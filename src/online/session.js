// src/online/session.js
// Durable Object：一个 Session 实例 = 一个（网页，runner）配对通道。
//
// 关键设计（都是踩过的坑）：
//   1. 用 Hibernation API（state.acceptWebSocket + webSocketMessage），
//      而不是 ws.accept()。后者只要连接挂着就按 128MB 全时计费，
//      免费额度（13,000 GB-s/天 ≈ 28 小时活跃）会被几十个用户吃光。
//   2. 状态必须能跨休眠恢复：hibernation 后内存里的字段会没，
//      所以状态与 token 一律进 storage，内存字段只做缓存。
//   3. 僵尸清理靠 alarm()，不能只依赖 close 事件：网络半断开时 close 可能不触发。
//   4. 配对码一次性：换到 token 立刻作废，且限 5 次/分钟，防 6 位数字爆破。

import {
  FRAME,
  SESSION_STATE,
  PAIR_CODE_TTL_MS,
  IDLE_TIMEOUT_MS,
  encodeFrame,
  decodeFrame,
  generatePairCode,
  generateToken,
  timingSafeEqual
} from "./protocol.js";

/** 配对尝试限流：窗口 60s 内最多 5 次。6 位码空间 100 万，此限速下爆破不可行。 */
const PAIR_ATTEMPT_WINDOW_MS = 60 * 1000;
const PAIR_ATTEMPT_LIMIT = 5;

const KEY_STATE = "state";
const KEY_TOKEN = "token";
const KEY_PAIR_CODE = "pairCode";
const KEY_PAIR_EXPIRE = "pairExpire";
const KEY_PAIR_ATTEMPTS = "pairAttempts";
const KEY_LAST_SEEN = "lastSeen";
const KEY_SID = "sid";

