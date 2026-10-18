import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import hot100 from "./data/hot100.json";
import { createDefaultState, parseState } from "./services/storage.js";
import { hasBackupDirectory, writeBackup } from "./services/backup.js";
import { appendHistory } from "./services/history.js";
import { getEffectivePracticeEvents } from "./services/history.js";
import { filterQuestions, hasCompletedLearning, orderByStudyOrder, pickNextQuestion, pickPreviousQuestion, pickStudyQuestion } from "./services/practice.js";
import { normalizeStudySolution } from "./services/study-text.js";
import { isReviewDue } from "./services/review.js";
import { recordHint, recordReviewOutcome, recordSolutionView, derivePracticeStatus } from "./services/status.js";
import BackupPanel from "./components/BackupPanel.jsx";
import ProblemDetail from "./components/ProblemDetail.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import ProblemBank from "./pages/ProblemBank.jsx";
import Mistakes from "./pages/Mistakes.jsx";
import "./styles.css";
import { createOnRun, canRunOnline } from "./online/runner-bridge.js";

const solutionModules = import.meta.glob("./data/solutions/*.json", { eager: false, import: "default" });
const STORAGE_KEYS = ["hot100-study-planner-v3", "hot100-study-planner-v1"];
const STATUS_TO_CANONICAL = {
  "未开始": "new", "思考中": "in-progress", "已完成": "completed", "错题": "reviewing", "待复习": "reviewing", "已掌握": "mastered",
  new: "new", "in-progress": "in-progress", completed: "completed", reviewing: "reviewing", mastered: "mastered"
};
const STATUS_TO_LABEL = { new: "未开始", "in-progress": "思考中", completed: "已完成", reviewing: "待复习", mastered: "已掌握" };

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

function canonicalStatus(status) {
  return STATUS_TO_CANONICAL[status] || status;
}

function uiProgress(progress = {}) {
  return Object.fromEntries(Object.entries(progress).map(([id, item]) => [id, { ...item, status: STATUS_TO_LABEL[canonicalStatus(item?.status)] || item?.status || "未开始" }]));
}

