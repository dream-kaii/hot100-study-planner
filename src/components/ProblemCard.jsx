import React from "react";
const labels = { EASY: "简单", MEDIUM: "中等", HARD: "困难" };
export default function ProblemCard({ question, progressItem, onOpen, onStatusChange }) {
  const status = progressItem?.status || "未开始";
  const summary = progressItem?.historySummary || {};
  const independentCount = Number(summary.independent ?? (progressItem?.independentPassAt ? 1 : 0));
  const hintCount = Number(summary.hintsUsed ?? progressItem?.hintsUsed ?? 0);
  const practiceCount = Number(summary.total ?? progressItem?.reviewCount ?? 0);
  const masteryText = progressItem?.masteredAt || progressItem?.status === "mastered" || progressItem?.status === "已掌握"
    ? "已稳固"
    : independentCount > 0 || progressItem?.independentPassAt
      ? "已有独立通过"
      : "还没有独立通过";
  return <article className="problemCard"><button className="problemOpen" onClick={() => onOpen(question.id)}><span className="problemNumber">#{question.id}</span><strong>{question.title}</strong><small>{question.category} · <span className={`difficulty ${question.difficulty.toLowerCase()}`}>{labels[question.difficulty]}</span></small><small className="masteryLine" aria-label={`${question.title} 掌握进度`}>{masteryText} · 练习 {practiceCount} 次 · 累计使用提示 {hintCount} 次</small></button><select value={status} onChange={(event) => onStatusChange(question.id, event.target.value)} aria-label={`${question.title} 状态`}><option>未开始</option><option>思考中</option><option>已完成</option><option>错题</option><option>待复习</option><option>已掌握</option></select></article>;
}
