// src/services/datetime.js
// 时间显示统一走这里。
//
// 背景：历史记录里存的是 new Date().toISOString()，即 UTC。
// 直接 slice(0, 19) 会显示 UTC 时间，在东八区看起来"慢了 8 小时"。
// 必须交给 Intl 按浏览器本地时区格式化。

/**
 * 把 ISO 时间串格式化成用户本地时间。
 * 例：2026-10-18T08:45:00.000Z → 2026/10/18 16:45
 */
export function formatDateTime(value) {
  if (!value) return "时间未知";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

/** 只要日期，不要时分。 */
export function formatDate(value) {
  if (!value) return "日期未知";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "日期未知";
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(date);
}

/** 把毫秒时长说成人话。 */
export function formatDuration(value) {
  const seconds = Math.max(0, Math.round(Number(value || 0) / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${minutes} 分 ${remainder} 秒` : `${minutes} 分钟`;
}

/** 给 <time dateTime> 用的原始值，不做转换。 */
export function isoValue(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}
