import assert from "node:assert/strict";
import test from "node:test";

import { httpBase, parseVersion, downloadBundle } from "../runner/autoupdate.mjs";

test("httpBase 把 wss 隧道地址换成 https 站点根", () => {
  assert.equal(httpBase("wss://hot100.kaii.homes/ws"), "https://hot100.kaii.homes");
  assert.equal(httpBase("wss://example.workers.dev/ws"), "https://example.workers.dev");
  assert.equal(httpBase("ws://127.0.0.1:8787/ws"), "http://127.0.0.1:8787");
  assert.equal(httpBase("不是地址"), null);
});

test("parseVersion 只认 version 行", () => {
  assert.equal(parseVersion("version: abc123\nbuilt-at: x"), "abc123");
  assert.equal(parseVersion("built-at: 2026\nsize: 74 KB"), null);
  assert.equal(parseVersion(""), null);
});

test("downloadBundle 拒绝不像运行助手的产物", async () => {
  const okBody = "// Hot 100 本机运行助手\n" + "x".repeat(40 * 1024) + "\nversion: v9\n";
  const originalFetch = globalThis.fetch;
  const stub = (body) => async () => new Response(body, { status: 200 });

  try {
    globalThis.fetch = stub(okBody);
    const text = await downloadBundle("https://x.test", "v9");
    assert.match(text, /Hot 100 本机运行助手/);

    globalThis.fetch = stub("tiny");
    await assert.rejects(() => downloadBundle("https://x.test", "v9"), /过小/);

    globalThis.fetch = stub("y".repeat(40 * 1024));
    await assert.rejects(() => downloadBundle("https://x.test", "v9"), /缺少标识/);

    globalThis.fetch = stub("// Hot 100 本机运行助手\n" + "z".repeat(40 * 1024));
    await assert.rejects(() => downloadBundle("https://x.test", "v9"), /版本号对不上/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
