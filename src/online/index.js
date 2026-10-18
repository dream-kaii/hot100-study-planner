// src/online/index.js
// 线上 Worker 入口。
//
// 它替代目前只做 env.ASSETS.fetch 的那个 5 行 worker.js，但**不改动那个文件**：
// 要启用时，把 wrangler.jsonc 的 "main" 指向本文件即可，回滚也只是改回一行。
//
// 路由：
//   POST /api/pair        网页申请配对码（生成本次会话的 sid）
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

  const stub = env.SESSION.get(env.SESSION.idFromName(sid));
  return stub.fetch(`https://session/ws?${params.toString()}`, request);
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
