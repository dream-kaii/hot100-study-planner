import React from "react";

const verdictLabels = { meets: "可能满足要求", "too-slow": "可能不满足要求", uncertain: "不确定", unknown: "暂无可比较要求" };

export default function ComplexityPanel({ result }) {
  if (!result) return null;
  return <section className={`complexityPanel ${result.verdict}`} aria-label="代码复杂度启发式检查">
    <div className="complexityHeader"><strong>复杂度启发式检查</strong><span>{verdictLabels[result.verdict] || result.verdict}</span></div>
    <div className="complexityValues"><span>题目要求：{result.expected || "暂无"}</span><span>代码估计：{result.estimated || "unknown"}</span><span>置信度：{result.confidence}</span></div>
    <p>{result.reason}</p>
    <small>这是静态启发式估计，不是形式化证明，不会阻止运行或改变练习状态。</small>
  </section>;
}
