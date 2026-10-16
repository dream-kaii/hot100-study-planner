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

test("review due checks compare reviewAt against current time", () => {
  assert.equal(isReviewDue({ reviewAt: "2026-10-13T23:59:59.000Z" }, now), true);
  assert.equal(isReviewDue({ reviewAt: "2026-10-14T00:00:01.000Z" }, now), false);
  assert.equal(isReviewDue({}, now), false);
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
