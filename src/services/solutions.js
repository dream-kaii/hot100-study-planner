// 多解法存档。
//
// 设计约束（来自练习过程中的真实痛点）：
//   一道题往往不止一种解法。过去想尝试第二种解法，只能把已经跑通的代码删掉，
//   于是「重新开始」等于「销毁证据」。
//
// 现在把「正在写的那份」和「已经存下来的若干份」分开：
//   - state.drafts[questionId][language][mode]   仍然是当前正在编辑的那份（沿用旧结构，零迁移风险）
//   - state.solutions[questionId][language][mode] 是存档列表，每份是一条快照
//
// 一个解法（variant）的字段刻意保持扁平、全部可序列化：
//   id          稳定的字符串 id，UI 的 key，也是运行结果回填的锚点
//   name        用户可改的短名字，默认「解法 N」
//   code        完整源码
//   cursor      光标位置，切换回来时恢复
//   scrollTop   滚动位置，切换回来时恢复
//   createdAt / updatedAt   时间戳，合并备份时按更新时间取舍
//   verdict     最近一次判题结论：independent / needed-hint / needed-solution / failed / null
//   verifiedAt  最后一次「通过公开示例」的时间
//   outcome     该次通过的来源口径（与 history.js 的 outcome 一致）
//
// 语言维度独立、编号对齐：Java 的解法 2 和 Python 的解法 2 是同一个思路的两种实现，
// 但代码各自独立保存 —— 这样既不强迫一份思路只能写一种语言，也不用引入两层嵌套。

export const MAX_SOLUTIONS_PER_SCOPE = 5;
export const SOLUTION_NAME_PREFIX = "解法";

const EPOCH = "1970-01-01T00:00:00.000Z";

export const VERDICTS = Object.freeze(["independent", "needed-hint", "needed-solution", "failed"]);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asTimestamp(value, fallback = EPOCH) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : fallback;
}

function asInteger(value, fallback = 0) {
  return Number.isFinite(value) && value >= 0 ? Math.trunc(value) : fallback;
}

export function isPassingVerdict(verdict) {
  return verdict === "independent" || verdict === "needed-hint" || verdict === "needed-solution";
}

export function verdictLabel(verdict) {
  return {
    independent: "独立通过",
    "needed-hint": "提示后通过",
    "needed-solution": "看题解后通过",
    failed: "未通过"
  }[verdict] || "";
}

// 一条快照的最小合法形态。任何缺字段的旧数据都能被归一化成它。
export function normalizeVariant(record = {}, index = 0) {
  const source = isObject(record) ? record : {};
  const verdict = VERDICTS.includes(source.verdict) ? source.verdict : null;
  // verifiedAt 与 verdict 解耦：一次失败不能抹掉上一次通过的时间戳，
  // 否则「这份我明明跑通过」的证据就没了。只有从没通过过才是 null。
  const verifiedAt = typeof source.verifiedAt === "string" && !Number.isNaN(Date.parse(source.verifiedAt))
    ? source.verifiedAt
    : null;
  return {
    id: typeof source.id === "string" && source.id ? source.id : createVariantId(index),
    name: typeof source.name === "string" && source.name.trim() ? source.name.trim().slice(0, 24) : `${SOLUTION_NAME_PREFIX} ${index + 1}`,
    code: typeof source.code === "string" ? source.code : "",
    cursor: asInteger(source.cursor),
    scrollTop: asInteger(source.scrollTop),
    createdAt: asTimestamp(source.createdAt || source.updatedAt),
    updatedAt: asTimestamp(source.updatedAt || source.createdAt),
    verdict,
    verifiedAt,
    outcome: typeof source.outcome === "string" ? source.outcome.slice(0, 32) : null
  };
}

