// runner/launchd.mjs
// macOS 开机自启（LaunchAgent）管理。
//
// 只做 macOS：Windows 用计划任务、Linux 用 systemd user unit，形态完全不同，
// 首版不覆盖（用户确认过只做 mac）。
//
// 为什么要 KeepAlive：runner 是长连接进程，网络抖动或代理重连时进程本身不该退出。
// 但刻意用 SuccessfulExit=false —— 用户手动 --stop（正常退出码 0）时不再被拉起。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const LABEL = "com.hot100.runner";

export function isMac() {
  return process.platform === "darwin";
}

export function plistPath() {
  return path.join(os.homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
}

export function isInstalled() {
  return fs.existsSync(plistPath());
}

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * 生成 plist。参数：
 *   nodePath   node 可执行文件绝对路径（launchd 的 PATH 很干净，必须用绝对路径）
 *   scriptPath runner 的 .mjs 绝对路径
 *   endpoint   隧道地址
 *   logsDir    日志目录
 */
export function buildPlist({ nodePath, scriptPath, endpoint, logsDir }) {
  const out = path.join(logsDir, "runner.log");
  const err = path.join(logsDir, "runner.err.log");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlEscape(nodePath)}</string>
    <string>${xmlEscape(scriptPath)}</string>
    <string>--headless</string>
    <string>--endpoint</string>
    <string>${xmlEscape(endpoint)}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>${xmlEscape(out)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(err)}</string>
</dict>
</plist>
`;
}

/** 写 plist 并注册到 launchd。重复调用是安全的（先 bootout 再 bootstrap）。 */
export function install({ nodePath, scriptPath, endpoint, logsDir }) {
  if (!isMac()) throw new Error("开机自启目前只支持 macOS");
  fs.mkdirSync(path.join(os.homedir(), "Library", "LaunchAgents"), { recursive: true });
  fs.mkdirSync(logsDir, { recursive: true });

  const target = plistPath();
  fs.writeFileSync(target, buildPlist({ nodePath, scriptPath, endpoint, logsDir }), "utf8");

  const domain = `gui/${process.getuid()}`;
  // 已存在时先卸掉，避免 "service already loaded"。
  try { execFileSync("launchctl", ["bootout", `${domain}/${LABEL}`], { stdio: "ignore" }); } catch { /* 本来就没加载 */ }
  execFileSync("launchctl", ["bootstrap", domain, target], { stdio: "ignore" });
  return target;
}

/** 从 launchd 注销并删除 plist。 */
export function uninstall() {
  if (!isMac()) return false;
  const domain = `gui/${process.getuid()}`;
  try { execFileSync("launchctl", ["bootout", `${domain}/${LABEL}`], { stdio: "ignore" }); } catch { /* 没加载 */ }
  try { fs.rmSync(plistPath(), { force: true }); } catch { /* 已删 */ }
  return true;
}

/** 查 launchd 是否真的加载了（plist 存在不等于在跑）。 */
export function isLoaded() {
  if (!isMac()) return false;
  try {
    const out = execFileSync("launchctl", ["print", `gui/${process.getuid()}/${LABEL}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return /state = running/.test(out);
  } catch {
    return false;
  }
}
