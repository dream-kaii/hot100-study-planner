import React from "react";
import { statusLabel } from "../services/status-labels.js";

const labels = { EASY: "简单", MEDIUM: "中等", HARD: "困难" };

// 状态下拉必须用「展示文案」做 value，并且和 progressItem.status 对齐。
// main.jsx 传下来的 displayProgress 已经带上了派生后的中文标签（含 due → 待复习），
// 所以这里只要显示它、回传文案即可，canonical 转换在 setStatus 里做。
export default function ProblemCard({ question, progressItem, onOpen, onStatusChange }) {
  const status = progressItem?.status || "未开始";
  const summary = progressItem?.historySummary || {};
  const independentCount = Number(summary.independent ?? (progressItem?.independentPassAt ? 1 : 0));
  const hintCount = Number(summary.hintsUsed ?? progressItem?.hintsUsed ?? 0);
  const practiceCount = Number(summary.total ?? progressItem?.reviewCount ?? 0);
  const variants = Number(progressItem?.variantCount || 0);
  const masteryText = progressItem?.masteredAt || progressItem?.status === "mastered" || progressItem?.status === "已掌握"
    ? "已稳固"
    : independentCount > 0 || progressItem?.independentPassAt
      ? "已有独立通过"
      : "还没有独立通过";
  return <article className={`problemCard status-${progressItem?.canonical || "new"}`}>
    <button className="problemOpen" onClick={() => onOpen(question.id)}>
      <span className="problemNumber">#{question.id}</span>
      <strong>{question.title}</strong>
      <small>{question.category} · <span className={`difficulty ${question.difficulty.toLowerCase()}`}>{labels[question.difficulty]}</span></small>
      <small className="masteryLine" aria-label={`${question.title} 掌握进度`}>
        {masteryText} · 练习 {practiceCount} 次 · 累计使用提示 {hintCount} 次{variants > 1 ? ` · ${variants} 种解法` : ""}
      </small>
    </button>
    <select value={status} onChange={(event) => onStatusChange(question.id, event.target.value)} aria-label={`${question.title} 状态`}>
      {["未开始", "思考中", "已完成", "错题", "待复习", "已掌握"].map((item) => <option key={item} value={item}>{item}</option>)}
      {/* 极端情况下 progressItem 带着一个不在列表里的值，补一个选项避免 select 显示空 */}
      {!["未开始", "思考中", "已完成", "错题", "待复习", "已掌握"].includes(status) && <option value={status}>{statusLabel(status)}</option>}
    </select>
  </article>;
}
