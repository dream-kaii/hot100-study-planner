import { mergeSolutions, normalizeSolutions } from "./solutions.js";

// 版本号保持不变：solutions 是纯新增的可选字段，
// 升版会让已经导出的 v3 备份全部被判为「版本不受支持」。
export const STATE_VERSION = 3;

const EPOCH = "1970-01-01T00:00:00.000Z";

export function createDefaultState() {
  return {
    version: STATE_VERSION,
    profile: { dailyMinutes: 90, dailyNewLimit: 1, defaultLanguage: "java" },
    progress: {},
    drafts: {},
    solutions: {},
    notes: {},
    history: [],
    timer: null,
    settings: { backupConfigured: false },
    updatedAt: EPOCH
  };
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asTimestamp(value, fallback = EPOCH) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : fallback;
}

function normalizeDrafts(value) {
  if (!isObject(value)) return {};
  const drafts = {};
  for (const [questionId, languages] of Object.entries(value)) {
    if (!isObject(languages)) continue;
    drafts[questionId] = {};
    for (const [language, modes] of Object.entries(languages)) {
      if (!isObject(modes)) continue;
      drafts[questionId][language] = {};
      for (const [mode, record] of Object.entries(modes)) {
        if (!isObject(record)) continue;
        drafts[questionId][language][mode] = {
          ...record,
          code: typeof record.code === "string" ? record.code : "",
          cursor: Number.isFinite(record.cursor) ? record.cursor : 0,
          scrollTop: Number.isFinite(record.scrollTop) ? record.scrollTop : 0,
          updatedAt: asTimestamp(record.updatedAt)
        };
      }
    }
  }
  return drafts;
}

function normalizeProgress(value) {
  if (!isObject(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([id, item]) => [id, migrateProgressItem(item)]));
}

function normalizeCurrent(value) {
  const defaults = createDefaultState();
  const source = isObject(value) ? value : {};
  const updatedAt = asTimestamp(source.updatedAt);
  return {
    ...defaults,
    ...source,
    version: STATE_VERSION,
    profile: { ...defaults.profile, ...(isObject(source.profile) ? source.profile : {}) },
    progress: normalizeProgress(source.progress),
    drafts: normalizeDrafts(source.drafts),
    solutions: normalizeSolutions(source.solutions),
    notes: isObject(source.notes) ? source.notes : {},
    history: Array.isArray(source.history) ? source.history.filter(isObject) : [],
    timer: source.timer ?? null,
    settings: { ...defaults.settings, ...(isObject(source.settings) ? source.settings : {}) },
    updatedAt
  };
}

function migrateProgressItem(item) {
  if (!isObject(item)) return item;
  const oldStatus = item.status;
  // 「待复习」迁移成 due，不再和「错题」共用 reviewing：
  // 两者语义不同，共用会让统计和筛选互相打架。
  const statusMap = { 未开始: "new", 思考中: "in-progress", 已完成: "completed", 错题: "reviewing", 待复习: "due", 已掌握: "completed" };
  const status = statusMap[oldStatus] || oldStatus;
  const migrated = { ...item, status };
  if (oldStatus && oldStatus !== status) migrated.legacy = { ...(isObject(item.legacy) ? item.legacy : {}), status: oldStatus };
  if (["已完成", "已掌握"].includes(oldStatus)) {
    migrated.legacyImported = true;
    delete migrated.masteredAt;
  }
  return migrated;
}

export function migrateState(value) {
  if (!isObject(value)) return createDefaultState();
  if (value.version === STATE_VERSION || value.version == null) return normalizeCurrent(value);
  if (value.version !== 2) throw new Error(`不支持的数据版本: ${String(value.version)}`);

  const defaults = createDefaultState();
  const oldProfile = isObject(value.profile) ? value.profile : {};
  const legacyProfile = {};
  for (const key of ["targetDays", "baseLevel", "weakCategories"]) if (key in oldProfile) legacyProfile[key] = oldProfile[key];
  const legacy = {};
  if (Object.keys(legacyProfile).length) legacy.profile = legacyProfile;
  if (value.backupAt) legacy.backupAt = value.backupAt;

  const migrated = normalizeCurrent({
    ...defaults,
    ...value,
    version: STATE_VERSION,
    profile: {
      dailyMinutes: Number.isFinite(oldProfile.dailyMinutes) ? oldProfile.dailyMinutes : defaults.profile.dailyMinutes,
      dailyNewLimit: Number.isFinite(oldProfile.dailyNewLimit) ? oldProfile.dailyNewLimit : defaults.profile.dailyNewLimit,
      defaultLanguage: oldProfile.defaultLanguage || defaults.profile.defaultLanguage
    },
    progress: Object.fromEntries(Object.entries(isObject(value.progress) ? value.progress : {}).map(([id, item]) => [id, migrateProgressItem(item)])),
    drafts: value.drafts || {},
    notes: value.notes || {},
    history: value.history || [],
    updatedAt: value.updatedAt || defaults.updatedAt
  });
  if (Object.keys(legacy).length) migrated.legacy = legacy;
  return migrated;
}

