/**
 * 浏览器抛出的 DOMException 都是英文，直接甩给用户既难懂又不一致。
 * 这里统一翻译成中文；认不出来的错误也一律给中文兜底，绝不把英文原文透给用户。
 */
const DOM_MESSAGES = {
  AbortError: "操作已取消",
  NotAllowedError: "浏览器没有授予这次操作的权限，请再试一次并在弹窗里点「允许」",
  SecurityError: "浏览器出于安全策略拒绝了这次操作",
  NotFoundError: "找不到对应的文件或目录",
  NotReadableError: "文件被其他程序占用，暂时读不了",
  InvalidStateError: "当前状态不允许这个操作，请刷新页面重试",
  QuotaExceededError: "浏览器存储空间不足",
  NetworkError: "网络请求失败，请检查网络或代理后重试",
  DataError: "文件内容格式不对",
  EncodingError: "文件编码无法识别",
  DataCloneError: "数据无法保存，可能是浏览器版本过旧",
};

/** 网络层的 TypeError（fetch 失败）没有 name 可依，只能看消息。 */
function isNetworkFailure(error) {
  const text = String(error?.message ?? "");
  return /Failed to fetch|NetworkError|Load failed|network error|ERR_NETWORK|fetch failed/i.test(text);
}

/**
 * 把任意异常转成一句中文。
 * @param {unknown} error 捕获到的异常
 * @param {string} fallback 认不出来时的中文兜底（应按具体场景写，例如「备份失败，请重试」）
 * @param {string} [abortFallback] AbortError 时的文案；不传则用 fallback
 */
export function describeError(error, fallback = "操作失败，请重试", abortFallback) {
  const name = error?.name;
  if (name === "AbortError") return abortFallback ?? "操作已取消";
  if (name && DOM_MESSAGES[name]) return DOM_MESSAGES[name];
  if (isNetworkFailure(error)) return DOM_MESSAGES.NetworkError;
  const text = typeof error?.message === "string" ? error.message.trim() : "";
  // 自己抛的中文提示原样透出；英文原文一律换成兜底，避免用户看到浏览器原文。
  if (text && /[\u4e00-\u9fa5]/.test(text)) return text;
  return fallback;
}

export function isAbortError(error) {
  return error?.name === "AbortError";
}
