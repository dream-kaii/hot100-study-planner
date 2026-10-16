import React from "react";
import { normalizeStudySolution, splitStudyParagraphs } from "../services/study-text.js";

const GROUP_LABELS = [
  "这道题在考什么",
  "思路方向",
  "完整步骤与变量演练",
  "正确性、复杂度和易错点",
  "Java/Python 参考代码"
];

function textValue(value, fallback) {
  if (typeof value === "string" && value.trim()) return value;
  return fallback;
}

function Paragraphs({ value, fallback }) {
  const text = textValue(value, fallback);
  return <div className="solutionText">{splitStudyParagraphs(text).map((line, index) => <p key={`solution-line-${index}`}>{line}</p>)}</div>;
}

function TextList({ items, ordered = false, fallback }) {
  const values = Array.isArray(items) ? items.filter((item) => String(item || "").trim()) : [];
  if (values.length === 0) return <p className="solutionPlaceholder">{fallback}</p>;
  const List = ordered ? "ol" : "ul";
  return <List>{values.map((item, index) => <li key={`solution-item-${index}`}>{item}</li>)}</List>;
}

function SourceLinks({ solution }) {
  const rawSources = solution?.sources;
  const sources = Array.isArray(rawSources)
    ? rawSources
    : Object.entries(rawSources || {}).map(([type, source]) => ({ ...source, type }));
  const validSources = sources.filter((source) => source?.url);
  return <div className="solutionSources">
    <span className="solutionSourcesLabel">参考来源</span>
    {validSources.length > 0 ? <ul>{validSources.map((source, index) => <li key={`${source.url}-${index}`}><a href={source.url} target="_blank" rel="noreferrer">{source.label || source.name || source.type || source.url} ↗</a></li>)}</ul> : <p className="solutionPlaceholder">暂无来源链接</p>}
  </div>;
}

function SolutionImages({ images }) {
  if (!Array.isArray(images) || images.length === 0) return null;
  return <div className="solutionImages">{images.map((image, index) => {
    const alt = image?.alt || "题解示意图";
    return <figure key={`${image?.url || alt}-${index}`}>
      <img src={image?.url} alt={alt} loading="lazy" onError={(event) => {
        event.currentTarget.hidden = true;
        const fallback = event.currentTarget.parentElement?.querySelector(".imageFallback");
        if (fallback) fallback.hidden = false;
      }} />
      <p className="imageFallback" hidden>图片暂时无法加载：{alt}</p>
      <figcaption>{alt}</figcaption>
    </figure>;
  })}</div>;
}

function SolutionTables({ tables }) {
  const validTables = Array.isArray(tables) ? tables.filter((table) => Array.isArray(table?.headers) && Array.isArray(table?.rows)) : [];
  if (validTables.length === 0) return null;
  return <div className="solutionTables">{validTables.map((table, tableIndex) => <div className="solutionTableWrap" key={`solution-table-${tableIndex}`}><table className="solutionTable"><thead><tr>{table.headers.map((header, index) => <th key={`table-header-${tableIndex}-${index}`}>{header}</th>)}</tr></thead><tbody>{table.rows.map((row, rowIndex) => <tr key={`table-row-${tableIndex}-${rowIndex}`}>{table.headers.map((_, columnIndex) => <td key={`table-cell-${tableIndex}-${rowIndex}-${columnIndex}`}>{row?.[columnIndex] || ""}</td>)}</tr>)}</tbody></table></div>)}</div>;
}