export function parseState(raw) {
  if (raw === null || raw === undefined || raw === "") return createDefaultState();
  let parsed;
  try {
    parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return createDefaultState();
  }
  if (!isObject(parsed)) return createDefaultState();
  return migrateState(parsed);
}

// 判断这份状态里是否已有学习痕迹（用于"换浏览器后是否自动恢复备份"的决策）
export function isStateEmpty(state) {
  const value = parseState(state);
  const hasRecords = (record) => Boolean(record) && typeof record === "object" && Object.keys(record).length > 0;
  return !hasRecords(value.progress) && !hasRecords(value.solutions) && !hasRecords(value.notes) && !hasRecords(value.drafts) && !(Array.isArray(value.history) && value.history.length > 0);
}

export function serializeState(state) {
  return JSON.stringify(normalizeCurrent(migrateState(state)), null, 2);
}

function newer(a, b) {
  const aTime = Date.parse(a?.updatedAt || "") || 0;
  const bTime = Date.parse(b?.updatedAt || "") || 0;
  return bTime >= aTime ? b : a;
}

function mergeDrafts(current, incoming) {
  const merged = structuredClone(current);
  for (const [questionId, languages] of Object.entries(incoming)) {
    merged[questionId] ||= {};
    for (const [language, modes] of Object.entries(languages)) {
      merged[questionId][language] ||= {};
      for (const [mode, draft] of Object.entries(modes)) merged[questionId][language][mode] = newer(merged[questionId][language][mode], draft);
    }
  }
  return merged;
}

function mergeRecords(current, incoming, currentUpdatedAt = EPOCH, incomingUpdatedAt = EPOCH) {
  const merged = { ...current };
  for (const [id, item] of Object.entries(incoming)) {
    const currentRecord = { record: merged[id], updatedAt: merged[id]?.updatedAt || currentUpdatedAt };
    const incomingRecord = { record: item, updatedAt: item?.updatedAt || incomingUpdatedAt };
    merged[id] = newer(currentRecord, incomingRecord).record;
  }
  return merged;
}

function mergeHistory(current, incoming) {
  const byId = new Map();
  for (const event of [...current, ...incoming]) {
    if (!event.id) continue;
    const previous = byId.get(event.id);
    if (!previous || (Date.parse(event.createdAt || "") || 0) >= (Date.parse(previous.createdAt || "") || 0)) byId.set(event.id, event);
  }
  const events = [...byId.values()].sort((a, b) => (Date.parse(a.createdAt || "") || 0) - (Date.parse(b.createdAt || "") || 0));
  const retained = [];
  const scope = (event) => `${event.questionId}\u0000${event.language || "java"}\u0000${event.mode || "function"}`;
  for (const event of events) {
    retained.push(event);
    const scopedEvents = retained.filter((item) => scope(item) === scope(event));
    const effective = scopedEvents.filter((item) => !["started", "unknown"].includes(item.outcome));
    if (effective.length > 20) retained.splice(retained.indexOf(effective[0]), 1);
    const started = scopedEvents.filter((item) => item.outcome === "started");
    if (started.length > 1) retained.splice(retained.indexOf(started[0]), 1);
  }
  return retained;
}

export function mergeState(current, incoming) {
  const base = parseState(current);
  const next = parseState(incoming);
  return {
    ...base,
    profile: newer({ value: base.profile, updatedAt: base.updatedAt }, { value: next.profile, updatedAt: next.updatedAt }).value,
    progress: mergeRecords(base.progress, next.progress, base.updatedAt, next.updatedAt),
    drafts: mergeDrafts(base.drafts, next.drafts),
    solutions: mergeSolutions(base.solutions, next.solutions),
    notes: mergeRecords(base.notes, next.notes, base.updatedAt, next.updatedAt),
    history: mergeHistory(base.history, next.history),
    timer: newer({ value: base.timer, updatedAt: base.updatedAt }, { value: next.timer, updatedAt: next.updatedAt }).value,
    settings: { ...base.settings, ...next.settings },
    updatedAt: newer(base, next).updatedAt
  };
}
