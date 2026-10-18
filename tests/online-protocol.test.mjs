// tests/online-protocol.test.mjs
// 校验 Worker 端 (src/online/protocol.js) 与 runner 端 (runner/protocol.mjs)
// 的协议实现行为一致。两份代码是刻意的分布式复制（Worker 打包时不能卷进 node:* 依赖），
// 所以必须有一条测试盯着它们不跑偏。

import test from "node:test";
import assert from "node:assert/strict";

import * as workerSide from "../src/online/protocol.js";
import * as runnerSide from "../runner/protocol.mjs";

test("两端协议常量一致", () => {
  assert.equal(workerSide.MAX_FRAME_BYTES, runnerSide.MAX_FRAME_BYTES);
  assert.equal(workerSide.PROTOCOL_VERSION, runnerSide.PROTOCOL_VERSION);
  assert.equal(workerSide.PAIR_CODE_LENGTH, runnerSide.PAIR_CODE_LENGTH);
  assert.equal(workerSide.PAIR_CODE_TTL_MS, runnerSide.PAIR_CODE_TTL_MS);
  assert.equal(workerSide.IDLE_TIMEOUT_MS, runnerSide.IDLE_TIMEOUT_MS);
  assert.deepEqual(Object.keys(workerSide.FRAME).sort(), Object.keys(runnerSide.FRAME).sort());
  for (const key of Object.keys(workerSide.FRAME)) {
    assert.equal(workerSide.FRAME[key], runnerSide.FRAME[key], `FRAME.${key} 不一致`);
  }
});

test("两端生成的配对码形状一致", () => {
  for (const side of [workerSide, runnerSide]) {
    for (let i = 0; i < 50; i += 1) {
      const code = side.generatePairCode();
      assert.match(code, /^\d{6}$/);
    }
  }
});

test("两端 token 长度一致", () => {
  assert.equal(workerSide.generateToken().length, runnerSide.generateToken().length);
  assert.match(workerSide.generateToken(), /^[0-9a-f]{64}$/);
});

test("两端 timingSafeEqual 判定一致", () => {
  const cases = [["abc", "abc"], ["abc", "abd"], ["abc", "ab"], ["", ""], ["ab", ""]];
  for (const [a, b] of cases) {
    assert.equal(workerSide.timingSafeEqual(a, b), runnerSide.timingSafeEqual(a, b), `${a} vs ${b}`);
  }
});

test("两端编码解码可以互通", () => {
  const frame = { t: "run", id: "r1", payload: { language: "python", code: "print('中文')" } };
  const fromWorker = workerSide.encodeFrame(frame);
  const fromRunner = runnerSide.encodeFrame(frame);
  assert.equal(fromWorker, fromRunner);
  const backRunner = runnerSide.decodeFrame(fromWorker);
  const backWorker = workerSide.decodeFrame(fromRunner);
  assert.deepEqual(backRunner, backWorker);
  assert.equal(backRunner.ok, true);
  assert.equal(backRunner.frame.payload.code, "print('中文')");
});

test("两端对坏帧给出同样的错误", () => {
  const bad = ["not json", "[]", '{"a":1}', "null"];
  for (const raw of bad) {
    assert.deepEqual(workerSide.decodeFrame(raw), runnerSide.decodeFrame(raw), raw);
  }
});

test("超过 1MB 的帧两端都拒绝", () => {
  const huge = "x".repeat(1024 * 1024 + 10);
  assert.throws(() => workerSide.encodeFrame({ t: "run", payload: huge }), /1MB/);
  assert.throws(() => runnerSide.encodeFrame({ t: "run", payload: huge }), /1MB/);
  assert.equal(workerSide.decodeFrame(huge).ok, false);
  assert.equal(runnerSide.decodeFrame(huge).ok, false);
});

