// 浏览器本地存储的安全封装。
//
// 为什么需要这层：`localStorage` 不是"总是可用"的 API。
// 以下环境里连**读属性**都会抛 SecurityError，而不是返回 null：
// - Safari「阻止所有 Cookie」（含某些版本的隐私浏览）
// - Chrome 关闭「允许网站保存和读取 Cookie 数据」
// - 部分企业/学校策略托管设备
// - iframe 没有 allow-same-origin
// 之前 `loadState()` 第一行就是 `typeof localStorage === "undefined"`，
// 属性访问本身抛错，异常冒到渲染根部，整个 React 树被卸载 —— 页面全白。
// 这里把所有访问路径都包起来，失败就当作"没有本地存储"，让应用能用内存跑起来。

function storage() {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage || null;
  } catch {
    return null;
  }
}

// 环境层面能不能用本地存储（属性可访问、且能写一个探针键）。
export function storageAvailable() {
  try {
    const target = storage();
    if (!target) return false;
    const probe = "__hot100_probe__";
    target.setItem(probe, "1");
    target.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

export function readLocal(key) {
  try {
    return storage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

// 返回 { ok, reason }。reason 只在 ok=false 时有意义：
// "quota" = 存储还有空间但这条写满了；"disabled" = 整个本地存储都不可用。
// 调用方据此决定要不要提示用户「这次的改动没保存」，以及怎么解释。
export function writeLocal(key, value) {
  try {
    const target = storage();
    if (!target) return { ok: false, reason: "disabled" };
    target.setItem(key, value);
    return { ok: true, reason: "" };
  } catch (error) {
    const name = error?.name || "";
    if (name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED") return { ok: false, reason: "quota" };
    if (name === "SecurityError") return { ok: false, reason: "disabled" };
    // 认不出的错误：如果探针也写不进去就是环境问题，否则算配额。
    return { ok: false, reason: storageAvailable() ? "quota" : "disabled" };
  }
}

export function removeLocal(key) {
  try {
    storage()?.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
