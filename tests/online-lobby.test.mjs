// 配对码索引（Lobby）与 runner 连接地址构造的测试。
// 这两处是 M3 打通的骨架：runner 只有 6 位配对码，必须靠 Lobby 换成 sid 才能连上。

import test from "node:test";
import assert from "node:assert/strict";

import { Lobby } from "../src/online/lobby.js";
import { Tunnel } from "../runner/session.mjs";

/** 最小可用的 DurableObjectState 替身。 */
function makeState() {
  const mem = new Map();
  let alarmAt = 0;
  return {
    storage: {
      async get(key) {
        if (Array.isArray(key)) return key.map((k) => mem.get(k));
        return mem.get(key);
      },
      async put(pairs) {
        for (const [k, v] of Object.entries(pairs)) mem.set(k, v);
      },
      async delete(keys) {
        for (const k of Array.isArray(keys) ? keys : [keys]) mem.delete(k);
      },
      async list({ prefix } = {}) {
        return new Map([...mem].filter(([k]) => !prefix || k.startsWith(prefix)));
      },
      async setAlarm(ts) { alarmAt = ts; }
    },
    _mem: mem,
    _alarm: () => alarmAt
  };
}

async function register(state, code, sid) {
  const lobby = new Lobby(state, {});
  return lobby.fetch(new Request("https://lobby/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, sid })
  }));
}

async function lookup(state, code) {
  const lobby = new Lobby(state, {});
  const response = await lobby.fetch(new Request(`https://lobby/lookup?code=${code}`));
  return { status: response.status, body: await response.json() };
}

test("登记后能用配对码换回 sid", async () => {
  const state = makeState();
  const sid = "a".repeat(32);
  const reg = await register(state, "123456", sid);
  assert.equal(reg.status, 200);

  const found = await lookup(state, "123456");
  assert.equal(found.status, 200);
  assert.equal(found.body.sid, sid);
});

test("未登记的配对码返回 404", async () => {
  const state = makeState();
  const found = await lookup(state, "000000");
  assert.equal(found.status, 404);
  assert.match(found.body.error, /不存在或已过期/);
});

test("配对码格式非法直接拒绝", async () => {
  const state = makeState();
  const bad = await lookup(state, "12ab56");
  assert.equal(bad.status, 400);

  const badSid = await register(state, "123456", "short");
  assert.equal(badSid.status, 400);
});

test("过期条目查不到，并且会被 alarm 清掉", async () => {
  const state = makeState();
  const sid = "b".repeat(32);
  await register(state, "222222", sid);
  // 手动把过期时间拨到过去
  state._mem.set("c:222222", { sid, expireAt: Date.now() - 1000 });

  const found = await lookup(state, "222222");
  assert.equal(found.status, 404);

  const lobby = new Lobby(state, {});
  await lobby.alarm();
  assert.equal(state._mem.has("c:222222"), false, "过期条目应被 alarm 删除");
});

test("连续查不到会被限流，避免枚举 6 位码", async () => {
  const state = makeState();
  let lastStatus = 0;
  for (let i = 0; i < 35; i += 1) {
    const { status } = await lookup(state, String(100000 + i));
    lastStatus = status;
  }
  assert.equal(lastStatus, 429, "超过失败上限后应返回 429");
});

test("runner 只有配对码时，连接地址带 code 和 role", () => {
  const tunnel = new Tunnel({ url: "wss://example.test/ws", token: "", code: "654321", onRun: async () => ({}) });
  const url = new URL(tunnel.buildEndpoint());
  assert.equal(url.searchParams.get("code"), "654321");
  assert.equal(url.searchParams.get("role"), "runner");
  assert.equal(url.searchParams.get("sid"), null);
  assert.equal(url.searchParams.get("token"), null);
});

test("runner 有 token 时，连接地址带 sid 和 token，不带 code", () => {
  const tunnel = new Tunnel({
    url: "wss://example.test/ws",
    token: "deadbeef",
    sid: "c".repeat(32),
    onRun: async () => ({})
  });
  const url = new URL(tunnel.buildEndpoint());
  assert.equal(url.searchParams.get("sid"), "c".repeat(32));
  assert.equal(url.searchParams.get("token"), "deadbeef");
  assert.equal(url.searchParams.get("code"), null);
  assert.equal(url.searchParams.get("role"), "runner");
});

test("token 是 pair: 前缀时退化成用 code 连接", () => {
  const tunnel = new Tunnel({ url: "wss://example.test/ws", token: "pair:777777", onRun: async () => ({}) });
  const url = new URL(tunnel.buildEndpoint());
  assert.equal(url.searchParams.get("code"), "777777");
});

// ---- 设备身份：同一台设备换浏览器不用重新配对 ----

const IP = (ch) => ch.repeat(32);

test("runner 连上后，网页能按设备找回同一个会话", async () => {
  const state = makeState();
  const ip = IP("a");
  const sid = "s".repeat(32);
  const online = await new Lobby(state, {}).fetch(new Request("https://lobby/runner-online", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ip, sid })
  }));
  assert.equal(online.status, 200);

  const adopted = await new Lobby(state, {}).fetch(new Request(`https://lobby/adopt?ip=${ip}`, { method: "POST" }));
  assert.equal(adopted.status, 200);
  assert.equal((await adopted.json()).sid, sid);
});

test("没登记过的设备拿不到会话", async () => {
  const state = makeState();
  const res = await new Lobby(state, {}).fetch(new Request(`https://lobby/adopt?ip=${IP("b")}`, { method: "POST" }));
  assert.equal(res.status, 404);
  assert.match((await res.json()).error, /还没有配过对/);
});

test("设备指纹格式不对直接拒绝", async () => {
  const state = makeState();
  const res = await new Lobby(state, {}).fetch(new Request("https://lobby/adopt?ip=not-a-fingerprint", { method: "POST" }));
  assert.equal(res.status, 400);
});

test("备份文件夹名按设备记住，另一个浏览器也读得到", async () => {
  const state = makeState();
  const ip = IP("c");
  const saved = await new Lobby(state, {}).fetch(new Request("https://lobby/backup", {
    method: "POST",
    headers: { "content-type": "application/json", "x-hot100-device": ip },
    body: JSON.stringify({ name: "Hot100备份" })
  }));
  assert.equal(saved.status, 200);

  const read = await new Lobby(state, {}).fetch(new Request(`https://lobby/backup?ip=${ip}`));
  assert.equal(read.status, 200);
  assert.equal((await read.json()).name, "Hot100备份");
});

test("没设置过备份位置时返回空对象而不是报错", async () => {
  const state = makeState();
  const read = await new Lobby(state, {}).fetch(new Request(`https://lobby/backup?ip=${IP("d")}`));
  assert.equal(read.status, 200);
  assert.deepEqual(await read.json(), {});
});

test("清理过期条目时不会误删限流计数", async () => {
  const state = makeState();
  const lobby = new Lobby(state, {});
  await lobby.fetch(new Request("https://lobby/lookup?code=000000"));
  assert.ok(state._mem.has("lookupFails"));
  await lobby.alarm();
  assert.ok(state._mem.has("lookupFails"), "限流计数没有 expireAt，不该被当成过期条目删掉");
});
