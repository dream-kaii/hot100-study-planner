import assert from "node:assert/strict";
import test from "node:test";
import { describeError, isAbortError } from "../src/services/errors.js";

const domError = (name, message) => Object.assign(new Error(message), { name });

test("取消选文件夹不是报错，给的是中性文案", () => {
  const error = domError("AbortError", "The user aborted a request.");
  assert.equal(isAbortError(error), true);
  assert.equal(describeError(error, "设置备份位置失败"), "操作已取消");
  assert.equal(describeError(error, "设置备份位置失败", "已取消，原来的备份设置没有改动。"), "已取消，原来的备份设置没有改动。");
});

test("权限被拒的英文原文翻成中文", () => {
  const error = domError("NotAllowedError", "The request is not allowed by the user agent or the platform in the current context.");
  const text = describeError(error, "备份失败");
  assert.match(text, /权限/);
  assert.doesNotMatch(text, /The request/);
});

test("fetch 失败的 TypeError 识别为网络问题", () => {
  assert.match(describeError(new TypeError("Failed to fetch"), "运行失败"), /网络/);
  assert.match(describeError(new TypeError("Load failed"), "运行失败"), /网络/);
});

test("认不出来的英文错误不会透给用户", () => {
  const text = describeError(new Error("Some internal engine exploded"), "备份失败，请重试。");
  assert.equal(text, "备份失败，请重试。");
});

test("自己抛的中文提示原样保留", () => {
  assert.equal(describeError(new Error("备份文件夹的授权已过期"), "兜底"), "备份文件夹的授权已过期");
});

test("没有 message 的异常走兜底", () => {
  assert.equal(describeError(undefined, "操作失败"), "操作失败");
  assert.equal(describeError({}, "操作失败"), "操作失败");
});
