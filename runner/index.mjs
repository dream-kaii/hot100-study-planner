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
import readline from "node:readline/promises";
import { install as installAgent, uninstall as uninstallAgent, isInstalled as agentInstalled, isLoaded as agentLoaded, isMac, plistPath } from "./launchd.mjs";
import { fileURLToPath } from "node:url";

import { Tunnel } from "./session.mjs";
import { checkOnce, respawnSelf, FIRST_CHECK_DELAY_MS, CHECK_INTERVAL_MS } from "./autoupdate.mjs";
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

/**
 * 构建版本号，由 scripts/build-runner.mjs 用 esbuild define 注入。
 * 直接跑源码时没有这个 define，用 typeof 兜底成 dev。
 */
const BUILD_VERSION = typeof __BUILD_VERSION__ !== "undefined" ? __BUILD_VERSION__ : "dev";

function log(level, message) {
  // 带上日期：后台日志会跨越很多天，只有时分秒看不出是哪天出的问题。
  const now = new Date();
  const stamp = `${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${now.toLocaleTimeString("zh-CN", { hour12: false })}`;
  const mark = level === "error" ? "✖" : level === "warn" ? "!" : "·";
  console.log(`${stamp} ${mark} ${message}`);
}

function parseArgs(argv) {
  const args = {
    doctor: false,
    endpoint: process.env.HOT100_ENDPOINT || DEFAULT_ENDPOINT,
    /** 命令行/环境变量是否显式给了地址。显式给的一律优先于本地保存的旧地址。 */
    endpointExplicit: Boolean(process.env.HOT100_ENDPOINT),
    unpair: false,
    code: "",
    help: false,
    detach: false,
    headless: false,
    stop: false,
    status: false,
    launch: false,
    install: false,
    uninstall: false,
    noAutostart: false,
    version: false,
    autoUpdate: true,
    update: false
  };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === "--doctor") args.doctor = true;
    else if (item === "--unpair") args.unpair = true;
    else if (item === "--detach") args.detach = true;
    else if (item === "--headless") args.headless = true;
    else if (item === "--stop") args.stop = true;
    else if (item === "--status") args.status = true;
    else if (item === "--launch") args.launch = true;
    else if (item === "--install") args.install = true;
    else if (item === "--uninstall") args.uninstall = true;
    else if (item === "--no-autostart") args.noAutostart = true;
    else if (item === "--version" || item === "-v") args.version = true;
    else if (item === "--no-auto-update") args.autoUpdate = false;
    else if (item === "--update") args.update = true;
    else if (item === "--help" || item === "-h") args.help = true;
    else if (item === "--code") args.code = String(argv[++i] || "");
    else if (item.startsWith("--code=")) args.code = item.slice("--code=".length);
    else if (item === "--endpoint") { args.endpoint = argv[++i] || args.endpoint; args.endpointExplicit = true; }
    else if (item.startsWith("--endpoint=")) { args.endpoint = item.slice("--endpoint=".length); args.endpointExplicit = true; }
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
  node hot100-runner.mjs --install       安装开机自启（macOS LaunchAgent）
  node hot100-runner.mjs --uninstall     取消开机自启
  node hot100-runner.mjs --version       只输出版本号
  node hot100-runner.mjs --update        立刻检查并安装最新版
  node hot100-runner.mjs --no-auto-update 关闭自动更新（默认开启）

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
  // launchd 托管的实例要连自启一起摘掉，否则停了又被拉起来。
  if (agentInstalled()) {
    uninstallAgent();
    log("info", "已取消开机自启并停止");
    return true;
  }
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

/** 交互式 yes/no。非 TTY 时直接返回默认值。 */
async function askYesNo(question, defaultValue = false) {
  if (!process.stdin.isTTY) return defaultValue;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(`${question} ${defaultValue ? "[Y/n]" : "[y/N]"} `)).trim().toLowerCase();
    if (!answer) return defaultValue;
    return answer === "y" || answer === "yes" || answer === "是";
  } finally {
    rl.close();
  }
}

