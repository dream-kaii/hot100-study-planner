import test from "node:test";
import assert from "node:assert/strict";
import { MAX_BODY_BYTES, validateRunnerRequest } from "../src/server/local-runner.mjs";

test("validates local runner content type, size and request shape", () => {
  const valid = validateRunnerRequest({ headers: { "content-type": "application/json" }, body: { language: "python", mode: "acm", code: "print(1)" } });
  assert.equal(valid.ok, true);
  assert.equal(validateRunnerRequest({ headers: { "content-type": "text/plain" }, body: {} }).status, 415);
  assert.equal(validateRunnerRequest({ headers: { "content-type": "application/json" }, body: { language: "ruby", mode: "acm" } }).status, 400);
  assert.equal(validateRunnerRequest({ headers: { "content-type": "application/json", "content-length": String(MAX_BODY_BYTES + 1) }, body: {} }).status, 413);
});

test("requires a loopback client address when validating an HTTP request", () => {
  assert.equal(validateRunnerRequest({ remoteAddress: "10.0.0.2", headers: { "content-type": "application/json" }, body: { language: "python", mode: "acm", code: "print(1)" } }).status, 403);
  assert.equal(validateRunnerRequest({ remoteAddress: "127.0.0.1", headers: { "content-type": "application/json" }, body: { language: "python", mode: "acm", code: "print(1)" } }).ok, true);
});