export class Session {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  // ── HTTP 入口：网页侧调用 ────────────────────────────────────────────

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname.endsWith("/pair")) return this.handlePair(request);
    if (url.pathname.endsWith("/status")) return this.handleStatus(request);
    if (url.pathname.endsWith("/ws")) return this.handleWebSocket(request);

    return json({ error: "未知路径" }, 404);
  }

  /** 网页申请一个配对码。每次调用都作废旧码，避免堆积。 */
  async handlePair(request) {
    if (request.method !== "POST") return json({ error: "只支持 POST" }, 405);
    const current = (await this.state.storage.get(KEY_STATE)) || SESSION_STATE.IDLE;
    if (current === SESSION_STATE.ONLINE) {
      return json({ error: "这个会话已经绑定了运行助手", state: current }, 409);
    }
    const code = generatePairCode();
    const expireAt = Date.now() + PAIR_CODE_TTL_MS;
    // sid 由 Worker 生成并传进来（DO 自己不知道 idFromName 用的什么名字）。
    const sid = request.headers.get("x-hot100-sid") || "";
    await this.state.storage.put({
      [KEY_SID]: sid,
      [KEY_STATE]: SESSION_STATE.PAIRED,
      [KEY_PAIR_CODE]: code,
      [KEY_PAIR_EXPIRE]: expireAt,
      [KEY_PAIR_ATTEMPTS]: 0
    });
    await this.state.storage.setAlarm(Date.now() + IDLE_TIMEOUT_MS);
    return json({ code, expireAt });
  }

  /** 网页轮询状态；也用于 runner 连上后页面发现"可以运行了"。 */
  async handleStatus() {
    const [state, lastSeen] = await Promise.all([
      this.state.storage.get(KEY_STATE),
      this.state.storage.get(KEY_LAST_SEEN)
    ]);
    return json({
      state: state || SESSION_STATE.IDLE,
      lastSeen: lastSeen || 0,
      runnerOnline: this.socketsOf("runner").length > 0
    });
  }

  // ── WebSocket 入口：网页与 runner 都连这里 ──────────────────────────

  async handleWebSocket(request) {
    if (request.headers.get("Upgrade") !== "websocket") return json({ error: "需要 Upgrade: websocket" }, 426);

    const url = new URL(request.url);
    const role = url.searchParams.get("role") === "runner" ? "runner" : "browser";

    // 网页侧：必须已经走过 /pair，且拿到 sid（由 Worker 侧生成并写进 URL）。
    if (role === "browser") {
      const state = await this.state.storage.get(KEY_STATE);
      if (!state) return json({ error: "会话不存在" }, 404);
      return this.acceptWebSocket(role, request);
    }

    // runner 侧：token 或一次性配对码。
    const token = url.searchParams.get("token") || "";
    if (!token) return json({ error: "缺少 token" }, 401);

    if (token.startsWith("pair:")) {
      const verdict = await this.consumePairCode(token.slice("pair:".length));
      if (!verdict.ok) return json({ error: verdict.error }, verdict.status);
      // 配对成功：生成 token 写进 storage，并在握手响应头里回传，
      // 这样 runner 不必等第一帧就能持久化。
      return this.acceptWebSocket(role, request, { newToken: { token: verdict.token, sid: verdict.sid } });
    }

    const stored = await this.state.storage.get(KEY_TOKEN);
    if (!stored || !timingSafeEqual(stored, token)) return json({ error: "token 无效" }, 401);
    return this.acceptWebSocket(role, request);
  }

  acceptWebSocket(role, request, { newToken } = {}) {
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    // Hibernation API：连接挂起时不占 duration。
    // 角色只记在 tag 上（Hibernation 休眠后恢复得到），不放实例字段。
    this.state.acceptWebSocket(server, [role]);

    // 配对换到的 token 走两条路回传：
    //   a) 握手响应头 x-hot100-token / x-hot100-sid —— 部分 WebSocket 实现能读到
    //   b) 连接建立后立刻推一帧 hello —— 浏览器实现读不到响应头，靠这条兜底
    const headers = new Headers();
    if (newToken) {
      headers.set("x-hot100-token", newToken.token);
      headers.set("x-hot100-sid", newToken.sid);
      // hello 帧要在 return 之后才发得出去，所以挂到 microtask。
      queueMicrotask(() => {
        try {
          server.send(encodeFrame({ t: FRAME.HELLO, payload: { role: "worker", token: newToken.token, sid: newToken.sid } }));
        } catch { /* 对端已断 */ }
      });
    }
    void request;
    return new Response(null, { status: 101, webSocket: client, headers });
  }

  /**
   * 用配对码换 token。
   * 一次性 + 10 分钟过期 + 60s 内 5 次限流。
   */
  async consumePairCode(input) {
    const [code, expireAt, attempts] = await Promise.all([
      this.state.storage.get(KEY_PAIR_CODE),
      this.state.storage.get(KEY_PAIR_EXPIRE),
      this.state.storage.get(KEY_PAIR_ATTEMPTS)
    ]);

    if (!code || !expireAt) return { ok: false, status: 410, error: "没有待配对的会话，请在网页上重新点运行" };
    if (Date.now() > expireAt) return { ok: false, status: 410, error: "配对码已过期，请在网页上重新点运行" };

    const record = attempts || { count: 0, since: Date.now() };
    if (Date.now() - record.since > PAIR_ATTEMPT_WINDOW_MS) {
      record.count = 0;
      record.since = Date.now();
    }
    if (record.count >= PAIR_ATTEMPT_LIMIT) {
      return { ok: false, status: 429, error: "配对尝试过于频繁，请 1 分钟后再试" };
    }
    record.count += 1;
    // 必须用对象形式写入。Cloudflare 的 storage.put 同时支持 put(key, value)
    // 与 put({...})，但对象形式只有一次 await，且不会因为键名写错而静默丢数据。
    await this.state.storage.put({ [KEY_PAIR_ATTEMPTS]: record });

    if (!timingSafeEqual(code, String(input))) return { ok: false, status: 401, error: "配对码不正确" };

    const token = generateToken();
    // 码用掉即焚：即使别人看到了同一串数字也换不到 token。
    await this.state.storage.put({ [KEY_TOKEN]: token, [KEY_STATE]: SESSION_STATE.ONLINE });
    await this.state.storage.delete([KEY_PAIR_CODE, KEY_PAIR_EXPIRE, KEY_PAIR_ATTEMPTS]);
    await this.state.storage.setAlarm(Date.now() + IDLE_TIMEOUT_MS);
    const sid = (await this.state.storage.get(KEY_SID)) || "";
    return { ok: true, token, sid };
  }

  // ── 帧转发（Hibernation 回调，全部是 async）─────────────────────────

  async webSocketMessage(ws, raw) {
    const decoded = decodeFrame(raw);
    if (!decoded.ok) {
      safeSend(ws, { t: FRAME.ERROR, payload: { code: "BAD_FRAME", message: decoded.error } });
      return;
    }
    const frame = decoded.frame;
    await this.state.storage.put({ [KEY_LAST_SEEN]: Date.now() });

    if (frame.t === FRAME.PING) {
      safeSend(ws, { t: FRAME.PONG, payload: frame.payload ?? null });
      return;
    }
    if (frame.t === FRAME.PONG) return;

    // Worker 不解析用例、不执行代码，只做转发。
    const target = this.peerOf(ws);
    if (!target) {
      safeSend(ws, { t: FRAME.ERROR, payload: { code: "PEER_OFFLINE", message: "另一端未连接" } });
      return;
    }
    try {
      target.send(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
    } catch {
      safeSend(ws, { t: FRAME.ERROR, payload: { code: "FORWARD_FAILED", message: "转发失败，另一端可能已断开" } });
    }
  }

  async webSocketClose(ws, code, reason) {
    // close 回调触发时 ws 已从 getWebSockets 里移除，所以先通知对端再判断。
    const peer = this.peerOf(ws);
    if (peer) {
      try { peer.send(encodeFrame({ t: FRAME.PRESENCE, payload: { peer: "offline" } })); } catch { /* 已断 */ }
    }
    if (this.socketsOf("runner").length === 0) {
      // runner 走了，会话退回"待配对"，让页面能重新生成配对码。
      await this.state.storage.put({ [KEY_STATE]: SESSION_STATE.PAIRED });
      await this.state.storage.setAlarm(Date.now() + IDLE_TIMEOUT_MS);
    }
    void code;
    void reason;
  }

  async webSocketError() {
    // 出错时连接会被 close 回调接管，这里不需要额外动作。
  }

  /**
   * 找对端连接。
   * 必须走 state.getWebSockets(tag) 而不是内存字段：
   * Hibernation 休眠后实例字段会清空，用内存引用会表现为"明明两边都连着却报 PEER_OFFLINE"。
   */
  peerOf(ws) {
    const tags = this.state.getTags(ws) || [];
    const targetTag = tags.includes("runner") ? "browser" : "runner";
    const peers = this.state.getWebSockets(targetTag) || [];
    return peers.length ? peers[0] : null;
  }

  /** 当前在线的连接（同样不依赖内存状态）。 */
  socketsOf(tag) {
    return this.state.getWebSockets(tag) || [];
  }

  /**
   * 僵尸清理。
   * 绝不能只靠 close 事件：网络半断开（拔网线、合盖）时 close 可能永远不触发，
   * 页面就会一直显示"在线"然后每次运行都超时。这里主动推进状态。
   */
  async alarm() {
    const lastSeen = (await this.state.storage.get(KEY_LAST_SEEN)) || 0;
    const state = (await this.state.storage.get(KEY_STATE)) || SESSION_STATE.IDLE;
    const silent = Date.now() - lastSeen;

    if (state === SESSION_STATE.ONLINE && silent > IDLE_TIMEOUT_MS) {
      for (const ws of this.state.getWebSockets()) {
        try { ws.close(4001, "idle timeout"); } catch { /* 已断 */ }
      }
      await this.state.storage.put({ [KEY_STATE]: SESSION_STATE.DEAD });
      // 状态回到需要重新配对，避免页面拿着一个永远连不上的 sid。
      await this.state.storage.delete([KEY_TOKEN]);
      return;
    }
    if (state === SESSION_STATE.PAIRED) {
      await this.state.storage.delete([KEY_PAIR_CODE, KEY_PAIR_EXPIRE]);
      await this.state.storage.put({ [KEY_STATE]: SESSION_STATE.IDLE });
      return;
    }
    if (silent <= IDLE_TIMEOUT_MS) {
      await this.state.storage.setAlarm(Date.now() + IDLE_TIMEOUT_MS);
    }
  }
}

function safeSend(ws, frame) {
  try { ws.send(encodeFrame(frame)); } catch { /* 对端已断 */ }
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}
