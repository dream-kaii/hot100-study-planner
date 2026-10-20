import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// 断线重连期间，隧道必须自己撑住事件循环。
// 曾经的 bug：重连定时器被 unref，socket 又刚断开，事件循环一空
// Node 就以退出码 0 静默退出，launchd（SuccessfulExit=false）也不会拉起，
// 用户表现为「用得好好的，过几小时突然让重新启动运行助手」。
test("断线重连期间进程不会静默退出", async () => {
  const script = `
    import { Tunnel } from ${JSON.stringify(pathToFileURL(path.join(root, "runner", "session.mjs")).href)};
    const tunnel = new Tunnel({
      url: "ws://127.0.0.1:9",
      token: "x",
      sid: "a".repeat(32),
      onLog: () => {},
      onStateChange: () => {},
    });
    tunnel.connect().catch(() => {});
    // 故意 unref：只有隧道持有 ref 的 handle 时，这个检查才会被执行到。
    setTimeout(() => { console.log("alive"); process.exit(0); }, 1200).unref();
  `;
  const child = spawn(process.execPath, ["-e", script], { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  const code = await new Promise((resolve) => child.on("exit", resolve));
  assert.equal(code, 0);
  assert.match(stdout, /alive/, "进程在重连等待期间提前退出了");
});
