// runner/index.mjs
// 本机运行助手入口。
//
// 它不监听任何端口，只做三件事：
//   1. 探测本机 node/python3/javac 是否可用（--doctor 也走这里）
//   2. 拿配对码换 token（首次），或读本地 token（之后）
//   3. 连 WSS 隧道，把收到的 run 帧交给 runExample()
//
// 判题核心用静态 import：在仓库里直接跑能解析到 ../src/services/runner.js，
// 打包成单文件时由 esbuild 把它内联进来。两种形态跑的是同一份代码。

import fs from "node:fs";
import path from "node:path";
import { spawn as spawnDetached } from "node:child_process";
import { fileURLToPath } from "node:url";

import { Tunnel } from "./session.mjs";
import { FRAME, validateRunFrame } from "./protocol.mjs";
import { loadSession, saveSession, clearSession, promptPairCode, pairedMessage, credentialsPath, credentialsDir } from "./pair.mjs";
import {
  runExample,
  getEnvironmentStatus,
  SUPPORTED_LANGUAGES,
  SUPPORTED_MODES,
  MAX_OUTPUT,
  RUN_TIMEOUT_MS
} from "../src/services/runner.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..");
const RUNNER_CORE = path.join(REPO_ROOT, "src", "services", "runner.js");
/** 打包后 src/ 不在磁盘上，这时判题核心已经内联进本文件。 */
const CORE_BUNDLED = !fs.existsSync(RUNNER_CORE);

/** 默认隧道地址。部署后改成你的 Workers 域名。 */
const DEFAULT_ENDPOINT = "wss://hot100-study-planner.example.workers.dev/ws";

function log(level, message) {
  const stamp = new Date().toLocaleTimeString("zh-CN", { hour12: false });
  const mark = level === "error" ? "✖" : level === "warn" ? "!" : "·";
  console.log(`${stamp} ${mark} ${message}`);
}

function parseArgs(argv) {
  const args = {
    doctor: false,
    endpoint: process.env.HOT100_ENDPOINT || DEFAULT_ENDPOINT,
    unpair: false,
    code: "",
    help: false,
    detach: false,
    headless: false,
    stop: false,
    status: false
  };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === "--doctor") args.doctor = true;
    else if (item === "--unpair") args.unpair = true;
    else if (item === "--detach") args.detach = true;
    else if (item === "--headless") args.headless = true;
    else if (item === "--stop") args.stop = true;
    else if (item === "--status") args.status = true;
    else if (item === "--help" || item === "-h") args.help = true;
    else if (item === "--code") args.code = String(argv[++i] || "");
    else if (item.startsWith("--code=")) args.code = item.slice("--code=".length);
    else if (item === "--endpoint") args.endpoint = argv[++i] || args.endpoint;
    else if (item.startsWith("--endpoint=")) args.endpoint = item.slice("--endpoint=".length);
  }
  return args;
}

function usage() {
  console.log(`Hot 100 本机运行助手

用法：
  node hot100-runner.mjs                  启动并连接隧道（首次会让你输配对码）
  node hot100-runner.mjs --doctor         只做环境自检，不连接
  node hot100-runner.mjs --code 123456    直接用配对码启动，不进入提问
  node hot100-runner.mjs --endpoint URL   指定隧道地址
  node hot100-runner.mjs --unpair         清除本地配对凭据后退出
  node hot100-runner.mjs --detach         配对成功后转入后台，终端窗口可以关掉
  node hot100-runner.mjs --status         查看后台实例是否在运行
  node hot100-runner.mjs --stop           停止后台实例

环境变量：
  HOT100_ENDPOINT   同 --endpoint
`);
}

/** 后台实例的 pid 文件与日志。 */
function pidPath() {
  return path.join(credentialsDir(), "runner.pid");
}
function logPath() {
  return path.join(credentialsDir(), "runner.log");
}

