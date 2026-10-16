import { summarizeQuestionHistory } from "./history.js";
import { derivePracticeStatus } from "./status.js";

export const LEARNING_STAGES = [
  { phase: 1, name: "数组、哈希和基础技巧" },
  { phase: 2, name: "双指针、滑动窗口和二分" },
  { phase: 3, name: "链表、栈和队列" },
  { phase: 4, name: "树和堆" },
  { phase: 5, name: "回溯、图和贪心" },
  { phase: 6, name: "动态规划" },
  { phase: 7, name: "综合与挑战" }
];

function phaseOf(question) {
  const value = question?.phase ?? question?.stage ?? question?.studyPhase;
  const match = String(value ?? "").match(/[1-7]/);
  const phase = Number.parseInt(match?.[0] || "", 10);
  return Number.isInteger(phase) && phase >= 1 && phase <= LEARNING_STAGES.length ? phase : null;
}

function questionIdOf(question) {
  return String(question?.id ?? "");
}

function eventsForQuestion(state, questionId) {
  return (Array.isArray(state?.history) ? state.history : [])
    .filter((event) => String(event.questionId) === String(questionId))
    .map((event, index) => ({ event, index }))
    .sort((a, b) => {
      const aTime = Date.parse(a.event.createdAt || "");
      const bTime = Date.parse(b.event.createdAt || "");
      const safeA = Number.isNaN(aTime) ? 0 : aTime;
      const safeB = Number.isNaN(bTime) ? 0 : bTime;
      return safeA - safeB || a.index - b.index;
    })
    .map(({ event }) => event);
}

function hasIndependentPass(events, progressItem) {
  return events.some((event) => event.outcome === "independent") || Boolean(progressItem?.independentPassAt);
}

function hasHintCompletion(summary) {
  return summary.neededHint > 0;
}

function hasSolutionCompletion(summary) {
  return summary.neededSolution > 0;
}

function stageSummary(stage, questions, state, now) {
  const progress = state?.progress || {};
  const questionIds = questions.map(questionIdOf);
  let independentCompleted = 0;
  let neededHint = 0;
  let neededSolution = 0;
  let mastered = 0;
  for (const question of questions) {
    const id = questionIdOf(question);
    const item = progress[id] || {};
    const events = eventsForQuestion(state, id);
    const summary = summarizeQuestionHistory(events);
    if (hasIndependentPass(events, item)) independentCompleted += 1;
    if (hasHintCompletion(summary)) neededHint += 1;
    if (hasSolutionCompletion(summary)) neededSolution += 1;
    if (derivePracticeStatus(item, now) === "mastered") mastered += 1;
  }
  return {
    phase: stage.phase,
    name: stage.name,
    total: questions.length,
    independentCompleted,
    neededHint,
    neededSolution,
    mastered,
    questions: questionIds
  };
}

export function buildStageProgress(questions = [], state = {}, now = new Date()) {
  const byPhase = new Map(LEARNING_STAGES.map((stage) => [stage.phase, []]));
  for (const question of questions) {
    const phase = phaseOf(question);
    if (phase) byPhase.get(phase).push(question);
  }
  return LEARNING_STAGES.map((stage) => stageSummary(stage, byPhase.get(stage.phase), state, now));
}

function dateValue(value) {
  const time = Date.parse(value || "");
  return Number.isNaN(time) ? null : time;
}

function weakPointFor(question, state, now) {
  const id = questionIdOf(question);
  const progressItem = state?.progress?.[id] || {};
  const events = eventsForQuestion(state, id);
  const summary = summarizeQuestionHistory(events);
  const reasons = [];

  const failuresByCase = new Map();
  for (const event of events) {
    if (event.outcome !== "failed" || event.caseId == null) continue;
    const list = failuresByCase.get(String(event.caseId)) || [];
    list.push(event);
    failuresByCase.set(String(event.caseId), list);
  }
  const latestEvent = events.at(-1);
  const repeatedFailure = [...failuresByCase.entries()]
    .filter(([, failureEvents]) => failureEvents.length >= 2)
    .filter(([caseId]) => latestEvent?.outcome === "failed" && String(latestEvent.caseId) === caseId)
    .map(([, failureEvents]) => failureEvents.at(-1))[0];
  if (repeatedFailure) reasons.push("重复失败同一用例");

  const maxHints = Math.max(Number(progressItem.hintsUsed || 0), ...events.map((event) => Number(event.hintsUsed || 0)), 0);
  const maxHintLevel = Math.max(...events.map((event) => Number(event.hintLevel ?? event.maxHintLevel ?? 0)), 0);
  if (maxHintLevel >= 2) reasons.push("多次使用高级提示");

  const viewedAt = events.reduce((latest, event) => (event.viewedSolutionCode ? event : latest), null);
  if (viewedAt) {
    const viewedIndex = events.indexOf(viewedAt);
    const independentlyRedone = events.slice(viewedIndex + 1).some((event) => event.outcome === "independent");
    if (!independentlyRedone) reasons.push("看过答案后尚未独立重做");
  } else if (progressItem.viewedSolutionCode && !progressItem.independentPassAt) {
    reasons.push("看过答案后尚未独立重做");
  }

  const status = derivePracticeStatus(progressItem, now);
  const dueAt = progressItem.reviewAt;
  if (status !== "mastered" && dueAt && (dateValue(dueAt) ?? Number.POSITIVE_INFINITY) <= (dateValue(now.toISOString?.() || now) ?? Date.now())) reasons.push("复习已到期");

  if (!reasons.length) return null;
  return {
    questionId: id,
    title: question.title || id,
    status,
    reasons,
    reason: reasons.join("；"),
    dueAt: dueAt || null,
    hintsUsed: maxHints,
    maxHintLevel,
    latestFailureAt: repeatedFailure?.createdAt || [...events].reverse().find((event) => event.outcome === "failed")?.createdAt || null
  };
}

export function findWeakPoints(questions = [], state = {}, now = new Date()) {
  const points = questions.map((question) => weakPointFor(question, state, now)).filter(Boolean);
  return points.sort((a, b) => {
    const aDue = dateValue(a.dueAt);
    const bDue = dateValue(b.dueAt);
    if (aDue !== null || bDue !== null) {
      if (aDue === null) return 1;
      if (bDue === null) return -1;
      if (aDue !== bDue) return aDue - bDue;
    }
    if (a.hintsUsed !== b.hintsUsed) return b.hintsUsed - a.hintsUsed;
    return (dateValue(b.latestFailureAt) || 0) - (dateValue(a.latestFailureAt) || 0);
  });
}

export function buildQuestionTimeline(state = {}, questionId) {
  return eventsForQuestion(state, questionId).map((event) => ({ ...event }));
}
