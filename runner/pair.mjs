// runner/pair.mjs
// 配对码输入 + 会话凭据的本地持久化。
// 设计原则：配对码只在"首次配对"时需要人输，之后靠 token 静默重连。

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import readline from "node:readline/promises";
import { PAIR_CODE_LENGTH } from "./protocol.mjs";

/** 凭据目录：~/.hot100-runner/。实测体积 <5KB。 */
export function credentialsDir() {
  return path.join(os.homedir(), ".hot100-runner");
}

export function credentialsPath() {
  return path.join(credentialsDir(), "session.json");
}

/**
 * 读取已保存的会话。
 * 任何异常（文件不存在、JSON 坏了）都当作"没有会话"，因为没有会话只是重新配对，
 * 而抛错会让用户对着栈发呆。
 */
export async function loadSession() {
  try {
    const text = await fs.readFile(credentialsPath(), "utf8");
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed.sid !== "string" || typeof parsed.token !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

/** 保存会话。目录权限 0700、文件 0600，避免同机其他用户读到 token。 */
export async function saveSession(session) {
  await fs.mkdir(credentialsDir(), { recursive: true, mode: 0o700 });
  await fs.writeFile(credentialsPath(), JSON.stringify(session, null, 2), { mode: 0o600 });
  return session;
}

export async function clearSession() {
  try {
    await fs.rm(credentialsPath(), { force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * 交互式输入配对码。
 * 非 TTY 环境（比如被脚本拉起）直接返回 null，让调用方给出明确提示，
 * 而不是卡在 stdin 上等一个永远不会来的输入。
 */
export async function promptPairCode({ input = process.stdin, output = process.stdout } = {}) {
  if (!input.isTTY) return null;
  const rl = readline.createInterface({ input, output });
  try {
    const answer = await rl.question(
      `请粘贴网页上显示的 ${PAIR_CODE_LENGTH} 位配对码（回车确认）：`
    );
    const code = answer.trim().replace(/\s+/g, "");
    if (!/^\d+$/.test(code) || code.length !== PAIR_CODE_LENGTH) return "";
    return code;
  } finally {
    rl.close();
  }
}

/** 一次性配对成功后的问候语。 */
export function pairedMessage(session) {
  const when = session?.pairedAt ? new Date(session.pairedAt).toLocaleString("zh-CN") : "刚刚";
  return `已绑定到这个浏览器的会话（${when}）。下次启动会自动重连，不用再输配对码。`;
}
