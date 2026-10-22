// runner/session.mjs
// WSS 客户端：连隧道、心跳、指数退避重连、收帧派发。
// 刻意不 import 判题核心，判题逻辑由 index.mjs 注入（onRun），
// 这样 session 层可以单独测，不需要真的跑 java/python。

import { FRAME, HEARTBEAT_INTERVAL_MS, encodeFrame, decodeFrame } from "./protocol.mjs";

/** 退避序列。前几次快，避免用户以为没反应；封顶 30s，避免把 Worker 打爆。 */
const BACKOFF_MS = [500, 1000, 2000, 4000, 8000, 15000, 30000];

/** Node 18 没有全局 WebSocket，只有 22+ 才有。这里做兼容。 */
async function resolveWebSocket() {
  if (typeof globalThis.WebSocket === "function") return globalThis.WebSocket;
  try {
    const mod = await import("undici");
    if (typeof mod.WebSocket === "function") return mod.WebSocket;
  } catch {
    /* 继续往下探 */
  }
  try {
    const mod = await import("ws");
    if (typeof mod.WebSocket === "function") return mod.WebSocket;
    if (typeof mod.default === "function") return mod.default;
  } catch {
    /* 继续往下探 */
  }
  return null;
}

/**
 * 隧道客户端。
 * 状态机：IDLE → CONNECTING → OPEN → (CLOSING) → IDLE
 * 断线后自动退避重连，直到 close() 被显式调用。
 */
export class Tunnel {
  constructor({ url, token, sid = "", code = "", onRun, onPaired = null, onPeerState = () => {}, onLog = () => {}, onStateChange = () => {}, WebSocketImpl = null }) {
    this.url = url;
    this.token = token;
    /** 已有 token 时用 sid 直连；只有配对码时用 code 让 Worker 去查 sid。 */
    this.sid = sid;
    this.code = code;
    this.onRun = onRun;
    this.onPaired = onPaired;
    this.onPeerState = onPeerState;
    this.onLog = onLog;
    this.onStateChange = onStateChange;
    this.WebSocketImpl = WebSocketImpl;
    this.ws = null;
    this.state = "IDLE";
    this.backoffIndex = 0;
    this.heartbeatTimer = null;
    this.reconnectTimer = null;
    this.stopped = false;
    this.inFlight = 0;
    this.joined = false;
  }

  /**
   * 拼连接地址。
   *   - 只有配对码：?code=123456，Worker 会用 Lobby 把它换成 sid
   *   - 已经有 token：?sid=...&token=...，直接进对应会话
   * 配对码不带 sid，因为用户手上只有 6 位数字。
   */
  buildEndpoint() {
    // runner 永远是 runner 角色，必须显式带上：Worker 靠它决定要不要走配对码查找。
    const params = new URLSearchParams({ role: "runner" });
    if (this.sid && this.token && !this.token.startsWith("pair:")) {
      params.set("sid", this.sid);
      params.set("token", this.token);
    } else {
      const code = this.code || (this.token?.startsWith("pair:") ? this.token.slice(5) : "");
      if (code) params.set("code", code);
      else if (this.token) params.set("token", this.token);
    }
    const base = this.url.includes("?") ? `${this.url}&` : `${this.url}?`;
    return `${base}${params.toString()}`;
  }

  setState(next, detail = {}) {
    if (this.state === next) return;
    this.state = next;
    this.onStateChange({ state: next, ...detail });
  }

  /** 建立连接。resolve 在第一次 OPEN 时完成，失败也一样 reject 由调用方决定。 */
  async connect() {
    if (!this.WebSocketImpl) {
      this.WebSocketImpl = await resolveWebSocket();
      if (!this.WebSocketImpl) {
        const error = new Error(
          "当前 Node 没有可用的 WebSocket 实现。需要 Node 22+，或在本目录执行 npm install 安装 ws。"
        );
        error.code = "NO_WEBSOCKET";
        throw error;
      }
    }
    this.stopped = false;
    return this.open();
  }

  open() {
    return new Promise((resolve, reject) => {
      const endpoint = this.buildEndpoint();
      this.setState("CONNECTING");
      let settled = false;
      let socket;
      try {
        socket = new this.WebSocketImpl(endpoint);
      } catch (cause) {
        this.setState("IDLE");
        reject(cause);
        return;
      }
      this.ws = socket;

      socket.addEventListener("open", () => {
        this.backoffIndex = 0;
        this.capturePairingHeaders(socket);
        this.setState("OPEN");
        this.send({ t: FRAME.HELLO, payload: { role: "runner", pid: process.pid, node: process.version } });
        this.startHeartbeat();
        if (!settled) { settled = true; resolve(); }
      });

      socket.addEventListener("message", (event) => {
        this.handleMessage(event.data);
      });

      socket.addEventListener("error", (event) => {
        this.onLog("warn", `WebSocket 错误：${event?.message || event?.error?.message || "未知"}`);
        if (!settled) { settled = true; reject(new Error("WebSocket 连接失败")); }
      });

      socket.addEventListener("close", (event) => {
        this.stopHeartbeat();
        this.ws = null;
        this.setState("IDLE", { code: event?.code, reason: event?.reason });
        if (!settled) { settled = true; reject(new Error(`连接被关闭（${event?.code ?? "?"}）`)); return; }
        if (!this.stopped) this.scheduleReconnect();
      });
    });
  }

