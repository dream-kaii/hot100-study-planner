// src/components/RunnerPairPanel.jsx
// 在线运行的引导面板：用户点了"运行"、但本机还没有运行助手时出现。
//
// 设计原则：
//   1. 只在"已写代码 + 点了运行"之后出现，不在页面加载时打扰
//   2. 配对码放最上面 —— 那是用户唯一要手输的东西，不能被折叠到滚动区外
//   3. 明确告诉用户"代码在你自己的电脑上执行"
//   4. 整体高度受控，不能把代码编辑器挤没

import React, { useEffect, useMemo, useState } from "react";

import { canReachLocalApi } from "../services/device.js";

/**
 * 由 scripts/build-runner.mjs 产出到 dist/download/：
 *   hot100-runner.zip            双击版压缩包（zip 才留得住可执行位）
 *   Hot100 运行助手.command      双击版（解压后的文件）
 *   hot100-runner.mjs            纯命令行版
 */
const ZIP_PATH = "download/hot100-runner.zip";
const ZIP_FILE = "hot100-runner.zip";
const MJS_FILE = "hot100-runner.mjs";

/**
 * 把当前页面的 origin 转成隧道地址。
 * 部署在哪个域名，runner 就连哪个域名 —— 不需要在构建时写死，
 * 换域名、加自定义域、用 workers.dev 预览地址都不会失效。
 */
function tunnelEndpoint() {
  if (typeof window === "undefined") return "";
  const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${window.location.host}/ws`;
}

export default function RunnerPairPanel({ code, mode = "pair", onRetry, onDismiss, waiting = false, error = "" }) {
  const offline = mode === "offline";
  const [copied, setCopied] = useState(false);
  // Safari 会拦掉 https 页面对本机的 fetch（实测 WebKit 直接 "Not allowed to request resource"），
  // 但顶层跳转不拦。探测失败就把"一键连接"这条路露出来。
  const [localBlocked, setLocalBlocked] = useState(false);
  useEffect(() => {
    let alive = true;
    const isHttps = typeof window !== "undefined" && window.location.protocol === "https:";
    if (!isHttps) return undefined;
    canReachLocalApi().then((ok) => { if (alive && !ok) setLocalBlocked(true); });
    return () => { alive = false; };
  }, []);
  const claimLink = () => {
    const next = typeof window === "undefined" ? "/" : `${window.location.pathname}${window.location.search}`;
    window.location.href = `http://127.0.0.1:17890/claim?next=${encodeURIComponent(next)}`;
  };
  const [copiedFresh, setCopiedFresh] = useState(false);

  // base "./" 是 vite.config.js 里设的，所以下载链接用相对路径，部署在子路径下也能用。
  const zipUrl = useMemo(() => {
    const base = typeof document !== "undefined" ? document.baseURI : "/";
    return new URL(ZIP_PATH, base).href;
  }, []);

  // 带上 cd：浏览器把文件存到「下载」目录，用户在任意位置直接敲 node 会报
  // Cannot find module。两行一起复制，粘进终端就能跑。
  // 已装过助手的人（绝大多数）：一条命令搞定，配对码直接带上，不用手输。
  const command = useMemo(
    () => (offline
      ? "node ~/.hot100-runner/hot100-runner.mjs --launch"
      : `node ~/.hot100-runner/hot100-runner.mjs --launch --code ${code || "······"}`),
    [offline, code]
  );

  // 还没装过：文件在下载目录，用这条。
  const freshCommand = useMemo(
    () => `cd ~/Downloads\nnode ${MJS_FILE} --endpoint ${tunnelEndpoint()} --code ${code || "······"}`,
    [code]
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  const copyFresh = async () => {
    try {
      await navigator.clipboard.writeText(freshCommand);
      setCopiedFresh(true);
      setTimeout(() => setCopiedFresh(false), 1600);
    } catch {
      setCopiedFresh(false);
    }
  };

  return <div className="runnerPairPanel" role="dialog" aria-label="启动本机运行助手">
    <div className="runnerPairHead">
      <strong>在你的电脑上运行</strong>
      <button type="button" className="runnerPairClose" onClick={onDismiss} aria-label="关闭">×</button>
    </div>

    {offline
      ? <p className="runnerPairWait" role="status">
          已配对过，但运行助手现在没有在运行 —— 启动它就会自动继续，不需要新的配对码。
        </p>
      : <div className="runnerPairCodeRow">
          <div className="runnerPairCode" aria-live="polite">
            {code ? code.split("").map((digit, index) => <span key={index}>{digit}</span>) : <em>正在生成…</em>}
          </div>
          <small>输进终端 · 10 分钟内有效</small>
        </div>}

    <div className="runnerPairDownloadRow">
      <a className="runnerPairDownload" href={zipUrl} download={ZIP_FILE}>
        下载双击版（{ZIP_FILE}）
      </a>
      <small>{offline ? "还没装的话下载这个，解压后双击即可" : "解压后双击「Hot100 运行助手.command」，按提示粘上面的配对码"}</small>
    </div>

    <details className="runnerPairAdvanced" open={offline}>
      <summary>{offline ? "启动命令" : "或者用命令行（已装过助手）"}</summary>
      <div className="runnerPairCommand">
        <code>{command}</code>
        <button type="button" onClick={copy}>{copied ? "已复制" : "复制"}</button>
      </div>
      {!offline && <div className="runnerPairCommand runnerPairCommandAlt">
        <code>{freshCommand}</code>
        <button type="button" onClick={copyFresh}>{copiedFresh ? "已复制" : "复制"}</button>
      </div>}
    </details>

    {localBlocked && <p className="runnerPairClaim">
      Safari 会拦截网页对本机助手的请求。
      <button type="button" onClick={claimLink}>点这里直接连上本机助手</button>
      （跳一下就自动回来，不用输配对码）
    </p>}
    {waiting && <p className="runnerPairWait" role="status">正在等待运行助手接入…连上后会自动继续运行</p>}
    {error && <p className="runnerPairError" role="alert">{error}</p>}

    <div className="runnerPairActions">
      <button type="button" className="primaryButton" onClick={onRetry} disabled={waiting}>
        {waiting ? "等待中…" : "我连上了，重新运行"}
      </button>
      <span>{offline ? "启动后会自动接上，不用重新配对" : "代码只在本机执行，不上传；关窗口即停止"}</span>
    </div>
  </div>;
}
