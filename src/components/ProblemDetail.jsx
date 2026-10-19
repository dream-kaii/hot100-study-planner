import React, { useEffect, useMemo, useRef, useState } from "react";
import Timer from "./Timer.jsx";
import CodeEditor from "./CodeEditor.jsx";
import HintLadder from "./HintLadder.jsx";
import ProgressiveSolution from "./ProgressiveSolution.jsx";
import SolutionVariants from "./SolutionVariants.jsx";
import { normalizeStudyText, splitStudyParagraphs } from "../services/study-text.js";
import { createLanguageDrafts, getDraftKey, getExecutionCases, selectDraftRecord } from "../services/editor.js";
import { classifyAttemptOutcome, derivePracticeStatus } from "../services/status.js";
import { STATUS_BUTTONS } from "../services/status-labels.js";
import { MAX_SOLUTIONS_PER_SCOPE, createVariantId, normalizeVariant, selectScope } from "../services/solutions.js";
import { formatDateTime } from "../services/datetime.js";

const difficultyText = { EASY: "简单", MEDIUM: "中等", HARD: "困难" };
// 「无本地运行接口」提示的关闭状态存储键（见组件内 runnerNoticeDismissed）
const RUNNER_NOTICE_KEY = "hot100:runnerNoticeDismissed";
const QUESTION_HISTORY_KEY_PREFIX = "hot100:questionHistoryOpen:";
// 每道题 × 语言 × 模式 记住「上次在编辑哪一份解法」。
// 放在 localStorage 而不是 state：刷新、切换题目回来都还能接着写那一份。
const ACTIVE_VARIANT_KEY_PREFIX = "hot100:activeVariant:";
const outcomeLabels = { failed: "运行失败", independent: "独立通过", "needed-hint": "提示后通过", "needed-solution": "看题解后通过", completed: "运行完成" };

function hasDraft(drafts, questionId, language, mode) {
  return Boolean(drafts?.[questionId]?.[language]?.[mode] && typeof drafts[questionId][language][mode] === "object");
}

function readQuestionHistoryOpen(questionId) {
  try {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(`${QUESTION_HISTORY_KEY_PREFIX}${questionId}`) === "1";
  } catch {
    return false;
  }
}

function activeVariantKey(questionId, language, mode) {
  return `${ACTIVE_VARIANT_KEY_PREFIX}${questionId}:${language}:${mode}`;
}

function readActiveVariant(questionId, language, mode, scope) {
  try {
    if (typeof window === "undefined") return null;
    const stored = window.localStorage.getItem(activeVariantKey(questionId, language, mode));
    if (stored && scope.some((item) => item.id === stored)) return stored;
  } catch {
    // localStorage 不可用时退回默认选择
  }
  // 没有记录时默认接着最后一份写，避免「明明存过却打开是空白模板」。
  return scope.length ? scope.at(-1).id : null;
}

function writeActiveVariant(questionId, language, mode, variantId) {
  try {
    if (typeof window === "undefined") return;
    const key = activeVariantKey(questionId, language, mode);
    if (variantId) window.localStorage.setItem(key, variantId);
    else window.localStorage.removeItem(key);
  } catch {
    // 存不了就只保留内存态
  }
}

