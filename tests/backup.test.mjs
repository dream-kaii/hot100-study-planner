import test from "node:test";
import assert from "node:assert/strict";
import { exportBackup, mergeOrReplaceState, readBackupFile } from "../src/services/backup.js";
import { createDefaultState } from "../src/services/storage.js";

test("malformed backup is rejected without throwing", async () => {
  await assert.rejects(() => readBackupFile({ text: async () => "{broken" }), /备份文件格式无效/);
});

test("backup export includes the current version", async () => {
  const blob = exportBackup({ ...createDefaultState(), progress: { "1": { status: "错题" } } });
  assert.match(await blob.text(), /"version": 3/);
});

test("replace and merge modes preserve the intended records", () => {
  const current = { ...createDefaultState(), progress: { "1": { status: "思考中", updatedAt: "2026-10-13" } } };
  const incoming = { ...createDefaultState(), progress: { "1": { status: "已完成", updatedAt: "2026-10-14" }, "2": { status: "错题", updatedAt: "2026-10-14" } } };
  assert.deepEqual(Object.keys(mergeOrReplaceState(current, incoming, "replace").progress), ["1", "2"]);
  assert.equal(mergeOrReplaceState(current, incoming, "merge").progress["1"].status, "completed");
});

test("unsupported backup version is rejected", async () => {
  await assert.rejects(() => readBackupFile({ text: async () => JSON.stringify({ version: 999 }) }), /版本不受支持/);
});
