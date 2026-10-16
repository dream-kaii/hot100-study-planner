import { runExample, SUPPORTED_LANGUAGES, SUPPORTED_MODES } from "../services/runner.js";

export const MAX_BODY_BYTES = 256 * 1024;

export function validateRunnerRequest({ headers = {}, body = {}, remoteAddress } = {}) {
  if (remoteAddress && !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(remoteAddress)) return { ok: false, status: 403, error: "本地运行器只接受回环地址请求" };
  const contentType = String(headers["content-type"] || "").split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") return { ok: false, status: 415, error: "运行请求必须使用 application/json" };
  const contentLength = Number(headers["content-length"] || 0);
  if (contentLength > MAX_BODY_BYTES) return { ok: false, status: 413, error: "运行请求超过 256KB 限制" };
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, status: 400, error: "运行请求必须是 JSON 对象" };
  if (!SUPPORTED_LANGUAGES.includes(body.language) || !SUPPORTED_MODES.includes(body.mode || "acm")) return { ok: false, status: 400, error: "language 或 mode 不受支持" };
  if (typeof body.code !== "string" || body.code.length > MAX_BODY_BYTES) return { ok: false, status: 413, error: "代码为空或超过 256KB 限制" };
  return { ok: true };
}

function isLoopback(request) {
  const address = request.socket?.remoteAddress;
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let body = "";
    request.on("data", (chunk) => {
      size += Buffer.byteLength(chunk);
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("运行请求超过 256KB 限制"), { status: 413 }));
        request.destroy();
        return;
      }
      body += chunk;
    });
    request.on("end", () => {
      try { resolve(JSON.parse(body || "{}")); } catch { reject(Object.assign(new Error("请求不是有效 JSON"), { status: 400 })); }
    });
    request.on("error", reject);
  });
}

function sendJson(response, status, payload) {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

export function localRunner() {
  return {
    name: "hot100-local-runner",
    configureServer(server) {
      server.middlewares.use("/__runner", async (request, response) => {
        if (!isLoopback(request)) { sendJson(response, 403, { status: "error", error: "本地运行器只接受回环地址请求" }); return; }
        if (request.method !== "POST") { sendJson(response, 405, { status: "error", error: "只支持 POST" }); return; }
        const contentType = String(request.headers["content-type"] || "").split(";", 1)[0].trim().toLowerCase();
        const contentLength = Number(request.headers["content-length"] || 0);
        if (contentType !== "application/json") { sendJson(response, 415, { status: "error", error: "运行请求必须使用 application/json" }); return; }
        if (contentLength > MAX_BODY_BYTES) { sendJson(response, 413, { status: "error", error: "运行请求超过 256KB 限制" }); return; }
        try {
          const body = await readJsonBody(request);
          const validation = validateRunnerRequest({ headers: request.headers, body, remoteAddress: request.socket?.remoteAddress });
          if (!validation.ok) { sendJson(response, validation.status, { status: "error", error: validation.error }); return; }
          sendJson(response, 200, await runExample(body));
        } catch (error) {
          sendJson(response, error.status || 400, { status: "error", output: "", error: error.message || "运行请求失败" });
        }
      });
    }
  };
}
