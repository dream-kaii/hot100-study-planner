import { parseState } from "./storage.js";

const MAX_EVENTS_PER_QUESTION = 20;

function historyScope(event) {
  return `${event.questionId}\u0000${event.language}\u0000${event.mode}`;
}

function isValidDate(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function shortErrorMessage(value) {
  if (value === undefined || value === null) return undefined;
  const text = String(value).replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 160) : undefined;
}

function normalizeEvent(event, fallbackId) {
  const source = event && typeof event === "object" ? event : {};
  const normalized = {
    id: source.id || fallbackId,
    questionId: String(source.questionId ?? ""),
    language: source.language || "java",
    mode: source.mode || "function",
    outcome: source.outcome || "unknown",
    hintsUsed: Number.isFinite(source.hintsUsed) ? source.hintsUsed : 0,
    viewedSolutionCode: Boolean(source.viewedSolutionCode),
    caseId: source.caseId ?? null,
    durationMs: Number.isFinite(source.durationMs) ? source.durationMs : 0,
    createdAt: isValidDate(source.createdAt) ? source.createdAt : new Date().toISOString()
  };
  if (source.attemptId) normalized.attemptId = String(source.attemptId);
  if (Object.hasOwn(source, "attemptHintsUsed")) normalized.attemptHintsUsed = Number.isFinite(source.attemptHintsUsed) ? source.attemptHintsUsed : 0;
  if (Object.hasOwn(source, "attemptViewedSolutionCode")) normalized.attemptViewedSolutionCode = Boolean(source.attemptViewedSolutionCode);
  if (Number.isFinite(source.reviewIntervalDays)) normalized.reviewIntervalDays = source.reviewIntervalDays;
  if (source.errorCode) normalized.errorCode = String(source.errorCode).slice(0, 64);
  const errorMessage = shortErrorMessage(source.errorMessage ?? source.error?.message ?? source.error);
  if (errorMessage) normalized.errorMessage = errorMessage;
  return normalized;
}

export function appendHistory(state, event) {
  const base = parseState(state);
  const fallbackId = `history-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const nextEvent = normalizeEvent(event, fallbackId);
  const history = [...base.history, nextEvent];
  const scope = historyScope(nextEvent);
  let count = history.filter((item) => historyScope(item) === scope).length;
  while (count > MAX_EVENTS_PER_QUESTION) {
    const oldestIndex = history.findIndex((item) => historyScope(item) === scope);
    if (oldestIndex < 0) break;
    history.splice(oldestIndex, 1);
    count -= 1;
  }
  return { ...base, history, updatedAt: nextEvent.createdAt || base.updatedAt };
}

export function getQuestionHistory(state, questionId, language, mode) {
  return (state?.history || []).filter((event) => String(event.questionId) === String(questionId)
    && (language === undefined || event.language === language)
    && (mode === undefined || event.mode === mode));
}

export function summarizeQuestionHistory(events = []) {
  const summary = {
    total: events.length,
    independent: 0,
    neededHint: 0,
    neededSolution: 0,
    failed: 0,
    hintsUsed: 0,
    viewedSolutionCode: 0,
    lastOutcome: events.at(-1)?.outcome || null,
    lastCreatedAt: events.at(-1)?.createdAt || null
  };
  for (const event of events) {
    if (event.outcome === "independent") summary.independent += 1;
    if (event.outcome === "needed-hint") summary.neededHint += 1;
    if (event.outcome === "needed-solution") summary.neededSolution += 1;
    if (event.outcome === "failed") summary.failed += 1;
    summary.hintsUsed += Number(event.hintsUsed || 0);
    if (event.viewedSolutionCode) summary.viewedSolutionCode += 1;
  }
  return summary;
}

export function findRepeatedFailure(events = [], caseId) {
  return [...events].reverse().find((event) => event.outcome === "failed" && event.caseId === caseId) || null;
}

export { MAX_EVENTS_PER_QUESTION };
