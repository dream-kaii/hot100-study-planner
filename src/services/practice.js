import { canonicalStatus } from "./status-labels.js";
import { derivePracticeStatus } from "./status.js";

export { derivePracticeStatus } from "./status.js";
export { isMistakeStatus, isReviewPending } from "./status.js";

export function orderByStudyOrder(questions) {
  return [...questions].sort((a, b) => (a.studyOrder ?? Infinity) - (b.studyOrder ?? Infinity));
}

export function hasCompletedLearning(item) {
  return Boolean(item && (item.masteredAt || item.independentPassAt || item.completedAt ||
    ["completed", "mastered", "已完成", "已掌握"].includes(item.status) ||
    ["independent", "needed-hint", "needed-solution"].includes(item.lastReviewOutcome)));
}

export function pickStudyQuestion(questions, progress = {}) {
  return orderByStudyOrder(questions).find(question => !hasCompletedLearning(progress[question.id])) || null;
}

// 筛选必须走派生状态，而不是 progress[id].status 原始值。
// 原始值里 completed + 复习到期 的题，派生出来是 due，
// 用原始值筛「错题」会把它漏掉（这就是之前统计卡和题库对不上的原因）。
export function filterQuestions(questions, progress, filters = {}, now = new Date()) {
  const query = (filters.query || "").trim().toLowerCase();
  const wanted = filters.status && filters.status !== "全部" ? canonicalStatus(filters.status) : null;
  return orderByStudyOrder(questions).filter((question) => {
    const textMatch = !query || [question.id, question.title, question.englishTitle].filter(Boolean).some((value) => value.toLowerCase().includes(query));
    if (!textMatch) return false;
    if (filters.phase && !String(question.phase).startsWith(`阶段${["", "一", "二", "三", "四", "五", "六", "七"][filters.phase]}`)) return false;
    if (filters.category && filters.category !== "全部" && question.category !== filters.category) return false;
    if (filters.difficulty && filters.difficulty !== "全部" && question.difficulty !== filters.difficulty) return false;
    if (!wanted) return true;
    return derivePracticeStatus(progress[question.id], now) === wanted;
  });
}

export function pickNextQuestion(questions, { mode = "sequential", currentId, random = Math.random } = {}) {
  if (!questions.length) return null;
  if (mode === "random") return questions[Math.min(questions.length - 1, Math.floor(random() * questions.length))];
  const ordered = orderByStudyOrder(questions);
  const index = ordered.findIndex((question) => String(question.id) === String(currentId));
  return ordered[index + 1] || null;
}

export function pickPreviousQuestion(questions, { currentId } = {}) {
  const ordered = orderByStudyOrder(questions);
  const index = ordered.findIndex((question) => String(question.id) === String(currentId));
  return index > 0 ? ordered[index - 1] : null;
}

export function timerReducer(state, action) {
  if (action.type === "set-duration") return { remaining: Math.max(0, action.duration), running: false };
  if (action.type === "start") return { ...state, running: true };
  if (action.type === "pause") return { ...state, running: false };
  if (action.type === "tick") return { ...state, remaining: Math.max(0, state.remaining - action.seconds), running: state.remaining - action.seconds > 0 && state.running };
  if (action.type === "reset") return { remaining: Math.max(0, action.duration), running: false };
  return state;
}

// ── 计时器里三处「不写出来就一定会写错」的判定 ───────────────────────────
// 它们原来是散在 Timer.jsx 的 effect 里的，任何一处写错都不会报错、
// 也不会有测试拦住 —— 事实上「时间到」的提示就这样从未生效过一整版。
// 抽成纯函数之后每条都能被单测直接钉住。

/** 计时器上报节流：运行中不必逐秒写盘。 */
export const TIMER_REPORT_EVERY_SECONDS = 5;

/**
 * 这一拍要不要把计时器写进存储？
 * - 运行中：攒够 TIMER_REPORT_EVERY_SECONDS 秒才写（25 分钟 1500 次 → 300 次）
 * - 停下 / 归零 / 首次：立即写，否则刷新会退回几秒前
 */
export function shouldReportTimer({ timer, lastSnapshot = "", lastReportedAt = 0 }) {
  if (JSON.stringify(timer) === lastSnapshot) return false;
  if (lastSnapshot === "") return true;
  if (!timer.running || timer.remaining === 0) return true;
  return Math.abs(lastReportedAt - timer.remaining) >= TIMER_REPORT_EVERY_SECONDS;
}

/**
 * 是不是「刚刚倒数到 0」。
 * reducer 在减到 0 的同一拍就把 running 置回 false，所以
 * `remaining === 0 && running` 永远不成立 —— 这就是提示从不触发的原因。
 * 只能用前后两拍比较：上一拍还有时间、这一拍没了。
 */
export function justReachedZero(previousRemaining, remaining) {
  return Number(previousRemaining) > 0 && Number(remaining) === 0;
}

/**
 * 存下来的计时器可能是坏的（旧备份、手改的 localStorage、跨设备合并）。
 * 让它在界面上显示 NaN:NaN 是最糟的处理：用户只会以为计时器坏了，无从自救。
 * 坏值一律退回本次时长。
 */
export function normalizeStoredTimer(timer, durationSeconds) {
  const remaining = Number(timer?.remaining);
  return {
    remaining: Number.isFinite(remaining) && remaining >= 0 ? Math.floor(remaining) : Math.max(0, durationSeconds),
    running: Boolean(timer?.running)
  };
}

/** 计时的可选时长（分钟）。下拉与 minutesFromTimer 共用同一份。 */
export const TIMER_MINUTE_OPTIONS = [15, 25, 45];

/** 存了 45 分钟就把下拉设成 45，别固定 25 然后悄悄少掉 20 分钟。 */
export function minutesFromTimer(timer, options = TIMER_MINUTE_OPTIONS, fallback = 25) {
  const stored = Number(timer?.remaining);
  return options.includes(stored / 60) ? stored / 60 : fallback;
}

