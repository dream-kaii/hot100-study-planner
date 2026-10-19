import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_SOLUTIONS_PER_SCOPE,
  appendVariant,
  applyVerdict,
  canAddVariant,
  createVariant,
  describeVariant,
  isPassingVerdict,
  mergeScope,
  mergeSolutions,
  nextVariantName,
  normalizeSolutions,
  normalizeVariant,
  removeVariant,
  renameVariant,
  selectScope,
  updateVariant
} from "../src/services/solutions.js";

const now = "2026-10-19T00:00:00.000Z";

test("a new variant captures the draft as a restorable snapshot", () => {
  const variant = createVariant({ code: "class Solution {}", cursor: 12, scrollTop: 40 }, { seed: 0, name: "哈希表", now: new Date(now) });
  assert.equal(variant.name, "哈希表");
  assert.equal(variant.code, "class Solution {}");
  assert.equal(variant.cursor, 12);
  assert.equal(variant.scrollTop, 40);
  assert.equal(variant.createdAt, now);
  assert.equal(variant.verdict, null);
  assert.equal(variant.verifiedAt, null);
  assert.ok(variant.id);
});

test("default names fill the smallest free slot so deleting does not leave holes", () => {
  const first = createVariant({ code: "a" }, { seed: 0, name: nextVariantName([]) });
  assert.equal(first.name, "解法 1");
  const list1 = appendVariant([], first);
  assert.equal(nextVariantName(list1), "解法 2");
  const second = appendVariant(list1, createVariant({ code: "b" }, { seed: 1, name: nextVariantName(list1) }));
  assert.equal(second[1].name, "解法 2");
  assert.equal(nextVariantName(removeVariant(second, first.id)), "解法 1");
});

test("scope caps at the soft limit and reports whether another variant fits", () => {
  let list = [];
  for (let index = 0; index < MAX_SOLUTIONS_PER_SCOPE; index += 1) {
    list = appendVariant(list, createVariant({ code: `v${index}` }, { seed: index, now: new Date(now) }));
  }
  assert.equal(list.length, MAX_SOLUTIONS_PER_SCOPE);
  assert.equal(canAddVariant(list), false);
  const overflow = appendVariant(list, createVariant({ code: "extra" }, { seed: 99, now: new Date(now) }));
  assert.equal(overflow.length, MAX_SOLUTIONS_PER_SCOPE);
});

test("a passing verdict stamps verifiedAt while a failure keeps the earlier pass", () => {
  const base = appendVariant([], createVariant({ code: "x" }, { seed: 0, now: new Date(now) }));
  const id = base[0].id;
  const passed = applyVerdict(base, id, { verdict: "independent", now: new Date("2026-10-20T00:00:00.000Z") });
  assert.equal(passed[0].verdict, "independent");
  assert.equal(passed[0].verifiedAt, "2026-10-20T00:00:00.000Z");
  assert.equal(isPassingVerdict(passed[0].verdict), true);

  const failed = applyVerdict(passed, id, { verdict: "failed", now: new Date("2026-10-21T00:00:00.000Z") });
  assert.equal(failed[0].verdict, "failed");
  // 上次通过的时间戳必须留着：一次失败不能抹掉「这份跑通过」的证据。
  assert.equal(failed[0].verifiedAt, "2026-10-20T00:00:00.000Z");
  assert.equal(failed[0].updatedAt, "2026-10-21T00:00:00.000Z");
  assert.equal(isPassingVerdict(failed[0].verdict), false);
});

test("editing, renaming and deleting operate on one variant without touching siblings", () => {
  let list = appendVariant([], createVariant({ code: "first" }, { seed: 0, name: "解法 1", now: new Date(now) }));
  list = appendVariant(list, createVariant({ code: "second" }, { seed: 1, name: "解法 2", now: new Date(now) }));
  const [a, b] = list;

  const edited = updateVariant(list, b.id, { code: "second-v2", cursor: 7 });
  assert.equal(edited[0].code, "first");
  assert.equal(edited[1].code, "second-v2");
  assert.equal(edited[1].cursor, 7);

  const renamed = renameVariant(edited, a.id, "  双指针  ");
  assert.equal(renamed[0].name, "双指针");
  assert.equal(renameVariant(renamed, a.id, "   ")[0].name, "双指针");

  const removed = removeVariant(renamed, a.id);
  assert.deepEqual(removed.map((item) => item.name), ["解法 2"]);
});

test("normalization survives malformed or legacy records", () => {
  const normalized = normalizeSolutions({
    "1": {
      java: { function: [{ code: "kept" }, null, { name: "只有名字" }] },
      python: { function: "not-an-array" }
    },
    "2": null
  });
  assert.equal(normalized["1"].java.function.length, 3);
  assert.equal(normalized["1"].java.function[0].code, "kept");
  assert.equal(normalized["1"].java.function[0].name, "解法 1");
  assert.equal(normalized["1"].java.function[1].code, "");
  assert.equal(normalized["1"].java.function[2].name, "只有名字");
  assert.equal(normalized["1"].python, undefined);
  assert.equal(normalized["2"], undefined);
  assert.deepEqual(normalizeSolutions(undefined), {});
  assert.deepEqual(normalizeSolutions([1, 2]), {});
});

test("selectScope returns an empty list for unknown scopes instead of throwing", () => {
  const solutions = normalizeSolutions({ "1": { java: { function: [{ id: "a", code: "x" }] } } });
  assert.equal(selectScope(solutions, "1", "java", "function").length, 1);
  assert.deepEqual(selectScope(solutions, "1", "python", "function"), []);
  assert.deepEqual(selectScope(solutions, "404", "java", "function"), []);
  assert.deepEqual(selectScope(undefined, "1", "java", "function"), []);
});

test("merging two scopes keeps the newer copy of each id and a stable order", () => {
  const older = normalizeVariant({ id: "a", name: "解法 1", code: "old", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z" });
  const newer = normalizeVariant({ id: "a", name: "解法 1", code: "new", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-19T00:00:00.000Z" });
  const other = normalizeVariant({ id: "b", name: "解法 2", code: "b-code", createdAt: "2026-10-02T00:00:00.000Z", updatedAt: "2026-10-02T00:00:00.000Z" });
  const merged = mergeScope([older], [other, newer]);
  assert.deepEqual(merged.map((item) => item.id), ["a", "b"]);
  assert.equal(merged[0].code, "new");
});

test("merging solutions keeps language scopes independent", () => {
  const current = normalizeSolutions({ "1": { java: { function: [{ id: "j1", code: "java", updatedAt: now }] } } });
  const incoming = normalizeSolutions({ "1": { python: { function: [{ id: "p1", code: "py", updatedAt: now }] } } });
  const merged = mergeSolutions(current, incoming);
  assert.equal(merged["1"].java.function.length, 1);
  assert.equal(merged["1"].python.function.length, 1);
  assert.equal(merged["1"].java.function[0].code, "java");
});

test("describeVariant summarizes a variant for the switcher", () => {
  const passed = describeVariant(normalizeVariant({ id: "a", name: "哈希", code: "1\n2\n3", verdict: "independent", verifiedAt: now }));
  assert.equal(passed.passing, true);
  assert.equal(passed.label, "独立通过");
  assert.equal(passed.lines, 3);
  const draft = describeVariant(normalizeVariant({ id: "b", code: "" }));
  assert.equal(draft.passing, false);
  assert.equal(draft.label, "未通过");
});
