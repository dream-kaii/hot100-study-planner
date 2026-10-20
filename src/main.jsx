import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import hot100 from "./data/hot100.json";
import { createDefaultState, parseState } from "./services/storage.js";
import { hasBackupDirectory, writeBackup } from "./services/backup.js";
import { appendHistory } from "./services/history.js";
import { getEffectivePracticeEvents } from "./services/history.js";
import { filterQuestions, hasCompletedLearning, orderByStudyOrder, pickNextQuestion, pickPreviousQuestion, pickStudyQuestion } from "./services/practice.js";
import { normalizeStudySolution } from "./services/study-text.js";
import { recordHint, recordReviewOutcome, recordSolutionView, derivePracticeStatus, isMistakeStatus, isReviewPending } from "./services/status.js";
import { canonicalStatus, statusLabel } from "./services/status-labels.js";
import {
  MAX_SOLUTIONS_PER_SCOPE,
  appendVariant,
  applyVerdict,
  canAddVariant,
  createVariant,
  nextVariantName,
  normalizeVariant,
  removeVariant,
  renameVariant,
  selectScope,
  updateVariant
} from "./services/solutions.js";
import BackupPanel from "./components/BackupPanel.jsx";
import { adoptFromUrl, fetchDeviceBackup } from "./services/device.js";
import ProblemDetail from "./components/ProblemDetail.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import ProblemBank from "./pages/ProblemBank.jsx";
import Mistakes from "./pages/Mistakes.jsx";
import BrandIcon from "./components/BrandIcon.jsx";
import SiteFooter from "./components/SiteFooter.jsx";
import { BRAND, BLOG } from "./brand.js";
import "./styles.css";
import { createOnRun, canRunOnline } from "./online/runner-bridge.js";

const solutionModules = import.meta.glob("./data/solutions/*.json", { eager: false, import: "default" });
const STORAGE_KEYS = ["hot100-study-planner-v3", "hot100-study-planner-v1"];

function loadState() {
  if (typeof localStorage === "undefined") return createDefaultState();
  for (const key of STORAGE_KEYS) {
    const raw = localStorage.getItem(key);
    if (raw) {
      try { return parseState(raw); } catch { /* ignore unsupported/corrupt local data and keep the app usable */ }
    }
  }
  return createDefaultState();
}

// 给 UI 的 progress 视图：把规范状态转成中文标签，
// 顺便把「已完成但复习到期」显式标成待复习，避免各处再各算一次。
function uiProgress(progress = {}, solutions = {}, now = new Date()) {
  return Object.fromEntries(Object.entries(progress).map(([id, item]) => {
    const derived = derivePracticeStatus(item, now);
    // 该题一共存了几种解法（跨语言去重后取最大），题库卡片上会显示「N 种解法」。
    const scopes = solutions?.[id] || {};
    const variantCount = Object.values(scopes).reduce((max, modes) => {
      const counts = Object.values(modes || {}).map((list) => (Array.isArray(list) ? list.length : 0));
      return Math.max(max, 0, ...counts);
    }, 0);
    return [id, { ...item, status: statusLabel(derived), canonical: derived, variantCount }];
  }));
}

