import React from "react";

const languageLabels = { java: "Java", python: "Python" };
const modeLabels = { function: "力扣函数模式", acm: "ACM 完整程序模式" };
const outcomeLabels = {
  independent: "独立通过",
  "needed-hint": "提示后通过",
  "needed-solution": "看题解后通过",
  failed: "运行失败",
  unknown: "已运行"
};

function formatDate(value) {
  if (!value) return "时间未知";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function formatDuration(value) {
  const seconds = Math.max(0, Math.round(Number(value || 0) / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${minutes} 分 ${remainder} 秒` : `${minutes} 分钟`;
}

export default function PracticeTimeline({ items = [], loading = false }) {
  return <section className="contentCard practiceTimeline" aria-labelledby="practice-timeline-title">
    <div className="sectionHeader">
      <div><span className="eyebrow">PRACTICE HISTORY</span><h2 id="practice-timeline-title">练习时间线</h2></div>
    </div>
    {loading ? <p role="status" aria-live="polite">正在加载练习记录…</p> : items.length ? <ol className="timelineList" aria-label="练习记录">
      {items.map((item, index) => <li className="timelineRow" key={item.id || `${item.createdAt}-${item.outcome}`}>
        <time dateTime={item.createdAt}>{formatDate(item.createdAt)}</time>
        <div className="timelineDetails">
          <strong>第 {index + 1} 次尝试 · {outcomeLabels[item.outcome] || item.outcome || outcomeLabels.unknown}</strong>
          <span>{languageLabels[item.language] || item.language || "未知语言"} · {modeLabels[item.mode] || item.mode || "未知模式"}</span>
          <small>用了 {Number(item.hintsUsed || 0)} 级提示 · 用时 {formatDuration(item.durationMs)}</small>
        </div>
      </li>)}
    </ol> : <div className="emptyState"><p>还没有练习记录。</p><p>先打开一道题并完成一次运行，之后这里会显示你的进步轨迹。</p></div>}
  </section>;
}

