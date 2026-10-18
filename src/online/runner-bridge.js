// src/online/runner-bridge.js
// 把 src/main.jsx 里那个 onRun 的职责搬到一个可独立测试的模块里。
//
// 设计要点：main.jsx 现有的 onRun 只做 "fetch /__runner"。
// 这里提供的是"同一份 payload，两条通路"：
//   本地 dev  → /__runner（原路，一字不改）
//   线 上     → WSS 隧道（本模块）
// 是否启用线上通路由 probe.js 决定，main.jsx 只需要在合并时把 onRun 换成 createOnRun()。

import { probeOnlineRunner, explainUnavailable } from "./probe.js";

/**
 * 造一个 onRun 函数，签名与 src/main.jsx 里的 onRun 完全一致：
 *   (payload) => Promise<runExample 结果>
 *
 * onPairCode 回调用于把 6 位配对码展示给用户。
 */
export function createOnRun({ onPairCode: defaultPairHandler, signal } = {}) {
  // 第二个参数是 AbortSignal（可选），第三个是本次运行的配对码回调。
  // CodeEditor 会把配对回调放在第三位，这里必须接住，否则用户永远看不到配对码。
  return async function onRun(payload, abortSignal, pairHandler) {
    const onPairCode = pairHandler || defaultPairHandler;
    const effectiveSignal = abortSignal || signal;
    const capability = await probeOnlineRunner();

    if (capability.reason === "dev") {
      // 本地开发：老路，交给 vite 插件的 /__runner
      try {
        const response = await fetch("/__runner", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload)
        });
        if (!response.ok) return { status: "unavailable", error: "本地运行接口返回了错误，请在本地开发环境重试。" };
        return response.json();
      } catch {
        return { status: "unavailable", error: "请在本地开发环境运行：线上页面没有本地 Java/Python 运行接口。" };
      }
    }

    if (!capability.available) {
      return { status: "unavailable", error: explainUnavailable(capability.reason) };
    }

    // 线上：动态 import，避免把隧道代码打进首屏包
    try {
      const mod = await import("./client.js");
      return await mod.requestRun(payload, { onPairCode, signal: effectiveSignal });
    } catch (error) {
      return {
        status: "unavailable",
        error: error?.message || "在线运行失败，请稍后重试。"
      };
    }
  };
}

/** 供 UI 决定运行按钮是否可点。与 createOnRun 共用同一份探测结果。 */
export async function canRunOnline() {
  const capability = await probeOnlineRunner();
  return capability.reason === "dev" || capability.available;
}
