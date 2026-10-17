import React, { useEffect, useMemo, useRef, useState } from "react";
import Timer from "./Timer.jsx";
import CodeEditor from "./CodeEditor.jsx";
import HintLadder from "./HintLadder.jsx";
import ProgressiveSolution from "./ProgressiveSolution.jsx";
import { normalizeStudyText, splitStudyParagraphs } from "../services/study-text.js";
import { createLanguageDrafts, getDraftKey, getExecutionCases, selectDraftRecord } from "../services/editor.js";
import { classifyAttemptOutcome } from "../services/status.js";

const difficultyText = { EASY: "简单", MEDIUM: "中等", HARD: "困难" };
// 「无本地运行接口」提示的关闭状态存储键（见组件内 runnerNoticeDismissed）
const RUNNER_NOTICE_KEY = "hot100:runnerNoticeDismissed";
const statusLabels = { new: "未开始", "in-progress": "思考中", completed: "已完成", reviewing: "待复习", mastered: "已掌握", 未开始: "未开始", 思考中: "思考中", 已完成: "已完成", 错题: "错题", 待复习: "待复习", 已掌握: "已掌握" };
const statusValues = ["思考中", "已完成", "错题", "待复习", "已掌握"];

function canonicalStatus(status) {
  return { 未开始: "new", 思考中: "in-progress", 已完成: "completed", 错题: "reviewing", 待复习: "reviewing", 已掌握: "mastered", new: "new", "in-progress": "in-progress", completed: "completed", reviewing: "reviewing", mastered: "mastered" }[status] || status || "new";
}

function hasDraft(drafts, questionId, language, mode) {
  return Boolean(drafts?.[questionId]?.[language]?.[mode] && typeof drafts[questionId][language][mode] === "object");
}

