// src/online/lobby.js
// Durable Object：配对码 → 会话 sid 的短期索引。
//
// 为什么需要它：
//   网页侧知道 sid（/api/pair 返回的），但本机 runner 只拿到用户手输的 6 位配对码。
//   runner 必须能用配对码找到对应的 Session DO，否则它拼不出 WebSocket 地址。
//
// 安全性：
//   配对码只有 6 位（100 万空间），所以查找必须限流，否则可以被枚举。
//   这里对"查不到"的请求做全局窗口限流；查得到的那条会让 Session 自己再校验一次配对码，
//   所以即使有人猜中一个还在有效期内的码，也只能换一次 token，且码用掉即焚。
//
// 生命周期：条目 10 分钟过期，靠 alarm 清理，不在内存里留状态（会休眠）。

import { SESSION_STATE } from "./protocol.js";

/** 配对码有效期，和 Session 保持一致。 */
const ENTRY_TTL_MS = 10 * 60 * 1000;
/** 查不到的限流窗口：60 秒内最多 30 次失败查找。 */
const LOOKUP_WINDOW_MS = 60 * 1000;
const LOOKUP_FAIL_LIMIT = 30;

const KEY_PREFIX = "c:";
const KEY_FAILS = "lookupFails";
/** r:<设备指纹> → 这台设备的 runner 最近连过的会话，用来免配对找回。 */
const KEY_RUNNER = "r:";
/** b:<设备指纹> → 这台设备上次选的备份文件夹名。 */
const KEY_BACKUP = "b:";
const RUNNER_TTL_MS = 180 * 24 * 60 * 60 * 1000;
const BACKUP_TTL_MS = 365 * 24 * 60 * 60 * 1000;
const DEVICE_PATTERN = /^[0-9a-f]{32}$/;

export class Lobby {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname.endsWith("/register")) return this.handleRegister(request);
    if (url.pathname.endsWith("/lookup")) return this.handleLookup(url);
    if (url.pathname.endsWith("/runner-online")) return this.handleRunnerOnline(request);
    if (url.pathname.endsWith("/adopt")) return this.handleAdopt(url);
    if (url.pathname.endsWith("/backup")) return this.handleBackup(request, url);

    return json({ error: "未知路径" }, 404);
  }

  /** 网页申请到配对码后，把 code → sid 登记进来。 */
  async handleRegister(request) {
    if (request.method !== "POST") return json({ error: "只支持 POST" }, 405);
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "请求不是有效 JSON" }, 400);
    }
    const code = String(body?.code || "");
    const sid = String(body?.sid || "");
    if (!/^\d{6}$/.test(code)) return json({ error: "配对码格式不正确" }, 400);
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(sid)) return json({ error: "sid 格式不正确" }, 400);

    const expireAt = Date.now() + ENTRY_TTL_MS;
    // 必须用对象形式写入。put(key, value) 在部分实现/替身里会被当成对象遍历，静默丢数据。
    await this.state.storage.put({ [`${KEY_PREFIX}${code}`]: { sid, expireAt } });
    // 顺手安排一次清理。alarm 会取最早的那个，重复设置同一时间点无害。
    await this.state.storage.setAlarm(expireAt + 1000);
    return json({ ok: true, expireAt });
  }

  /** runner 用配对码换 sid。 */
  async handleLookup(url) {
    const code = url.searchParams.get("code") || "";
    if (!/^\d{6}$/.test(code)) return json({ error: "配对码格式不正确" }, 400);

    const fails = (await this.state.storage.get(KEY_FAILS)) || { count: 0, since: Date.now() };
    if (Date.now() - fails.since > LOOKUP_WINDOW_MS) {
      fails.count = 0;
      fails.since = Date.now();
    }
    if (fails.count >= LOOKUP_FAIL_LIMIT) {
      return json({ error: "配对码查找过于频繁，请稍后重试" }, 429);
    }

    const entry = await this.state.storage.get(`${KEY_PREFIX}${code}`);
    if (!entry || Date.now() > entry.expireAt) {
      fails.count += 1;
      await this.state.storage.put({ [KEY_FAILS]: fails });
      if (entry) await this.state.storage.delete(`${KEY_PREFIX}${code}`);
      return json({ error: "配对码不存在或已过期，请在网页上重新点运行" }, 404);
    }

    return json({ sid: entry.sid, state: SESSION_STATE.PAIRED });
  }

  /** runner 每次连上隧道都来登记一次，记下"这台设备的助手现在在哪个会话"。 */
  async handleRunnerOnline(request) {
    if (request.method !== "POST") return json({ error: "只支持 POST" }, 405);
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "请求不是有效 JSON" }, 400);
    }
    const ip = String(body?.ip || "");
    const sid = String(body?.sid || "");
    if (!DEVICE_PATTERN.test(ip)) return json({ error: "设备指纹格式不正确" }, 400);
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(sid)) return json({ error: "sid 格式不正确" }, 400);

    const expireAt = Date.now() + RUNNER_TTL_MS;
    await this.state.storage.put({ [`${KEY_RUNNER}${ip}`]: { sid, at: Date.now(), expireAt } });
    await this.state.storage.setAlarm(expireAt + 1000);
    return json({ ok: true });
  }

  /**
   * 网页说"我是这台设备，把我已经配好的会话还给我"。
   * ip 由 Worker 从请求头算出，客户端传不进来，所以没法枚举别人的会话。
   */
  async handleAdopt(url) {
    const ip = url.searchParams.get("ip") || "";
    if (!DEVICE_PATTERN.test(ip)) return json({ error: "设备指纹格式不正确" }, 400);
    const entry = await this.state.storage.get(`${KEY_RUNNER}${ip}`);
    if (!entry) return json({ error: "这台设备还没有配过对的助手" }, 404);
    return json({ sid: entry.sid, at: entry.at });
  }

  /** 备份文件夹名（只有名字，没有路径——浏览器拿不到完整路径）。 */
  async handleBackup(request, url) {
    if (request.method === "POST") {
      const ip = request.headers.get("x-hot100-device") || "";
      if (!DEVICE_PATTERN.test(ip)) return json({ error: "设备指纹格式不正确" }, 400);
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: "请求不是有效 JSON" }, 400);
      }
      const name = String(body?.name || "").trim().slice(0, 120);
      if (!name) return json({ error: "缺少文件夹名称" }, 400);
      const expireAt = Date.now() + BACKUP_TTL_MS;
      await this.state.storage.put({ [`${KEY_BACKUP}${ip}`]: { name, at: Date.now(), expireAt } });
      await this.state.storage.setAlarm(expireAt + 1000);
      return json({ ok: true, name });
    }

    const ip = url.searchParams.get("ip") || "";
    if (!DEVICE_PATTERN.test(ip)) return json({ error: "设备指纹格式不正确" }, 400);
    const entry = await this.state.storage.get(`${KEY_BACKUP}${ip}`);
    if (!entry) return json({});
    return json({ name: entry.name, at: entry.at });
  }

  /** 清理过期条目。 */
  async alarm() {
    const all = await this.state.storage.list();
    const now = Date.now();
    const stale = [];
    let nextAlarm = 0;
    for (const [key, value] of all) {
      // 限流计数没有 expireAt，跳过。
      if (!value || typeof value.expireAt !== "number") continue;
      if (now > value.expireAt) stale.push(key);
      else if (!nextAlarm || value.expireAt < nextAlarm) nextAlarm = value.expireAt;
    }
    if (stale.length) await this.state.storage.delete(stale);
    if (nextAlarm) await this.state.storage.setAlarm(nextAlarm + 1000);
  }
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}
