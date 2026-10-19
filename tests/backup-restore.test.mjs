// 换浏览器后「选回原来那个备份文件夹」能不能把数据一起带回来。
// 关键点：只恢复授权不等于恢复数据，必须把文件夹里的 hot100-backup.json 读回来合并。

import test from "node:test";
import assert from "node:assert/strict";

import { readBackupFromDirectory } from "../src/services/backup.js";
import { createDefaultState, isStateEmpty, serializeState } from "../src/services/storage.js";

function fakeDirectory(state) {
  return {
    getFileHandle: async (name) => ({
      getFile: async () => ({ text: async () => serializeState(state), name })
    })
  };
}

test("文件夹里有备份 → 能读回状态", async () => {
  const state = { ...createDefaultState(), progress: { p1: { status: "done" } }, updatedAt: "2026-10-19T00:00:00.000Z" };
  const result = await readBackupFromDirectory(fakeDirectory(state));
  assert.deepEqual(result.progress, { p1: { status: "done" } });
});

test("文件夹里没有备份 → 返回 null 而不是抛错", async () => {
  const empty = { getFileHandle: async () => { throw new DOMException("missing", "NotFoundError"); } };
  assert.equal(await readBackupFromDirectory(empty), null);
  assert.equal(await readBackupFromDirectory(null), null);
  assert.equal(await readBackupFromDirectory({}), null);
});

test("空状态判定：默认状态算空，有学习痕迹就不算", () => {
  assert.equal(isStateEmpty(createDefaultState()), true);
  assert.equal(isStateEmpty({ ...createDefaultState(), history: [{ id: "h1" }] }), false);
  assert.equal(isStateEmpty({ ...createDefaultState(), progress: { p1: { status: "done" } } }), false);
  assert.equal(isStateEmpty({ ...createDefaultState(), notes: { p1: { text: "笔记" } } }), false);
});