export function createVariantId(seed = 0) {
  return `v-${Date.now().toString(36)}-${seed.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function normalizeScope(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item, index) => normalizeVariant(item, index)).slice(0, MAX_SOLUTIONS_PER_SCOPE);
}

export function normalizeSolutions(value) {
  if (!isObject(value)) return {};
  const solutions = {};
  for (const [questionId, languages] of Object.entries(value)) {
    if (!isObject(languages)) continue;
    const cleanLanguages = {};
    for (const [language, modes] of Object.entries(languages)) {
      if (!isObject(modes)) continue;
      const cleanModes = {};
      for (const [mode, list] of Object.entries(modes)) {
        const scope = normalizeScope(list);
        if (scope.length) cleanModes[mode] = scope;
      }
      if (Object.keys(cleanModes).length) cleanLanguages[language] = cleanModes;
    }
    if (Object.keys(cleanLanguages).length) solutions[questionId] = cleanLanguages;
  }
  return solutions;
}

export function selectScope(solutions, questionId, language, mode) {
  const list = solutions?.[questionId]?.[language]?.[mode];
  return Array.isArray(list) ? list : [];
}

export function findVariant(solutions, questionId, language, mode, variantId) {
  return selectScope(solutions, questionId, language, mode).find((item) => item.id === variantId) || null;
}

// 用当前草稿生成一条新快照。调用方负责把它写回 state。
export function createVariant(draft = {}, { seed = 0, name, now = new Date() } = {}) {
  const updatedAt = asTimestamp(now instanceof Date ? now.toISOString() : now, EPOCH);
  return normalizeVariant({
    id: createVariantId(seed),
    name,
    code: draft?.code ?? "",
    cursor: draft?.cursor ?? 0,
    scrollTop: draft?.scrollTop ?? 0,
    createdAt: updatedAt,
    updatedAt
  }, seed);
}

// 默认名字按「当前列表里没被占用的最小序号」取，删掉解法 2 之后新建仍然叫解法 2，
// 不会出现「解法 1、解法 3、解法 4」这种空洞。
export function nextVariantName(list = []) {
  const used = new Set(list.map((item) => String(item?.name || "").trim()));
  for (let index = 1; index <= MAX_SOLUTIONS_PER_SCOPE + 1; index += 1) {
    const candidate = `${SOLUTION_NAME_PREFIX} ${index}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${SOLUTION_NAME_PREFIX} ${list.length + 1}`;
}

export function canAddVariant(list = []) {
  return list.length < MAX_SOLUTIONS_PER_SCOPE;
}

// 纯函数式操作：都返回新的 scope 列表，交给调用方写回 state。
export function appendVariant(list = [], variant) {
  const next = [...list, variant];
  return next.slice(-MAX_SOLUTIONS_PER_SCOPE);
}

export function updateVariant(list = [], variantId, patch = {}) {
  return list.map((item) => (item.id === variantId ? normalizeVariant({ ...item, ...patch }, 0) : item));
}

export function removeVariant(list = [], variantId) {
  return list.filter((item) => item.id !== variantId);
}

export function renameVariant(list = [], variantId, name) {
  const trimmed = String(name || "").trim().slice(0, 24);
  if (!trimmed) return list;
  return updateVariant(list, variantId, { name: trimmed });
}

// 判题结果回填。只有通过的结论才更新 verifiedAt，
// 失败不清掉上一次通过记录（否则「我明明跑通过」的证据会丢）。
export function applyVerdict(list = [], variantId, { verdict, now = new Date(), outcome } = {}) {
  if (!VERDICTS.includes(verdict)) return list;
  const at = asTimestamp(now instanceof Date ? now.toISOString() : now, EPOCH);
  return list.map((item) => {
    if (item.id !== variantId) return item;
    const passing = isPassingVerdict(verdict);
    return normalizeVariant({
      ...item,
      verdict,
      outcome: outcome || item.outcome,
      verifiedAt: passing ? at : item.verifiedAt,
      updatedAt: at
    }, 0);
  });
}

// 合并两份 scope：按 id 对齐，updatedAt 新的胜出；顺序按 createdAt，
// 保证「解法 1」永远在前面，不会因为合并顺序而漂移。
export function mergeScope(current = [], incoming = []) {
  const byId = new Map();
  for (const item of [...current, ...incoming]) {
    if (!item?.id) continue;
    const previous = byId.get(item.id);
    if (!previous || Date.parse(item.updatedAt) >= Date.parse(previous.updatedAt)) byId.set(item.id, item);
  }
  return [...byId.values()]
    .sort((a, b) => (Date.parse(a.createdAt) - Date.parse(b.createdAt)) || String(a.id).localeCompare(String(b.id)))
    .slice(0, MAX_SOLUTIONS_PER_SCOPE);
}

export function mergeSolutions(current, incoming) {
  const base = normalizeSolutions(current);
  const next = normalizeSolutions(incoming);
  const merged = { ...base };
  for (const [questionId, languages] of Object.entries(next)) {
    merged[questionId] = { ...(merged[questionId] || {}) };
    for (const [language, modes] of Object.entries(languages)) {
      merged[questionId][language] = { ...(merged[questionId][language] || {}) };
      for (const [mode, list] of Object.entries(modes)) {
        merged[questionId][language][mode] = mergeScope(merged[questionId][language][mode] || [], list);
      }
    }
  }
  return merged;
}

// 摘要给列表/切换器直接用：一份解法值不值得显示徽标。
export function describeVariant(variant) {
  const verified = isPassingVerdict(variant?.verdict);
  return {
    id: variant?.id || "",
    name: variant?.name || SOLUTION_NAME_PREFIX,
    passing: verified,
    label: verified ? verdictLabel(variant.verdict) : "未通过",
    verifiedAt: variant?.verifiedAt || null,
    updatedAt: variant?.updatedAt || EPOCH,
    lines: String(variant?.code || "").split("\n").length
  };
}

export { EPOCH as SOLUTIONS_EPOCH };
