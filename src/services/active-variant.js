// 「这道题这个语言这个模式，现在在写哪一份解法」的读写。
//
// 原来这段逻辑埋在 ProblemDetail.jsx 里（模块内私有函数），只有一个组件会用。
// 现在「到期复习 → 看上次的写法」需要从外面把光标挪到「那份通过过的代码」上，
// 于是它必须是共享的：两处各写一遍，迟早会出现「点进去看到的是空白模板」。
//
// 存 localStorage 而不是 React state 的理由没变：刷新、切题回来都要接着写那一份。

import { isPassingVerdict } from "./solutions.js";
import { readLocal, removeLocal, writeLocal } from "./local-store.js";

const ACTIVE_VARIANT_KEY_PREFIX = "hot100:activeVariant:";

function asTime(value) {
  const time = Date.parse(String(value || ""));
  return Number.isNaN(time) ? 0 : time;
}

export function activeVariantKey(questionId, language, mode) {
  return `${ACTIVE_VARIANT_KEY_PREFIX}${questionId}:${language}:${mode}`;
}

export function readActiveVariant(questionId, language, mode, scope = []) {
  // readLocal 在本地存储被禁用时返回 null，自动退回下面的默认选择。
  const stored = readLocal(activeVariantKey(questionId, language, mode));
  if (stored && scope.some((item) => item.id === stored)) return stored;
  // 没有记录时默认接着最后一份写，避免「明明存过却打开是空白模板」。
  return scope.length ? scope.at(-1).id : null;
}

export function writeActiveVariant(questionId, language, mode, variantId) {
  // 存不了就只保留内存态，不影响当前操作。
  const key = activeVariantKey(questionId, language, mode);
  if (variantId) writeLocal(key, variantId);
  else removeLocal(key);
}

/**
 * 「上次的写法」到底是哪一段代码。
 *
 * 这里是 2026-10 那次改动带出来的新问题：复习重写的旧代码不再是一份独立的
 * 解法副本，而是压进了这份解法的 versions。如果沿用老的「找一份通过的解法」，
 * 复习完一轮之后所有解法都是空的，点「看上次的写法」会打开一张空白模板 ——
 * 用户会以为代码丢了。
 *
 * 所以候选池要同时包含「解法自身的代码」和「它历史版本里的代码」，
 * 按最后通过时间取最新的一段。返回 `{ variantId, versionId, code, label }`。
 *
 * versionId 非空表示这段代码不在当前存档里，而在历史版本栈里 ——
 * 调用方据此决定它是不是只读的预览（不能直接改，改了会覆盖掉当前那份）。
 */
export function pickReviewSnapshot(questionId, language, mode, scope = []) {
  const candidates = [];
  for (const variant of Array.isArray(scope) ? scope : []) {
    if (!variant?.id) continue;
    if (isPassingVerdict(variant.verdict) && String(variant.code || "").trim()) {
      candidates.push({
        variantId: variant.id,
        versionId: null,
        code: variant.code,
        label: variant.name,
        at: asTime(variant.verifiedAt || variant.updatedAt)
      });
    }
    for (const version of Array.isArray(variant.versions) ? variant.versions : []) {
      if (!isPassingVerdict(version.verdict) || !String(version.code || "").trim()) continue;
      candidates.push({
        variantId: variant.id,
        versionId: version.id,
        code: version.code,
        label: `${variant.name} · ${version.reason || "历史版本"}`,
        at: asTime(version.verifiedAt || version.savedAt)
      });
    }
  }
  if (candidates.length) {
    candidates.sort((a, b) => b.at - a.at);
    return candidates[0];
  }
  // 一次都没通过过：退回「上次停在哪份」，让用户至少看到自己写的东西。
  const fallbackId = readActiveVariant(questionId, language, mode, scope);
  const fallback = (Array.isArray(scope) ? scope : []).find((item) => item.id === fallbackId);
  if (!fallback) return null;
  return {
    variantId: fallback.id,
    versionId: null,
    code: String(fallback.code || ""),
    label: fallback.name || "上次停在这份",
    at: asTime(fallback.updatedAt)
  };
}

/** 只要那份解法的 id（兼容旧调用点）。 */
export function pickReviewVariant(questionId, language, mode, scope = []) {
  return pickReviewSnapshot(questionId, language, mode, scope)?.variantId ?? readActiveVariant(questionId, language, mode, scope);
}
