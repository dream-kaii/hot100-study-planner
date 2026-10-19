import React, { useMemo } from "react";
import { orderByStudyOrder } from "../services/practice.js";
import { STATUS_FILTER_OPTIONS } from "../services/status-labels.js";
import ProblemCard from "../components/ProblemCard.jsx";

const DIFFICULTY_OPTIONS = [
  ["全部", "全部"],
  ["EASY", "简单"],
  ["MEDIUM", "中等"],
  ["HARD", "困难"]
];

export default function ProblemBank({
  questions,
  allQuestions = [],
  progress,
  dailyNewLimit = 1,
  onDailyNewLimitChange,
  filters,
  onFiltersChange,
  onOpenQuestion,
  onStatusChange,
  categories,
  onPractice
}) {
  const dailyNew = useMemo(
    () => orderByStudyOrder(allQuestions)
      .filter((question) => !progress[question.id] || (progress[question.id].canonical || "new") === "new")
      .slice(0, Math.max(1, Number(dailyNewLimit) || 1)),
    [allQuestions, progress, dailyNewLimit]
  );

  return <section className="pageSection">
    <div className="sectionHeader">
      <div>
        <span className="eyebrow">PROBLEM BANK</span>
        <h1>题库</h1>
        <p>按学习顺序浏览，也可以按专题、难度和状态筛选。Java 是默认语言，草稿会按语言和代码模式分别保存；同一道题的多种解法各自存档。</p>
      </div>
      <div className="filterBar">
        <label>
          <span className="srOnly">搜索题目</span>
          <input value={filters.query} onChange={(event) => onFiltersChange({ query: event.target.value })} placeholder="搜索题号或题目" />
        </label>
        <label>
          <span className="srOnly">专题</span>
          <select value={filters.category} onChange={(event) => onFiltersChange({ category: event.target.value })}>
            {categories.map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
        <label>
          <span className="srOnly">难度</span>
          <select value={filters.difficulty} onChange={(event) => onFiltersChange({ difficulty: event.target.value })}>
            {DIFFICULTY_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label>
          <span className="srOnly">状态</span>
          <select value={filters.status} onChange={(event) => onFiltersChange({ status: event.target.value })}>
            {STATUS_FILTER_OPTIONS.map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
      </div>
    </div>

    <div className="practiceBar bankPracticeBar">
      <button onClick={() => onPractice("sequential")}>按顺序练习</button>
      <button onClick={() => onPractice("random")}>随机出题</button>
      <button onClick={() => onPractice("unfinished")}>只抽未完成</button>
      <button onClick={() => onPractice("wrong")}>只抽错题</button>
      <button onClick={() => onPractice("due")}>只抽到期复习</button>
    </div>

    <section className="dailyPlan contentCard">
      <div>
        <h2>今日新题</h2>
        <p>每天安排
          <label className="inlineLimit">
            <span className="srOnly">每日新题数量</span>
            <input type="number" min="1" max="10" value={dailyNewLimit} onChange={(event) => onDailyNewLimitChange?.(Math.min(10, Math.max(1, Number(event.target.value) || 1)))} />
          </label>
          道，可按时间和能力调整。
        </p>
      </div>
      <div>
        {dailyNew.length
          ? dailyNew.map((question) => <button className="planRow" key={question.id} onClick={() => onOpenQuestion(question.id)}><span>#{question.id}</span><strong>{question.title}</strong><small>学习顺序 {question.studyOrder || question.order}</small></button>)
          : <p>今日新题已完成，去错题复习页看看待复习内容。</p>}
      </div>
    </section>

    <div className="problemList">
      {questions.length
        ? questions.map((question) => <ProblemCard key={question.id} question={question} progressItem={progress[question.id]} onOpen={onOpenQuestion} onStatusChange={onStatusChange} />)
        : <div className="contentCard emptyState">没有符合筛选条件的题目。</div>}
    </div>
  </section>;
}
