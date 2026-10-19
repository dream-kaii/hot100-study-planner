// runner/autoupdate.mjs
// 运行助手自更新：连上隧道后定期问服务器"现在最新是哪个版本"，
// 发现不一样就把自己替换掉。
//
// 为什么不直接信任下载到的内容：
//   下载的是会立刻执行的代码，所以在落盘之前做三道校验 ——
//   长度、产物标识、版本号必须同时对上。任何一道不过就保留旧文件。
//
// 为什么替换完成后是"另起一个进程再退出"而不是原地热替换：
//   原地换文件对已经加载到内存的代码没有作用；退出再拉起才能真正用上新代码。
//   launchd 那边配的是 KeepAlive.SuccessfulExit=false，正常退出不会触发重启，
//   所以由我们主动 spawn 一个脱离的子进程，然后自己退 0 —— 两边不会同时跑两个。

import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

/** 启动后等一会儿再查，避免和首次配对抢时间。可用环境变量调短（测试用）。 */
export const FIRST_CHECK_DELAY_MS = Number(process.env.HOT100_UPDATE_DELAY_MS) || 30 * 1000;
/** 之后的检查间隔。 */
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** 产物合法性的最小字节数（当前约 75KB，留足余量）。 */
const MIN_BUNDLE_BYTES = 30 * 1024;

/** wss://host/ws → https://host；解析不了返回 null。 */
export function httpBase(endpoint) {
  try {
    const url = new URL(endpoint);
    url.protocol = url.protocol === "wss:" ? "https:" : "http:";
    url.pathname = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

/** 从 VERSION.txt 里取 version 字段。 */
export function parseVersion(text) {
  const match = /^version:\s*(\S+)\s*$/m.exec(text || "");
  return match ? match[1] : null;
}

export async function fetchLatestVersion(base, { timeoutMs = 8000 } = {}) {
  const res = await fetch(`${base}/download/VERSION.txt`, {
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!res.ok) throw new Error(`VERSION.txt 返回 ${res.status}`);
  const version = parseVersion(await res.text());
  if (!version) throw new Error("VERSION.txt 里没有 version 字段");
  return version;
}

export async function downloadBundle(base, expectedVersion, { timeoutMs = 30000 } = {}) {
  const res = await fetch(`${base}/download/hot100-runner.mjs`, {
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!res.ok) throw new Error(`hot100-runner.mjs 返回 ${res.status}`);
  const text = await res.text();

  // 三道校验，全过才认可
  if (Buffer.byteLength(text, "utf8") < MIN_BUNDLE_BYTES) {
    throw new Error("产物过小，疑似下载不完整");
  }
  if (!text.includes("Hot 100 本机运行助手")) {
    throw new Error("产物缺少标识，不是运行助手");
  }
  if (!text.includes(expectedVersion)) {
    throw new Error(`产物版本号对不上（期望 ${expectedVersion}）`);
  }
  return text;
}

/** 原子替换：先写 .new，再 rename 覆盖，避免半截文件把旧的也毁了。 */
export async function installBundle(targetPath, text) {
  const dir = path.dirname(targetPath);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const tmp = `${targetPath}.new`;
  await fs.writeFile(tmp, text, { mode: 0o600 });
  await fs.chmod(tmp, 0o600);
  await fs.rename(tmp, targetPath);
}

/**
 * 用新文件重新拉起自己，然后调用方退出。
 * 返回子进程 pid，让调用方可以记日志。
 */
export function respawnSelf() {
  const script = process.argv[1];
  if (!script) throw new Error("拿不到自身脚本路径");
  const child = spawn(process.execPath, [script, ...process.argv.slice(2)], {
    detached: true,
    stdio: "ignore",
    cwd: process.cwd()
  });
  child.unref();
  return child.pid;
}

/**
 * 执行一次检查。返回 { updated, from, to, reason }。
 * 任何网络/校验失败都只返回 reason，不抛异常 —— 自更新坏了不能影响判题。
 */
export async function checkOnce({ endpoint, currentVersion, targetPath, log = () => {} }) {
  const base = httpBase(endpoint);
  if (!base) return { updated: false, reason: "隧道地址解析失败" };
  if (!currentVersion || currentVersion === "dev") {
    return { updated: false, reason: "开发模式，跳过" };
  }

  let latest;
  try {
    latest = await fetchLatestVersion(base);
  } catch (error) {
    return { updated: false, reason: `查不到最新版本：${error.message}` };
  }

  if (latest === currentVersion) return { updated: false, reason: "已是最新", latest };

  let text;
  try {
    text = await downloadBundle(base, latest);
  } catch (error) {
    return { updated: false, latest, reason: `下载失败：${error.message}` };
  }

  try {
    await installBundle(targetPath, text);
  } catch (error) {
    return { updated: false, latest, reason: `写入失败：${error.message}` };
  }

  log("info", `已更新 ${currentVersion} → ${latest}`);
  return { updated: true, from: currentVersion, to: latest };
}

// 版本 B：仅用于验证自动更新链路
