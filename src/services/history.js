import { parseState } from "./storage.js";

const MAX_EVENTS_PER_QUESTION = 20;
const EFFECTIVE_OUTCOMES = new Set(["failed", "independent", "needed-hint", "needed-solution", "completed"]);

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
  return { ...base, history: pruneHistory([...base.history, nextEvent]), updatedAt: nextEvent.createdAt || base.updatedAt };
}

function eventTime(event) { return Date.parse(event?.createdAt || "") || 0; }

export function isEffectivePracticeEvent(event) {
  return EFFECTIVE_OUTCOMES.has(event?.outcome);
}

export function pruneHistory(events = []) {
  const byScope = new Map();
  for (const event of events) {
    const scope = historyScope(event);
    const list = byScope.get(scope) || [];
    list.push(event);
    byScope.set(scope, list);
  }
  const retained = [];
  for (const list of byScope.values()) {
    const sorted = [...list].sort((a, b) => eventTime(a) - eventTime(b));
    const effective = sorted.filter(isEffectivePracticeEvent).slice(-MAX_EVENTS_PER_QUESTION);
    const started = sorted.filter((event) => event.outcome === "started").slice(-1);
    retained.push(...effective, ...started);
  }
  return retained.sort((a, b) => eventTime(a) - eventTime(b));
}

export function getQuestionHistory(state, questionId, language, mode) {
  return (state?.history || []).filter((event) => String(event.questionId) === String(questionId)
    && (language === undefined || event.language === language)
    && (mode === undefined || event.mode === mode));
}

export function getEffectivePracticeEvents(state, questionId, language, mode) {
  return getQuestionHistory(state, questionId, language, mode).filter(isEffectivePracticeEvent)
    .sort((a, b) => eventTime(a) - eventTime(b));
}

export function getRecentHistory(state, { limit = 8, outcomes } = {}) {
  const allowed = outcomes ? new Set(outcomes) : EFFECTIVE_OUTCOMES;
  return (state?.history || []).filter((event) => allowed.has(event.outcome))
    .sort((a, b) => eventTime(b) - eventTime(a)).slice(0, Math.max(0, limit));
}

export function getQuestionHistorySummary(state, questionId) {
  const events = getEffectivePracticeEvents(state, questionId);
  const passes = events.filter((event) => ["independent", "needed-hint", "needed-solution", "completed"].includes(event.outcome));
  return {
    attempts: events.length,
    failures: events.filter((event) => event.outcome === "failed").length,
    passes: passes.length,
    independent: events.filter((event) => event.outcome === "independent").length,
    lastOutcome: events.at(-1)?.outcome || null,
    lastCreatedAt: events.at(-1)?.createdAt || null
  };
}

export function getHistorySummary(state) {
  const events = getRecentHistory(state, { limit: Number.POSITIVE_INFINITY });
  const passes = events.filter((event) => ["independent", "needed-hint", "needed-solution", "completed"].includes(event.outcome));
  return {
    attempts: events.length,
    failures: events.filter((event) => event.outcome === "failed").length,
    independent: events.filter((event) => event.outcome === "independent").length,
    lastCreatedAt: events[0]?.createdAt || null,
    lastOutcome: events[0]?.outcome || null
  };
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
