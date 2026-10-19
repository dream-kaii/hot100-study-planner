// runner/localapi.mjs
// 一个只监听回环地址的极小 HTTP 接口，专门给同机的网页用。
//
// 为什么需要它：
//   localStorage 属于某一个浏览器，换浏览器 / 无痕窗口 / 清过数据都是全新的空壳，
//   于是网页会以为自己"没配对过"，又生成一个新配对码，而 runner 认的还是旧会话。
//   想自动认回同一台设备，唯一可靠的信号是本机——网页和 runner 在同一台机器上，
//   而浏览器又能合法地访问 http://127.0.0.1（回环地址属于"可信来源"，https 页面也能请求它）。
//
// 安全性：
//   1. 只绑 127.0.0.1，外部网络连不进来（退出时 unref，不阻止进程结束）。
//   2. 只对白名单 Origin 返回 Access-Control-Allow-Origin。
//      别的网站照样能发请求，但读不到响应，因此拿不到 sid。
//   3. 校验 Host 头必须是 127.0.0.1 / localhost，防 DNS rebinding
//      （把 evil.com 解析到 127.0.0.1 之后，Origin 仍是 evil.com，会被第 2 条挡住）。
//   4. 返回的只有 sid 和设置项，不含 token——sid 只能用来"加入这个会话"，不能重配对。

import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";

import { credentialsDir } from "./pair.mjs";

/** 固定端口：网页只认这一个，改端口就得两边同时改。 */
export const LOCAL_API_PORT = 17890;
const MAX_BODY_BYTES = 4096;

export function settingsPath() {
  return path.join(credentialsDir(), "settings.json");
}

async function readSettings() {
  try {
    const text = await fs.readFile(settingsPath(), "utf8");
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function writeSettings(next) {
  const dir = credentialsDir();
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  await fs.writeFile(settingsPath(), `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
}

/** 允许的网页来源：隧道对应的站点 + 本地开发服务器。 */
export function allowedOrigins(endpoint) {
  const set = new Set();
  try {
    const url = new URL(endpoint);
    const scheme = url.protocol === "wss:" ? "https:" : "http:";
    set.add(`${scheme}//${url.host}`);
  } catch {
    /* endpoint 不可解析就只留本地开发来源 */
  }
  for (const host of ["127.0.0.1", "localhost"]) {
    for (const port of ["5173", "4173"]) set.add(`http://${host}:${port}`);
  }
  return set;
}

function send(res, status, payload, cors) {
  const body = payload === undefined ? "" : JSON.stringify(payload);
  res.writeHead(status, { ...cors, "content-type": "application/json; charset=utf-8" });
  res.end(body);
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("请求体过大");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  return parsed && typeof parsed === "object" ? parsed : {};
}

/**
 * 启动本机接口。
 * @param {object} options
 * @param {string} options.endpoint 隧道地址，用来推导允许的网页来源
 * @param {() => {sid?: string}} options.getSession 取当前会话（配对完成后才变成新的）
 * @param {(level: string, message: string) => void} [options.log]
 * @returns {import("node:http").Server}
 */
export function startLocalApi({ endpoint, getSession, version = "", log = () => {} }) {
  const origins = allowedOrigins(endpoint);

  const server = http.createServer(async (req, res) => {
    const origin = String(req.headers.origin || "");
    const allowOrigin = origins.has(origin) ? origin : "";
    const cors = {
      "cache-control": "no-store",
      vary: "origin",
      "access-control-allow-origin": allowOrigin,
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "content-type",
      // Chrome 对"公网页面访问本机端口"要多一次预检确认，不回这个头会被直接拦掉。
      "access-control-allow-private-network": "true",
      "access-control-max-age": "600"
    };

    // 防 DNS rebinding：只接受直连回环地址的 Host。
    const host = String(req.headers.host || "").replace(/:\d+$/, "");
    if (host !== "127.0.0.1" && host !== "localhost") {
      res.writeHead(403, { "cache-control": "no-store" });
      res.end();
      return;
    }

    if (req.method === "OPTIONS") {
      res.writeHead(allowOrigin ? 204 : 403, cors);
      res.end();
      return;
    }
    if (!allowOrigin) {
      res.writeHead(403, { "cache-control": "no-store" });
      res.end();
      return;
    }

    const url = new URL(req.url || "/", `http://${req.headers.host}`);

    try {
      if (url.pathname === "/device" && req.method === "GET") {
        const session = getSession() || {};
        send(res, 200, { sid: session.sid || "", version }, cors);
        return;
      }

      if (url.pathname === "/device/settings") {
        if (req.method === "GET") {
          send(res, 200, await readSettings(), cors);
          return;
        }
        if (req.method === "POST") {
          const body = await readJsonBody(req);
          const current = await readSettings();
          const name = String(body?.backupName || "").trim().slice(0, 120);
          const next = name ? { ...current, backupName: name } : current;
          await writeSettings(next);
          send(res, 200, next, cors);
          return;
        }
      }

      send(res, 404, { error: "未知路径" }, cors);
    } catch (error) {
      send(res, 400, { error: error.message || "请求无效" }, cors);
    }
  });

  server.on("error", (error) => {
    // 端口被占用不是致命问题：网页会退回配对码方式，功能仍然可用。
    log("warn", `本机接口监听 127.0.0.1:${LOCAL_API_PORT} 失败（${error.code || error.message}），浏览器将改用配对码`);
  });

  server.listen(LOCAL_API_PORT, "127.0.0.1", () => {
    log("info", `本机接口就绪：http://127.0.0.1:${LOCAL_API_PORT}/device`);
  });
  // 不因为多了一个监听而拖住进程退出。
  server.unref?.();

  return server;
}