function CodeGroup({ solution, language, onLanguageChange, onViewCode, onJumpToEditor }) {
  const activeLanguage = language === "java" ? "java" : "python";
  const code = solution?.[activeLanguage];
  const languageLabel = activeLanguage === "java" ? "Java" : "Python";
  const source = solution?.sources?.[activeLanguage] || solution?.sources?.explanation;
  return <>
    <div className="solutionLanguageTabs" role="tablist" aria-label="参考代码语言">
      {[["python", "Python"], ["java", "Java"]].map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={activeLanguage === value} className={activeLanguage === value ? "active" : ""} onClick={() => onLanguageChange?.(value)}>{label}</button>)}
    </div>
    {code ? <pre className="solutionLargeCode"><code>{code}</code></pre> : <p className="solutionPlaceholder">暂无 {activeLanguage} 参考代码</p>}
    <div className="solutionCodeActions">
      <span>当前语言：{languageLabel}</span>
      <button type="button" className="textButton" onClick={onJumpToEditor}>在右侧编辑器打开</button>
      {source?.url && <a href={source.url} target="_blank" rel="noreferrer">查看代码来源 ↗</a>}
    </div>
  </>;
}

export default function ProgressiveSolution({ question, solution = {}, language = "java", onLanguageChange, onViewCode, onJumpToEditor }) {
  solution = normalizeStudySolution(solution);
  const recognition = solution.recognition || solution.learningGoal || solution.thinking;
  const direction = solution.direction || solution.thinking || solution.explanation || solution.summary;
  const viewedCode = (event) => {
    if (event.currentTarget.open) onViewCode?.({ language: language === "java" ? "java" : "python", viewedAt: new Date().toISOString() });
  };

  return <article className="progressiveSolution" aria-label={`题解：${question?.title || ""}`}>
    <details className="solutionDisclosure" open>
      <summary>{GROUP_LABELS[0]}</summary>
      <div className="solutionDisclosureBody">
        <Paragraphs value={recognition} fallback="暂无识别提示，请先阅读题目约束和示例。" />
        <TextList items={solution.prerequisites} fallback="暂无前置知识记录。" />
      </div>
    </details>

    <details className="solutionDisclosure">
      <summary>{GROUP_LABELS[1]}</summary>
      <div className="solutionDisclosureBody"><Paragraphs value={direction} fallback="暂无思路方向。" /></div>
    </details>

    <details className="solutionDisclosure">
      <summary>{GROUP_LABELS[2]}</summary>
      <div className="solutionDisclosureBody">
        <TextList items={solution.steps} ordered fallback="暂无可用的完整步骤。" />
        {Array.isArray(solution.walkthrough) && solution.walkthrough.length > 0 && <div className="solutionWalkthrough"><h4>变量演练</h4><TextList items={solution.walkthrough} fallback="暂无变量演练。" /></div>}
        <SolutionTables tables={solution.tables} />
        <SolutionImages images={solution.images} />
      </div>
    </details>

    <details className="solutionDisclosure">
      <summary>{GROUP_LABELS[3]}</summary>
      <div className="solutionDisclosureBody">
        <h4>为什么正确</h4>
        <Paragraphs value={solution.correctness} fallback="暂无正确性说明。" />
        <h4>复杂度</h4>
        {solution.complexity && typeof solution.complexity === "object" ? <dl className="solutionComplexity"><div><dt>时间</dt><dd>{solution.complexity.time || "未提供"}</dd></div><div><dt>空间</dt><dd>{solution.complexity.space || "未提供"}</dd></div></dl> : <p className="solutionPlaceholder">暂无复杂度说明。</p>}
        <h4>易错点</h4>
        <TextList items={solution.pitfalls} fallback="暂无易错点记录。" />
        {solution.summaryText && <><h4>总结</h4><Paragraphs value={solution.summaryText} fallback="暂无总结。" /></>}
      </div>
    </details>

    <details className="solutionDisclosure" onToggle={viewedCode}>
      <summary>{GROUP_LABELS[4]}</summary>
      <div className="solutionDisclosureBody"><CodeGroup solution={solution} language={language} onLanguageChange={onLanguageChange} onViewCode={onViewCode} onJumpToEditor={onJumpToEditor} /></div>
    </details>

    <SourceLinks solution={solution} />
  </article>;
}

export { GROUP_LABELS };
