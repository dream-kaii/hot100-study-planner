import React, { useEffect, useMemo, useState } from "react";

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

export default function PracticeTimeline({ items = [], summary = {}, loading = false }) {
  const [filter, setFilter] = useState("all");
  const [expanded, setExpanded] = useState(false);
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 800px)");
    const update = () => setMobile(media.matches);
    update(); media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const filtered = useMemo(() => items.filter((item) => filter === "all" || filter === "failed" ? (filter === "all" || item.outcome === "failed") : filter === "passed" ? item.outcome !== "failed" : item.outcome === "independent"), [items, filter]);
  const visible = expanded ? filtered : filtered.slice(0, mobile ? 5 : 8);
  return <section className="contentCard practiceTimeline" aria-labelledby="practice-timeline-title">
    <div className="sectionHeader">
      <div><span className="eyebrow">PRACTICE HISTORY</span><h2 id="practice-timeline-title">练习时间线</h2></div>
    </div>
    {loading ? <p role="status" aria-live="polite">正在加载练习记录…</p> : <>
      <div className="timelineSummary"><span>最近练习 {summary.attempts || 0} 次</span><span>独立通过 {summary.independent || 0} 次</span><span>失败 {summary.failures || 0} 次</span><span>{summary.lastCreatedAt ? `最近：${formatDate(summary.lastCreatedAt)}` : "暂无最近练习"}</span></div>
      <div className="timelineFilters" role="group" aria-label="练习记录筛选">{[["all", "全部"], ["failed", "失败"], ["passed", "通过"], ["independent", "独立通过"]].map(([value, label]) => <button key={value} className={filter === value ? "active" : ""} onClick={() => { setFilter(value); setExpanded(false); }}>{label}</button>)}</div>
      {visible.length ? <ol className="timelineList" aria-label="练习记录">
      {visible.map((item, index) => <li className="timelineRow" key={item.id || `${item.createdAt}-${item.outcome}`}>
        <time dateTime={item.createdAt}>{formatDate(item.createdAt)}</time>
        <div className="timelineDetails">
          <strong>第 {index + 1} 次尝试 · {outcomeLabels[item.outcome] || item.outcome || outcomeLabels.unknown}</strong>
          <span>{languageLabels[item.language] || item.language || "未知语言"} · {modeLabels[item.mode] || item.mode || "未知模式"}</span>
          <small>用了 {Number(item.hintsUsed || 0)} 级提示 · 用时 {formatDuration(item.durationMs)}</small>
        </div>
      </li>)}
    </ol> : <div className="emptyState"><p>还没有符合条件的练习记录。</p><p>打开题目并完成一次运行后，这里会保留最近尝试。</p></div>}
      {filtered.length > visible.length && <button type="button" className="timelineMore" onClick={() => setExpanded(true)}>查看更多</button>}
    </>}
  </section>;
}

