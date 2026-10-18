// Session Durable Object 的转发与休眠恢复测试。
//
// 重点覆盖一个真实缺陷：Hibernation 休眠后实例字段会被清空，
// 如果转发逻辑依赖内存里的 peer 引用，就会表现为"两边都连着却报 PEER_OFFLINE"。
// 这里的测试会在同一个 storage 上新建一个实例，模拟"休眠后被重新唤醒"。

import test from "node:test";
import assert from "node:assert/strict";

import { Session } from "../src/online/session.js";

function makeState() {
  const mem = new Map();
  const sockets = [];
  return {
    storage: {
      async get(key) {
        if (Array.isArray(key)) return key.map((k) => mem.get(k));
        return mem.get(key);
      },
      async put(pairs) { for (const [k, v] of Object.entries(pairs)) mem.set(k, v); },
      async delete(keys) { for (const k of Array.isArray(keys) ? keys : [keys]) mem.delete(k); },
      async setAlarm() {},
      async list() { return new Map(mem); }
    },
    acceptWebSocket(ws, tags) { ws._tags = tags; sockets.push(ws); },
    getWebSockets(tag) {
      const alive = sockets.filter((s) => s.readyState !== 3);
      return tag ? alive.filter((s) => (s._tags || []).includes(tag)) : alive;
    },
    getTags(ws) { return ws._tags || []; },
    _mem: mem,
    _sockets: sockets
  };
}

/** 假 WebSocketPair：pair[0] 给客户端，pair[1] 给 DO。 */
class FakePair {
  constructor() {
    const mk = () => ({
      readyState: 1,
      _recv: [],
      send(msg) { if (this._peer) this._peer._recv.push(msg); },
      close() { this.readyState = 3; }
    });
    const client = mk();
    const server = mk();
    client._peer = server;
    server._peer = client;
    this[0] = client;
    this[1] = server;
  }
}

function installGlobals() {
  const realResponse = globalThis.Response;
  // workerd 允许 101，Node 的 Response 不允许；这里把 101 映射成 200 以便测试跑在 Node 上。
  globalThis.Response = class extends realResponse {
    constructor(body, init) {
      const next = init && init.status === 101 ? { ...init, status: 200 } : init;
      super(body, next);
      this._ws = init?.webSocket;
      this._hs = init?.headers;
    }
  };
  globalThis.WebSocketPair = FakePair;
  return () => { globalThis.Response = realResponse; delete globalThis.WebSocketPair; };
}

async function pairAndConnect(state) {
  const session = new Session(state, {});
  const paired = await session.handlePair(new Request("https://x/pair", {
    method: "POST",
    headers: { "x-hot100-sid": "d".repeat(32) }
  }));
  const { code } = await paired.json();

  const server = new Session(state, {});
  const runnerRes = await server.handleWebSocket(new Request(`https://x/ws?role=runner&token=pair:${code}`, {
    headers: { Upgrade: "websocket" }
  }));
  const browserRes = await server.handleWebSocket(new Request(`https://x/ws?role=browser`, {
    headers: { Upgrade: "websocket" }
  }));
  // 配对成功时服务端会推一帧 hello（带 token/sid），清掉它，让后续断言只看到业务帧。
  await new Promise((r) => setTimeout(r, 5));
  runnerRes._ws._recv.length = 0;
  browserRes._ws._recv.length = 0;
  return { code, session, server, runnerClient: runnerRes._ws, browserClient: browserRes._ws };
}

test("配对后网页发的 run 帧能转发到 runner，runner 的结果也能回到网页", async () => {
  const restore = installGlobals();
  try {
    const state = makeState();
    const { server, runnerClient, browserClient } = await pairAndConnect(state);
    const runner = state.getWebSockets("runner")[0];
    const browser = state.getWebSockets("browser")[0];

    await server.webSocketMessage(browser, JSON.stringify({ v: 1, t: "run", id: "r1", payload: { code: "x" } }));
    assert.equal(runnerClient._recv.length, 1, "runner 应收到转发的 run 帧");

    await server.webSocketMessage(runner, JSON.stringify({ v: 1, t: "done", id: "r1", payload: { status: "passed" } }));
    assert.equal(browserClient._recv.length, 1, "网页应收到 runner 的结果");
    assert.match(browserClient._recv[0], /passed/);
  } finally {
    restore();
  }
});

test("休眠后被重新唤醒（新实例、同 storage）仍然能正确转发", async () => {
  const restore = installGlobals();
  try {
    const state = makeState();
    const { runnerClient, browserClient } = await pairAndConnect(state);

    // 模拟 hibernation：丢弃旧实例，用新实例处理消息。
    const revived = new Session(state, {});
    const runner = state.getWebSockets("runner")[0];
    const browser = state.getWebSockets("browser")[0];

    await revived.webSocketMessage(browser, JSON.stringify({ v: 1, t: "run", id: "r2", payload: { code: "y" } }));
    assert.equal(runnerClient._recv.length, 1, "唤醒后仍应能转发到 runner");

    await revived.webSocketMessage(runner, JSON.stringify({ v: 1, t: "done", id: "r2", payload: { status: "passed" } }));
    assert.equal(browserClient._recv.length, 1, "唤醒后仍应能把结果转回网页");
  } finally {
    restore();
  }
});

test("对端不在线时回 PEER_OFFLINE，而不是静默丢弃", async () => {
  const restore = installGlobals();
  try {
    const state = makeState();
    const { browserClient } = await pairAndConnect(state);
    const revived = new Session(state, {});
    // 把 runner 摘掉
    state.getWebSockets("runner")[0].readyState = 3;
    const browser = state.getWebSockets("browser")[0];

    await revived.webSocketMessage(browser, JSON.stringify({ v: 1, t: "run", id: "r3", payload: {} }));
    assert.equal(browserClient._recv.length, 1);
    assert.match(browserClient._recv[0], /PEER_OFFLINE/);
  } finally {
    restore();
  }
});

test("状态查询用真实连接判断在线，不依赖内存字段", async () => {
  const restore = installGlobals();
  try {
    const state = makeState();
    await pairAndConnect(state);
    const revived = new Session(state, {});
    const status = await (await revived.handleStatus()).json();
    assert.equal(status.runnerOnline, true);

    state.getWebSockets("runner")[0].readyState = 3;
    const after = await (await new Session(state, {}).handleStatus()).json();
    assert.equal(after.runnerOnline, false);
  } finally {
    restore();
  }
});