export default function ProblemDetail({
  question,
  solution = {},
  progressItem,
  drafts = {},
  note,
  defaultLanguage = "java",
  runnerAvailable = true,
  onProgressChange,
  onHint,
  onSolutionView,
  onDraftChange,
  onNoteChange,
  onRun,
  onPracticeOutcome,
  onRecordHistory,
  onBack,
  onPrevious,
  onNext,
  previousQuestion,
  nextQuestion,
  practiceHistory = []
}) {
  const [language, setLanguage] = useState(defaultLanguage === "python" ? "python" : "java");
  const [mode, setMode] = useState("function");
  const [practiceMode, setPracticeMode] = useState("learning");
  const [leftTab, setLeftTab] = useState("problem");
  const [timerMinutes, setTimerMinutes] = useState(25);
  const [activeExample, setActiveExample] = useState(0);
  // 运行器不可用提示：可关闭，并记住选择。
  // 线上构建（import.meta.env.DEV === false）永远没有 /__runner 接口，
  // 这个提示会一直挂着，所以给一个关闭入口；关一次后不再打扰。
  const [runnerNoticeDismissed, setRunnerNoticeDismissed] = useState(() => {
    try {
      return typeof window !== "undefined" && window.localStorage.getItem(RUNNER_NOTICE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const dismissRunnerNotice = () => {
    setRunnerNoticeDismissed(true);
    try {
      window.localStorage.setItem(RUNNER_NOTICE_KEY, "1");
    } catch {
      // localStorage 不可用时静默降级：至少本次会话内不再显示
    }
  };
  const attemptRef = useRef(null);
  const sessionRef = useRef(null);

  useEffect(() => {
    const attemptId = `${question.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    attemptRef.current = { attemptId, hintsUsed: 0, viewedSolutionCode: false };
    sessionRef.current = { questionId: String(question.id), language: defaultLanguage === "python" ? "python" : "java", mode: "function", attemptId };
    setLanguage(defaultLanguage === "python" ? "python" : "java");
    setMode("function");
    setPracticeMode("learning");
    setLeftTab("problem");
    setTimerMinutes(25);
    setActiveExample(0);
    onRecordHistory?.({ questionId: question.id, language: defaultLanguage === "python" ? "python" : "java", mode: "function", outcome: "started", createdAt: new Date().toISOString() });
    return () => { sessionRef.current = null; attemptRef.current = null; };
  }, [question.id]);

  useEffect(() => {
    const attemptId = `${question.id}-${language}-${mode}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    attemptRef.current = { attemptId, hintsUsed: 0, viewedSolutionCode: false };
    sessionRef.current = { questionId: String(question.id), language, mode, attemptId };
  }, [question.id, language, mode]);

  const draftRecord = selectDraftRecord(drafts, question.id, language, mode);
  const template = useMemo(() => createLanguageDrafts({ ...solution, title: question.title }, mode)[language] || "", [language, mode, question.title, solution]);
  const code = hasDraft(drafts, question.id, language, mode) ? draftRecord.code : template;
  const visibleNote = typeof note === "string" ? note : note?.value || "";
  const hintsUsed = progressItem?.hintsByContext?.[`${language}:${mode}`]?.count ?? progressItem?.hintsUsed ?? 0;
  const viewedSolutionCode = Boolean(progressItem?.viewedSolutionByContext?.[`${language}:${mode}`] || progressItem?.viewedSolutionCode);
  const examples = mode === "acm" ? solution.acm?.examples || [] : Array.isArray(solution.examples) ? solution.examples : [];
  const selectedExample = examples[activeExample] || examples[0];
  const cases = getExecutionCases(solution, mode);
  const currentStatus = canonicalStatus(progressItem?.status);
  const nextHint = (level) => {
    if (attemptRef.current) attemptRef.current.hintsUsed += 1;
    onHint?.(question.id, level, language, mode);
  };
  const saveDraft = (record) => onDraftChange?.(question.id, language, mode, record);
  const recordAttemptSolutionView = (viewedLanguage) => {
    if (attemptRef.current) attemptRef.current.viewedSolutionCode = true;
    onSolutionView?.(question.id, viewedLanguage, mode);
  };

  const execute = async (payload) => {
    const session = sessionRef.current;
    const attempt = attemptRef.current || { attemptId: `${question.id}-legacy`, hintsUsed: 0, viewedSolutionCode: false };
    const result = await onRun?.(payload);
    if (!result || result.status === "unavailable") return result;
    if (sessionRef.current !== session || sessionRef.current?.questionId !== String(question.id)
      || sessionRef.current?.language !== payload.language || sessionRef.current?.mode !== payload.mode) return result;
    const allCases = Array.isArray(result.cases) ? result.cases : [result];
    const passed = result.status === "passed" || allCases.length > 0 && allCases.every((item) => item.status === "passed");
    const effectiveMode = payload.mode || mode;
    const hasHardFailure = ["mismatch", "failed", "compile_error", "compile_timeout", "runtime_error", "timeout", "output_limit", "environment_error", "template", "unsupported"].includes(result.status) || allCases.some((item) => ["mismatch", "failed", "compile_error", "compile_timeout", "runtime_error", "timeout", "output_limit", "environment_error", "template", "unsupported"].includes(item.status));
    const outcome = hasHardFailure ? "failed" : classifyAttemptOutcome({ passed, attemptHintsUsed: attempt.hintsUsed, attemptViewedSolutionCode: attempt.viewedSolutionCode });
    const failedCase = allCases.find((item) => item.status !== "passed");
    onPracticeOutcome?.({ questionId: question.id, language, mode: effectiveMode, outcome, hintsUsed: attempt.hintsUsed, viewedSolutionCode: attempt.viewedSolutionCode, attemptId: attempt.attemptId, attemptHintsUsed: attempt.hintsUsed, attemptViewedSolutionCode: attempt.viewedSolutionCode, caseId: failedCase?.caseId, durationMs: result.durationMs || failedCase?.durationMs || 0, error: result.error });
    attemptRef.current = { attemptId: `${question.id}-${language}-${effectiveMode}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, hintsUsed: 0, viewedSolutionCode: false };
    return result;
  };

  return <section className="detailPage problemWorkspace">
    <div className="practiceBar">
      <button className="textButton" onClick={onBack}>← 返回题库</button>
      <div className="practiceIdentity"><strong>#{question.id} {question.title}</strong><span>{question.category} · {difficultyText[question.difficulty]} · {question.phase || "学习顺序"} · 学习顺序 {question.studyOrder}</span><span>{nextQuestion ? `下一题：${nextQuestion.title} · 按学习顺序 ${nextQuestion.studyOrder} 继续` : "已到学习顺序末尾"}</span></div>
      <div className="practiceMode" role="group" aria-label="练习模式">{[["learning", "学习模式"], ["independent", "独立模式"], ["interview", "面试模拟"]].map(([value, label]) => <button key={value} className={practiceMode === value ? "active" : ""} onClick={() => setPracticeMode(value)}>{label}</button>)}</div>
      <div className="practiceStatus" role="group" aria-label="学习状态">{statusValues.map((status) => <button key={status} className={statusLabels[currentStatus] === status ? "active" : ""} onClick={() => onProgressChange?.(question.id, status)}>{status}</button>)}</div>
      <div className="practiceTimer"><select value={timerMinutes} aria-label="计时分钟数" onChange={(event) => setTimerMinutes(Number(event.target.value))}><option value="15">15 分钟</option><option value="25">25 分钟</option><option value="45">45 分钟</option></select><Timer durationSeconds={timerMinutes * 60} persistedTimer={progressItem?.timer} onChange={(timer) => onProgressChange?.(question.id, progressItem?.status || "in-progress", timer)} onComplete={() => window.alert("时间到，可以查看结果了。")} /></div>
      <div className="questionNav" aria-label="学习顺序导航"><button className="nextQuestionButton" onClick={onPrevious} disabled={!onPrevious}>← 上一题</button><span>学习顺序 {question.studyOrder || "–"} / 100</span><button className="nextQuestionButton" onClick={onNext} disabled={!onNext}>下一题 →</button></div>
    </div>

    <div className="workspaceGrid">
      <article className="statementPane contentCard">
        <div className="workspaceTabs" role="tablist" aria-label="左侧阅读内容"><button role="tab" aria-selected={leftTab === "problem"} className={leftTab === "problem" ? "active" : ""} onClick={() => setLeftTab("problem")}>题目</button><button role="tab" aria-selected={leftTab === "solution"} className={leftTab === "solution" ? "active" : ""} onClick={() => setLeftTab("solution")} disabled={practiceMode === "interview"}>题解</button></div>
        {leftTab === "problem" || practiceMode === "interview" ? <div className="problemReading"><div className="paneTitle"><div><span className="eyebrow">题目 #{question.id} · {question.category}</span><h1>{question.title}</h1></div><a href={question.url} target="_blank" rel="noreferrer">力扣题目 ↗</a></div><p className="readingHint">先读题目约束，再在右侧写出自己的版本。{question.phase ? ` 当前属于${question.phase}。` : ""}</p><div className="statementText">{solution.description ? splitStudyParagraphs(solution.description).map((line, index) => <p key={`${question.id}-description-${index}`}>{line}</p>) : <p>{solution.loadError || "这道题的题面暂不可用，请刷新后重试。"}</p>}</div><div className="learningMeta"><h3>学习目标</h3><p>{normalizeStudyText(solution.learningGoal || solution.recognition || "先识别输入、输出和边界条件。")}</p><h3>前置知识</h3>{Array.isArray(solution.prerequisites) && solution.prerequisites.length ? <ul>{solution.prerequisites.map((item) => <li key={item}>{normalizeStudyText(item)}</li>)}</ul> : <p>暂无前置知识记录。</p>}</div><div className="exampleBlock"><h3>公开示例</h3>{solution.examples?.map((item, index) => <div className="exampleRow" key={`${question.id}-example-${index}`}><div><span>输入</span><pre>{item.input}</pre></div><div><span>输出</span><pre>{item.output}</pre></div></div>)}</div></div> : <ProgressiveSolution question={question} solution={solution} language={language} onLanguageChange={setLanguage} onViewCode={({ language: viewedLanguage }) => recordAttemptSolutionView(viewedLanguage)} onJumpToEditor={() => document.querySelector(".codeEditor")?.scrollIntoView({ behavior: "smooth", block: "center" })} />}
      </article>

      <section className="editorPane">
        <div className="editorCard contentCard">
          <div className="editorHeader"><div><h2>固定编码区</h2><span>{language === "python" ? "Python 3" : "Java 17"} · {mode === "function" ? "力扣函数模式" : "ACM 完整程序模式"} · {practiceMode === "learning" ? "可用分级提示" : practiceMode === "independent" ? "隐藏提示" : "面试模拟"}</span></div><div className="editorControls"><div className="languageTabs" role="tablist" aria-label="代码语言"><button role="tab" aria-selected={language === "java"} className={language === "java" ? "active" : ""} onClick={() => setLanguage("java")}>Java</button><button role="tab" aria-selected={language === "python"} className={language === "python" ? "active" : ""} onClick={() => setLanguage("python")}>Python</button></div><div className="modeTabs" role="group" aria-label="代码模式"><button className={mode === "function" ? "active" : ""} onClick={() => setMode("function")}>函数</button><button className={mode === "acm" ? "active" : ""} onClick={() => setMode("acm")}>ACM</button></div>{examples.length > 0 && <div className="casePicker"><label htmlFor="public-case">公开用例</label><select id="public-case" value={activeExample} onChange={(event) => setActiveExample(Number(event.target.value))}>{examples.map((item, index) => <option value={index} key={`case-option-${index}`}>示例 {index + 1}</option>)}</select></div>}</div></div>
          <details className="editorExtras">
            <summary>提示与笔记<span>{practiceMode === "learning" ? `已解锁 ${Math.min(4, hintsUsed)}/4 级提示` : "个人笔记"}</span></summary>
            <div className="editorExtrasBody">
              {practiceMode === "learning" && <HintLadder hints={solution.hints} hintsUsed={hintsUsed} onRequestHint={nextHint} />}
              <label className="practiceNote">个人笔记<textarea className="noteArea" value={visibleNote} onChange={(event) => onNoteChange?.(question.id, event.target.value)} placeholder="例如：边界条件、复杂度、下一次复习提醒" /></label>
            </div>
          </details>
          {practiceMode === "interview" && <p className="interviewNotice">面试模拟会隐藏提示和题解，已有草稿会继续保留；需要清空时请手动删除代码。</p>}
          {!runnerAvailable && !runnerNoticeDismissed && (
            <div className="runnerNotice" role="status">
              <p>当前页面没有本地运行接口，请在本地开发环境运行 Java/Python。</p>
              <p className="runnerNoticeHint">
                运行功能需要本机的 JDK / Python，且只在 <code>npm run dev</code> 时可用 ——
                这是刻意设计，避免把任意代码执行开放到公网。
              </p>
              <button type="button" className="runnerNoticeClose" onClick={dismissRunnerNotice} aria-label="不再显示这条提示">
                知道了，不再提示
              </button>
            </div>
          )}
          <CodeEditor key={getDraftKey(question.id, language, mode)} language={language} code={code} mode={mode} questionId={question.id} func={solution.func} complexity={solution.complexity} cases={cases} draftRecord={draftRecord} draftStatus={hasDraft(drafts, question.id, language, mode) ? `已恢复 ${language === "java" ? "Java" : "Python"} · ${mode === "function" ? "函数" : "ACM"} 草稿` : "这是当前模式的初始模板，编辑后会自动保存"} onDraftChange={saveDraft} example={selectedExample} onRun={runnerAvailable ? execute : undefined} readOnly={practiceMode === "interview" && false} />
        </div>
        <details className="questionHistory">
          <summary>本题练习历史（{practiceHistory.length} 次有效记录）</summary>
          <div className="questionHistoryBody">{practiceHistory.length ? practiceHistory.map((event, index) => <div className="questionHistoryRow" key={event.id || `${event.createdAt}-${index}`}><strong>第 {index + 1} 次 · {event.outcome === "failed" ? "运行失败" : event.outcome === "independent" ? "独立通过" : event.outcome === "needed-hint" ? "提示后通过" : event.outcome === "needed-solution" ? "看题解后通过" : "运行完成"}</strong><small>{event.language} · {event.mode} · {event.createdAt?.slice(0, 19).replace("T", " ")} · 提示 {event.hintsUsed || 0} 级 · {event.viewedSolutionCode ? "看过题解" : "未看题解"} · {Math.round((event.durationMs || 0) / 1000)} 秒</small></div>) : <p>本题还没有有效运行记录。</p>}</div>
        </details>
      </section>
    </div>
  </section>;
}
