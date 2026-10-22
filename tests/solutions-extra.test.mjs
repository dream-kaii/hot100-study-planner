import test from "node:test";
import assert from "node:assert/strict";
import { pushVersion, restoreVersion, dropVersion } from "../src/services/solutions.js";

function makeVariant(overrides = {}) {
  return {
    id: "v1", name: "快慢指针", code: "class S { void a() {} }", cursor: 0, scrollTop: 0,
    createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z",
    verdict: "independent", verifiedAt: "2026-10-01T00:00:00.000Z", outcome: null,
    versions: [], ...overrides
  };
}

test("pushVersion 把旧代码压进历史，空代码不占位", () => {
  const [pushed] = pushVersion([makeVariant()], "v1", { reason: "复习重写" });
  assert.equal(pushed.versions.length, 1);
  assert.equal(pushed.versions[0].code, "class S { void a() {} }");
  assert.equal(pushed.versions[0].verdict, "independent");
  assert.equal(pushed.versions[0].reason, "复习重写");

  // 空白模板压不出东西来，否则版本栈里全是 ""
  const [blank] = pushVersion([makeVariant({ code: "  \n\t " })], "v1");
  assert.equal(blank.versions.length, 0);

  // 连点两次不重复占格
  const once = pushVersion([makeVariant()], "v1")[0];
  const twice = pushVersion([once], "v1")[0];
  assert.equal(twice.versions.length, 1);
});

test("取回历史版本时，当前内容要先落进历史 —— 否则「取回」等于静默删除", () => {
  const v = {
    ...makeVariant(), code: "editor 里已经写了一半的新代码", verdict: null, verifiedAt: null,
    versions: [{ id: "ver-1", code: "很久以前那版", verdict: "independent", verifiedAt: null, savedAt: "2026-10-10T00:00:00.000Z", reason: "复习重写" }]
  };
  // 目标版本不存在时也要保住当前内容：先 push 再查找，顺序不能反。
  const [missing] = restoreVersion([v], "v1", "ver-不存在");
  assert.equal(missing.code, "editor 里已经写了一半的新代码");
  assert.equal(missing.versions.length, 2);
  assert.equal(missing.versions.at(-1).code, "editor 里已经写了一半的新代码");
});

test("提示条的「撤销」不把空模板压进历史", () => {
  const cleared = { ...makeVariant(), code: "   ", verdict: null, verifiedAt: null, versions: [{ id: "ver-1", code: "旧代码", verdict: "independent", verifiedAt: null, savedAt: "2026-10-10T00:00:00.000Z", reason: "复习重写" }] };
  // keepCurrent: false → 不 push，空模板不进历史
  const [restored] = restoreVersion([cleared], "v1", "ver-1", { keepCurrent: false });
  assert.equal(restored.code, "旧代码");
  assert.equal(restored.verdict, "independent");
  assert.equal(restored.versions.length, 0);
});

test("手动取回：当前内容留在历史里，可以再取回来", () => {
  const v = {
    ...makeVariant(), code: "当前这份是有内容的", verdict: null, verifiedAt: null,
    versions: [{ id: "ver-1", code: "更早的代码", verdict: "independent", verifiedAt: "2026-10-02T00:00:00.000Z", savedAt: "2026-10-10T00:00:00.000Z", reason: "复习重写" }]
  };
  const [restored] = restoreVersion([v], "v1", "ver-1");
  assert.equal(restored.code, "更早的代码");
  assert.equal(restored.verdict, "independent");
  // 刚才那份「当前这份是有内容的」被留在历史里了
  assert.equal(restored.versions.length, 1);
  assert.equal(restored.versions[0].code, "当前这份是有内容的");
});

test("dropVersion 只摘掉指定那一版，其它不动", () => {
  const v = {
    ...makeVariant(),
    versions: [
      { id: "a", code: "A", verdict: null, verifiedAt: null, savedAt: "2026-10-10T00:00:00.000Z", reason: "" },
      { id: "b", code: "B", verdict: null, verifiedAt: null, savedAt: "2026-10-11T00:00:00.000Z", reason: "" }
    ]
  };
  const [after] = dropVersion([v], "v1", "a");
  assert.deepEqual(after.versions.map((x) => x.id), ["b"]);
});
