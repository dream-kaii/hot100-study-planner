// src/online/probe.js
// 页面侧能力探测：判断"要不要给用户显示在线运行这条路"。
//
// 用户明确要求过：不做"环境提示弹窗"，所以这里只做静默判断，
// 结果只用于决定运行按钮是"可点"还是"灰的 + 一句话"。

/** 结果缓存 60 秒，避免每次切题都打一次接口。 */
const CACHE_TTL_MS = 60 * 1000;
let cache = { at: 0, value: null };

/**
 * 探测线上运行能力是否可用。
 * 返回 { available, reason }：
 *   available=false, reason="dev"        本地开发环境，走 /__runner，不需要隧道
 *   available=false, reason="no-backend" 这个部署没有 /api/pair（说明没启用在线运行）
 *   available=true                       可以走隧道
 */
export async function probeOnlineRunner({ force = false } = {}) {
  if (!force && cache.value && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;

  let value;
  if (typeof window === "undefined") {
    value = { available: false, reason: "ssr" };
  } else if (import.meta.env?.DEV) {
    value = { available: false, reason: "dev" };
  } else {
    try {
      // HEAD 太容易被 CDN 缓存，用 OPTIONS 打一个明确不存在的探测路径；
      // 只要 /api/ 前缀被 Worker 接管就会返回 404 JSON 而不是 index.html。
      const response = await fetch("/api/status/probe", { method: "GET", cache: "no-store" });
      const isJson = (response.headers.get("content-type") || "").includes("application/json");
      value = isJson
        ? { available: true, reason: "ok" }
        : { available: false, reason: "no-backend" };
    } catch {
      value = { available: false, reason: "network" };
    }
  }

  cache = { at: Date.now(), value };
  return value;
}

/** 给用户看的一句话解释。文案刻意短，不占版面。 */
export function explainUnavailable(reason) {
  switch (reason) {
    case "dev": return "本地开发环境走 /__runner，不需要额外配置。";
    case "no-backend": return "这个站点的在线运行还未启用。";
    case "network": return "网络异常，暂时无法连接在线运行服务。";
    default: return "当前环境不支持在线运行。";
  }
}
