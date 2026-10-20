import test from "node:test";
import assert from "node:assert/strict";
import { readLocal, removeLocal, storageAvailable, writeLocal } from "../src/services/local-store.js";

// 用最小的假 window 模拟各种浏览器环境。
// 这些场景都不是假设：Safari「阻止所有 Cookie」、Chrome 关掉站点数据、
// 企业策略托管设备、无 allow-same-origin 的 iframe 都会真实发生。
function withWindow(impl, run) {
  const original = globalThis.window;
  globalThis.window = impl;
  try {
    run();
  } finally {
    if (original === undefined) delete globalThis.window;
    else globalThis.window = original;
  }
}

function makeStore() {
  const data = new Map();
  return {
    data,
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, String(value)); },
    removeItem: (key) => { data.delete(key); }
  };
}

test("reads and writes through the wrapper when storage works", () => {
  const store = makeStore();
  withWindow({ localStorage: store }, () => {
    assert.equal(readLocal("missing"), null);
    assert.deepEqual(writeLocal("k", "v"), { ok: true, reason: "" });
    assert.equal(readLocal("k"), "v");
    assert.equal(removeLocal("k"), true);
    assert.equal(readLocal("k"), null);
    assert.equal(storageAvailable(), true);
  });
});

test("a throwing localStorage getter degrades instead of crashing", () => {
  // Safari「阻止所有 Cookie」的表现：读属性就抛 SecurityError，
  // 连 `typeof localStorage` 都过不去。以前这里会让 loadState() 抛错，整页白屏。
  const hostile = {};
  Object.defineProperty(hostile, "localStorage", {
    get() { throw new DOMException("denied", "SecurityError"); },
    configurable: true
  });
  withWindow(hostile, () => {
    assert.equal(readLocal("k"), null);
    assert.deepEqual(writeLocal("k", "v"), { ok: false, reason: "disabled" });
    assert.equal(removeLocal("k"), true);
    assert.equal(storageAvailable(), false);
  });
});

test("a full quota reports quota, not disabled", () => {
  const store = makeStore();
  store.setItem = () => { const error = new Error("full"); error.name = "QuotaExceededError"; throw error; };
  withWindow({ localStorage: store }, () => {
    assert.deepEqual(writeLocal("k", "v"), { ok: false, reason: "quota" });
  });
  // Firefox 用的是另一个错误名，同样算配额。
  const firefox = makeStore();
  firefox.setItem = () => { const error = new Error("full"); error.name = "NS_ERROR_DOM_QUOTA_REACHED"; throw error; };
  withWindow({ localStorage: firefox }, () => {
    assert.deepEqual(writeLocal("k", "v"), { ok: false, reason: "quota" });
  });
});

test("an unknown write failure falls back to probing whether storage works at all", () => {
  const disabled = makeStore();
  disabled.setItem = () => { throw new Error("mystery"); };
  disabled.removeItem = () => { throw new Error("mystery"); };
  withWindow({ localStorage: disabled }, () => {
    assert.equal(writeLocal("k", "v").reason, "disabled");
  });

  // 能写探针键、只是这条数据写不进去 —— 说明是容量问题。
  let firstWrite = true;
  const mostly = makeStore();
  const originalSet = mostly.setItem;
  mostly.setItem = (key, value) => {
    if (firstWrite) { firstWrite = false; throw new Error("mystery"); }
    originalSet(key, value);
  };
  withWindow({ localStorage: mostly }, () => {
    assert.equal(writeLocal("k", "v").reason, "quota");
  });
});

test("no window at all stays silent", () => {
  withWindow(undefined, () => {
    assert.equal(readLocal("k"), null);
    assert.equal(writeLocal("k", "v").ok, false);
    assert.equal(removeLocal("k"), true);
  });
});