function installAutostart(endpoint) {
  const scriptPath = path.resolve(process.argv[1]);
  return installAgent({
    nodePath: process.execPath,
    scriptPath,
    endpoint,
    logsDir: credentialsDir()
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.version) { console.log(BUILD_VERSION); return 0; }
  if (args.help) { usage(); console.log(`\n版本：${BUILD_VERSION}`); return 0; }

  if (args.doctor) {
    const ok = await doctor();
    return ok ? 0 : 1;
  }

  if (args.unpair) {
    const removed = await clearSession();
    log("info", removed ? `已清除 ${credentialsPath()}` : "本地没有配对凭据");
    return 0;
  }

  if (args.update) {
    // 显式更新：用和后台实例同一套 endpoint 优先级算地址
    const saved = await loadSession();
    const target = args.endpointExplicit ? args.endpoint : saved?.endpoint || args.endpoint || DEFAULT_ENDPOINT;
    const result = await checkOnce({
      endpoint: target,
      currentVersion: BUILD_VERSION,
      targetPath: path.resolve(process.argv[1]),
      log
    });
    if (result.updated) {
      log("info", "用新版本重新启动后台实例");
      respawnSelf();
      return 0;
    }
    log("info", result.latest ? `没有更新：${result.reason}（最新 ${result.latest}）` : `没有更新：${result.reason}`);
    return 0;
  }

  if (args.stop) return stopBackground() ? 0 : 1;

  if (args.status) {
    // 开机自启写的是当时的 node 绝对路径。用 nvm 升级 Node 后旧路径会消失，
    // 表现为"明明装了自启却再也不启动"，这里主动查一下。
    if (agentInstalled() && isMac()) {
      try {
        const plist = fs.readFileSync(plistPath(), "utf8");
        const program = plist.match(/<key>ProgramArguments<\/key>\s*<array>\s*<string>([^<]+)<\/string>/);
        if (program && !fs.existsSync(program[1])) {
          log("warn", `自启里的 Node 路径已不存在：${program[1]}`);
          log("warn", "可能升级过 Node。重新运行一次双击版，或执行 --install 重新登记。");
        }
      } catch { /* 读不到就算了 */ }
    }
    const pid = readPid();
    if (isAlive(pid)) {
      log("info", `后台实例正在运行（pid ${pid}），日志：${logPath()}`);
      return 0;
    }
    if (agentInstalled() && agentLoaded()) {
      log("info", "由 macOS 开机自启托管，正在运行");
      return 0;
    }
    log("info", "没有在运行");
    return 1;
  }

  if (args.uninstall) {
    if (!isMac()) {
      log("error", "开机自启目前只支持 macOS");
      return 1;
    }
    uninstallAgent();
    log("info", "已取消开机自启");
    return 0;
  }

  if (args.install) {
    if (!isMac()) {
      log("error", "开机自启目前只支持 macOS");
      return 1;
    }
    const saved = await loadSession();
    if (!saved?.token) {
      log("error", "还没有配对凭据，先正常启动一次完成配对，再加开机自启。");
      return 1;
    }
    const target = installAutostart(saved.endpoint || args.endpoint);
    log("info", `已安装开机自启：${target}`);
    log("info", "取消：node hot100-runner.mjs --uninstall");
    return 0;
  }

  if (args.headless) {
    log("info", `后台实例启动（pid ${process.pid}，版本 ${BUILD_VERSION}）`);
  }
  if (!args.headless) {
    console.log(`Hot 100 本机运行助手（版本 ${BUILD_VERSION}）`);
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

  // 显式传入的地址优先。否则换域名后，本地保存的旧地址会把新域名顶掉，
  // 表现为"我明明传了新域名，却还连着老地址"。
  const endpoint = args.endpointExplicit ? args.endpoint : session.endpoint || args.endpoint;

  // 用本地保存的 token 连上、但网页一直没接入 —— 说明连的是旧会话。
  // 这是真实踩过的坑：用户网页上看到一个新配对码，runner 却在等上一个会话。
  let staleHintTimer = null;
  let runArrived = false;
  const armStaleSessionHint = () => {
    if (args.code) return; // 用配对码连的，一定是当前会话
    // 后台实例（--headless / launchd 拉起）本来就是"没人连"的状态，
    // 这条提示只有盯着终端的人才看得懂，后台模式下纯属误报且会污染日志。
    if (args.headless || !process.stdout.isTTY) return;
    if (staleHintTimer) clearTimeout(staleHintTimer);
    staleHintTimer = setTimeout(() => {
      if (runArrived) return;
      console.log(`
⚠ 正在等待的这个会话没有网页在连。如果你网页上显示的是一个**新的**配对码，
  说明 runner 连的是上一次的旧会话。二选一：

  1) 用网页上的新码重跑：
     node --use-env-proxy ${path.basename(process.argv[1] || "hot100-runner.mjs")} --code <6位码> --endpoint ${endpoint}

  2) 清掉旧凭据后重跑（启动时会问你要码）：
     node ${path.basename(process.argv[1] || "hot100-runner.mjs")} --unpair
`);
    }, 8000);
    staleHintTimer.unref?.();
  };

  // 正在判题的并发数。有任务在跑时不自动更新，免得把用户的一次运行打断。
  let activeRuns = 0;
  let autoUpdateStarted = false;

  const tryAutoUpdate = async ({ manual = false } = {}) => {
    if (!args.autoUpdate && !manual) return;
    if (activeRuns > 0) {
      log("info", `有 ${activeRuns} 个判题在跑，等它结束再检查更新`);
      return;
    }
    const result = await checkOnce({
      endpoint,
      currentVersion: BUILD_VERSION,
      targetPath: path.resolve(process.argv[1]),
      log
    });
    if (!result.updated) {
      if (manual) log("info", `没有更新：${result.reason}`);
      return;
    }
    log("info", `自动更新完成：${result.from} → ${result.to}，正在用新版本重启`);
    const pid = respawnSelf();
    log("info", `新实例已启动（pid ${pid}），本进程退出`);
    process.exit(0);
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
        // 连上后先等一会儿再查，免得和首次配对抢时间
        if (args.autoUpdate && !autoUpdateStarted) {
          autoUpdateStarted = true;
          const first = setTimeout(() => { void tryAutoUpdate(); }, FIRST_CHECK_DELAY_MS);
          first.unref?.();
          const repeat = setInterval(() => { void tryAutoUpdate(); }, CHECK_INTERVAL_MS);
          repeat.unref?.();
        }
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
      activeRuns += 1;
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
      try {
        const result = await runExample(check.payload);
        log("info", `完成：${result.status}（${Date.now() - started}ms）`);
        return result;
      } finally {
        activeRuns -= 1;
      }
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
    if (!args.code && session?.token) {
      // 用的是本地保存的凭据却连不上：最常见是站点换了域名，或凭据已失效。
      // 不提示的话用户只会看到"连接失败"，不知道该怎么办。
      console.log(`
这次用的是本地保存的凭据。如果站点换过域名、或凭据已经失效，重新配对一次：

  node ${path.basename(process.argv[1] || "hot100-runner.mjs")} --unpair

然后重新启动，输入网页上显示的 6 位配对码。
`);
    }
    printConnectHint(endpoint);
    return 1;
  }

  // 4. --launch：双击启动后的完整体验 —— 配对 → 问是否开机自启 → 后台 → 退出
  if (args.launch) {
    // 更新/重装场景：必须先停掉正在跑的实例。
    // 否则新旧两个 runner 会同时连着同一个会话，运行请求可能被投递到旧连接上，
    // 表现为"更新了但行为没变"，或者一次运行只收到一半结果。
    let stopped = false;
    if (isMac() && agentInstalled()) {
      uninstallAgent();
      stopped = true;
    }
    const previous = readPid();
    if (isAlive(previous)) {
      try { process.kill(previous, "SIGTERM"); stopped = true; } catch { /* 已退出 */ }
      fs.rmSync(pidPath(), { force: true });
    }
    if (stopped) {
      log("info", "已停止正在运行的旧实例");
      await new Promise((resolve) => setTimeout(resolve, 600));
    }

    if (!session.pairCode) resolvePaired(true);
    const ok = await Promise.race([
      pairedOrReady,
      new Promise((resolve) => setTimeout(() => resolve(false), 60000))
    ]);
    if (!ok) {
      log("error", "配对没有完成。请重新双击启动。");
      return 1;
    }

    let managed = false;
    if (isMac()) {
      const wantAuto = args.noAutostart ? false : await askYesNo("\n以后开机自动启动？", true);
      if (wantAuto) {
        try {
          const target = installAutostart(endpoint);
          managed = true;
          log("info", `已设置开机自启：${target}`);
        } catch (error) {
          log("warn", `设置开机自启失败：${error.message}`);
        }
      }
    }

    if (!managed) {
      const pid = spawnBackground(args);
      log("info", `已转入后台（pid ${pid}）`);
    }
    tunnel.close();
    console.log("");
    log("info", "配置完成，这个窗口可以关掉了。");
    log("info", `日志：${logPath()}`);
    log("info", "停止：node hot100-runner.mjs --stop" + (managed ? " 或 --uninstall" : ""));
    return 0;
  }

  // 5. --detach：配对完成后转入后台，让终端可以关掉
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
