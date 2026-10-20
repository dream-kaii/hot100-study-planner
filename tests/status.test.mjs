import test from "node:test";
import assert from "node:assert/strict";
import {
  derivePracticeStatus,
  getMasteryLevel,
  isMistakeStatus,
  isReviewPending,
  recordHint,
  recordReviewOutcome,
  recordSolutionView
} from "../src/services/status.js";

const now = "2026-10-14T00:00:00.000Z";

test("derives practice status and mastery level from one progress contract", () => {
  assert.equal(derivePracticeStatus({}, now), "new");
  assert.equal(derivePracticeStatus({ status: "in-progress" }, now), "in-progress");
  assert.equal(derivePracticeStatus({ status: "completed", reviewAt: "2026-10-20T00:00:00.000Z" }, now), "completed");
  // 已完成 + 复习到期 = 待复习（due），不是错题（reviewing）。
  // 题本身没做错，只是该重做了；混成同一个状态正是之前统计对不上的根源。
  assert.equal(derivePracticeStatus({ status: "completed", reviewAt: "2026-10-13T00:00:00.000Z" }, now), "due");
  assert.equal(derivePracticeStatus({ status: "reviewing" }, now), "reviewing");
  assert.equal(derivePracticeStatus({ status: "错题" }, now), "reviewing");
  assert.equal(derivePracticeStatus({ status: "待复习" }, now), "due");
  assert.equal(derivePracticeStatus({ status: "due" }, now), "due");
  assert.equal(derivePracticeStatus({ status: "mastered" }, now), "mastered");
  assert.equal(derivePracticeStatus({ masteredAt: now }, now), "mastered");
  assert.equal(getMasteryLevel({}), "new");
  assert.equal(getMasteryLevel({ status: "in-progress" }), "learning");
  assert.equal(getMasteryLevel({ status: "reviewing" }), "reviewing");
  assert.equal(getMasteryLevel({ status: "due" }), "reviewing");
  assert.equal(getMasteryLevel({ masteredAt: now }), "mastered");
});

test("mistake and due stay distinct predicates across every view", () => {
  const overdue = { status: "completed", reviewAt: "2026-10-13T00:00:00.000Z" };
  const missed = { status: "reviewing" };
  const mastered = { status: "reviewing", masteredAt: now };
  assert.equal(isMistakeStatus(derivePracticeStatus(overdue, now)), false);
  assert.equal(isMistakeStatus(derivePracticeStatus(missed, now)), true);
  assert.equal(isMistakeStatus(derivePracticeStatus(mastered, now)), false);
  assert.equal(isReviewPending(overdue, now), true);
  assert.equal(isReviewPending(missed, now), true);
  assert.equal(isReviewPending(mastered, now), false);
  assert.equal(isReviewPending({ status: "completed", reviewAt: "2026-12-01T00:00:00.000Z" }, now), false);
});

test("hints and solution views preserve a previous independent pass", () => {
  const passed = { status: "completed", independentPassAt: "2026-10-10T00:00:00.000Z", hintsUsed: 0 };
  const hinted = recordHint(passed, 2, now);
  const viewed = recordSolutionView(hinted, "java", now);
  assert.equal(viewed.status, "completed");
  assert.equal(viewed.hintsUsed, 1);
  assert.deepEqual(viewed.hintHistory, [{ level: 2, usedAt: now }]);
  assert.equal(viewed.independentPassAt, passed.independentPassAt);
  assert.equal(viewed.viewedSolutionCode, true);
  assert.equal(viewed.viewedSolutionLanguage, "java");
});

test("hint and solution records keep language and mode scopes separate", () => {
  const java = recordHint({}, 1, now, "java", "function");
  const both = recordHint(java, 2, now, "python", "acm");
  assert.equal(both.hintsByContext["java:function"].count, 1);
  assert.equal(both.hintsByContext["python:acm"].count, 1);
  const viewed = recordSolutionView(both, "java", now, "function");
  assert.equal(viewed.viewedSolutionByContext["java:function"].viewedAt, now);
  assert.equal(viewed.viewedSolutionByContext["python:acm"], undefined);
});

test("review outcomes advance intervals and master after an independent 14-day pass", () => {
  const first = recordReviewOutcome({}, "independent", now);
  assert.equal(first.reviewIntervalDays, 1);
  assert.equal(first.reviewAt, "2026-10-15T00:00:00.000Z");
  const mastered = recordReviewOutcome({ status: "completed", reviewCount: 4, reviewIntervalDays: 14 }, "independent", now);
  assert.equal(mastered.masteredAt, now);
  assert.equal(mastered.reviewAt, undefined);
  assert.equal(derivePracticeStatus(mastered, now), "mastered");
});

test("hinted, solution-assisted and failed reviews reset the next interval", () => {
  for (const outcome of ["needed-hint", "needed-solution", "failed"]) {
    const next = recordReviewOutcome({ status: "reviewing", reviewIntervalDays: 14 }, outcome, now);
    assert.equal(next.reviewIntervalDays, 1);
    assert.equal(next.reviewAt, "2026-10-15T00:00:00.000Z");
    assert.equal(next.lastReviewOutcome, outcome);
  }
});

