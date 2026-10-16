import React from "react";

const statusLabels = { new: "未开始", "in-progress": "学习中", completed: "已完成", reviewing: "待复习", mastered: "已稳固" };

export default function WeakPoints({ items = [], loading = false, onOpenQuestion }) {
  return <section className="contentCard weakPoints" aria-labelledby="weak-points-title">
    <div className="sectionHeader">
      <div><span className="eyebrow">FOCUS NEXT</span><h2 id="weak-points-title">需要重点关注</h2></div>
    </div>
    {loading ? <p role="status" aria-live="polite">正在计算薄弱点…</p> : items.length ? <ul className="weakPointList" aria-label="需要重点关注的题目">
      {items.map((item) => <li className="weakPointRow" key={item.questionId}>
        <div><strong>#{item.questionId} {item.title}</strong><span>{item.reasons?.join(" · ") || item.reason}</span><small>当前状态：{statusLabels[item.status] || item.status || "未开始"} · 累计使用提示 {item.hintsUsed || 0} 次</small></div>
        <button type="button" onClick={() => onOpenQuestion?.(item.questionId)} aria-label={`打开 ${item.title || item.questionId}`}>打开题目</button>
      </li>)}
    </ul> : <div className="emptyState"><p>目前没有需要特别关注的题目。</p><p>保持每隔一段时间独立重做，系统会在需要复习时提醒你。</p></div>}
  </section>;
}

