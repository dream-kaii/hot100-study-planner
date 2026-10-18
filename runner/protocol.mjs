// runner/protocol.mjs
// 帧协议：网页 ↔ Worker ↔ 本机 runner 三方共用。
// 这里刻意不 import 判题核心，任何一端（含 Worker 的纯 JS 环境）都能安全加载。

/** 单帧上限 1MB。用例输入实测最长 <2KB，留足余量。 */
export const MAX_FRAME_BYTES = 1024 * 1024;

/** 帧类型。方向用注释标出，避免三方各写一套字符串。 */
export const FRAME = {
  // 本机 runner → Worker → 网页
  HELLO: "hello",       // runner 报出自己的身份与能力
  DONE: "done",         // 一次 run 的全部用例结果
  PRESENCE: "presence", // runner 在线状态变化（连上/断开）
  ERROR: "error",       // 协议级错误，不是用户代码错误

  // 网页 → Worker → 本机 runner
  RUN: "run",           // 发起一次判题
  PING: "ping",         // 应用层心跳
  PONG: "pong"
};

/** 配对码长度。6 位纯数字，仅用于首次换取 token。 */
export const PAIR_CODE_LENGTH = 6;

/** 配对码有效期 10 分钟。过期后网页需重新生成。 */
export const PAIR_CODE_TTL_MS = 10 * 60 * 1000;

/** 已经拿到 token 的连接，空闲 90s 未收到任何帧则视为死亡。 */
export const IDLE_TIMEOUT_MS = 90 * 1000;

/** 应用层心跳间隔。Worker 端的 WebSocket 只要有人发帧就不会被判定空闲。 */
export const HEARTBEAT_INTERVAL_MS = 25 * 1000;

/** 协议版本。Runner 与 Worker 版本不一致时网页能给出可读提示而不是白屏。 */
export const PROTOCOL_VERSION = 1;

/**
 * 生成 6 位配对码。
 * 用 crypto.getRandomValues 而不是 Math.random：后者在 Worker 里可预测。
 * 去掉全 0 / 全 9 这类易被误以为占位的码没有意义，保留纯随机保证均匀。
 */
export function generatePairCode() {
  const digits = new Uint8Array(PAIR_CODE_LENGTH);
  crypto.getRandomValues(digits);
  let code = "";
  for (const byte of digits) code += String(byte % 10);
  return code;
}

/** 生成会话 token（32 字节 hex）。 */
export function generateToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * 恒定时间字符串比较，避免 token 校验被时序攻击。
 * 长度不同直接返回 false（长度本身就泄露不了有效 token，因为长度固定）。
 */
export function timingSafeEqual(a = "", b = "") {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * 编码一帧。
 * 返回 string，因为 WebSocket 文本帧在 Worker 与浏览器之间最省事，
 * 且能保住 emoji / 中文报错信息。
 */
export function encodeFrame(frame) {
  const payload = JSON.stringify({ v: PROTOCOL_VERSION, ...frame });
  if (new TextEncoder().encode(payload).byteLength > MAX_FRAME_BYTES) {
    throw new Error("帧超过 1MB 上限");
  }
  return payload;
}

/**
 * 解码一帧。任何异常都收敛成 { ok: false, error }，
 * 因为一帧坏数据不该让整条连接抛栈。
 */
export function decodeFrame(raw) {
  const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
  if (new TextEncoder().encode(text).byteLength > MAX_FRAME_BYTES) {
    return { ok: false, error: "帧超过 1MB 上限" };
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "帧不是有效 JSON" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "帧必须是 JSON 对象" };
  }
  if (typeof parsed.t !== "string") return { ok: false, error: "帧缺少 t 字段" };
  return { ok: true, frame: parsed };
}

/**
 * 校验一次 run 请求。
 * 这一层和 src/server/local-runner.mjs 的 validateRunnerRequest 保持同一口径，
 * 差别只是"HTTP body"换成了"WS 帧"：语言/模式白名单、代码大小、cases 结构。
 */
export function validateRunFrame(frame, { supportedLanguages, supportedModes, maxCodeBytes = 256 * 1024 }) {
  if (!frame || typeof frame !== "object") return { ok: false, error: "run 帧缺失" };
  const payload = frame.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { ok: false, error: "run 帧缺少 payload" };
  if (!supportedLanguages.includes(payload.language)) return { ok: false, error: "language 不受支持" };
  const mode = payload.mode || (payload.func ? "function" : "acm");
  if (!supportedModes.includes(mode)) return { ok: false, error: "mode 不受支持" };
  if (typeof payload.code !== "string") return { ok: false, error: "code 必须为字符串" };
  if (payload.code.length > maxCodeBytes) return { ok: false, error: "代码超过 256KB 上限" };
  if (payload.cases !== undefined && !Array.isArray(payload.cases)) return { ok: false, error: "cases 必须为数组" };
  if (Array.isArray(payload.cases) && payload.cases.length > 64) return { ok: false, error: "单次最多 64 条用例" };
  // function 模式必须有 func 契约，否则 runExample 无法生成调用入口。
  if (mode === "function" && (!payload.func || typeof payload.func !== "object")) {
    return { ok: false, error: "function 模式缺少 func 契约" };
  }
  // 输入总大小也要挡住：64 条大用例同样能把 runExample 撑爆。
  const inputBytes = new TextEncoder().encode(JSON.stringify(payload.cases ?? [])).byteLength;
  if (inputBytes > MAX_FRAME_BYTES / 2) return { ok: false, error: "用例输入超过 512KB 上限" };
  return { ok: true, payload: { ...payload, mode } };
}