function readPid() {
  try {
    const value = Number(fs.readFileSync(pidPath(), "utf8").trim());
    return Number.isInteger(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function isAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function stopBackground() {
  const pid = readPid();
  if (!pid) {
    log("info", "没有找到后台实例");
    return true;
  }
  if (!isAlive(pid)) {
    fs.rmSync(pidPath(), { force: true });
    log("info", `后台实例（pid ${pid}）已经不在了，已清理 pid 文件`);
    return true;
  }
  try {
    process.kill(pid, "SIGTERM");
    fs.rmSync(pidPath(), { force: true });
    log("info", `已停止后台实例（pid ${pid}）`);
    return true;
  } catch (error) {
    log("error", `停止失败：${error.message}`);
    return false;
  }
}

/**
 * 转入后台：把自己以 --headless 再启动一份，脱离当前终端。
 * 这样用户可以关掉终端窗口，代码执行能力还在。
 */
function spawnBackground(args) {
  const self = process.argv[1];
  const out = fs.openSync(logPath(), "a");
  const child = spawnDetached(process.execPath, [
    ...process.execArgv,
    self,
    "--headless",
    "--endpoint", args.endpoint
  ], { detached: true, stdio: ["ignore", out, out] });
  child.unref();
  fs.writeFileSync(pidPath(), String(child.pid), "utf8");
  return child.pid;
}

/**
 * 环境自检。
 * --doctor 与启动前的探测共用这一份，避免两处判断口径不一致。
 */
async function doctor() {
  const lines = [];
  let ok = true;

  const nodeMajor = Number(process.versions.node.split(".")[0]);
  const nodeOk = nodeMajor >= 18;
  lines.push(`${nodeOk ? "✔" : "✖"} node      ${process.version}${nodeOk ? "" : "  （需要 ≥18）"}`);
  if (!nodeOk) ok = false;

  const status = await getEnvironmentStatus();
  for (const [name, label, hint] of [
    ["python3", "python3", "macOS 可执行 brew install python3，或从 python.org 安装"],
    ["javac", "javac", "需要完整 JDK（不是 JRE）。macOS 可执行 brew install openjdk"]
  ]) {
    const item = status[name];
    if (item.available) {
      lines.push(`✔ ${label.padEnd(9)} ${item.version}`);
    } else {
      lines.push(`! ${label.padEnd(9)} 未找到 —— ${hint}`);
      // 缺语言不阻止启动：用户在页面上可以只用另一种语言
    }
  }
  if (!status.python3.available && !status.javac.available) {
    lines.push("✖ python3 和 javac 都不可用，页面上的两种语言都无法运行");
    ok = false;
  }

  lines.push(`✔ 判题核心  ${CORE_BUNDLED ? "已内联进本文件" : RUNNER_CORE}`);
  lines.push(`✔ 运行限制  单次 ${RUN_TIMEOUT_MS / 1000}s、输出 ${MAX_OUTPUT / 1024}KB、Java 堆 256MB`);
  console.log(lines.join("\n"));
  console.log(ok ? "\n自检通过。" : "\n自检发现问题，请按上面的提示修复。");
  return ok;
}

/**
 * 连不上隧道时给出可操作的提示。
 * 最常见的原因是终端没走代理：浏览器能打开站点不代表终端能连 wss。
 * 另一种是设了代理变量但忘了加 --use-env-proxy（Node 默认不读这些变量）。
 */
function printConnectHint(endpoint) {
  const envKeys = ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "ALL_PROXY", "all_proxy"];
  const hasProxyEnv = envKeys.some((key) => process.env[key]);
  const usesEnvProxy = process.execArgv.some((arg) => arg === "--use-env-proxy");
  const self = path.basename(process.argv[1] || "hot100-runner.mjs");

  if (hasProxyEnv && !usesEnvProxy) {
    console.log(`
检测到你设了代理变量，但 Node 默认不读它们。加一个 --use-env-proxy 参数：

  node --use-env-proxy ${self} --endpoint ${endpoint}
`);
    return;
  }
  if (hasProxyEnv && usesEnvProxy) {
    console.log(`
已经带了代理参数，但仍然连不上。请确认：
  1. 代理软件里是「HTTP 代理」端口，不是 SOCKS 端口
  2. 该端口在当前能正常转发 HTTPS（用 curl -x http://127.0.0.1:<端口> https://www.google.com 验证）
`);
    return;
  }
  console.log(`
连不上隧道。浏览器能打开页面，不代表终端也能连 —— 终端需要单独走代理。

如果你的网络需要代理，这样启动（端口换成你代理软件的 HTTP 端口）：

  HTTP_PROXY=http://127.0.0.1:12450 HTTPS_PROXY=http://127.0.0.1:12450 node --use-env-proxy ${self} --endpoint ${endpoint}

不需要代理的网络下直接重跑原命令即可。
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { usage(); return 0; }

  if (args.doctor) {
    const ok = await doctor();
    return ok ? 0 : 1;
  }

  if (args.unpair) {
    const removed = await clearSession();
    log("info", removed ? `已清除 ${credentialsPath()}` : "本地没有配对凭据");
    return 0;
  }

  if (args.stop) return stopBackground() ? 0 : 1;

  if (args.status) {
    const pid = readPid();
    if (isAlive(pid)) {
      log("info", `后台实例正在运行（pid ${pid}），日志：${logPath()}`);
      return 0;
    }
    log("info", "后台实例没有在运行");
    return 1;
  }

  if (!args.headless) {
    console.log("Hot 100 本机运行助手");
    console.log("代码在你自己的电脑上执行，不会上传。关掉这个窗口即停止；想关窗口又不停止，用 --detach。\n");
    await doctor();
    console.log("");
  }

  // 1. 读本地凭据，没有就要求配对
  //    显式给了 --code 时一律重新配对：用户手上有新码，说明他要连的是这次会话，
  //    不能让本地旧 token 把它顶掉（否则网页永远等不到 runner）。
  let session = args.code ? null : await loadSession();
  if (!session) {
    let code = args.code;
    if (!code && args.headless) {
      log("error", "后台实例没有可用凭据，请先在前台完成一次配对。");
      return 1;
    }
    if (!code) {
      log("info", "尚未配对。请在网页上点「运行公开示例」，把显示的 6 位配对码粘到这里。");
      code = await promptPairCode();
      if (code === null) {
        log("error", "当前不是交互终端，无法输入配对码。请用 --code 传入配对码。");
        return 1;
      }
      if (!code) {
        log("error", "配对码应为 6 位数字。请重新启动并再试一次。");
        return 1;
      }
    }
    session = { pairCode: code, endpoint: args.endpoint };
    log("info", `已记录配对码 ${code}，正在与云端换取凭据…`);
  }

  const endpoint = session.endpoint || args.endpoint;

  // 用本地保存的 token 连上、但网页一直没接入 —— 说明连的是旧会话。
  // 这是真实踩过的坑：用户网页上看到一个新配对码，runner 却在等上一个会话。
  let staleHintTimer = null;
  let runArrived = false;
  const armStaleSessionHint = () => {
    if (args.code) return; // 用配对码连的，一定是当前会话
    if (staleHintTimer) clearTimeout(staleHintTimer);
    staleHintTimer = setTimeout(() => {
      if (runArrived) return;
      console.log(`
⚠ 正在等待的这个会话没有网页在连。如果你网页上显示的是一个**新的**配对码，
  说明 runner 连的是上一次的旧会话。二选一：

  1) 用网页上的新码重跑：
     node --use-env-proxy ${path.basename(process.argv[1] || "hot100-runner.mjs")} --code <6位码> --endpoint ${session.endpoint || args.endpoint}

  2) 清掉旧凭据后重跑（启动时会问你要码）：
     node ${path.basename(process.argv[1] || "hot100-runner.mjs")} --unpair
`);
    }, 8000);
    staleHintTimer.unref?.();
  };

  // 2. 建隧道
  const tunnel = new Tunnel({
    url: endpoint,
    token: session.token || "",
    // 只有配对码时走 ?code=，让 Worker 用 Lobby 换 sid；已有 token 时用 sid 直连。
    code: session.pairCode || "",
    sid: session.sid || "",
    // 用本地凭据（而不是新配对码）连上时，网页可能根本不在这个会话上。
    resumed: !args.code,
    WebSocketImpl: null,
    onLog: log,
    onStateChange: (event) => {
      if (event.state === "OPEN") {
        log("info", "已连上隧道，等待网页发来运行请求");
        armStaleSessionHint();
      } else if (event.state === "IDLE" && event.code) {
        log("warn", `隧道断开（${event.code}）`);
      }
    },
    onPeerState: (peer) => {
      // 网页接入了就撤销"连到旧会话"的告警。
      if (peer === "online" && staleHintTimer) {
        clearTimeout(staleHintTimer);
        staleHintTimer = null;
      }
    },
    onRun: async (frame) => {
      const check = validateRunFrame(frame, {
        supportedLanguages: SUPPORTED_LANGUAGES,
        supportedModes: SUPPORTED_MODES,
        maxCodeBytes: MAX_OUTPUT * 4
      });
      if (!check.ok) return { status: "error", error: check.error };
      runArrived = true;
      if (staleHintTimer) { clearTimeout(staleHintTimer); staleHintTimer = null; }
      log("info", `收到运行请求：${check.payload.language} / ${check.payload.mode}`);
      const started = Date.now();
      const result = await runExample(check.payload);
      log("info", `完成：${result.status}（${Date.now() - started}ms）`);
      return result;
    }
  });

  // 3. 首次配对：云端会把 token 放在握手响应头或一帧 hello 里
  // --detach 用：配对完成（或本来就有凭据）时解除等待
  let resolvePaired;
  const pairedOrReady = new Promise((resolve) => { resolvePaired = resolve; });

  tunnel.onPaired = async (payload) => {
    const next = { sid: payload.sid, token: payload.token, endpoint, pairedAt: Date.now() };
    await saveSession(next);
    log("info", pairedMessage(next));
    resolvePaired(true);
  };

  try {
    await tunnel.connect();
  } catch (error) {
    log("error", error.message);
    printConnectHint(endpoint);
    return 1;
  }

  // 4. --detach：配对完成后转入后台，让终端可以关掉
  if (args.detach) {
    if (!session.pairCode) resolvePaired(true); // 用的是已有 token，无需等待配对
    const ok = await Promise.race([
      pairedOrReady,
      new Promise((resolve) => setTimeout(() => resolve(false), 20000))
    ]);
    if (!ok) {
      log("error", "配对没有完成，未转入后台。请重试。");
      return 1;
    }
    const pid = spawnBackground(args);
    tunnel.close();
    console.log("");
    log("info", `已转入后台（pid ${pid}），现在可以关掉这个终端窗口了。`);
    log("info", `日志：${logPath()}`);
    log("info", "停止后台：node hot100-runner.mjs --stop");
    return 0;
  }

  // 5. 保持前台运行，Ctrl+C 优雅退出
  const shutdown = () => {
    log("info", "正在关闭…");
    tunnel.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await new Promise(() => {});
  return 0;
}

main().then((code) => process.exit(code)).catch((error) => {
  console.error("启动失败：", error?.message || error);
  process.exit(1);
});
