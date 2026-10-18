// src/components/RunnerPairPanel.jsx
// 在线运行的引导面板：用户点了"运行"、但本机还没有运行助手时出现。
//
// 设计原则（来自需求确认）：
//   1. 只在"已写代码 + 点了运行"之后出现，不在页面加载时打扰
//   2. 明确告诉用户"代码在你自己的电脑上执行"
//   3. 配对码是最显眼的元素，因为那是唯一需要手动输入的东西
//   4. 一条命令就能启动，不要把用户丢进文档

import React, { useMemo, useState } from "react";

/** 单文件构建的下载路径，由 scripts/build-runner.mjs 产出到 dist/download/。 */
const DOWNLOAD_PATH = "download/hot100-runner.mjs";
const DOWNLOAD_FILE = "hot100-runner.mjs";

/**
 * 把当前页面的 origin 转成隧道地址。
 * 部署在哪个域名，runner 就连哪个域名 —— 不需要在构建时把地址写死，
 * 换域名、加自定义域、用 workers.dev 预览地址都不会失效。
 */
function tunnelEndpoint() {
  if (typeof window === "undefined") return "";
  const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${window.location.host}/ws`;
}

export default function RunnerPairPanel({ code, onRetry, onDismiss, waiting = false, error = "" }) {
  const [copied, setCopied] = useState(false);

  // base "./" 是 vite.config.js 里设的，所以下载链接用相对路径，部署在子路径下也能用。
  const downloadUrl = useMemo(() => {
    const base = typeof document !== "undefined" ? document.baseURI : "/";
    return new URL(DOWNLOAD_PATH, base).href;
  }, []);

  const command = useMemo(() => `node ${DOWNLOAD_FILE} --endpoint ${tunnelEndpoint()}`, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return <div className="runnerPairPanel" role="dialog" aria-label="启动本机运行助手">
    <div className="runnerPairHead">
      <strong>在你的电脑上运行</strong>
      <button type="button" className="runnerPairClose" onClick={onDismiss} aria-label="关闭">×</button>
    </div>

    <p className="runnerPairLead">
      代码只在你自己的电脑上执行，不会上传到服务器。只需要配置一次，之后每次点运行都会自动连上。
    </p>

    <ol className="runnerPairSteps">
      <li>
        <span>下载运行助手</span>
        <a className="runnerPairDownload" href={downloadUrl} download={DOWNLOAD_FILE}>
          下载 {DOWNLOAD_FILE}（约 57 KB）
        </a>
        <small>一个单文件 Node 脚本，已内联全部判题逻辑，可以直接用编辑器打开审一遍。</small>
      </li>
      <li>
        <span>在下载目录执行</span>
        <div className="runnerPairCommand">
          <code>{command}</code>
          <button type="button" onClick={copy}>{copied ? "已复制" : "复制"}</button>
        </div>
        <small>
          它会检查 node / python3 / javac，缺哪个会直接告诉你。想先自检可以加 <code>--doctor</code>。
        </small>
      </li>
      <li>
        <span>把下面的配对码粘进终端</span>
        <div className="runnerPairCode" aria-live="polite">
          {code ? code.split("").map((digit, index) => <span key={index}>{digit}</span>) : <em>正在生成…</em>}
        </div>
        <small>配对码 10 分钟内有效，用一次就作废。窗口可以一直开着，关掉窗口就等于停止运行。</small>
      </li>
    </ol>

    {waiting && <p className="runnerPairWait" role="status">正在等待运行助手接入…</p>}
    {error && <p className="runnerPairError" role="alert">{error}</p>}

    <div className="runnerPairActions">
      <button type="button" className="primaryButton" onClick={onRetry} disabled={waiting}>
        {waiting ? "等待中…" : "我连上了，重新运行"}
      </button>
      <span>运行助手不会开机自启、不监听端口，也不会常驻后台。</span>
    </div>
  </div>;
}
