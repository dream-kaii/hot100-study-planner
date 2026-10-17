import test from "node:test";
import assert from "node:assert/strict";
import { appendHistory, findRepeatedFailure, getEffectivePracticeEvents, getQuestionHistory, getQuestionHistorySummary, getRecentHistory, summarizeQuestionHistory } from "../src/services/history.js";
import { createDefaultState, mergeState } from "../src/services/storage.js";

function event(id, questionId = "1", index = 0, extra = {}) {
  return {
    id,
    questionId,
    language: "java",
    mode: "function",
    outcome: "failed",
    hintsUsed: 0,
    viewedSolutionCode: false,
    caseId: "case-1",
    durationMs: 100,
    createdAt: `2026-10-14T00:00:${String(index).padStart(2, "0")}.000Z`,
    ...extra
  };
}

test("appends history in order and caps each question at 20 events", () => {
  let state = createDefaultState();
  state = appendHistory(state, event("other", "2", 0));
  for (let index = 0; index < 21; index += 1) state = appendHistory(state, event(`e${index}`, "1", index + 1));
  const history = getQuestionHistory(state, "1");
  assert.equal(history.length, 20);
  assert.equal(history[0].id, "e1");
  assert.equal(history.at(-1).id, "e20");
  assert.equal(getQuestionHistory(state, "2")[0].id, "other");
});

test("history stores summaries instead of complete failed output", () => {
  const state = appendHistory(createDefaultState(), event("e1", "1", 1, {
    output: "a very large compiler output that must not be persisted",
    errorCode: "COMPILE_ERROR",
    errorMessage: "  missing symbol  "
  }));
  assert.deepEqual(state.history[0], {
    id: "e1",
    questionId: "1",
    language: "java",
    mode: "function",
    outcome: "failed",
    hintsUsed: 0,
    viewedSolutionCode: false,
    caseId: "case-1",
    durationMs: 100,
    createdAt: "2026-10-14T00:00:01.000Z",
    errorCode: "COMPILE_ERROR",
    errorMessage: "missing symbol"
  });
});

test("summarizes outcomes and finds the latest repeated failure by stable caseId", () => {
  const events = [
    event("e1", "1", 1, { outcome: "independent", hintsUsed: 1 }),
    event("e2", "1", 2, { outcome: "failed", caseId: "case-2", viewedSolutionCode: true }),
    event("e3", "1", 3, { outcome: "failed", caseId: "case-2" })
  ];
  const summary = summarizeQuestionHistory(events);
  assert.equal(summary.total, 3);
  assert.equal(summary.independent, 1);
  assert.equal(summary.failed, 2);
  assert.equal(summary.hintsUsed, 1);
  assert.equal(summary.viewedSolutionCode, 1);
  assert.equal(findRepeatedFailure(events, "case-2").id, "e3");
  assert.equal(findRepeatedFailure(events, "missing"), null);
});

test("generated history ids remain unique after the per-question cap is reached", () => {
  let state = createDefaultState();
  for (let index = 0; index < 24; index += 1) state = appendHistory(state, event(undefined, "1", index));
  const ids = state.history.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("merging history keeps the newer duplicate and caps each question", () => {
  const current = { ...createDefaultState(), history: [event("same", "1", 1, { outcome: "failed" })] };
  const incoming = {
    ...createDefaultState(),
    history: [
      event("same", "1", 30, { outcome: "independent" }),
      ...Array.from({ length: 20 }, (_, index) => event(`incoming-${index}`, "1", index + 3))
    ]
  };
  const merged = mergeState(current, incoming);
  assert.equal(merged.history.filter((item) => item.questionId === "1").length, 20);
  assert.equal(merged.history.find((item) => item.id === "same").outcome, "independent");
});

test("history caps and queries each language and mode scope independently", () => {
  let state = createDefaultState();
  for (let index = 0; index < 21; index += 1) {
    state = appendHistory(state, event(`java-${index}`, "1", index, { language: "java", mode: "function" }));
    state = appendHistory(state, event(`python-${index}`, "1", index, { language: "python", mode: "function" }));
  }
  assert.equal(getQuestionHistory(state, "1", "java", "function").length, 20);
  assert.equal(getQuestionHistory(state, "1", "python", "function").length, 20);
  assert.equal(getQuestionHistory(state, "1", "java", "acm").length, 0);
});

test("preserves attempt metadata on both failed and independent events", () => {
  let state = createDefaultState();
  state = appendHistory(state, { questionId: "283", language: "java", mode: "function", outcome: "failed", attemptId: "a1", attemptHintsUsed: 0, attemptViewedSolutionCode: false, createdAt: "2026-10-15T00:00:00.000Z" });
  state = appendHistory(state, { questionId: "283", language: "java", mode: "function", outcome: "independent", attemptId: "a2", attemptHintsUsed: 0, attemptViewedSolutionCode: false, createdAt: "2026-10-16T00:00:00.000Z" });
  assert.deepEqual(state.history.map(event => [event.outcome, event.attemptId, event.attemptHintsUsed, event.attemptViewedSolutionCode]), [
    ["failed", "a1", 0, false],
    ["independent", "a2", 0, false]
  ]);
});

test("recent history excludes started events, sorts newest first, and limits the dashboard list", () => {
  let state = createDefaultState();
  for (let index = 0; index < 100; index += 1) {
    state = appendHistory(state, { questionId: String(index + 1), outcome: "started", createdAt: `2026-10-01T00:${String(index % 60).padStart(2, "0")}:00.000Z` });
    state = appendHistory(state, { questionId: String(index + 1), outcome: index % 2 ? "failed" : "independent", createdAt: `2026-10-02T00:${String(index % 60).padStart(2, "0")}:00.000Z` });
  }
  const recent = getRecentHistory(state, { limit: 8 });
  assert.equal(recent.length, 8);
  assert.ok(recent.every((event) => event.outcome !== "started"));
  assert.ok(new Date(recent[0].createdAt) >= new Date(recent.at(-1).createdAt));
  assert.equal(getEffectivePracticeEvents(state, "1").length, 1);
});

test("question history summary keeps failed and successful attempts and ignores started", () => {
  const state = { ...createDefaultState(), history: [
    { id: "open", questionId: "283", language: "java", mode: "function", outcome: "started", createdAt: "2026-10-01T00:00:00.000Z" },
    { id: "fail", questionId: "283", language: "java", mode: "function", outcome: "failed", createdAt: "2026-10-01T00:01:00.000Z" },
    { id: "pass", questionId: "283", language: "java", mode: "function", outcome: "independent", createdAt: "2026-10-01T00:02:00.000Z" }
  ] };
  const summary = getQuestionHistorySummary(state, "283");
  assert.deepEqual(summary, { attempts: 2, failures: 1, passes: 1, independent: 1, lastOutcome: "independent", lastCreatedAt: "2026-10-01T00:02:00.000Z" });
  assert.equal(getQuestionHistory(state, "283").length, 3);
});
