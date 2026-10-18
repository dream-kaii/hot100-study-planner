// src/online/protocol.js
// Worker 端的帧协议常量与校验。
// 与 runner/protocol.mjs 保持同一份定义（分布式复制的取舍见文末）。
//
// 为什么不在 Worker 里直接 import runner/protocol.mjs：
// wrangler 打包时会把 import 到的文件一起打，runner/ 目录里有 node:fs / node:os
// 的引用链，一旦被卷进 Worker 构建就会报 "Cannot resolve node:fs"。
// 因此这里保持一份等价实现，并由 tests/online-protocol.test.mjs 校验两边行为一致。

export const MAX_FRAME_BYTES = 1024 * 1024;
export const PROTOCOL_VERSION = 1;
export const PAIR_CODE_LENGTH = 6;
export const PAIR_CODE_TTL_MS = 10 * 60 * 1000;
export const IDLE_TIMEOUT_MS = 90 * 1000;

export const FRAME = {
  HELLO: "hello",
  DONE: "done",
  PRESENCE: "presence",
  ERROR: "error",
  RUN: "run",
  PING: "ping",
  PONG: "pong"
};

export const SESSION_STATE = {
  IDLE: "IDLE",
  PAIRED: "PAIRED",
  ONLINE: "ONLINE",
  DEAD: "DEAD"
};

export function generatePairCode() {
  const digits = new Uint8Array(PAIR_CODE_LENGTH);
  crypto.getRandomValues(digits);
  let code = "";
  for (const byte of digits) code += String(byte % 10);
  return code;
}

export function generateToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function timingSafeEqual(a = "", b = "") {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function encodeFrame(frame) {
  const payload = JSON.stringify({ v: PROTOCOL_VERSION, ...frame });
  if (new TextEncoder().encode(payload).byteLength > MAX_FRAME_BYTES) throw new Error("帧超过 1MB 上限");
  return payload;
}

export function decodeFrame(raw) {
  const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
  if (new TextEncoder().encode(text).byteLength > MAX_FRAME_BYTES) return { ok: false, error: "帧超过 1MB 上限" };
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "帧不是有效 JSON" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false, error: "帧必须是 JSON 对象" };
  if (typeof parsed.t !== "string") return { ok: false, error: "帧缺少 t 字段" };
  return { ok: true, frame: parsed };
}
