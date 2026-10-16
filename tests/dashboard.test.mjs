import test from "node:test";
import assert from "node:assert/strict";
import { buildQuestionTimeline, buildStageProgress, findWeakPoints } from "../src/services/dashboard.js";
import { createDefaultState } from "../src/services/storage.js";

const now = "2026-10-15T00:00:00.000Z";

function historyEvent(id, questionId, createdAt, extra = {}) {
  return {
    id,
    questionId,
    language: "java",
    mode: "function",
    outcome: "failed",
    hintsUsed: 0,
    viewedSolutionCode: false,
    caseId: "case-1",
    durationMs: 120000,
    createdAt,
    ...extra
  };
}

test("builds all seven stage summaries and separates completion kinds", () => {
  const questions = [
    { id: "1", title: "两数之和", phase: 1 },
    { id: "2", title: "字母异位词分组", phase: 1 },
    { id: "3", title: "最长连续序列", phase: 2 }
  ];
  const state = {
    ...createDefaultState(),
    progress: {
      "1": { status: "completed", independentPassAt: "2026-10-14T00:00:00.000Z" },
      "2": { status: "mastered", masteredAt: "2026-10-14T00:00:00.000Z" },
      "3": { status: "completed" }
    },
    history: [
      historyEvent("h1", "1", "2026-10-14T00:00:00.000Z", { outcome: "independent" }),
      historyEvent("h2", "2", "2026-10-14T00:00:00.000Z", { outcome: "needed-solution", viewedSolutionCode: true }),
      historyEvent("h3", "3", "2026-10-14T00:00:00.000Z", { outcome: "needed-hint", hintsUsed: 2 })
    ]
  };

  const stages = buildStageProgress(questions, state, now);
  assert.equal(stages.length, 7);
  assert.deepEqual(stages[0], {
    phase: 1,
    name: "数组、哈希和基础技巧",
    total: 2,
    independentCompleted: 1,
    neededHint: 0,
    neededSolution: 1,
    mastered: 1,
    questions: ["1", "2"]
  });
  assert.equal(stages[1].total, 1);
  assert.equal(stages[1].neededHint, 1);
  assert.deepEqual(stages.slice(2).map((stage) => stage.total), [0, 0, 0, 0, 0]);
});

test("finds actionable weak points without keeping an old solution view forever", () => {
  const questions = [
    { id: "1", title: "两数之和", phase: 1 },
    { id: "2", title: "字母异位词分组", phase: 1 },
    { id: "3", title: "最长连续序列", phase: 2 },
    { id: "6", title: "环形链表", phase: 2 },
    { id: "7", title: "二叉树", phase: 3 },
    { id: "4", title: "移动零", phase: 2 },
    { id: "5", title: "盛最多水的容器", phase: 2 }
  ];
  const state = {
    ...createDefaultState(),
    progress: {
      "1": { status: "completed", reviewAt: "2026-10-14T00:00:00.000Z" },
      "2": { status: "in-progress", viewedSolutionCode: true },
      "3": { status: "in-progress" },
      "4": { status: "completed", reviewAt: "2026-10-20T00:00:00.000Z" },
      "5": { status: "completed", reviewAt: "2026-10-13T00:00:00.000Z" },
      "6": { status: "completed" },
      "7": { status: "mastered", reviewAt: "2026-10-10T00:00:00.000Z" }
    },
    history: [
      historyEvent("a1", "1", "2026-10-10T00:00:00.000Z", { outcome: "failed", caseId: "same" }),
      historyEvent("a2", "1", "2026-10-11T00:00:00.000Z", { outcome: "failed", caseId: "same" }),
      historyEvent("a3", "1", "2026-10-12T00:00:00.000Z", { outcome: "failed", caseId: "other" }),
      historyEvent("b1", "2", "2026-10-10T00:00:00.000Z", { outcome: "needed-solution", viewedSolutionCode: true }),
      historyEvent("b2", "2", "2026-10-12T00:00:00.000Z", { outcome: "independent" }),
      historyEvent("c1", "3", "2026-10-09T00:00:00.000Z", { outcome: "needed-hint", hintsUsed: 1, hintLevel: 2 }),
      historyEvent("d1", "4", "2026-10-10T00:00:00.000Z", { outcome: "failed", caseId: "one" }),
      historyEvent("d2", "4", "2026-10-11T00:00:00.000Z", { outcome: "failed", caseId: "different" }),
      historyEvent("e1", "5", "2026-10-13T00:00:00.000Z", { outcome: "independent" }),
      historyEvent("f1", "6", "2026-10-10T00:00:00.000Z", { outcome: "independent" }),
      historyEvent("f2", "6", "2026-10-11T00:00:00.000Z", { outcome: "needed-solution", viewedSolutionCode: true })
    ]
  };

  const weakPoints = findWeakPoints(questions, state, now);
  assert.deepEqual(weakPoints.map((item) => item.questionId), ["5", "1", "3", "6"]);
  assert.deepEqual(weakPoints.find((item) => item.questionId === "1").reasons, ["复习已到期"]);
  assert.deepEqual(weakPoints.find((item) => item.questionId === "3").reasons, ["多次使用高级提示"]);
  assert.equal(weakPoints.find((item) => item.questionId === "2"), undefined);
  assert.equal(weakPoints.find((item) => item.questionId === "4"), undefined);
  assert.deepEqual(weakPoints.find((item) => item.questionId === "6").reasons, ["看过答案后尚未独立重做"]);
  assert.equal(weakPoints.find((item) => item.questionId === "7"), undefined);
});

