// src/services/device.js
// 「同一台设备」级别的设置，而不是「这个浏览器」级别。
//
// localStorage 属于某一个浏览器：换浏览器、无痕窗口、清过数据都是全新的空壳。
// 想让它们认回同一份状态，唯一可靠的办法是问本机——浏览器和运行助手在同一台电脑上。
//
// 主通道：http://127.0.0.1:17890（运行助手开的小接口，只绑回环地址）
// 备用通道：Worker 上按公网出口 IP 记的设备线索（走代理时可能对不上，所以只当兜底）
//
// 所有函数都是"有就用、没有就算了"：没装助手、端口被占、浏览器拦了本机请求，
// 都安静返回 null，调用方退回配对码流程，不会卡住。

/** 运行助手的本机接口端口，和 runner/localapi.mjs 里的 LOCAL_API_PORT 必须一致。 */
const LOCAL_API = "http://127.0.0.1:17890";
const LOCAL_TIMEOUT_MS = 1500;

function withTimeout(ms) {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(ms);
  }
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

async function localRequest(pathname, init = {}) {
  const response = await fetch(`${LOCAL_API}${pathname}`, {
    ...init,
    cache: "no-store",
    signal: withTimeout(LOCAL_TIMEOUT_MS)
  });
  if (!response.ok) throw new Error(`本机接口返回 ${response.status}`);
  return response.json();
}

/** 找回这台设备已经配过对的 runner 会话。没有就返回 null。 */
export async function adoptSession() {
  // 1. 问本机。跟出口 IP、代理、换浏览器都无关，最稳。
  try {
    const local = await localRequest("/device");
    if (typeof local?.sid === "string" && local.sid) return { sid: local.sid, source: "local" };
  } catch {
    /* 没装新版助手，或浏览器拦了本机请求 —— 继续走备用通道 */
  }

  // 2. 备用：服务端按公网出口 IP 记的那条线索。
  try {
    const response = await fetch("/api/adopt", { method: "POST" });
    if (!response.ok) return null;
    const data = await response.json();
    return typeof data?.sid === "string" && data.sid ? data : null;
  } catch {
    return null;
  }
}

/** 读这台设备上次选的备份文件夹名。 */
export async function fetchDeviceBackup() {
  try {
    const local = await localRequest("/device/settings");
    if (typeof local?.backupName === "string" && local.backupName) return { name: local.backupName };
  } catch {
    /* 同上，退回服务端 */
  }
  try {
    const response = await fetch("/api/device/backup", { cache: "no-store" });
    if (!response.ok) return null;
    const data = await response.json();
    return typeof data?.name === "string" && data.name ? data : null;
  } catch {
    return null;
  }
}

/** 记下这台设备选的备份文件夹名（只存名字，浏览器拿不到完整路径）。 */
export async function saveDeviceBackup(name) {
  const trimmed = String(name || "").trim();
  if (!trimmed) return false;

  let saved = false;
  try {
    await localRequest("/device/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ backupName: trimmed })
    });
    saved = true;
  } catch {
    /* 本机接口不可用时靠下面服务端那份兜底 */
  }

  try {
    const response = await fetch("/api/device/backup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: trimmed })
    });
    saved = saved || response.ok;
  } catch {
    /* 离线场景忽略 */
  }
  return saved;
}