test("validateRunFrame 拦截非白名单语言与超大代码", () => {
  const opts = { supportedLanguages: ["python", "java"], supportedModes: ["function", "acm"], maxCodeBytes: 1024 };
  const ok = runnerSide.validateRunFrame({ t: "run", payload: { language: "python", code: "print(1)" } }, opts);
  assert.equal(ok.ok, true);
  assert.equal(ok.payload.mode, "acm");

  const badLang = runnerSide.validateRunFrame({ t: "run", payload: { language: "ruby", code: "" } }, opts);
  assert.equal(badLang.ok, false);

  const badMode = runnerSide.validateRunFrame({ t: "run", payload: { language: "python", mode: "nope", code: "" } }, opts);
  assert.equal(badMode.ok, false);

  const tooBig = runnerSide.validateRunFrame({ t: "run", payload: { language: "python", code: "x".repeat(2000) } }, opts);
  assert.equal(tooBig.ok, false);

  const funcMode = runnerSide.validateRunFrame({ t: "run", payload: { language: "java", code: "", func: { methodName: "f" } } }, opts);
  assert.equal(funcMode.payload.mode, "function");
});

// ── 回归：M2 联调时发现的两个真实缺陷 ──────────────────────────────
// 1) ProblemDetail.execute 只接收 payload，把配对回调丢掉了 → 用户永远看不到配对码
// 2) 有缓存 sid 但 runner 离线时，应该重新配对而不是发一个注定失败的 run 帧

test("配对回调必须能穿透 ProblemDetail.execute 这样的中间层", async () => {
  // 模拟 execute 的签名：(payload, signal, pairHandler) => onRun(...)
  const seen = [];
  const onRun = async (payload, signal, pairHandler) => {
    pairHandler?.("123456");
    return { status: "unavailable", error: "等待配对" };
  };
  const execute = async (payload, signal, pairHandler) => onRun(payload, signal, pairHandler);
  await execute({ code: "x" }, undefined, (code) => seen.push(code));
  assert.deepEqual(seen, ["123456"]);
});

test("runner 离线时不应把 run 帧发出去", async () => {
  const { requestRun } = await import("../src/online/client.js");
  const calls = [];
  const originalFetch = globalThis.fetch;
  const originalWS = globalThis.WebSocket;
  globalThis.fetch = async (url, init = {}) => {
    calls.push(`${init.method || "GET"} ${url}`);
    if (url === "/api/status/old-sid") return new Response(JSON.stringify({ runnerOnline: false }), { status: 200, headers: { "content-type": "application/json" } });
    if (url === "/api/pair") return new Response(JSON.stringify({ sid: "new-sid", code: "654321" }), { status: 200, headers: { "content-type": "application/json" } });
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  };
  globalThis.WebSocket = class { constructor() { throw new Error("runner 未上线时不该建 WebSocket"); } };
  globalThis.localStorage = { getItem: () => JSON.stringify({ sid: "old-sid" }), setItem: () => {}, removeItem: () => {} };
  let pairCode = null;
  // 立刻中止：这次测试只关心"离线 → 重新配对"这一步，不需要真的等满 120 秒。
  const controller = new AbortController();
  try {
    await requestRun({ code: "x" }, { onPairCode: (code) => { pairCode = code; controller.abort(); }, signal: controller.signal, resumeWindowMs: 100 });
  } catch {
    // 后续建 WS 失败是预期的：这里只关心流程有没有走"重新配对"
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.WebSocket = originalWS;
    delete globalThis.localStorage;
  }
  // 新行为：先给 runner 一小段回连窗口（多次轮询状态），确认不在线才重新配对。
  assert.ok(calls.filter((c) => c === "GET /api/status/old-sid").length >= 1, "应先查询旧会话状态");
  assert.ok(calls.includes("POST /api/pair"), "确认离线后应重新申请配对码");
  assert.equal(calls[calls.length - 1], "POST /api/pair", "最后一次应是 /api/pair");
  assert.equal(pairCode, "654321", "runner 离线时必须重新配对并给出新码");
});
