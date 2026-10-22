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
import { TIMER_MINUTE_OPTIONS, minutesFromTimer } from "../services/practice.js";
import { readLocal, writeLocal } from "../services/local-store.js";
import { pickReviewVariant, readActiveVariant, writeActiveVariant } from "../services/active-variant.js";
import { describeNextReview, isReusedPassingCode, planFreshAttempt } from "../services/review-session.js";
import { isPassingVerdict } from "../services/solutions.js";

const difficultyText = { EASY: "简单", MEDIUM: "中等", HARD: "困难" };
// 「无本地运行接口」提示的关闭状态存储键（见组件内 runnerNoticeDismissed）
const RUNNER_NOTICE_KEY = "hot100:runnerNoticeDismissed";
const QUESTION_HISTORY_KEY_PREFIX = "hot100:questionHistoryOpen:";
// 「上次在编辑哪一份解法」的读写已经搬到 services/active-variant.js ——
// 错题页的「看上次的写法」也要用同一份逻辑，两处各写一遍迟早会出现
// 「点进去看到的是空白模板」。

const outcomeLabels = { failed: "运行失败", independent: "独立通过", "needed-hint": "提示后通过", "needed-solution": "看题解后通过", completed: "运行完成" };

function hasDraft(drafts, questionId, language, mode) {
  return Boolean(drafts?.[questionId]?.[language]?.[mode] && typeof drafts[questionId][language][mode] === "object");
}

