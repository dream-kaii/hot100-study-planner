import test from "node:test";
import assert from "node:assert/strict";
import { advanceReview, getNextReviewAt, isReviewDue } from "../src/services/review.js";

const now = "2026-10-14T00:00:00.000Z";

test("review intervals follow 1, 3, 7 and 14 day defaults", () => {
  assert.equal(getNextReviewAt("错题", now), "2026-10-15T00:00:00.000Z");
  assert.equal(getNextReviewAt("待复习", now), "2026-10-17T00:00:00.000Z");
  assert.equal(getNextReviewAt("已完成", now), "2026-10-21T00:00:00.000Z");
  assert.equal(getNextReviewAt("已掌握", now), "2026-10-28T00:00:00.000Z");
  assert.equal(getNextReviewAt("reviewing", now), "2026-10-15T00:00:00.000Z");
  assert.equal(getNextReviewAt("completed", now), "2026-10-21T00:00:00.000Z");
  assert.equal(getNextReviewAt("mastered", now), "2026-10-28T00:00:00.000Z");
});

test("review due checks derive from the shared practice status", () => {
  // 旧版只看 reviewAt 是否过期。问题在于手动把题改成「思考中」后，
  // 旧的 reviewAt 会留在记录里 —— 总览按派生状态算 0 条待复习，
  // 错题页按 reviewAt 算 1 条，两处又对不上。
  // 现在 isReviewDue 直接问派生状态：只有 due 才算到期。
  assert.equal(isReviewDue({ status: "completed", reviewAt: "2026-10-13T23:59:59.000Z" }, now), true);
  assert.equal(isReviewDue({ status: "completed", reviewAt: "2026-10-14T00:00:01.000Z" }, now), false);
  assert.equal(isReviewDue({}, now), false);
  // 没有排期的裸 reviewAt 不算「到期」——它不在任何复习节奏里。
  assert.equal(isReviewDue({ reviewAt: "2026-10-13T23:59:59.000Z" }, now), false);
  // 手动降级成思考中/未开始后，残留的旧到期日不该再把人拉回待复习。
  assert.equal(isReviewDue({ status: "in-progress", reviewAt: "2026-10-13T23:59:59.000Z" }, now), false);
  assert.equal(isReviewDue({ status: "new", reviewAt: "2026-10-13T23:59:59.000Z" }, now), false);
  // 已掌握永远不该出现在待复习里。
  assert.equal(isReviewDue({ status: "completed", masteredAt: now, reviewAt: "2026-10-13T23:59:59.000Z" }, now), false);
  // 错题也不是「到期复习」，它有自己的一栏。
  assert.equal(isReviewDue({ status: "reviewing", reviewAt: "2026-10-13T23:59:59.000Z" }, now), false);
});

test("every overdue completion is counted once across dashboard, filter and review page", () => {
  // 回归：到期复习的计数必须三处一致（总览统计卡 / 题库筛选 / 错题复习页）。
  const overdue = [
    { status: "completed", reviewAt: "2026-10-01T00:00:00.000Z" },
    { status: "due" },
    { status: "reviewing" },
    { status: "completed", reviewAt: "2026-11-01T00:00:00.000Z" },
    { status: "in-progress", reviewAt: "2026-10-01T00:00:00.000Z" },
    {}
  ];
  const due = (item) => {

    return isReviewDue(item, now);
  };
  assert.deepEqual(overdue.map(due), [true, true, false, false, false, false]);
});

test("a successful completion advances a completed item to mastered", () => {
  const next = advanceReview({ status: "已完成", reviewCount: 2 }, "correct", now);
  assert.equal(next.status, "已掌握");
  assert.equal(next.reviewCount, 3);
  assert.equal(next.reviewAt, "2026-10-21T00:00:00.000Z");
  assert.equal(next.updatedAt, now);
});

test("advanceReview accepts the canonical review outcomes", () => {
  const next = advanceReview({}, "independent", now);
  assert.equal(next.status, "completed");
  assert.equal(next.reviewIntervalDays, 1);
});
