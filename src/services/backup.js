import { mergeState, parseState, serializeState, STATE_VERSION } from "./storage.js";

const DB_NAME = "hot100-study-planner";
const STORE_NAME = "settings";
const HANDLE_KEY = "backup-directory";
const FILE_NAME = "hot100-backup.json";
let memoryHandle;

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveHandle(handle) {
  memoryHandle = handle;
  const db = await openDb();
  if (!db) return;
  await new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).put(handle, HANDLE_KEY);
    request.onsuccess = resolve;
    request.onerror = () => reject(request.error);
  });
}

export async function requestBackupDirectory() {
  if (typeof window === "undefined" || typeof window.showDirectoryPicker !== "function") {
    throw new Error("当前浏览器不支持文件夹备份，请使用最新版 Chrome 或 Edge。");
  }
  const handle = await window.showDirectoryPicker({ mode: "readwrite" });
  await saveHandle(handle);
  return handle;
}

/** 从 IndexedDB 里取回句柄（不检查权限）。 */
async function loadHandle() {
  if (memoryHandle) return memoryHandle;
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(HANDLE_KEY);
    request.onsuccess = () => { memoryHandle = request.result || null; resolve(memoryHandle); };
    request.onerror = () => resolve(null);
  });
}

/**
 * 句柄存进 IndexedDB 之后，权限并不跟着走。
 * 浏览器重启、清过站点数据、隔得太久，句柄还在但权限已过期，
 * 此时直接 getFileHandle() 会抛：
 *   NotAllowedError: The request is not allowed by the user agent or the platform in the current context.
 * 所以每次用之前先查、必要时请求一次（requestPermission 只能在用户点击的调用栈里生效）。
 */
async function ensurePermission(handle, mode = "readwrite", allowRequest = true) {
  if (!handle) return false;
  try {
    if (typeof handle.queryPermission === "function") {
      if ((await handle.queryPermission({ mode })) === "granted") return true;
    } else {
      return true;
    }
    if (!allowRequest || typeof handle.requestPermission !== "function") return false;
    return (await handle.requestPermission({ mode })) === "granted";
  } catch {
    return false;
  }
}

/** 有句柄、且当前上下文真的能写，才算"已设置"。 */
export async function hasBackupDirectory() {
  const handle = await loadHandle();
  if (!handle) return false;
  // 这里只查不问：挂载时没有用户手势，requestPermission 会被浏览器直接拒绝。
  return ensurePermission(handle, "readwrite", false);
}

/** 句柄在不在（不管权限）——用来区分"从没设过"和"设过但要重新确认"。 */
export async function hasBackupHandle() {
  return Boolean(await loadHandle());
}

export async function writeBackup(state) {
  const handle = await loadHandle();
  if (!handle) throw new Error("请先选择备份文件夹。");
  if (!(await ensurePermission(handle, "readwrite"))) {
    throw new Error("备份文件夹的授权已过期，请点「选择位置」重新选一次同一个文件夹。");
  }
  const file = await handle.getFileHandle(FILE_NAME, { create: true });
  const writable = await file.createWritable();
  await writable.write(serializeState({ ...state, backupAt: new Date().toISOString() }));
  await writable.close();
  return new Date().toISOString();
}

export async function readBackupFile(file) {
  const raw = await file.text();
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw new Error("备份文件格式无效"); }
  if (!parsed || typeof parsed !== "object" || !Number.isInteger(parsed.version)) throw new Error("备份文件格式无效");
  if (parsed.version > STATE_VERSION) throw new Error("备份文件版本不受支持");
  return parseState(parsed);
}

// 换浏览器后重新授权同一个文件夹时，把文件夹里已有的备份读回来，
// 才能真正做到"数据统一"——只恢复授权是不够的，数据还在各自的 localStorage 里。
export async function readBackupFromDirectory(directory) {
  const target = directory || (await loadHandle());
  if (!target || typeof target.getFileHandle !== "function") return null;
  if (!(await ensurePermission(target, "read"))) return null;
  try {
    const fileHandle = await target.getFileHandle(FILE_NAME);
    const file = await fileHandle.getFile();
    return await readBackupFile(file);
  } catch {
    return null; // 文件夹里还没有备份文件
  }
}

export function mergeOrReplaceState(current, incoming, mode = "merge") {
  return mode === "replace" ? parseState(incoming) : mergeState(current, incoming);
}

export function exportBackup(state) {
  return new Blob([serializeState({ ...state, backupAt: new Date().toISOString() })], { type: "application/json" });
}

export { FILE_NAME };