function readQuestionHistoryOpen(questionId) {
  return readLocal(`${QUESTION_HISTORY_KEY_PREFIX}${questionId}`) === "1";
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
  reviewMode = false,
  onFreshStartConsumed,
  onPatchVariant,
  onProgressChange,
  onTimerChange,
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
  // 时长下拉的初始值必须来自存下来的计时器：
  // 固定 25 会让「存着 45 分钟」的题目显示 45:00、下拉却写 25，
  // 一按「重置」就静默少掉 20 分钟。
  const [timerMinutes, setTimerMinutes] = useState(() => minutesFromTimer(progressItem?.timer));
  const [activeExample, setActiveExample] = useState(0);
  const scope = useMemo(() => selectScope(solutions, question.id, language, mode), [solutions, question.id, language, mode]);
  const [activeVariantId, setActiveVariantId] = useState(() => readActiveVariant(question.id, language, mode, selectScope(solutions, question.id, language, mode)));
  // 「还没存档的草稿」最近一次判题结论。
  // 第一次跑通后马上点「+ 新解法」时，要把这个通过结论一起带进新存档，
  // 否则徽标会莫名其妙地消失（用户已经在公开示例上验证过了）。
  const [draftVerdict, setDraftVerdict] = useState(null);
  // 界面上「已解锁几级提示」。
  //
  // 以前这里读的是 progressItem.hintsByContext 里的**历史累计**，
  // 于是复习一道已经开过 4 级提示的题，一打开就是全解锁；
  // 而判题用的 attemptRef.current.hintsUsed 从 0 开始，判定照样算「独立通过」——
  // 提示白开，间隔白推进。现在两个数各管一头：
  //   hintUnlocked    只影响这一屏能看到几级提示，切题/切语言才归零
  //   attempt.hintsUsed 只影响这一次运行怎么判定，每次运行后归零
  // 这样既不惩罚「我今天想看着提示写」，也不会让复习蒙混过关。
  const [hintUnlocked, setHintUnlocked] = useState(0);
  // 本次运行的提示条（不记进进度，只在界面上说明发生了什么）
  const [attemptNotice, setAttemptNotice] = useState("");
  // 「重写」把当前这份清成模板之前，先把旧代码留一手，随时能撤回来。
  const [overwriteBackup, setOverwriteBackup] = useState(null);
  // 运行器不可用提示：可关闭，并记住选择。
  // 线上构建（import.meta.env.DEV === false）永远没有 /__runner 接口，
  // 这个提示会一直挂着，所以给一个关闭入口；关一次后不再打扰。
  const [runnerNoticeDismissed, setRunnerNoticeDismissed] = useState(() => readLocal(RUNNER_NOTICE_KEY) === "1");
  const dismissRunnerNotice = () => {
    setRunnerNoticeDismissed(true);
    // 存不下也无所谓：至少本次会话内不再显示。
    writeLocal(RUNNER_NOTICE_KEY, "1");
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
    setTimerMinutes(minutesFromTimer(progressItem?.timer));
    setActiveExample(0);
    setHintUnlocked(0);
    setAttemptNotice("");
    setOverwriteBackup(null);
    // 从「看上次的写法」进来：直接把光标停在最近一次通过的那份上。
    // 注意它不推进任何复习记录 —— 只是翻阅，想推进间隔就点「重写」。
    if (reviewMode) {
      const initialLanguage = defaultLanguage === "python" ? "python" : "java";
      setActiveVariantId(pickReviewVariant(question.id, initialLanguage, "function", selectScope(solutions, question.id, initialLanguage, "function")));
      setAttemptNotice("这是你上次通过的写法，只做翻阅，不会推进复习间隔。想推进就点「重写」。");
    }
    onRecordHistory?.({ questionId: question.id, language: defaultLanguage === "python" ? "python" : "java", mode: "function", outcome: "started", createdAt: new Date().toISOString() });
    return () => { sessionRef.current = null; attemptRef.current = null; };
  }, [question.id]);

  useEffect(() => {
    const attemptId = `${question.id}-${language}-${mode}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    attemptRef.current = { attemptId, hintsUsed: 0, viewedSolutionCode: false };
    sessionRef.current = { questionId: String(question.id), language, mode, attemptId };
    setHintUnlocked(0);
  }, [question.id, language, mode]);

  // 切换语言/模式之后，作用域变了，重新决定「在写哪一份」。
  //
  // 但这个 effect 在挂载时也会跑一次，会覆盖掉上面「看上次的写法」挑好的那份
  // （readActiveVariant 只看上次停在哪，不看有没有通过过）。所以首次挂载
  // 且是复习入口时跳过它，把选择权留给 pickReviewVariant。
  const reviewPickDone = useRef(false);
  useEffect(() => {
    if (reviewMode && !reviewPickDone.current) {
      reviewPickDone.current = true;
      return;
    }
    setActiveVariantId(readActiveVariant(question.id, language, mode, selectScope(solutions, question.id, language, mode)));
  }, [question.id, language, mode]);

  const activeVariant = scope.find((item) => item.id === activeVariantId) || null;
  const draftRecord = selectDraftRecord(drafts, question.id, language, mode);
  const template = useMemo(() => createLanguageDrafts({ ...solution, title: question.title }, mode)[language] || "", [language, mode, question.title, solution]);
  // 有激活解法时，编辑器内容就来自这份解法的快照；否则是「未存档草稿 → 初始模板」。
  const code = activeVariant ? activeVariant.code : hasDraft(drafts, question.id, language, mode) ? draftRecord.code : template;
  const editorRecord = activeVariant ? normalizeVariant(activeVariant) : draftRecord;
  const visibleNote = typeof note === "string" ? note : note?.value || "";
  const examples = mode === "acm" ? solution.acm?.examples || [] : Array.isArray(solution.examples) ? solution.examples : [];
  const selectedExample = examples[activeExample] || examples[0];
  const cases = getExecutionCases(solution, mode);
  const currentStatus = derivePracticeStatus(progressItem);
  // 复习通过之后必须立刻说出「下次什么时候」。
  // 以前做对了题就从队列里消失，用户不知道是被排到 3 天后还是 7 天后，
  // 也就没法判断间隔复习到底有没有在工作 —— 反馈缺失让整套机制看起来像没生效。
  const nextReview = describeNextReview(progressItem, new Date(), language);
  const latestPractice = practiceHistory.at(-1);
  const latestPracticeLabel = latestPractice ? (outcomeLabels[latestPractice.outcome] || "运行完成") : "暂无记录";
  const nextHint = (level) => {
    if (attemptRef.current) attemptRef.current.hintsUsed += 1;
    setHintUnlocked((count) => Math.min(4, count + 1));
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

  // 把某一份解法清空回模板。
  //
  // 这是不可逆操作的唯一入口，所以先存一份内存快照到 overwriteBackup：
  // 点错了还能点「撤销，恢复原代码」把它放回去。真正的存档（其它解法）不受影响。
  const resetActiveVariant = (target, message) => {
    if (!target) return;
    setOverwriteBackup({ variantId: target.id, code: target.code, name: target.name });
    const record = {
      code: template,
      cursor: 0,
      scrollTop: 0,
      updatedAt: new Date().toISOString()
    };
    // 判题结论由 patchSolutionVariant 一并清掉：这份已经不是「跑通过的那份」了，
    // 徽标留着会让用户以为模板也验证过。
    onPatchVariant?.(question.id, language, mode, target.id, record);
    setDraftVerdict(null);
    setActiveVariantId(target.id);
    writeActiveVariant(question.id, language, mode, target.id);
    // 撤销按钮挂在提示条里。以前这里只写了 overwriteBackup、没写提示条，
    // 提示条是空字符串就不渲染 —— 于是「旧代码留了一份快照」这句话永远看不到，
    // 撤销按钮也就永远点不到。重置本身必须自己把提示条点亮。
    setAttemptNotice(message || `已把「${target.name}」重置为空白模板，旧代码留了一份快照，可以撤销。`);
  };

  const undoReset = () => {
    if (!overwriteBackup) return;
    onPatchVariant?.(question.id, language, mode, overwriteBackup.variantId, { code: overwriteBackup.code, cursor: 0, scrollTop: 0 });
    setOverwriteBackup(null);
    setAttemptNotice("已经恢复成重置前的代码。");
  };

  // 新增一份解法：当前这份（如果在写）已经实时同步过了，
  // 所以这里只需要把新快照建出来并切过去，编辑器随即拿到干净的模板。
  const addVariant = () => {
    // 存档满了以前是 `return;` —— 点了没反应、也没提示，用户只会以为按钮坏了。
    // 现在满了退化成「把当前这份重置成模板」：仍然能开始重写，但必须说清楚
    // 旧代码去哪儿了（就在旁边那几份里，不是被删了）。
    const plan = planFreshAttempt(scope, maxVariants);
    if (plan.action === "reset-active") {
      const target = activeVariant || scope.at(-1);
      if (!target) return;
      resetActiveVariant(target, plan.message);
      return;
    }
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
    // 「重写」进来的第一句必须说清「上次的写法去哪了」：
    // 它没被删，仍然躺在存档里，只是现在写的是一份新的空白模板。
    setAttemptNotice("已开一份空白模板，上次的写法没有删，随时可以在上面的存档里切回去看。");
    onFreshStartConsumed?.();
  }, [freshStart, question.id]);

  const handleQuestionHistoryToggle = (event) => {
    const open = event.currentTarget.open;
    setQuestionHistoryOpen(open);
    // 存不下也不影响本次页面内的折叠状态。
    writeLocal(`${QUESTION_HISTORY_KEY_PREFIX}${question.id}`, open ? "1" : "0");
  };

  // pairHandler 是 CodeEditor 传下来的配对码回调（线上首次运行时才会有）。
  // 这一层只做统计与本机记录，必须把参数原样透传，否则用户看不到配对码。
  const execute = async (payload, signal, pairHandler, offlineHandler) => {
    const session = sessionRef.current;
    const variantIdAtRun = activeVariantId;
    const attempt = attemptRef.current || { attemptId: `${question.id}-legacy`, hintsUsed: 0, viewedSolutionCode: false };
    const result = await onRun?.(payload, signal, pairHandler, offlineHandler);
    if (!result || result.status === "unavailable") return result;
    if (sessionRef.current !== session || sessionRef.current?.questionId !== String(question.id)
      || sessionRef.current?.language !== payload.language || sessionRef.current?.mode !== payload.mode) return result;
    const allCases = Array.isArray(result.cases) ? result.cases : [result];
    const passed = result.status === "passed" || allCases.length > 0 && allCases.every((item) => item.status === "passed");
    const effectiveMode = payload.mode || mode;
    const hasHardFailure = ["mismatch", "failed", "compile_error", "compile_timeout", "runtime_error", "timeout", "output_limit", "environment_error", "template", "unsupported"].includes(result.status) || allCases.some((item) => ["mismatch", "failed", "compile_error", "compile_timeout", "runtime_error", "timeout", "output_limit", "environment_error", "template", "unsupported"].includes(item.status));
    let outcome = hasHardFailure ? "failed" : classifyAttemptOutcome({ passed, attemptHintsUsed: attempt.hintsUsed, attemptViewedSolutionCode: attempt.viewedSolutionCode });
    // 「原样再跑一遍已通过的代码」不算一次独立通过。
    //
    // 这是复习功能最容易自欺的一环：点开到期复习，代码还在，直接点运行、绿了、
    // 间隔就往前推一档。中间没有任何思考发生，但记录上看起来和「重新做出来」一样。
    // 所以这里比对代码指纹：和任何一份已通过的快照逐字一致，就把这次判定降级成
    // 「运行完成」，只记一次历史，不动复习阶梯。
    const passedCodes = scope.filter((item) => isPassingVerdict(item.verdict)).map((item) => item.code);
    const reused = passed && passedCodes.length > 0 && isReusedPassingCode(payload.code, passedCodes);
    if (reused) {
      outcome = "completed";
      setAttemptNotice("这次的代码和你之前通过的那份完全一样，只记一次运行，不算独立通过、也不会推进复习间隔。");
    } else if (outcome !== "failed") {
      setAttemptNotice("");
    }
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
      {nextReview && <span className="nextReviewChip" title="按 1、3、7、14 天的间隔复习；独立通过才推进，用了提示会退回第 1 档">{nextReview.text}</span>}
      <div className="practiceTimer"><select value={timerMinutes} aria-label="计时分钟数" onChange={(event) => setTimerMinutes(Number(event.target.value))}>{TIMER_MINUTE_OPTIONS.map((value) => <option key={value} value={value}>{value} 分钟</option>)}</select><Timer durationSeconds={timerMinutes * 60} persistedTimer={progressItem?.timer} onChange={(timer) => onTimerChange?.(question.id, timer)} onComplete={() => window.alert("时间到，可以查看结果了。")} /></div>
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
            <summary>提示与笔记<span>{practiceMode === "learning" ? `已解锁 ${Math.min(4, hintUnlocked)}/4 级提示` : "个人笔记"}</span></summary>
            <div className="editorExtrasBody">
              {practiceMode === "learning" && <HintLadder hints={solution.hints} hintsUsed={hintUnlocked} onRequestHint={nextHint} />}
              <label className="practiceNote">个人笔记<textarea className="noteArea" value={visibleNote} onChange={(event) => onNoteChange?.(question.id, event.target.value)} placeholder="例如：边界条件、复杂度、下一次复习提醒" /></label>
            </div>
          </details>
          {attemptNotice && <div className="attemptNotice" role="status">
            <span>{attemptNotice}</span>
            {overwriteBackup && <button type="button" className="attemptNoticeUndo" onClick={undoReset}>撤销，恢复原代码</button>}
            <button type="button" className="attemptNoticeClose" onClick={() => { setAttemptNotice(""); setOverwriteBackup(null); }} aria-label="关闭这条提示">×</button>
          </div>}
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
          {activeVariant && <div className="resetRow">
            <button type="button" className="textButton" onClick={() => resetActiveVariant(activeVariant)} title="把「当前这份」清回空白模板，旧代码会留一份可撤销的快照">重置为模板</button>
            <small>只是清空这一份，其它解法不受影响；清完还能撤销。</small>
          </div>}
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
