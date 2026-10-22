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
//
// ── 为什么「复习重写」不再新建一份（2026-10 改） ──────────────────────
// 原来的「重写」等于再叫一次 appendVariant，于是每次复习都在存档里多一份。
// 间隔阶梯是 1/3/7/14 天，一轮完整的复习就是 4 次重写 —— 加上最初的解法正好 5 份，
// 把槽位吃光。结果是：一道真有两种思路的题（两数之和 = 暴力 / 哈希），
// 第二种思路反而没地方放；而存档里躺着 4 份几乎一样的「解法 2/3/4/5」。
//
// 现在分成两层：
//   解法（variant）    长期保留，代表「一种思路」，上限 MAX_SOLUTIONS_PER_SCOPE
//     └ versions[]     这份解法被顶替掉的历次代码，最近 MAX_VERSIONS_PER_VARIANT 份
// 复习重写 = 在同一份上重新开始，旧代码压进 versions，
// 所以槽位数量只随「思路种类」增长，不随「复习次数」增长。
//
// 复习记录本身（哪天做的、通过没有、用了几级提示）仍然由 state.history 负责，
// 两个账本各管一件事，不要混在存档里。

export const MAX_SOLUTIONS_PER_SCOPE = 5;
// 一份解法留几版历史。3 是权衡：够覆盖「上一次通过 + 上上次」，
// 又不至于让 localStorage 里一份 8KB 的代码乘 5 份解法再乘 3 版顶到配额。
export const MAX_VERSIONS_PER_VARIANT = 3;
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

// 一版历史代码。字段刻意少：能显示、能恢复、能判断「这版是通过的」就够。
export function normalizeVersion(record = {}, index = 0) {
  const source = isObject(record) ? record : {};
  const verdict = VERDICTS.includes(source.verdict) ? source.verdict : null;
  return {
    id: typeof source.id === "string" && source.id ? source.id : `ver-${index}`,
    code: typeof source.code === "string" ? source.code : "",
    verdict,
    verifiedAt: typeof source.verifiedAt === "string" && !Number.isNaN(Date.parse(source.verifiedAt)) ? source.verifiedAt : null,
    // reason 只用于 UI 文案：「复习重写」/「手动重置」。老数据没有就留空。
    reason: typeof source.reason === "string" ? source.reason.slice(0, 24) : "",
    savedAt: asTimestamp(source.savedAt || source.at)
  };
}

function normalizeVersions(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index) => normalizeVersion(item, index))
    .filter((item) => item.code)
    .slice(-MAX_VERSIONS_PER_VARIANT);
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
    outcome: typeof source.outcome === "string" ? source.outcome.slice(0, 32) : null,
    versions: normalizeVersions(source.versions)
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

// 把「当前代码」压进版本栈，然后把这份解法清成新内容。
// 这是「复习重写」和「重置为模板」共用的底层动作，也是唯一会产生版本栈的入口。
//
// 为什么不在这里直接清空 code：调用方可能想把它换成模板、也可能换成别的草稿，
// 让调用方决定更清楚。这里只负责「旧代码不丢」。
export function pushVersion(list = [], variantId, { reason = "", now = new Date() } = {}) {
  const at = asTimestamp(now instanceof Date ? now.toISOString() : now, EPOCH);
  return list.map((item) => {
    if (item.id !== variantId) return item;
    const code = String(item.code || "");
    // 空代码没什么可留的，否则版本栈里会堆积一串 ""
    if (!code.trim()) return item;
    const snapshot = normalizeVersion({
      id: `ver-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      code,
      verdict: item.verdict,
      verifiedAt: item.verifiedAt,
      reason,
      savedAt: at
    });
    // 相邻两版完全相同（含判题结论）就不重复压 —— 连点两次「重置」不该占两格。
    const last = item.versions.at(-1);
    if (last && last.code === snapshot.code && last.verdict === snapshot.verdict) return item;
    return normalizeVariant({ ...item, versions: [...item.versions, snapshot].slice(-MAX_VERSIONS_PER_VARIANT) }, 0);
  });
}

// 从版本栈里捞回一版：把它的代码与结论装回这份解法，并把那一版从栈里摘掉
// （否则「撤销」会让同一段代码既在编辑器里又在历史里）。
//
// 取回前先把「当前这段代码」压进版本栈。用户点取回时，编辑器里可能已经写了一半新
// 东西 —— 直接覆盖等于把刚才的输入扔掉，而这个功能的全部承诺就是「不丢代码」。
// 压进去之后，取回是真正的双向可逆：反悔了再点一次取回就能回到原来的内容。
export function restoreVersion(list = [], variantId, versionId, { keepCurrent = true } = {}) {
  // keepCurrent=false 是给提示条上那个「撤销」用的：它紧跟在一次重写之后，
  // 编辑器里此刻就是刚清出来的空模板，把它压进历史纯属噪音。
  // 而从「⋯ → 历史版本 → 取回」是隔了很久的主动操作，当前那份可能已经写了一半，
  // 必须压进去，否则「取回」会变成一次静默的删除。
  const withCurrent = keepCurrent ? pushVersion(list, variantId, { reason: "取回前" }) : list;
  return withCurrent.map((item) => {
    if (item.id !== variantId) return item;
    const target = item.versions.find((version) => version.id === versionId);
    if (!target) return item;
    return normalizeVariant({
      ...item,
      code: target.code,
      verdict: target.verdict,
      verifiedAt: target.verifiedAt,
      cursor: 0,
      scrollTop: 0,
      versions: item.versions.filter((version) => version.id !== versionId)
    }, 0);
  });
}

export function dropVersion(list = [], variantId, versionId) {
  return list.map((item) => (item.id === variantId
    ? normalizeVariant({ ...item, versions: item.versions.filter((version) => version.id !== versionId) }, 0)
    : item));
}

// 「一个字都没写」的解法：代码就是模板、没有判题结论、也没有历史版本。
// 这种份值零信息，留着只会在切换器上占一个看起来像「我有 3 种解法」的位置。
//
// 判定用「去掉所有空白后相等」而不是逐字节相等：编辑器可能补一个结尾换行，
// 也可能被 prettier 洗过，这些都不该让一份空壳被判成「写过」。
function comparableCode(code) {
  return String(code || "").replace(/\s+/g, "");
}

export function isBlankVariant(variant, template) {
  if (!variant) return false;
  if (variant.verdict) return false;
  if (Array.isArray(variant.versions) && variant.versions.length) return false;
  const expected = comparableCode(template);
  if (!expected) return false;
  return comparableCode(variant.code) === expected;
}

// 回收空壳。keepId 用来保护「正在编辑的那份」——哪怕它现在是空的，
// 用户也可能正准备往里写，不能在他打第一个字之前就把它抽走。
//
// 返回 { scope, removed }，removed 是 id 数组，调用方据此决定要不要改激活项。
export function pruneBlankVariants(list = [], template, { keepId = null } = {}) {
  const removed = [];
  const kept = list.filter((item) => {
    if (item.id === keepId) return true;
    if (!isBlankVariant(item, template)) return true;
    removed.push(item.id);
    return false;
  });
  return { scope: kept, removed };
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
    lines: String(variant?.code || "").split("\n").length,
    versionCount: Array.isArray(variant?.versions) ? variant.versions.length : 0
  };
}

export { EPOCH as SOLUTIONS_EPOCH };
