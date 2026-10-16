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

export async function hasBackupDirectory() {
  if (memoryHandle) return true;
  const db = await openDb();
  if (!db) return false;
  return new Promise((resolve) => {
    const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(HANDLE_KEY);
    request.onsuccess = () => { memoryHandle = request.result; resolve(Boolean(memoryHandle)); };
    request.onerror = () => resolve(false);
  });
}

export async function writeBackup(state) {
  if (!(await hasBackupDirectory())) throw new Error("请先选择备份文件夹。");
  const file = await memoryHandle.getFileHandle(FILE_NAME, { create: true });
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

export function mergeOrReplaceState(current, incoming, mode = "merge") {
  return mode === "replace" ? parseState(incoming) : mergeState(current, incoming);
}

export function exportBackup(state) {
  return new Blob([serializeState({ ...state, backupAt: new Date().toISOString() })], { type: "application/json" });
}

export { FILE_NAME };
