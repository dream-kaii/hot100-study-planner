const REVIEW_INTERVALS = [1, 3, 7, 14];

function asDate(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError("Invalid date");
  return date;
}

// 宽松版：拿不到合法时间就返回 null，交给调用方决定怎么兜底。
//
// 为什么需要它：derivePracticeStatus 是整个 UI 的必经函数，总览、题库、错题页、
// 顶栏统计全在调。以前它内部直接用会抛错的 asDate，于是只要某条 progress 里的
// reviewAt 是个坏字符串（手改过 localStorage、旧备份、跨设备合并都可能出现），
// 一次渲染就炸掉整个 React 树 —— 实测整页白屏，页面上一个字都没有。
// 派生状态是只读展示逻辑，遇到坏数据应当退化成「当作没有复习日」，不能连累整站。
function safeTime(value) {
  if (value === undefined || value === null || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  return Number.isNaN(time) ? null : time;
}

function addDays(value, days) {
  const date = asDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function contextKey(language = "java", mode = "function") {
  return `${language}:${mode}`;
}

// 用提示、看题解都不该改变「这题我标成什么样了」。
//
// 以前这里只排除 completed / mastered，于是：
//   用户把一道题标成「错题」→ 打开提示看一眼 → 状态被悄悄改成「思考中」
//   → 题目从错题池里消失，而用户完全没做任何「取消错题」的动作。
// 「待复习」同理。这两者是用户主动判定的结果，只有再做一次才能改变。
const STATUSES_KEPT_ON_HINT = ["completed", "mastered", "reviewing", "due"];

function keepsStatusOnHint(progressItem, now = new Date()) {
  if (!progressItem || typeof progressItem !== "object") return false;
  if (progressItem.independentPassAt) return true;
  return STATUSES_KEPT_ON_HINT.includes(normalizedStatus(progressItem, now));
}

export function classifyAttemptOutcome({ passed, attemptHintsUsed = 0, attemptViewedSolutionCode = false }) {
  if (!passed) return "failed";
  if (attemptViewedSolutionCode) return "needed-solution";
  if (Number(attemptHintsUsed) > 0) return "needed-hint";
  return "independent";
}

function normalizedStatus(progressItem, now) {
  if (!progressItem || typeof progressItem !== "object") return "new";
  if (progressItem.masteredAt || progressItem.status === "mastered" || progressItem.status === "已掌握") return "mastered";
  const mapped = {
    未开始: "new",
    思考中: "in-progress",
    已完成: "completed",
    // 「错题」和「待复习」是两个不同的东西：
    //   错题   —— 你做错了/没做出来，需要重新啃（reviewing）
    //   待复习 —— 已通过，但按 1/3/7/14 间隔到期了（due）
    // 以前两者都压成 reviewing，导致统计卡和题库筛选口径打架，
    // 手动点「错题」还会被 setStatus 静默丢掉。
    错题: "reviewing",
    待复习: "due",
    reviewing: "reviewing",
    due: "due",
    failed: "reviewing"
  }[progressItem.status];
  // status 可能是个对象/数字（坏数据），映射不上时退回 "new"，
  // 否则这个值会一路漏到 class 名和筛选比较里。
  const status = mapped || (typeof progressItem.status === "string" && progressItem.status ? progressItem.status : "new");
  // 已完成且复习到期，派生为「待复习」而不是「错题」：题本身没做错，只是该复习了。
  if (status === "completed") {
    const dueTime = safeTime(progressItem.reviewAt);
    const nowTime = safeTime(now) ?? Date.now();
    if (dueTime !== null && dueTime <= nowTime) return "due";
  }
  return status;
}

export function derivePracticeStatus(progressItem, now = new Date()) {
  return normalizedStatus(progressItem, now);
}

// 统一的「是不是错题」判据。统计卡、题库筛选、错题页都必须用同一个，
// 否则会出现「顶部显示 1 道错题，筛选出来 0 条」。
export function isMistakeStatus(status) {
  return status === "reviewing";
}

// 「今天该复习」的判据：到期复习 + 错题（错题本身就需要重做）。
export function isReviewPending(progressItem, now = new Date()) {
  const status = normalizedStatus(progressItem, now);
  return status === "reviewing" || status === "due";
}

export function getMasteryLevel(progressItem, now = new Date()) {
  const status = normalizedStatus(progressItem, now);
  if (status === "mastered") return "mastered";
  if (status === "reviewing" || status === "due") return "reviewing";
  if (status === "new") return "new";
  return "learning";
}

export function recordHint(progressItem = {}, level, now = new Date(), language = "java", mode = "function") {
  const updatedAt = asDate(now).toISOString();
  const current = { ...progressItem };
  const hintHistory = Array.isArray(current.hintHistory) ? current.hintHistory : [];
  const key = contextKey(language, mode);
  const scoped = current.hintsByContext?.[key] || { count: 0, history: [] };
  const next = {
    ...current,
    hintsUsed: Number(current.hintsUsed || 0) + 1,
    hintHistory: [...hintHistory, { level, usedAt: updatedAt }],
    hintsByContext: {
      ...(current.hintsByContext || {}),
      [key]: { count: scoped.count + 1, history: [...scoped.history, { level, usedAt: updatedAt }] }
    },
    lastHintAt: updatedAt,
    updatedAt
  };
  if (!keepsStatusOnHint(current, now)) next.status = "in-progress";
  return next;
}

export function recordSolutionView(progressItem = {}, language, now = new Date(), mode = "function") {
  const updatedAt = asDate(now).toISOString();
  const key = contextKey(language, mode);
  const next = {
    ...progressItem,
    viewedSolutionCode: true,
    viewedSolutionLanguage: language,
    viewedSolutionByContext: {
      ...(progressItem.viewedSolutionByContext || {}),
      [key]: { language, mode, viewedAt: updatedAt }
    },
    viewedAt: updatedAt,
    updatedAt
  };
  if (!keepsStatusOnHint(next, now)) next.status = "in-progress";
  return next;
}

export function recordReviewOutcome(progressItem = {}, outcome, now = new Date()) {
  if (!["independent", "needed-hint", "needed-solution", "failed"].includes(outcome)) throw new RangeError(`Unsupported review outcome: ${outcome}`);
  const updatedAt = asDate(now).toISOString();
  const reviewCount = Number(progressItem.reviewCount || 0) + 1;
  const currentInterval = Number(progressItem.reviewIntervalDays || (reviewCount > 1 ? REVIEW_INTERVALS[Math.min(reviewCount - 2, REVIEW_INTERVALS.length - 1)] : 0));
  const next = { ...progressItem, reviewCount, lastReviewOutcome: outcome, updatedAt };
  if (outcome !== "failed") next.completedAt = progressItem.completedAt || updatedAt;
  if (outcome === "independent") {
    next.independentPassAt = updatedAt;
    const reviewStep = Number.isInteger(progressItem.reviewStep) ? progressItem.reviewStep : (currentInterval >= 14 ? 3 : Math.max(0, reviewCount - 2));
    if (reviewStep >= REVIEW_INTERVALS.length - 1) {
      // 这里也要用安全解析：旧的 reviewAt 可能是坏字符串，
      // 一抛错就整条记录写不进去，用户点「重做完成」像没反应。
      const pendingTime = safeTime(progressItem.reviewAt);
      if (pendingTime !== null && pendingTime > asDate(updatedAt).getTime()) {
        next.status = "completed";
        next.reviewIntervalDays = REVIEW_INTERVALS[REVIEW_INTERVALS.length - 1];
        next.reviewStep = REVIEW_INTERVALS.length - 1;
        next.reviewAt = progressItem.reviewAt;
        return next;
      }
      next.status = "mastered";
      next.masteredAt = updatedAt;
      delete next.reviewAt;
      return next;
    }
    const intervalDays = REVIEW_INTERVALS[reviewStep];
    next.status = "completed";
    next.reviewIntervalDays = intervalDays;
    next.reviewStep = Math.min(reviewStep + 1, REVIEW_INTERVALS.length - 1);
    next.reviewAt = addDays(updatedAt, intervalDays);
    return next;
  }
  if (outcome === "needed-hint" || outcome === "needed-solution") {
    next.status = "completed";
    next.reviewIntervalDays = REVIEW_INTERVALS[0];
    next.reviewStep = 0;
    next.reviewAt = addDays(updatedAt, REVIEW_INTERVALS[0]);
    delete next.masteredAt;
    return next;
  }
  next.status = "reviewing";
  next.reviewIntervalDays = REVIEW_INTERVALS[0];
  next.reviewStep = 0;
  next.reviewAt = addDays(updatedAt, REVIEW_INTERVALS[0]);
  delete next.masteredAt;
  return next;
}

export { REVIEW_INTERVALS };
