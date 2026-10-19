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
