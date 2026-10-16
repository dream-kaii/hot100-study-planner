import React from "react";
import { getHintLevel, getVisibleHints, nextHintLevel } from "../services/hints.js";
import { normalizeStudyText } from "../services/study-text.js";

function hintText(hint) {
  if (typeof hint === "string") return hint;
  return hint?.text || hint?.content || hint?.description || "暂无该级提示。";
}

function hintIsPseudocode(hint, level) {
  return level === 4 || (typeof hint === "object" && (hint?.kind === "pseudocode" || hint?.type === "pseudocode"));
}

export default function HintLadder({ hints = [], hintsUsed = 0, onRequestHint, disabled = false, className = "" }) {
  const visibleHints = getVisibleHints(hints, hintsUsed);
  const nextLevel = nextHintLevel(hintsUsed, hints);
  const availableLevels = new Set((Array.isArray(hints) ? hints : []).map(getHintLevel).filter(Boolean));
  const hasIncompleteRecord = availableLevels.size < 4;
  const classes = ["hintLadder", className].filter(Boolean).join(" ");

  return <section className={classes} aria-label="分级提示">
    <div className="hintLadderHeader">
      <div>
        <h3>分级提示</h3>
        <p>先自己想一会儿，只打开下一层帮助。</p>
      </div>
      <span className="hintProgress" aria-live="polite">已解锁 {Math.min(4, Math.max(0, Number(hintsUsed) || 0))}/4 级</span>
    </div>
    {visibleHints.length > 0 && <ol className="hintList">
      {visibleHints.map((hint, index) => {
        const originalIndex = Array.isArray(hints) ? hints.indexOf(hint) : index;
        const level = getHintLevel(hint, originalIndex);
        const pseudocode = hintIsPseudocode(hint, level);
        return <li key={`hint-${level}-${index}`} className={pseudocode ? "hintItem hintPseudocode" : "hintItem"}>
          <span className="hintLevel" aria-label={`第 ${level} 级提示`}>第 {level} 级提示</span>
          {pseudocode ? <pre aria-label="伪代码提示"><code>{hintText(hint)}</code></pre> : <p>{normalizeStudyText(hintText(hint))}</p>}
        </li>;
      })}
    </ol>}
    {hasIncompleteRecord && <p className="hintCompatibility" role="status">当前题目的提示阶梯尚未补齐，已有提示仍可正常使用。</p>}
    {nextLevel > 0 ? <button type="button" className="hintButton" disabled={disabled} onClick={() => onRequestHint?.(nextLevel)}>
      我要提示（第 {nextLevel} 级）
    </button> : <p className="hintCompletion" role="status">再想不出来就看题解</p>}
  </section>;
}
