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
 * 「看上次的写法」该落在哪一份上。
 *
 * 优先最近一次通过过的那份 —— 复习时想看的是「当时我是怎么解出来的」，
 * 不是「我上一次点开时随便停在哪个标签上」。都没通过过才退回默认规则。
 */
export function pickReviewVariant(questionId, language, mode, scope = []) {
  const passing = scope.filter((item) => isPassingVerdict(item?.verdict));
  if (passing.length) {
    const latest = passing.reduce((best, item) => {
      const time = Date.parse(item.verifiedAt || item.updatedAt || "") || 0;
      const bestTime = Date.parse(best.verifiedAt || best.updatedAt || "") || 0;
      return time >= bestTime ? item : best;
    });
    if (latest?.id) return latest.id;
  }
  return readActiveVariant(questionId, language, mode, scope);
}
