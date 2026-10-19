// src/online/client.js
// 浏览器侧的隧道客户端。
//
// 它只在"线上构建 + 用户点了运行"时才会被动态 import，
// 因此不影响首页体积，也不影响本地 dev（本地走 /__runner 原路）。
//
// 对外只暴露一个函数：requestRun(payload) → Promise<runExample 结果>

const PAIR_KEY = "hot100:onlineRunner";
/** 单次判题的客户端超时。服务端 runExample 自身有 3s/10s 超时，这里留 2 倍余量。 */
const RUN_TIMEOUT_MS = 60 * 1000;
/**
 * 等 runner 连上隧道的上限。
 * 用户从看到配对码到真的把 runner 跑起来，中间要下载文件、配代理、输码，
 * 2 分钟经常不够（实测就踩过）。放长到 10 分钟，超时后仍可用面板上的按钮重试。
 */
const PAIR_WAIT_MS = 10 * 60 * 1000;

function readSaved() {
  try {
    const raw = localStorage.getItem(PAIR_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeSaved(value) {
  try {
    localStorage.setItem(PAIR_KEY, JSON.stringify(value));
  } catch {
    /* 隐私模式下 localStorage 不可写，忽略即可，每次重新配对 */
  }
}

async function postJson(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {})
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `请求失败（${response.status}）`);
    error.status = response.status;
    throw error;
  }
  return data;
}

/**
 * 打开一条到 Session DO 的 WebSocket。
 * role=browser 侧不需要带 token，靠 sid 标识身份（sid 只有本浏览器知道）。
 */
function openSocket(sid) {
  const scheme = location.protocol === "https:" ? "wss:" : "ws:";
  const url = `${scheme}//${location.host}/ws?sid=${encodeURIComponent(sid)}&role=browser`;
  return new WebSocket(url);
}

/**
 * 主入口：跑一次判题。
 * 流程：
 *   1. 有 sid 就直接连；连不上（DO 已回收）就重新配对
 *   2. 没 sid 就申请配对码，把码交给用户，等 runner 连上
 *   3. 连上后发 run 帧，等 done 帧
 *
 * onPairCode(code) 会在需要用户动手时被调用，参数是 6 位码。
 */
export async function requestRun(payload, { onPairCode, onRunnerOffline, signal, resumeWindowMs } = {}) {
  const saved = readSaved();

  // 候选会话：当前 + 曾经用过的。
  // 为什么要有"曾经用过的"：网页在 runner 没开的时候刷新过，就会自己开一个新会话
  // 并显示配对码；而本机 runner 认的还是旧会话。两边各连各的，网页永远等到"等待中"。
  // 把旧 sid 一起轮询，谁有 runner 就用谁，这种错位能自己长回来。
  const candidates = [];
  if (saved?.sid) candidates.push(saved.sid);
  for (const sid of saved?.previous || []) {
    if (sid && !candidates.includes(sid)) candidates.push(sid);
  }

  const usable = [];
  for (const sid of candidates) {
    const status = await fetchStatus(sid).catch(() => null);
    // 没配过对（paired=false）说明这个 sid 是新建的、或者服务端已经回收了它的凭据，
    // 等下去也不会有 runner 来，直接跳过。
    if (status?.paired) usable.push({ sid, online: Boolean(status.runnerOnline) });
  }

  if (usable.length) {
    const alreadyOnline = usable.find((item) => item.online);
    if (!alreadyOnline) onRunnerOffline?.({ sids: usable.map((item) => item.sid) });
    const sid = alreadyOnline?.sid || (await waitForAnyRunner(usable.map((item) => item.sid), { signal, windowMs: resumeWindowMs }));
    if (sid !== saved?.sid) writeSaved({ sid, previous: [], pairedAt: saved?.pairedAt || Date.now() });
    return runOverSocket(sid, payload, { signal });
  }

  // 一个可用的都没有 → 真的需要重新配对
  const { sid, code } = await postJson("/api/pair");
  const previous = [saved?.sid, ...(saved?.previous || [])].filter(Boolean).slice(0, 3);
  writeSaved({ sid, previous, pairedAt: Date.now() });
  onPairCode?.(code);
  await waitForRunner(sid, { signal });
  return runOverSocket(sid, payload, { signal });
}

async function fetchStatus(sid) {
  const response = await fetch(`/api/status/${sid}`, { cache: "no-store" });
  if (!response.ok) return null;
  return response.json().catch(() => null);
}

/** 在多个候选会话里等，谁先连上 runner 就用谁。 */
async function waitForAnyRunner(sids, { signal, windowMs = PAIR_WAIT_MS } = {}) {
  const deadline = Date.now() + (Number.isFinite(windowMs) && windowMs >= 0 ? windowMs : PAIR_WAIT_MS);
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new DOMException("已取消", "AbortError");
    for (const sid of sids) {
      const status = await fetchStatus(sid).catch(() => null);
      if (status?.paired && status.runnerOnline) return sid;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("运行助手还没有连上。确认它正在运行（双击「Hot 100 运行助手」，或执行 node ~/.hot100-runner/hot100-runner.mjs --launch），连上后会自动继续。");
}

/** 轮询状态直到 runner 上线。超时给出可操作提示。 */
async function waitForRunner(sid, { signal } = {}) {
  const deadline = Date.now() + PAIR_WAIT_MS;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new DOMException("已取消", "AbortError");
    const response = await fetch(`/api/status/${sid}`, { cache: "no-store" });
    if (response.ok) {
      const status = await response.json();
      if (status.runnerOnline) return status;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("等了很久仍没连上。如果运行助手已经显示「已连上隧道」，点下面的「我连上了，重新运行」；否则确认窗口还开着。");
}

function runOverSocket(sid, payload, { signal } = {}) {
  return new Promise((resolve, reject) => {
    const socket = openSocket(sid);
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket.close(1000, "done"); } catch { /* 已关 */ }
      fn(value);
    };
    const timer = setTimeout(() => finish(reject, new Error("判题超时，请确认本机运行助手还在运行")), RUN_TIMEOUT_MS);

    signal?.addEventListener("abort", () => finish(reject, new DOMException("已取消", "AbortError")));

    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ v: 1, t: "run", id: "web-1", payload }));
    });

    socket.addEventListener("message", (event) => {
      let frame;
      try {
        frame = JSON.parse(event.data);
      } catch {
        return;
      }
      if (frame.t === "done") finish(resolve, frame.payload);
      else if (frame.t === "error") {
        const error = new Error(frame.payload?.message || "运行器返回错误");
        error.code = frame.payload?.code;
        finish(reject, error);
      } else if (frame.t === "ping") {
        socket.send(JSON.stringify({ v: 1, t: "pong", payload: frame.payload ?? null }));
      }
    });

    socket.addEventListener("error", () => finish(reject, new Error("连接本机运行助手失败")));
    socket.addEventListener("close", (event) => {
      if (!settled) finish(reject, new Error(`连接被关闭（${event.code}）`));
    });
  });
}

/** 撤销配对：用户换电脑或助手重装时用。 */
export function forgetPairing() {
  try { localStorage.removeItem(PAIR_KEY); } catch { /* 忽略 */ }
}
