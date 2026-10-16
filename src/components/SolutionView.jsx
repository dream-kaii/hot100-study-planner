import React, { useState } from "react";
import ProgressiveSolution from "./ProgressiveSolution.jsx";

export default function SolutionView({ question, solution, onBack, language: controlledLanguage, onLanguageChange, onViewCode, onJumpToEditor }) {
  const [localLanguage, setLocalLanguage] = useState("java");
  const language = controlledLanguage === "java" || controlledLanguage === "python" ? controlledLanguage : localLanguage;
  const source = solution?.sources?.explanation;
  const sourceUrl = source?.url || solution?.fallbackSource;
  const changeLanguage = (nextLanguage) => {
    setLocalLanguage(nextLanguage);
    onLanguageChange?.(nextLanguage);
  };

  return <section className="detailPage solutionPage solutionOverlay">
    <div className="solutionTopbar">
      <button className="textButton" type="button" onClick={onBack}>← 返回写题</button>
      <div><span className="eyebrow">题解 · #{question.id} {question.title}</span><h1>思路与总结</h1></div>
      {sourceUrl ? <a className="sourceButton" href={sourceUrl} target="_blank" rel="noreferrer">打开{source?.label || "题解来源"} ↗</a> : <span className="sourceButton">暂无题解来源</span>}
    </div>
    <div className="solutionLayout">
      <div className="solutionReading contentCard">
        <div className="solutionHeading"><div><h2>{source?.label || "渐进题解"}</h2><p>按层阅读思路、步骤、证明和参考代码。</p></div><span className="solutionBadge">本地内容</span></div>
        {solution?.sourceNote && <p className="sourceNote">{solution.sourceNote}</p>}
        <ProgressiveSolution question={question} solution={solution} language={language} onLanguageChange={changeLanguage} onViewCode={onViewCode} onJumpToEditor={onJumpToEditor} />
      </div>
    </div>
  </section>;
}
