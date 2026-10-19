// src/online/index.js
// 线上 Worker 入口。
//
// 它替代目前只做 env.ASSETS.fetch 的那个 5 行 worker.js，但**不改动那个文件**：
// 要启用时，把 wrangler.jsonc 的 "main" 指向本文件即可，回滚也只是改回一行。
//
// 路由：
//   POST /api/pair        网页申请配对码（生成本次会话的 sid）
//   POST /api/adopt       按设备找回已经配过对的会话（换浏览器/清数据不用重配对）
//   GET  /api/device/backup  读这台设备上次选的备份文件夹名
//   POST /api/device/backup  记下这台设备选的备份文件夹名
//   GET  /api/status/:sid 查会话/runner 在线状态
//   GET  /ws?sid=&role=   WebSocket：网页（role=browser）
//   GET  /ws?code=&token= WebSocket：runner（只有 6 位配对码，靠 Lobby 换 sid）
//   其余                  回退给 env.ASSETS（和现在行为一致）

import { Session } from "./session.js";
import { Lobby } from "./lobby.js";
import { SESSION_STATE } from "./protocol.js";

export { Session, Lobby };

/** 单个全局 Lobby 实例：配对码索引只有一份。 */
const LOBBY_NAME = "hot100-runner-lobby";

const SID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
const CODE_PATTERN = /^\d{6}$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      return handleApi(request, url, env);
    }
    if (url.pathname === "/ws") {
      return handleWebSocket(request, url, env);
    }
    return env.ASSETS.fetch(request);
  }
};

function lobbyStub(env) {
  return env.LOBBY.get(env.LOBBY.idFromName(LOBBY_NAME));
}

async function handleApi(request, url, env) {
  if (url.pathname === "/api/pair") {
    if (request.method !== "POST") return json({ error: "只支持 POST" }, 405);
    const sid = await newSid();
    const stub = env.SESSION.get(env.SESSION.idFromName(sid));
    const paired = await stub.fetch(`https://session/pair`, {
      method: "POST",
      headers: { "x-hot100-sid": sid }
    });
    const body = await paired.json();
    if (!paired.ok) return json({ error: body.error || "配对码生成失败" }, paired.status);

    // 登记 code → sid，runner 才能用 6 位码找到这个会话。
    const registered = await lobbyStub(env).fetch("https://lobby/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: body.code, sid })
    });
    if (!registered.ok) {
      const reason = await registered.json().catch(() => ({}));
      return json({ error: reason.error || "配对码登记失败" }, registered.status);
    }

    return json({ sid, code: body.code, expireAt: body.expireAt, state: SESSION_STATE.PAIRED });
  }

  // 找回同一台设备上已经配过对的会话。
  // 同一个人的浏览器和本机 runner 走同一条公网出口，所以用出口 IP 的哈希当设备身份：
  // 换浏览器、清数据、无痕窗口都还是同一台设备，不用再输配对码。
  if (url.pathname === "/api/adopt") {
    if (request.method !== "POST") return json({ error: "只支持 POST" }, 405);
    const ip = await deviceKey(request);
    if (!ip) return json({ error: "无法识别设备" }, 400);
    const found = await lobbyStub(env).fetch(`https://lobby/adopt?ip=${ip}`, { method: "POST" });
    const body = await found.json().catch(() => ({}));
    if (!found.ok) return json({ error: body.error || "没有找到已配对的助手" }, found.status);
    return json({ sid: body.sid });
  }

  // 备份位置只记"文件夹名字"：真正的目录句柄没法跨浏览器共享
  // （File System Access 的句柄是浏览器本地凭据，换浏览器必须重新授权一次）。
  // 记下来是为了让另一个浏览器显示"已设置：xxx"，而不是"未设置"。
  if (url.pathname === "/api/device/backup") {
    const ip = await deviceKey(request);
    if (!ip) return json({ error: "无法识别设备" }, 400);
    if (request.method === "POST") {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: "请求不是有效 JSON" }, 400);
      }
      const name = String(body?.name || "").slice(0, 120);
      if (!name) return json({ error: "缺少文件夹名称" }, 400);
      const saved = await lobbyStub(env).fetch("https://lobby/backup", {
        method: "POST",
        headers: { "content-type": "application/json", "x-hot100-device": ip },
        body: JSON.stringify({ name })
      });
      return new Response(saved.body, { status: saved.status, headers: saved.headers });
    }
    const found = await lobbyStub(env).fetch(`https://lobby/backup?ip=${ip}`);
    return new Response(found.body, { status: found.status, headers: found.headers });
  }

  if (url.pathname.startsWith("/api/status/")) {
    const sid = url.pathname.slice("/api/status/".length);
    if (!SID_PATTERN.test(sid)) return json({ error: "sid 格式不正确" }, 400);
    const stub = env.SESSION.get(env.SESSION.idFromName(sid));
    const status = await stub.fetch(`https://session/status`);
    return new Response(status.body, { status: status.status, headers: status.headers });
  }

  return json({ error: "未知接口" }, 404);
}

async function handleWebSocket(request, url, env) {
  const token = url.searchParams.get("token") || "";
  const code = url.searchParams.get("code") || "";
  // 只有 runner 会用配对码；带 code 就按 runner 处理，避免调用方漏带 role 时静默失败。
  const role = url.searchParams.get("role") === "runner" || (CODE_PATTERN.test(code) && !url.searchParams.get("role"))
    ? "runner"
    : "browser";

  let sid = url.searchParams.get("sid") || "";

  // runner 只有配对码时，先问 Lobby 要 sid。
  if (!sid && role === "runner" && CODE_PATTERN.test(code)) {
    const looked = await lobbyStub(env).fetch(`https://lobby/lookup?code=${encodeURIComponent(code)}`);
    if (!looked.ok) {
      const reason = await looked.json().catch(() => ({}));
      return json({ error: reason.error || "配对码无效" }, looked.status);
    }
    const found = await looked.json();
    sid = found.sid;
  }

  if (!SID_PATTERN.test(sid)) return json({ error: "sid 格式不正确，或配对码已过期" }, 400);

  // 只把必要字段转给 Session，避免把用户的其它 query 带进日志。
  const params = new URLSearchParams({ role });
  if (role === "runner") {
    // 用配对码首次连接时，由 Worker 补成 token=pair:<code>
    const effective = token || (CODE_PATTERN.test(code) ? `pair:${code}` : "");
    if (effective) params.set("token", effective);
  }

  // runner 连上来时记一下"这台设备的助手在哪个会话"，网页侧才能自动找回。
  // 必须在转发 WebSocket 之前 await 完，之后 request 就不归我们了。
  if (role === "runner") {
    const ip = await deviceKey(request);
    if (ip) {
      await lobbyStub(env)
        .fetch("https://lobby/runner-online", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ip, sid })
        })
        .catch(() => {});
    }
  }

  const stub = env.SESSION.get(env.SESSION.idFromName(sid));
  return stub.fetch(`https://session/ws?${params.toString()}`, request);
}

/**
 * 设备指纹：用公网出口 IP 的哈希。
 * 不存明文 IP，也不做跨站点追踪——换个网络它就变了，变化时退回配对码，不会卡住。
 */
async function deviceKey(request) {
  const ip = request.headers.get("CF-Connecting-IP") || "";
  if (!ip) return "";
  const data = new TextEncoder().encode(`hot100-device-v1:${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

/** sid：16 字节随机 hex（32 字符），足够做 DO 的 name，且不可猜。 */
async function newSid() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}