export default function ProblemDetail({
  question,
  solution = {},
  progressItem,
  drafts = {},
  solutions = {},
  note,
  defaultLanguage = "java",
  runnerAvailable = true,
  maxVariants = MAX_SOLUTIONS_PER_SCOPE,
  freshStart = false,
  onFreshStartConsumed,
  onProgressChange,
  onHint,
  onSolutionView,
  onDraftChange,
  onNoteChange,
  onAddVariant,
  onSaveVariant,
  onRenameVariant,
  onRemoveVariant,
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
  const [questionHistoryOpen, setQuestionHistoryOpen] = useState(() => readQuestionHistoryOpen(question?.id));
  const [timerMinutes, setTimerMinutes] = useState(25);
  const [activeExample, setActiveExample] = useState(0);
  const scope = useMemo(() => selectScope(solutions, question.id, language, mode), [solutions, question.id, language, mode]);
  const [activeVariantId, setActiveVariantId] = useState(() => readActiveVariant(question.id, language, mode, selectScope(solutions, question.id, language, mode)));
  // 「还没存档的草稿」最近一次判题结论。
  // 第一次跑通后马上点「+ 新解法」时，要把这个通过结论一起带进新存档，
  // 否则徽标会莫名其妙地消失（用户已经在公开示例上验证过了）。
  const [draftVerdict, setDraftVerdict] = useState(null);
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
    setQuestionHistoryOpen(readQuestionHistoryOpen(question.id));
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

  // 切换语言/模式之后，作用域变了，重新决定「在写哪一份」。
  useEffect(() => {
    setActiveVariantId(readActiveVariant(question.id, language, mode, selectScope(solutions, question.id, language, mode)));
  }, [question.id, language, mode]);

  const activeVariant = scope.find((item) => item.id === activeVariantId) || null;
  const draftRecord = selectDraftRecord(drafts, question.id, language, mode);
  const template = useMemo(() => createLanguageDrafts({ ...solution, title: question.title }, mode)[language] || "", [language, mode, question.title, solution]);
  // 有激活解法时，编辑器内容就来自这份解法的快照；否则是「未存档草稿 → 初始模板」。
  const code = activeVariant ? activeVariant.code : hasDraft(drafts, question.id, language, mode) ? draftRecord.code : template;
  const editorRecord = activeVariant ? normalizeVariant(activeVariant) : draftRecord;
  const visibleNote = typeof note === "string" ? note : note?.value || "";
  const hintsUsed = progressItem?.hintsByContext?.[`${language}:${mode}`]?.count ?? progressItem?.hintsUsed ?? 0;
  const viewedSolutionCode = Boolean(progressItem?.viewedSolutionByContext?.[`${language}:${mode}`] || progressItem?.viewedSolutionCode);
  const examples = mode === "acm" ? solution.acm?.examples || [] : Array.isArray(solution.examples) ? solution.examples : [];
  const selectedExample = examples[activeExample] || examples[0];
  const cases = getExecutionCases(solution, mode);
  const currentStatus = derivePracticeStatus(progressItem);
  const latestPractice = practiceHistory.at(-1);
  const latestPracticeLabel = latestPractice ? (outcomeLabels[latestPractice.outcome] || "运行完成") : "暂无记录";
  const nextHint = (level) => {
    if (attemptRef.current) attemptRef.current.hintsUsed += 1;
    onHint?.(question.id, level, language, mode);
  };

  // 草稿与解法快照同步写：编辑永远先落盘，再谈切换。
  // 这样「切走再切回来」不会丢任何一个字符。
  const saveDraft = (record) => {
    onDraftChange?.(question.id, language, mode, record);
    if (activeVariantId) onSaveVariant?.(question.id, language, mode, activeVariantId, record);
  };
  const recordAttemptSolutionView = (viewedLanguage) => {
    if (attemptRef.current) attemptRef.current.viewedSolutionCode = true;
    onSolutionView?.(question.id, viewedLanguage, mode);
  };

  const switchVariant = (variantId) => {
    setActiveVariantId(variantId);
    writeActiveVariant(question.id, language, mode, variantId);
  };

  // 新增一份解法：当前这份（如果在写）已经实时同步过了，
  // 所以这里只需要把新快照建出来并切过去，编辑器随即拿到干净的模板。
  const addVariant = () => {
    if (scope.length >= maxVariants) return;
    // 防呆：最后一份如果还是原样空模板（没写过、也没通过），直接切过去，
    // 不再堆一份一模一样的空解法 —— 否则连点几次「另起一种解法」会把 5 个槽位占满。
    const last = scope.at(-1);
    const blankTemplate = String(template || "").trim();
    if (last && !last.verdict && blankTemplate && String(last.code || "").trim() === blankTemplate) {
      setActiveVariantId(last.id);
      writeActiveVariant(question.id, language, mode, last.id);
      return;
    }
    const newId = createVariantId(scope.length);
    // 传的是编辑器里的真实内容（code），不是 draftRecord ——
    // 没编辑过的草稿记录是空的，用它会存下一份空字符串。
    // 通过结论只在「跑通之后代码没再改过」时才带过去，避免把旧结论贴到新代码上。
    const verdictCarries = draftVerdict && draftVerdict.code === code ? draftVerdict : null;
    onAddVariant?.(question.id, language, mode, { ...draftRecord, code }, {
      template,
      newId,
      verdict: verdictCarries?.verdict,
      verifiedAt: verdictCarries?.verifiedAt
    });
    setActiveVariantId(newId);
    writeActiveVariant(question.id, language, mode, newId);
  };

  const removeVariant = (variantId) => {
    const index = scope.findIndex((item) => item.id === variantId);
    const fallback = scope[index + 1] || scope[index - 1] || null;
    onRemoveVariant?.(question.id, language, mode, variantId);
    setActiveVariantId(fallback ? fallback.id : null);
    writeActiveVariant(question.id, language, mode, fallback ? fallback.id : null);
  };

  // 从错题页点「另起一种解法」进来：走与「+ 新解法」完全相同的路径，
  // 所以旧代码一律进存档，不会被 delete 掉。只消费一次。
  const consumedFreshStart = useRef(false);
  useEffect(() => {
    if (!freshStart) { consumedFreshStart.current = false; return; }
    if (consumedFreshStart.current) return;
    consumedFreshStart.current = true;
    addVariant();
    onFreshStartConsumed?.();
  }, [freshStart, question.id]);

  const handleQuestionHistoryToggle = (event) => {
    const open = event.currentTarget.open;
    setQuestionHistoryOpen(open);
    try {
      window.localStorage.setItem(`${QUESTION_HISTORY_KEY_PREFIX}${question.id}`, open ? "1" : "0");
    } catch {
      // localStorage 不可用时仍保持本次页面内的折叠状态。
    }
  };

  // pairHandler 是 CodeEditor 传下来的配对码回调（线上首次运行时才会有）。
  // 这一层只做统计与本机记录，必须把参数原样透传，否则用户看不到配对码。
  const execute = async (payload, signal, pairHandler) => {
    const session = sessionRef.current;
    const variantIdAtRun = activeVariantId;
    const attempt = attemptRef.current || { attemptId: `${question.id}-legacy`, hintsUsed: 0, viewedSolutionCode: false };
    const result = await onRun?.(payload, signal, pairHandler);
    if (!result || result.status === "unavailable") return result;
    if (sessionRef.current !== session || sessionRef.current?.questionId !== String(question.id)
      || sessionRef.current?.language !== payload.language || sessionRef.current?.mode !== payload.mode) return result;
    const allCases = Array.isArray(result.cases) ? result.cases : [result];
    const passed = result.status === "passed" || allCases.length > 0 && allCases.every((item) => item.status === "passed");
    const effectiveMode = payload.mode || mode;
    const hasHardFailure = ["mismatch", "failed", "compile_error", "compile_timeout", "runtime_error", "timeout", "output_limit", "environment_error", "template", "unsupported"].includes(result.status) || allCases.some((item) => ["mismatch", "failed", "compile_error", "compile_timeout", "runtime_error", "timeout", "output_limit", "environment_error", "template", "unsupported"].includes(item.status));
    const outcome = hasHardFailure ? "failed" : classifyAttemptOutcome({ passed, attemptHintsUsed: attempt.hintsUsed, attemptViewedSolutionCode: attempt.viewedSolutionCode });
    const failedCase = allCases.find((item) => item.status !== "passed");
    onPracticeOutcome?.({ questionId: question.id, language, mode: effectiveMode, outcome, hintsUsed: attempt.hintsUsed, viewedSolutionCode: attempt.viewedSolutionCode, attemptId: attempt.attemptId, attemptHintsUsed: attempt.hintsUsed, attemptViewedSolutionCode: attempt.viewedSolutionCode, caseId: failedCase?.caseId, durationMs: result.durationMs || failedCase?.durationMs || 0, error: result.error, variantId: variantIdAtRun });
    // 未存档草稿的判题结论留着，等「+ 新解法」时一起写进存档。
    // 连带把当时的代码一起记下：只有代码没再改过，这个结论才算数。
    if (!variantIdAtRun) setDraftVerdict({ verdict: outcome, verifiedAt: outcome === "failed" ? null : new Date().toISOString(), code: payload.code });
    else setDraftVerdict(null);
    attemptRef.current = { attemptId: `${question.id}-${language}-${effectiveMode}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, hintsUsed: 0, viewedSolutionCode: false };
    return result;
  };

  return <section className="detailPage problemWorkspace">
    <div className="practiceBar">
      <button className="textButton" onClick={onBack}>← 返回题库</button>
      <div className="practiceIdentity"><strong>#{question.id} {question.title}</strong><span>{question.category} · {difficultyText[question.difficulty]} · {question.phase || "学习顺序"} · 学习顺序 {question.studyOrder}</span><span>{nextQuestion ? `下一题：${nextQuestion.title} · 按学习顺序 ${nextQuestion.studyOrder} 继续` : "已到学习顺序末尾"}</span></div>
      <div className="practiceMode" role="group" aria-label="练习模式">{[["learning", "学习模式"], ["independent", "独立模式"], ["interview", "面试模拟"]].map(([value, label]) => <button key={value} className={practiceMode === value ? "active" : ""} onClick={() => setPracticeMode(value)}>{label}</button>)}</div>
      <div className="practiceStatus" role="group" aria-label="学习状态">{STATUS_BUTTONS.map(({ canonical, label }) => <button key={canonical} className={currentStatus === canonical ? "active" : ""} onClick={() => onProgressChange?.(question.id, canonical)}>{label}</button>)}</div>
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
          <div className="editorHeader">
            <div><h2>固定编码区</h2><span>{language === "python" ? "Python 3" : "Java 17"} · {mode === "function" ? "力扣函数模式" : "ACM 完整程序模式"} · {practiceMode === "learning" ? "可用分级提示" : practiceMode === "independent" ? "隐藏提示" : "面试模拟"}</span></div>
            <div className="editorControls">
              <div className="languageTabs" role="tablist" aria-label="代码语言"><button role="tab" aria-selected={language === "java"} className={language === "java" ? "active" : ""} onClick={() => setLanguage("java")}>Java</button><button role="tab" aria-selected={language === "python"} className={language === "python" ? "active" : ""} onClick={() => setLanguage("python")}>Python</button></div>
              <div className="modeTabs" role="group" aria-label="代码模式"><button className={mode === "function" ? "active" : ""} onClick={() => setMode("function")}>函数</button><button className={mode === "acm" ? "active" : ""} onClick={() => setMode("acm")}>ACM</button></div>
              <SolutionVariants
                variants={scope}
                activeId={activeVariantId}
                max={maxVariants}
                onSwitch={switchVariant}
                onAdd={addVariant}
                onRename={(variantId, name) => onRenameVariant?.(question.id, language, mode, variantId, name)}
                onRemove={removeVariant}
              />
              {examples.length > 0 && <div className="casePicker"><label htmlFor="public-case">公开用例</label><select id="public-case" value={activeExample} onChange={(event) => setActiveExample(Number(event.target.value))}>{examples.map((item, index) => <option value={index} key={`case-option-${index}`}>示例 {index + 1}</option>)}</select></div>}
            </div>
          </div>
          <details className="editorExtras">
            <summary>提示与笔记<span>{practiceMode === "learning" ? `已解锁 ${Math.min(4, hintsUsed)}/4 级提示` : "个人笔记"}</span></summary>
            <div className="editorExtrasBody">
              {practiceMode === "learning" && <HintLadder hints={solution.hints} hintsUsed={hintsUsed} onRequestHint={nextHint} />}
              <label className="practiceNote">个人笔记<textarea className="noteArea" value={visibleNote} onChange={(event) => onNoteChange?.(question.id, event.target.value)} placeholder="例如：边界条件、复杂度、下一次复习提醒" /></label>
            </div>
          </details>
          {practiceMode === "interview" && <p className="interviewNotice">面试模拟会隐藏提示和题解，已有草稿会继续保留；想换个思路就用「+ 新解法」，原来那份不会丢。</p>}
          {!runnerAvailable && !runnerNoticeDismissed && (
            <div className="runnerNotice" role="status">
              <p>这道题暂时无法运行：缺少函数签名，或本机没有可用的 Java / Python。</p>
              <p className="runnerNoticeHint">
                运行需要本机装有 JDK 或 Python。代码只在你自己的电脑上执行，不会上传。
              </p>
              <button type="button" className="runnerNoticeClose" onClick={dismissRunnerNotice} aria-label="不再显示这条提示">
                知道了，不再提示
              </button>
            </div>
          )}
          <CodeEditor
            key={`${getDraftKey(question.id, language, mode)}:${activeVariantId || "draft"}`}
            language={language}
            code={code}
            mode={mode}
            questionId={question.id}
            func={solution.func}
            complexity={solution.complexity}
            cases={cases}
            draftRecord={editorRecord}
            draftStatus={activeVariant ? `正在写「${activeVariant.name}」· 自动保存` : hasDraft(drafts, question.id, language, mode) ? `已恢复 ${language === "java" ? "Java" : "Python"} · ${mode === "function" ? "函数" : "ACM"} 草稿` : "这是当前模式的初始模板，编辑后会自动保存"}
            onDraftChange={saveDraft}
            example={selectedExample}
            onRun={runnerAvailable ? execute : undefined}
            readOnly={practiceMode === "interview" && false}
          />
        </div>
        <details className="questionHistory" open={questionHistoryOpen} onToggle={handleQuestionHistoryToggle}>
          <summary>本题练习历史 · {practiceHistory.length} 次 · 最近一次{latestPracticeLabel}</summary>
          <div className="questionHistoryBody">{practiceHistory.length ? practiceHistory.map((event, index) => <div className="questionHistoryRow" key={event.id || `${event.createdAt}-${index}`}><strong>第 {index + 1} 次 · {event.outcome === "failed" ? "运行失败" : event.outcome === "independent" ? "独立通过" : event.outcome === "needed-hint" ? "提示后通过" : event.outcome === "needed-solution" ? "看题解后通过" : "运行完成"}</strong><small>{event.language} · {event.mode} · {formatDateTime(event.createdAt)} · 提示 {event.hintsUsed || 0} 级 · {event.viewedSolutionCode ? "看过题解" : "未看题解"} · {Math.round((event.durationMs || 0) / 1000)} 秒{event.variantId ? ` · ${scope.find((item) => item.id === event.variantId)?.name || "某个解法"}` : ""}</small></div>) : <p>本题还没有有效运行记录。</p>}</div>
        </details>
      </section>
    </div>
  </section>;
}