function App() {
  const [state, setState] = useState(loadState);
  const [backupAvailable, setBackupAvailable] = useState(false);
  const [selectedId, setSelectedId] = useState(() => typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("question"));
  const [view, setView] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("question") ? "detail" : "dashboard");
  const [filters, setFilters] = useState({ query: "", category: "全部", difficulty: "全部", status: "全部" });
  const [lastBackupAt, setLastBackupAt] = useState("");
  const [selectedSolution, setSelectedSolution] = useState(null);

  useEffect(() => {
    hasBackupDirectory().then(setBackupAvailable).catch(() => setBackupAvailable(false));
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
  const displayProgress = useMemo(() => uiProgress(progress), [progress]);
  const updateState = (updater) => setState((current) => ({ ...current, ...(typeof updater === "function" ? updater(current) : updater), updatedAt: new Date().toISOString() }));

  const setStatus = (questionId, status, timer) => updateState((current) => {
    const previous = current.progress?.[questionId] || {};
    const now = new Date().toISOString();
    const requested = canonicalStatus(status);
    if (requested === "reviewing" && previous.status === "completed" && previous.reviewAt && Date.parse(previous.reviewAt) > Date.parse(now)) return {};
    return { progress: { ...current.progress, [questionId]: { ...previous, status: requested, ...(["completed", "mastered"].includes(requested) ? { completedAt: previous.completedAt || now } : {}), ...(timer ? { timer } : {}), updatedAt: now } } };
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

  const recordHintUsage = (questionId, level, language, mode) => updateState((current) => ({
    progress: { ...current.progress, [questionId]: recordHint(current.progress?.[questionId] || {}, level, new Date(), language, mode) }
  }));

  const recordSolutionCodeView = (questionId, language, mode) => updateState((current) => ({
    progress: { ...current.progress, [questionId]: recordSolutionView(current.progress?.[questionId] || {}, language, new Date(), mode) }
  }));

  const recordHistory = (event) => updateState((current) => appendHistory(current, event));

  const recordPracticeOutcome = ({ questionId, language, mode, outcome, hintsUsed, viewedSolutionCode, attemptId, attemptHintsUsed, attemptViewedSolutionCode, caseId, durationMs, error }) => updateState((current) => {
    const now = new Date().toISOString();
    const nextProgress = outcome === "completed"
      ? current.progress?.[questionId] || {}
      : recordReviewOutcome(current.progress?.[questionId] || {}, outcome, now);
    return appendHistory({ ...current, progress: { ...current.progress, [questionId]: nextProgress } }, {
      questionId, language, mode, outcome, hintsUsed, viewedSolutionCode, attemptId, attemptHintsUsed, attemptViewedSolutionCode, caseId, durationMs, errorMessage: error, createdAt: now
    });
  });

  const stats = useMemo(() => {
    const values = hot100.questions.map((q) => derivePracticeStatus(progress[q.id]));
    return {
      total: hot100.questions.length,
      done: values.filter((value) => ["completed", "mastered"].includes(value)).length,
      wrong: values.filter((value) => value === "reviewing").length,
      mastered: values.filter((value) => value === "mastered").length,
      due: hot100.questions.filter((q) => isReviewDue(progress[q.id])).length
    };
  }, [progress]);

  const filtered = useMemo(() => filterQuestions(hot100.questions, progress, { ...filters, status: filters.status === "全部" ? "全部" : canonicalStatus(filters.status) }), [progress, filters]);
  const studyQuestions = useMemo(() => orderByStudyOrder(hot100.questions), []);
  const dashboardQuestions = useMemo(() => hot100.questions.map((question) => ({ ...question, phase: String(question.phase || "").replace("阶段一", "阶段 1").replace("阶段二", "阶段 2").replace("阶段三", "阶段 3").replace("阶段四", "阶段 4").replace("阶段五", "阶段 5").replace("阶段六", "阶段 6").replace("阶段七", "阶段 7") })), []);
  const studyEntry = useMemo(() => pickStudyQuestion(studyQuestions, progress), [progress, studyQuestions]);
  const nextInOrder = pickNextQuestion(studyQuestions, { currentId: selectedId });
  const previousInOrder = pickPreviousQuestion(studyQuestions, { currentId: selectedId });
  const dueReviews = useMemo(() => studyQuestions.filter(q => isReviewDue(progress[q.id])), [progress, studyQuestions]);
  const selected = hot100.questions.find((question) => question.id === selectedId);

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
    if (options.resetDraft) updateState((current) => {
      const drafts = { ...current.drafts };
      delete drafts[String(id)];
      return { drafts };
    });
    const nextId = String(id);
    setSelectedId(nextId);
    if (typeof window !== "undefined") window.history.pushState({}, "", `?question=${encodeURIComponent(nextId)}`);
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
      : mode === "wrong" ? hot100.questions.filter((q) => derivePracticeStatus(progress[q.id]) === "reviewing")
        : mode === "due" ? hot100.questions.filter((q) => isReviewDue(progress[q.id])) : filtered;
    const next = mode === "sequential" || mode === "unfinished" ? pickStudyQuestion(pool, progress) : pickNextQuestion(pool, { mode: mode === "random" ? "random" : "sequential" });
    if (next) open(next.id);
  };

  return <div className="appShell">
    <header className="topbar">
      <button className="brandButton" onClick={() => { window.history.pushState({}, "", window.location.pathname); setSelectedId(null); setView("dashboard"); }}><span className="brandMark">H</span><span><strong>Hot 100</strong><small>学习工作台</small></span></button>
      <nav aria-label="主导航">{[["dashboard", "总览"], ["bank", "题库"], ["mistakes", "错题复习"]].map(([id, label]) => <button className={view === id ? "active" : ""} key={id} onClick={() => { window.history.pushState({}, "", window.location.pathname); setSelectedId(null); if (id === "bank") setFilters(current => ({ ...current, phase: undefined })); setView(id); }}>{label}</button>)}</nav>
      <span className="topProgress">{stats.done}/{stats.total} 已完成</span>
    </header>
    <main>
      {view === "dashboard" && <Dashboard stats={stats} studyEntry={studyEntry} dueReviews={dueReviews} questions={dashboardQuestions} state={state} onOpen={open} onOpenStage={(phase) => { setFilters({ query: "", category: "全部", difficulty: "全部", status: "全部", phase }); setView("bank"); }} />}
      {view === "bank" && <ProblemBank questions={filtered} allQuestions={studyQuestions} progress={displayProgress} dailyNewLimit={state.profile?.dailyNewLimit} onDailyNewLimitChange={(value) => updateState((current) => ({ profile: { ...current.profile, dailyNewLimit: value } }))} filters={filters} onFiltersChange={(patch) => setFilters((current) => ({ ...current, ...patch }))} onOpenQuestion={open} onStatusChange={setStatus} onPractice={onPractice} categories={["全部", ...hot100.groups.map((group) => group.name)]} />}
      {view === "mistakes" && <Mistakes questions={hot100.questions} progress={displayProgress} rawProgress={progress} dailyNewLimit={state.profile?.dailyNewLimit} onOpen={open} />}
      {view === "detail" && selected && (selectedSolution?.id === selectedId ? <ProblemDetail question={selected} solution={selectedSolution} practiceHistory={getEffectivePracticeEvents(state, selected.id)} progressItem={progress[selected.id]} drafts={state.drafts} note={state.notes[selected.id]} defaultLanguage={state.profile?.defaultLanguage || "java"} runnerAvailable={Boolean(runnerAvailable && selectedSolution?.func)} onProgressChange={setStatus} onHint={recordHintUsage} onSolutionView={recordSolutionCodeView} onDraftChange={setDraft} onNoteChange={setNote} onRun={onRun} onPracticeOutcome={recordPracticeOutcome} onRecordHistory={recordHistory} onBack={() => { window.history.pushState({}, "", window.location.pathname); setSelectedId(null); setView("bank"); }} onPrevious={previousInOrder ? () => open(previousInOrder.id) : undefined} previousQuestion={previousInOrder} onNext={nextInOrder ? nextQuestion : undefined} nextQuestion={nextInOrder} /> : <div className="contentCard loadingCard">正在加载这道题的题面和题解…</div>)}
      {view === "detail" && !selected && <div className="contentCard emptyState">未找到这道题，请从上方题库重新选择。</div>}
    </main>
    <BackupPanel state={state} lastBackupAt={lastBackupAt} backupAvailable={backupAvailable} onConfigured={() => setBackupAvailable(true)} onImport={(incoming) => setState(parseState(incoming))} />
  </div>;
}

createRoot(document.getElementById("root")).render(<App />);
