import test from "node:test";
import assert from "node:assert/strict";
import { createDefaultState, mergeState, migrateState, parseState, serializeState } from "../src/services/storage.js";

test("default state is versioned and has independent collections", () => {
  const state = createDefaultState();
  assert.equal(state.version, 3);
  assert.deepEqual(state.profile, { dailyMinutes: 90, dailyNewLimit: 1, defaultLanguage: "java" });
  assert.deepEqual(state.progress, {});
  assert.deepEqual(state.drafts, {});
  assert.deepEqual(state.notes, {});
  assert.deepEqual(state.history, []);
  assert.equal(state.updatedAt, "1970-01-01T00:00:00.000Z");
  assert.notEqual(state.progress, createDefaultState().progress);
});

test("malformed JSON falls back safely to defaults", () => {
  const state = parseState("{broken");
  assert.equal(state.version, 3);
  assert.deepEqual(state.progress, {});
});

test("serialization preserves version and parse accepts valid state", () => {
  const raw = serializeState({ version: 3, progress: { "1": { status: "错题" } }, notes: {} });
  const state = parseState(raw);
  assert.equal(state.version, 3);
  assert.equal(state.progress["1"].status, "reviewing");
});

test("version 2 data migrates completed items without inventing mastery", () => {
  const state = migrateState({
    version: 2,
    profile: { dailyMinutes: 60, targetDays: 30 },
    progress: { "1": { status: "已完成", reviewCount: 1, updatedAt: "2026-10-13T00:00:00.000Z" } },
    notes: { "1": { value: "keep", updatedAt: "2026-10-13T00:00:00.000Z" } },
    timer: { questionId: "1", startedAt: "2026-10-13T00:00:00.000Z" }
  });
  assert.equal(state.version, 3);
  assert.equal(state.profile.dailyMinutes, 60);
  assert.equal(state.profile.dailyNewLimit, 1);
  assert.equal(state.profile.defaultLanguage, "java");
  assert.equal(state.progress["1"].status, "completed");
  assert.equal(state.progress["1"].legacyImported, true);
  assert.equal(state.progress["1"].masteredAt, undefined);
  assert.deepEqual(state.notes["1"], { value: "keep", updatedAt: "2026-10-13T00:00:00.000Z" });
  assert.deepEqual(state.timer, { questionId: "1", startedAt: "2026-10-13T00:00:00.000Z" });
});

test("drafts keep separate language and mode records with timestamps", () => {
  const state = parseState({
    version: 3,
    drafts: { "1": { java: { function: { code: "class Solution {}", cursor: 4, scrollTop: 12, updatedAt: "2026-10-14T00:00:00.000Z" } } } }
  });
  assert.deepEqual(state.drafts["1"].java.function, {
    code: "class Solution {}",
    cursor: 4,
    scrollTop: 12,
    updatedAt: "2026-10-14T00:00:00.000Z"
  });
});

test("unsupported legacy versions fail with an explicit error", () => {
  assert.throws(() => migrateState({ version: 1 }), /不支持的数据版本/);
});

test("version 3 records also normalize legacy Chinese statuses", () => {
  const state = parseState({ version: 3, progress: { "1": { status: "已完成" }, "2": { status: "已掌握" } } });
  assert.equal(state.progress["1"].status, "completed");
  assert.equal(state.progress["1"].legacyImported, true);
  assert.equal(state.progress["2"].status, "completed");
  assert.equal(state.progress["2"].legacyImported, true);
});

test("merge state chooses the newer record by updatedAt per question id", () => {
  const current = { ...createDefaultState(), progress: { "1": { status: "思考中", updatedAt: "2026-10-13T00:00:00.000Z" } } };
  const incoming = { ...createDefaultState(), progress: {
    "1": { status: "已完成", updatedAt: "2026-10-14T00:00:00.000Z" },
    "2": { status: "错题", updatedAt: "2026-10-14T00:00:00.000Z" }
  } };
  const merged = mergeState(current, incoming);
  assert.equal(merged.progress["1"].status, "completed");
  assert.equal(merged.progress["2"].status, "reviewing");
});

test("merge state uses parent timestamps when note records are plain values", () => {
  const current = { ...createDefaultState(), updatedAt: "2026-10-13T00:00:00.000Z", notes: { "1": "old" } };
  const older = { ...createDefaultState(), updatedAt: "2026-10-12T00:00:00.000Z", notes: { "1": "older" } };
  const newer = { ...createDefaultState(), updatedAt: "2026-10-14T00:00:00.000Z", notes: { "1": "new" } };
  assert.equal(mergeState(current, older).notes["1"], "old");
  assert.equal(mergeState(current, newer).notes["1"], "new");
});

test("solutions are version-3 optional data and survive a round trip", () => {
  const state = parseState(JSON.stringify({
    version: 3,
    solutions: { "1": { java: { function: [{ id: "a", name: "哈希", code: "class Solution {}", verdict: "independent", verifiedAt: "2026-10-19T00:00:00.000Z" }] } } }
  }));
  assert.equal(state.solutions["1"].java.function[0].name, "哈希");
  assert.equal(state.solutions["1"].java.function[0].verdict, "independent");
  const round = parseState(serializeState(state));
  assert.equal(round.solutions["1"].java.function[0].code, "class Solution {}");
});

test("old backups without solutions still parse", () => {
  const state = parseState(JSON.stringify({ version: 3, progress: { "1": { status: "已完成" } } }));
  assert.deepEqual(state.solutions, {});
  assert.equal(state.progress["1"].status, "completed");
});

test("merging backups unions solution variants across languages", () => {
  const base = parseState(JSON.stringify({
    version: 3,
    solutions: { "1": { java: { function: [{ id: "j1", code: "java-1", updatedAt: "2026-10-19T00:00:00.000Z" }] } } }
  }));
  const incoming = parseState(JSON.stringify({
    version: 3,
    solutions: { "1": { java: { function: [{ id: "j1", code: "java-2", updatedAt: "2026-10-19T02:00:00.000Z" }] }, python: { function: [{ id: "p1", code: "py", updatedAt: "2026-10-19T00:00:00.000Z" }] } } }
  }));
  const merged = mergeState(base, incoming);
  assert.equal(merged.solutions["1"].java.function.length, 1);
  assert.equal(merged.solutions["1"].java.function[0].code, "java-2");
  assert.equal(merged.solutions["1"].python.function[0].code, "py");
});

test("待复习 migrates to due instead of sharing reviewing with 错题", () => {
  const state = parseState(JSON.stringify({
    version: 3,
    progress: { "1": { status: "待复习" }, "2": { status: "错题" } }
  }));
  assert.equal(state.progress["1"].status, "due");
  assert.equal(state.progress["2"].status, "reviewing");
});
