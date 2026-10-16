import test from "node:test";
import assert from "node:assert/strict";
import { getVisibleHints, nextHintLevel, recordHintUsage } from "../src/services/hints.js";

const hints = [
  { level: 1, text: "先找出题目要求维护的关系。" },
  { level: 2, text: "记录已经看过的元素。" },
  { level: 3, text: "遍历时先查询互补值，再保存当前值。" },
  { level: 4, text: "伪代码：遍历 -> 查询 -> 找到则返回 -> 否则记录。", kind: "pseudocode" }
];

test("empty hints have no next level or visible records", () => {
  assert.equal(nextHintLevel(0, []), 0);
  assert.deepEqual(getVisibleHints([], 4), []);
  assert.equal(nextHintLevel(0, undefined), 0);
});

test("next hint follows available levels without skipping past the maximum", () => {
  const missingLevel = [hints[0], hints[2], hints[3]];
  assert.equal(nextHintLevel(0, missingLevel), 1);
  assert.equal(nextHintLevel(1, missingLevel), 3);
  assert.equal(nextHintLevel(3, missingLevel), 4);
  assert.equal(nextHintLevel(4, missingLevel), 0);
  assert.equal(nextHintLevel(99, hints), 0);
});

test("visible hints are the sorted prefix at or below the unlocked level", () => {
  const unsorted = [hints[2], hints[0], hints[3]];
  assert.deepEqual(getVisibleHints(unsorted, 3), [hints[0], hints[2]]);
  assert.deepEqual(getVisibleHints(unsorted, 0), []);
});

test("recordHintUsage is immutable and does not duplicate consecutive history", () => {
  const original = { status: "in-progress", hintsUsed: 1, hintHistory: [{ level: 1, createdAt: "2026-10-14T00:00:00.000Z" }] };
  const first = recordHintUsage(original, 2, "2026-10-15T00:00:00.000Z");
  const repeated = recordHintUsage(first, 2, "2026-10-15T01:00:00.000Z");

  assert.equal(original.hintsUsed, 1);
  assert.deepEqual(original.hintHistory, [{ level: 1, createdAt: "2026-10-14T00:00:00.000Z" }]);
  assert.equal(first.hintsUsed, 2);
  assert.deepEqual(first.hintHistory, [
    { level: 1, createdAt: "2026-10-14T00:00:00.000Z" },
    { level: 2, createdAt: "2026-10-15T00:00:00.000Z" }
  ]);
  assert.equal(repeated.hintsUsed, 2);
  assert.deepEqual(repeated.hintHistory, first.hintHistory);
  assert.equal(repeated.lastHintAt, "2026-10-15T01:00:00.000Z");
});

test("hint usage is capped at level four", () => {
  const progress = recordHintUsage({ hintsUsed: 4, hintHistory: [{ level: 4, createdAt: "2026-10-14T00:00:00.000Z" }] }, 4, "2026-10-15T00:00:00.000Z");
  assert.equal(progress.hintsUsed, 4);
  assert.deepEqual(progress.hintHistory, [{ level: 4, createdAt: "2026-10-14T00:00:00.000Z" }]);
});