function App() {
  const [state, setState] = useState(loadState);
  const [backupAvailable, setBackupAvailable] = useState(false);
  const [selectedId, setSelectedId] = useState(() => typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("question"));
  const [view, setView] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("question") ? "detail" : "dashboard");
  const [filters, setFilters] = useState({ query: "", category: "全部", difficulty: "全部", status: "全部" });
  const [lastBackupAt, setLastBackupAt] = useState("");
  const [deviceBackupName, setDeviceBackupName] = useState("");
  const [selectedSolution, setSelectedSolution] = useState(null);
  // 「从错题页点另起一种解法」要用的一次性标记。消费后清掉，
  // 免得下次普通打开题目又莫名其妙多开一份。
  const [freshStartFor, setFreshStartFor] = useState(null);

  // Safari 拦掉了 https 页面对本机的 fetch，只能靠"顶层跳转"把 sid 带回来，
  // 落点是 /?adopt=<sid>，这里第一时间收下并清掉地址栏参数。
  useEffect(() => {
    adoptFromUrl().catch(() => {});
  }, []);

  useEffect(() => {
    hasBackupDirectory()
      .then((has) => {
        setBackupAvailable(has);
        // 本浏览器还没有句柄时，问问这台设备是不是在别的浏览器里设过。
        if (!has) {
          fetchDeviceBackup()
            .then((info) => { if (info?.name) setDeviceBackupName(info.name); })
            .catch(() => {});
        }
      })
      .catch(() => setBackupAvailable(false));
  }, []);

  useEffect(() => {
    const onPopState = () => {
      const id = new URLSearchParams(window.location.search).get("question");
      setSelectedId(id);
      setView(id ? "detail" : "dashboard");
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (typeof localStorage !== "undefined") localStorage.setItem(STORAGE_KEYS[0], JSON.stringify(state));
    if (!backupAvailable) return undefined;
    const timer = window.setTimeout(() => writeBackup(state).then(setLastBackupAt).catch(() => {}), 800);
    return () => window.clearTimeout(timer);
  }, [state, backupAvailable]);

  const progress = state.progress || {};
  const displayProgress = useMemo(() => uiProgress(progress, state.solutions), [progress, state.solutions]);
  const updateState = (updater) => setState((current) => ({ ...current, ...(typeof updater === "function" ? updater(current) : updater), updatedAt: new Date().toISOString() }));

  // 手动改状态。
  // 旧版在这里静默 return {} —— 用户点了「错题」什么都不发生，也没有提示，
  // 一度让人以为「我明明标了错题，怎么找不到」。现在一律立刻生效。
  const setStatus = (questionId, status, timer) => updateState((current) => {
    const previous = current.progress?.[questionId] || {};
    const now = new Date().toISOString();
    const requested = canonicalStatus(status);
    const next = { ...previous, status: requested, ...(timer ? { timer } : {}), updatedAt: now };
    if (["completed", "mastered"].includes(requested)) next.completedAt = previous.completedAt || now;
    if (requested === "mastered" && !next.masteredAt) next.masteredAt = now;
    if (requested === "reviewing") {
      // 标成错题就要排进错题池，给一个立刻到期的复习日。
      delete next.masteredAt;
      next.reviewAt = now;
    }
    if (requested === "due") {
      delete next.masteredAt;
      next.reviewAt = now;
    }
    if (requested === "in-progress") delete next.masteredAt;
    return { progress: { ...current.progress, [questionId]: next } };
  });

  const setNote = (questionId, note) => updateState((current) => ({ notes: { ...current.notes, [questionId]: { value: note, updatedAt: new Date().toISOString() } } }));

  const setDraft = (questionId, language, mode, draft) => updateState((current) => ({
    drafts: {
      ...current.drafts,
      [questionId]: {
        ...(current.drafts?.[questionId] || {}),
        [language]: { ...(current.drafts?.[questionId]?.[language] || {}), [mode]: draft }
      }
    }
  }));

  const readScope = (current, questionId, language, mode) => selectScope(current.solutions, questionId, language, mode);
  const writeScope = (current, questionId, language, mode, list) => ({
    ...current.solutions,
    [questionId]: {
      ...(current.solutions?.[questionId] || {}),
      [language]: { ...(current.solutions?.[questionId]?.[language] || {}), [mode]: list }
    }
  });

  // 点「+ 新解法」的语义：
  //   1) 如果当前还是「未存档草稿」，先把它存成一份（不丢任何已写代码）；
  //   2) 再追加一份空白模板解法并切过去，用户立刻开始写新思路。
  // 这样「另起一种解法」永远不等于「删掉上一份」。
  //
  // 唯一的例外：草稿就是原样未改的模板（一个字符都没写）时不再额外存档，
  // 否则刚打开题目点一下「+ 新解法」会凭空多出两份一模一样的空模板。
  const isUntouchedTemplate = (code, template) => !String(code || "").trim() || String(code || "").trim() === String(template || "").trim();

  const addSolutionVariant = (questionId, language, mode, draft, options = {}) => updateState((current) => {
    let list = readScope(current, questionId, language, mode);
    if (list.length === 0 && draft?.code && !isUntouchedTemplate(draft.code, options.template)) {
      // 第一次存档：把这份草稿连同它的判题结论一起收进「解法 1」。
      const first = createVariant(draft, { seed: 0, name: nextVariantName(list) });
      list = appendVariant(list, {
        ...first,
        verdict: options.verdict || first.verdict,
        verifiedAt: options.verifiedAt || first.verifiedAt
      });
    }
    if (!canAddVariant(list)) return { solutions: writeScope(current, questionId, language, mode, list) };
    const now = new Date().toISOString();
    // 新建的这份是空白模板，必须不带判题结论 ——
    // 通过徽标只属于刚被存档的那份代码，不能跟着新解法一起复制。
    const blank = normalizeVariant({
      id: options.newId,
      name: nextVariantName(list),
      code: options.template || "",
      createdAt: now,
      updatedAt: now
    }, list.length);
    list = appendVariant(list, blank);
    // 草稿归零：以后编辑器内容完全由「激活的解法」驱动，避免两份代码互相打架。
    const drafts = { ...current.drafts };
    if (drafts[questionId]?.[language]) {
      const scoped = { ...drafts[questionId][language] };
      delete scoped[mode];
      drafts[questionId] = { ...drafts[questionId], [language]: scoped };
    }
    return { solutions: writeScope(current, questionId, language, mode, list), drafts };
  });

  // 把当前草稿覆盖写回某份已存在的解法。
  const saveSolutionVariant = (questionId, language, mode, variantId, draft) => updateState((current) => {
    const list = readScope(current, questionId, language, mode);
    if (!list.some((item) => item.id === variantId)) return {};
    return {
      solutions: writeScope(current, questionId, language, mode, updateVariant(list, variantId, {
        code: draft?.code ?? "",
        cursor: draft?.cursor ?? 0,
        scrollTop: draft?.scrollTop ?? 0,
        updatedAt: new Date().toISOString()
      }))
    };
  });

  const renameSolutionVariant = (questionId, language, mode, variantId, name) => updateState((current) => ({
    solutions: writeScope(current, questionId, language, mode, renameVariant(readScope(current, questionId, language, mode), variantId, name))
  }));

  const removeSolutionVariant = (questionId, language, mode, variantId) => updateState((current) => ({
    solutions: writeScope(current, questionId, language, mode, removeVariant(readScope(current, questionId, language, mode), variantId))
  }));

  const recordHintUsage = (questionId, level, language, mode) => updateState((current) => ({
    progress: { ...current.progress, [questionId]: recordHint(current.progress?.[questionId] || {}, level, new Date(), language, mode) }
  }));

  const recordSolutionCodeView = (questionId, language, mode) => updateState((current) => ({
    progress: { ...current.progress, [questionId]: recordSolutionView(current.progress?.[questionId] || {}, language, new Date(), mode) }
  }));

  const recordHistory = (event) => updateState((current) => appendHistory(current, event));

  const recordPracticeOutcome = ({ questionId, language, mode, outcome, hintsUsed, viewedSolutionCode, attemptId, attemptHintsUsed, attemptViewedSolutionCode, caseId, durationMs, error, variantId }) => updateState((current) => {
    const now = new Date().toISOString();
    const nextProgress = outcome === "completed"
      ? current.progress?.[questionId] || {}
      : recordReviewOutcome(current.progress?.[questionId] || {}, outcome, now);
    // 判题结论顺手回填到该解法的快照上，切换器里才能显示「这份跑通过」。
    const list = readScope(current, questionId, language, mode);
    const nextSolutions = variantId && list.some((item) => item.id === variantId)
      ? writeScope(current, questionId, language, mode, applyVerdict(list, variantId, { verdict: outcome, outcome }))
      : current.solutions;
    return appendHistory({ ...current, progress: { ...current.progress, [questionId]: nextProgress }, solutions: nextSolutions }, {
      questionId, language, mode, outcome, hintsUsed, viewedSolutionCode, attemptId, attemptHintsUsed, attemptViewedSolutionCode, caseId, durationMs, errorMessage: error, variantId, createdAt: now
    });
  });

  // 统计口径统一：错题 = 派生为 reviewing；待复习 = 派生为 due。
  // 两者都不再和「已完成」混在一起，统计卡和题库筛选用的是同一个派生函数。
  const stats = useMemo(() => {
    const values = hot100.questions.map((q) => derivePracticeStatus(progress[q.id]));
    return {
      total: hot100.questions.length,
      done: values.filter((value) => ["completed", "mastered"].includes(value)).length,
      wrong: values.filter((value) => isMistakeStatus(value)).length,
      mastered: values.filter((value) => value === "mastered").length,
      due: values.filter((value) => value === "due").length
    };
  }, [progress]);

  const filtered = useMemo(() => filterQuestions(hot100.questions, progress, filters), [progress, filters]);
  const studyQuestions = useMemo(() => orderByStudyOrder(hot100.questions), []);
  const dashboardQuestions = useMemo(() => hot100.questions.map((question) => ({ ...question, phase: String(question.phase || "").replace("阶段一", "阶段 1").replace("阶段二", "阶段 2").replace("阶段三", "阶段 3").replace("阶段四", "阶段 4").replace("阶段五", "阶段 5").replace("阶段六", "阶段 6").replace("阶段七", "阶段 7") })), []);
  const studyEntry = useMemo(() => pickStudyQuestion(studyQuestions, progress), [progress, studyQuestions]);
  const nextInOrder = pickNextQuestion(studyQuestions, { currentId: selectedId });
  const previousInOrder = pickPreviousQuestion(studyQuestions, { currentId: selectedId });
  const dueReviews = useMemo(() => studyQuestions.filter(q => isReviewPending(progress[q.id])), [progress, studyQuestions]);
  const selected = hot100.questions.find((question) => question.id === selectedId);

  // 浏览器标签标题跟随当前视图。
  // 作用不只是好看：这个站会被开成很多个标签（每题一个），标题里带上题号
  // 才能在标签栏里区分「我在看哪道题」。index.html 里的静态标题作为首帧兜底。
  useEffect(() => {
    const label = selected ? `#${selected.id} ${selected.title}` : view === "bank" ? "题库" : view === "mistakes" ? "错题复习" : "总览";
    document.title = `${label} · ${BRAND.name}｜${BRAND.owner}`;
  }, [selected, view]);

  useEffect(() => {
    if (!selectedId) return undefined;
    let active = true;
    setSelectedSolution(null);
    const loader = solutionModules[`./data/solutions/${selectedId}.json`];
    if (!loader) { setSelectedSolution({ id: selectedId, loadError: "题面数据暂不可用，可以继续保存草稿，稍后重试。" }); return undefined; }
    loader().then((solution) => { if (active) setSelectedSolution(normalizeStudySolution(solution)); }).catch(() => { if (active) setSelectedSolution({ id: selectedId, loadError: "题面加载失败，可以继续保存草稿，刷新后重试。" }); });
    return () => { active = false; };
  }, [selectedId]);

  const open = (id, options = {}) => {
    if (!id) return;
    // 「另起一种解法」不再粗暴删掉草稿（那是不可逆的）。
    // 现在只是挂一个一次性标记，由 ProblemDetail 挂载时走和「+ 新解法」完全相同的路径：
    // 先把已有代码存档，再开一份干净的模板。旧代码永远留在存档里。
    if (options.freshStart) setFreshStartFor(String(id));
    setSelectedId(String(id));
    if (typeof window !== "undefined") window.history.pushState({}, "", `?question=${encodeURIComponent(String(id))}`);
    setView("detail");
  };
  const nextQuestion = () => {
    const next = nextInOrder;
    if (next) open(next.id);
  };
  // 运行能力探测：只判断"能不能点运行"，不做任何弹窗（用户明确要求不要环境提示）。
  const [runnerAvailable, setRunnerAvailable] = useState(false);
  useEffect(() => {
    let alive = true;
    canRunOnline().then((ok) => { if (alive) setRunnerAvailable(ok); }).catch(() => { if (alive) setRunnerAvailable(false); });
    return () => { alive = false; };
  }, []);

  // 运行入口：本地 dev 走 /__runner（原路），线上走「网页 → Worker → 本机 runner」隧道。
  // 两条通路的判定在 src/online/runner-bridge.js 里，这里只负责转发。
  const onRun = useMemo(() => createOnRun(), []);
  const onPractice = (mode) => {
    const pool = mode === "unfinished"
      ? studyQuestions.filter((q) => !hasCompletedLearning(progress[q.id]))
      : mode === "wrong" ? hot100.questions.filter((q) => isMistakeStatus(derivePracticeStatus(progress[q.id])))
        : mode === "due" ? hot100.questions.filter((q) => isReviewPending(progress[q.id])) : filtered;
    const next = mode === "sequential" || mode === "unfinished" ? pickStudyQuestion(pool, progress) : pickNextQuestion(pool, { mode: mode === "random" ? "random" : "sequential" });
    if (next) open(next.id);
  };

  return <div className="appShell">
    <header className="topbar">
      {/* 品牌块：图标与 public/favicon.svg 同源（BrandIcon 里是同一份路径数据）。
          第二行从「学习工作台」改成子域名，让访客一进来就知道这是 kaii.homes 的子站。 */}
      <button className="brandButton" onClick={() => { window.history.pushState({}, "", window.location.pathname); setSelectedId(null); setView("dashboard"); }} aria-label={`${BRAND.name} ${BRAND.tagline}，回到总览`}><BrandIcon /><span><strong>{BRAND.name}</strong><small>{BRAND.host}</small></span></button>
      <nav aria-label="主导航">{[["dashboard", "总览"], ["bank", "题库"], ["mistakes", "错题复习"]].map(([id, label]) => <button className={view === id ? "active" : ""} key={id} onClick={() => { window.history.pushState({}, "", window.location.pathname); setSelectedId(null); if (id === "bank") setFilters(current => ({ ...current, phase: undefined })); setView(id); }}>{label}</button>)}</nav>
      <div className="topbarRight">
        <span className="topProgress">{stats.done}/{stats.total} 已完成</span>
        {/* 回主站。rel="noreferrer" 是因为这是跨站跳转，且本站不需要知道来源。
            落点是博客的「学习路线」页而不是首页 —— 读者是从那条路线过来的。 */}
        <a className="topBackLink" href={BLOG.pathUrl} target="_blank" rel="noopener noreferrer">
          <span aria-hidden="true">←</span> 回 {BLOG.name}
        </a>
      </div>
    </header>
    <main>
      {view === "dashboard" && <Dashboard stats={stats} studyEntry={studyEntry} dueReviews={dueReviews} questions={dashboardQuestions} state={state} onOpen={open} onOpenStage={(phase) => { setFilters({ query: "", category: "全部", difficulty: "全部", status: "全部", phase }); setView("bank"); }} />}
      {view === "bank" && <ProblemBank questions={filtered} allQuestions={studyQuestions} progress={displayProgress} dailyNewLimit={state.profile?.dailyNewLimit} onDailyNewLimitChange={(value) => updateState((current) => ({ profile: { ...current.profile, dailyNewLimit: value } }))} filters={filters} onFiltersChange={(patch) => setFilters((current) => ({ ...current, ...patch }))} onOpenQuestion={open} onStatusChange={setStatus} onPractice={onPractice} categories={["全部", ...hot100.groups.map((group) => group.name)]} />}
      {view === "mistakes" && <Mistakes questions={hot100.questions} rawProgress={progress} dailyNewLimit={state.profile?.dailyNewLimit} onOpen={open} />}
      {view === "detail" && selected && (selectedSolution?.id === selectedId ? <ProblemDetail
        question={selected}
        solution={selectedSolution}
        practiceHistory={getEffectivePracticeEvents(state, selected.id)}
        progressItem={progress[selected.id]}
        drafts={state.drafts}
        solutions={state.solutions}
        note={state.notes[selected.id]}
        defaultLanguage={state.profile?.defaultLanguage || "java"}
        runnerAvailable={Boolean(runnerAvailable && selectedSolution?.func)}
        maxVariants={MAX_SOLUTIONS_PER_SCOPE}
        freshStart={freshStartFor === selectedId}
        onFreshStartConsumed={() => setFreshStartFor(null)}
        onProgressChange={setStatus}
        onHint={recordHintUsage}
        onSolutionView={recordSolutionCodeView}
        onDraftChange={setDraft}
        onNoteChange={setNote}
        onAddVariant={addSolutionVariant}
        onSaveVariant={saveSolutionVariant}
        onRenameVariant={renameSolutionVariant}
        onRemoveVariant={removeSolutionVariant}
        onRun={onRun}
        onPracticeOutcome={recordPracticeOutcome}
        onRecordHistory={recordHistory}
        onBack={() => { window.history.pushState({}, "", window.location.pathname); setSelectedId(null); setView("bank"); }}
        onPrevious={previousInOrder ? () => open(previousInOrder.id) : undefined}
        previousQuestion={previousInOrder}
        onNext={nextInOrder ? nextQuestion : undefined}
        nextQuestion={nextInOrder}
      /> : <div className="contentCard loadingCard">正在加载这道题的题面和题解…</div>)}
      {view === "detail" && !selected && <div className="contentCard emptyState">未找到这道题，请从上方题库重新选择。</div>}
    </main>
    <SiteFooter />
    <BackupPanel state={state} lastBackupAt={lastBackupAt} backupAvailable={backupAvailable} deviceBackupName={deviceBackupName} onConfigured={() => setBackupAvailable(true)} onImport={(incoming) => setState(parseState(incoming))} />
  </div>;
}

createRoot(document.getElementById("root")).render(<App />);
