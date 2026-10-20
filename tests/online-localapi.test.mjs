// 本机回环接口：Safari 的"顶层跳转认领"通道。
// 关键是把 sid 锁死在站点地址上，不能让 next 参数把人带到外站。

import test from "node:test";
import assert from "node:assert/strict";

import { startLocalApi, allowedOrigins } from "../runner/localapi.mjs";

const endpoint = "wss://hot100.example.com/ws";
const session = { sid: "88c1ebf4e93fd2a8dbc3b62fca0148b6" };

function withServer(fn) {
  const server = startLocalApi({ endpoint, getSession: () => session, version: "test", port: 0 });
  const ready = new Promise((resolve, reject) => {
    server.once("listening", () => resolve(server.address().port));
    server.once("error", reject);
  });
  return ready.then(fn).finally(() => server.close());
}

test("/claim 把 sid 带在站点地址上回跳", async () => {
  await withServer(async (port) => {
    const res = await fetch(`http://127.0.0.1:${port}/claim?next=${encodeURIComponent("/?question=1")}`, { redirect: "manual" });
    assert.equal(res.status, 302);
    const location = new URL(res.headers.get("location"));
    assert.equal(location.origin, "https://hot100.example.com");
    assert.equal(location.pathname, "/");
    assert.equal(location.searchParams.get("question"), "1");
    assert.equal(location.searchParams.get("adopt"), session.sid);
  });
});

test("/claim 拒绝把 sid 送去外站", async () => {
  await withServer(async (port) => {
    for (const next of ["//evil.com/steal", "https://evil.com", "javascript:alert(1)"]) {
      const res = await fetch(`http://127.0.0.1:${port}/claim?next=${encodeURIComponent(next)}`, { redirect: "manual" });
      const location = new URL(res.headers.get("location"));
      assert.equal(location.origin, "https://hot100.example.com");
    }
  });
});

test("普通接口仍然只对白名单 Origin 放行", async () => {
  await withServer(async (port) => {
    assert.deepEqual([...allowedOrigins(endpoint)], [...allowedOrigins(endpoint)]);
    const blocked = await fetch(`http://127.0.0.1:${port}/device`);
    assert.equal(blocked.status, 403);
    const allowed = await fetch(`http://127.0.0.1:${port}/device`, { headers: { origin: "https://hot100.example.com" } });
    assert.equal(allowed.status, 200);
    assert.equal((await allowed.json()).sid, session.sid);
  });
});