test("a failed 14-day review restarts the success interval sequence", () => {
  const failed = recordReviewOutcome({ reviewCount: 4, reviewIntervalDays: 14, reviewStep: 3 }, "failed", now);
  const next = recordReviewOutcome(failed, "independent", "2026-10-15T00:00:00.000Z");
  assert.equal(next.reviewIntervalDays, 1);
  assert.equal(next.reviewStep, 1);
  assert.equal(next.reviewAt, "2026-10-16T00:00:00.000Z");
});

test("an early independent result does not claim mastery before a future 14-day review is due", () => {
  const next = recordReviewOutcome({ reviewIntervalDays: 14, reviewStep: 3, reviewAt: "2026-10-20T00:00:00.000Z" }, "independent", now);
  assert.notEqual(next.status, "mastered");
  assert.equal(next.reviewAt, "2026-10-20T00:00:00.000Z");
});

test("assisted completion remains on the learning path after a later failed review", async () => {
  const {hasCompletedLearning}=await import('../src/services/practice.js');
  for(const outcome of ["needed-hint","needed-solution"]){
    const completed=recordReviewOutcome({},outcome,now);
    assert.equal(hasCompletedLearning(completed),true);
    const failed=recordReviewOutcome(completed,"failed","2026-10-15T00:00:00.000Z");
    assert.equal(hasCompletedLearning(failed),true);
    assert.equal(failed.completedAt,now);
  }
});

test("classifies each run from current attempt assistance, not cumulative progress", async () => {
  const { classifyAttemptOutcome } = await import("../src/services/status.js");
  assert.equal(classifyAttemptOutcome({ passed: true, attemptHintsUsed: 0, attemptViewedSolutionCode: false }), "independent");
  assert.equal(classifyAttemptOutcome({ passed: true, attemptHintsUsed: 1, attemptViewedSolutionCode: false }), "needed-hint");
  assert.equal(classifyAttemptOutcome({ passed: true, attemptHintsUsed: 0, attemptViewedSolutionCode: true }), "needed-solution");
  assert.equal(classifyAttemptOutcome({ passed: false, attemptHintsUsed: 0, attemptViewedSolutionCode: false }), "failed");
});

test("assisted success is completed and a later independent success recovers from a failure", () => {
  const assisted = recordReviewOutcome({}, "needed-hint", now);
  assert.equal(assisted.status, "completed");
  assert.equal(assisted.reviewAt, "2026-10-15T00:00:00.000Z");
  const failed = recordReviewOutcome(assisted, "failed", "2026-10-15T00:00:00.000Z");
  assert.equal(failed.status, "reviewing");
  const recovered = recordReviewOutcome(failed, "independent", "2026-10-16T00:00:00.000Z");
  assert.equal(recovered.status, "completed");
  assert.equal(recovered.lastReviewOutcome, "independent");
  assert.equal(recovered.reviewAt, "2026-10-17T00:00:00.000Z");
});

test("a completed item with a future review date is not manually downgraded to a current mistake", () => {
  const item = recordReviewOutcome({}, "independent", "2026-10-16T00:00:00.000Z");
  assert.equal(item.status, "completed");
  assert.ok(Date.parse(item.reviewAt) > Date.parse("2026-10-16T00:00:00.000Z"));
});

// 回归：派生状态是全站的必经函数（总览/题库/错题页/顶栏统计都在调），
// 它以前用会抛错的 asDate 解析 reviewAt。只要一条 progress 里的 reviewAt
// 是坏字符串（手改 localStorage、旧备份、跨设备合并都可能），
// 一次渲染就抛错，实测整个 React 树被卸载 —— 整页白屏，一个字都不剩。
// 派生状态是只读展示逻辑，坏数据只能让它退化成「没有复习日」。
test("a malformed reviewAt degrades to no review date instead of throwing", () => {
  const cases = [
    { status: "completed", reviewAt: "not-a-date" },
    { status: "completed", reviewAt: 123 },
    { status: "completed", reviewAt: {} },
    { reviewAt: "not-a-date" },
    { reviewAt: null },
    null,
    undefined,
    "completed",
    { status: null },
    { status: {} }
  ];
  for (const item of cases) {
    assert.doesNotThrow(() => derivePracticeStatus(item, now), `派生状态不接受坏数据 ${JSON.stringify(item)}`);
    assert.equal(typeof derivePracticeStatus(item, now), "string");
  }
  // 坏复习日 = 当作没有复习日，状态就是已通过本身。
  assert.equal(derivePracticeStatus({ status: "completed", reviewAt: "not-a-date" }, now), "completed");
  // 坏数据不能让人凭空拿到「已掌握」。
  assert.equal(derivePracticeStatus({ reviewAt: "not-a-date" }, now), "new");
  assert.equal(isReviewPending({ status: "completed", reviewAt: "not-a-date" }, now), false);
  assert.equal(isMistakeStatus(derivePracticeStatus({ reviewAt: "not-a-date" }, now)), false);
});

test("a malformed stored reviewAt does not break recording a new outcome", () => {
  // 14 天那一步会读旧的 reviewAt 判断「是不是还排着复习」。
  // 旧值坏掉时也不能抛错，否则用户点「重做完成」像没反应。
  assert.doesNotThrow(() => recordReviewOutcome({ reviewStep: 3, reviewAt: "not-a-date" }, "independent", now));
  const next = recordReviewOutcome({ reviewStep: 3, reviewAt: "not-a-date" }, "independent", now);
  assert.equal(next.status, "mastered");
});