test("does not invent a stage when question metadata is missing", () => {
  const stages = buildStageProgress([{ id: "without-phase", title: "未标阶段" }], createDefaultState(), now);
  assert.deepEqual(stages.map((stage) => stage.total), [0, 0, 0, 0, 0, 0, 0]);
});

test("uses hint level instead of cumulative hint count for weak-point reasons", () => {
  const questions = [{ id: "1", title: "两数之和", phase: 1 }, { id: "2", title: "移动零", phase: 1 }];
  const state = {
    ...createDefaultState(),
    history: [
      historyEvent("one", "1", "2026-10-10T00:00:00.000Z", { outcome: "needed-hint", hintsUsed: 1, hintLevel: 1 }),
      historyEvent("two", "1", "2026-10-11T00:00:00.000Z", { outcome: "needed-hint", hintsUsed: 2, hintLevel: 1 }),
      historyEvent("three", "2", "2026-10-12T00:00:00.000Z", { outcome: "needed-hint", hintsUsed: 1, hintLevel: 2 })
    ]
  };
  assert.equal(findWeakPoints(questions, state, now).find((item) => item.questionId === "1"), undefined);
  assert.deepEqual(findWeakPoints(questions, state, now).find((item) => item.questionId === "2").reasons, ["多次使用高级提示"]);
});

test("builds a complete ascending timeline for one question", () => {
  const state = {
    ...createDefaultState(),
    history: [
      historyEvent("late", "1", "2026-10-14T00:00:00.000Z", { outcome: "independent", language: "python", mode: "acm", hintsUsed: 1 }),
      historyEvent("early", "1", "2026-10-12T00:00:00.000Z", { outcome: "failed" }),
      historyEvent("other", "2", "2026-10-11T00:00:00.000Z")
    ]
  };
  assert.deepEqual(buildQuestionTimeline(state, "1").map((event) => event.id), ["early", "late"]);
  assert.equal(buildQuestionTimeline(state, "1")[1].language, "python");
  assert.deepEqual(buildQuestionTimeline(state, "missing"), []);
});

test("historical failures do not make a successfully recovered question a current weak point", async () => {
  const questions = [{ id: "283", title: "移动零", phase: 1 }];
  const state = {
    progress: { "283": { status: "completed", reviewAt: "2026-10-20T00:00:00.000Z", lastReviewOutcome: "independent", independentPassAt: "2026-10-16T00:00:00.000Z" } },
    history: [
      { id: "failed", questionId: "283", language: "java", mode: "function", outcome: "failed", caseId: "bad", createdAt: "2026-10-15T00:00:00.000Z" },
      { id: "passed", questionId: "283", language: "java", mode: "function", outcome: "independent", createdAt: "2026-10-16T00:00:00.000Z" }
    ]
  };
  const { findWeakPoints } = await import("../src/services/dashboard.js");
  assert.deepEqual(findWeakPoints(questions, state, "2026-10-16T12:00:00.000Z"), []);
});