  /**
   * 配对握手：Worker 在用一次性配对码验证通过后，会在 101 响应里带上
   * x-hot100-token / x-hot100-sid。这里取出来交给 onPaired 落盘。
   * 浏览器 WebSocket API 在 Node 的 undici/ws 实现里没有暴露 headers，
   * 所以两路兜底：能读到就立刻用，读不到就等 Worker 推 hello 帧。
   */
  capturePairingHeaders(socket) {
    let headers = null;
    try {
      const response = socket?._socket?.response || socket?.response;
      headers = response?.headers ?? null;
    } catch { /* 实现不暴露，走 hello 帧兜底 */ }
    if (!headers) return;
    const read = (name) => (typeof headers.get === "function" ? headers.get(name) : headers[name]);
    const token = read("x-hot100-token");
    const sid = read("x-hot100-sid");
    if (token && sid) this.emitPaired({ sid, token });
  }

  emitPaired(payload) {
    if (!payload?.token || !payload?.sid) return;
    // 配对成功后立刻把凭据切到内存里：
    // 配对码是一次性的，如果用旧 code 重连会被 401 拒绝，导致无限重连。
    this.sid = payload.sid;
    this.token = payload.token;
    this.code = "";
    if (!this.onPaired || this.pairedEmitted) return;
    this.pairedEmitted = true;
    this.onPaired(payload);
  }

  handleMessage(raw) {
    const decoded = decodeFrame(raw);
    if (!decoded.ok) {
      this.onLog("warn", `收到坏帧：${decoded.error}`);
      return;
    }
    const frame = decoded.frame;
    switch (frame.t) {
      case FRAME.PING:
        this.send({ t: FRAME.PONG, payload: frame.payload ?? null });
        return;
      case FRAME.PONG:
        return;
      case FRAME.RUN:
        this.handleRun(frame);
        return;
      case FRAME.HELLO:
        // Worker 在配对成功后推的 hello 带 sid/token，作为响应头不可读时的兜底。
        if (frame.payload?.token && frame.payload?.sid) this.emitPaired(frame.payload);
        return;
      case FRAME.ERROR: {
        // 网页还没连上时，Session 会回 PEER_OFFLINE —— 这是正常的中间态，不当错误。
        const code = frame.payload?.code || "";
        const message = frame.payload?.message || "";
        if (code === "PEER_OFFLINE") this.onLog("info", "网页端尚未连接，等待中");
        else this.onLog("warn", `服务端提示：${message || code || "未知错误"}`);
        return;
      }
      case FRAME.PRESENCE:
        // Worker 告诉我们网页那一端的状态。走独立回调：
        // 混进 onStateChange 会被当成一次新的 OPEN，日志里重复出现"已连上隧道"。
        this.onPeerState(frame.payload?.peer || "unknown");
        return;
      default:
        this.onLog("warn", `未知帧类型：${frame.t}`);
    }
  }

  async handleRun(frame) {
    const requestId = frame.payload?.requestId || frame.id || null;
    this.inFlight += 1;
    try {
      const result = await this.onRun(frame);
      this.send({ t: FRAME.DONE, id: requestId, payload: result });
    } catch (error) {
      this.send({
        t: FRAME.ERROR,
        id: requestId,
        payload: { code: "RUN_THREW", message: error?.message || String(error) }
      });
    } finally {
      this.inFlight -= 1;
    }
  }

  send(frame) {
    if (!this.ws || this.ws.readyState !== 1) return false;
    try {
      this.ws.send(encodeFrame(frame));
      return true;
    } catch (error) {
      this.onLog("warn", `发送失败：${error?.message || error}`);
      return false;
    }
  }

  startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.send({ t: FRAME.PING, payload: { at: Date.now() } });
    }, HEARTBEAT_INTERVAL_MS);
    this.heartbeatTimer.unref?.();
  }

  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  scheduleReconnect() {
    // 一次只允许有一个待触发的重连定时器。
    // 不加这个守卫时，error 与 close 两个回调会各排一次，而每次失败又排两个，
    // 定时器数量指数增长 —— 实测重连次数飙到 39 万，日志被刷爆。
    if (this.stopped || this.reconnectTimer) return;
    const wait = BACKOFF_MS[Math.min(this.backoffIndex, BACKOFF_MS.length - 1)];
    this.backoffIndex += 1;
    this.onLog("info", `${(wait / 1000).toFixed(1)} 秒后重连（第 ${this.backoffIndex} 次）`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.stopped) return;
      this.connect().catch((error) => {
        this.onLog("warn", `重连失败：${error.message}`);
        if (!this.stopped) this.scheduleReconnect();
      });
    }, wait);
    // 这个定时器必须是 ref 的。断线期间 socket 已关、心跳已停，
    // 如果重连也 unref，事件循环里就一个 ref 的 handle 都没有了，
    // Node 会以退出码 0 静默退出；而 launchd 的 KeepAlive.SuccessfulExit=false
    // 又不会把它拉起来 —— 现象就是"用着好好的，过几小时突然让你重新启动运行助手"。
    this.reconnectTimer.ref?.();
  }

  /** 优雅关闭：先告诉对端，再断，且不再重连。 */
  close() {
    this.stopped = true;
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try { this.ws.close(1000, "runner shutdown"); } catch { /* 已经断了 */ }
      this.ws = null;
    }
    this.setState("IDLE");
  }
}
