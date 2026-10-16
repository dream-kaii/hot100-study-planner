const REVIEW_INTERVALS = [1, 3, 7, 14];

function asDate(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError("Invalid date");
  return date;
}

function addDays(value, days) {
  const date = asDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function contextKey(language = "java", mode = "function") {
  return `${language}:${mode}`;
}

export function classifyAttemptOutcome({ passed, attemptHintsUsed = 0, attemptViewedSolutionCode = false }) {
  if (!passed) return "failed";
  if (attemptViewedSolutionCode) return "needed-solution";
  if (Number(attemptHintsUsed) > 0) return "needed-hint";
  return "independent";
}

function normalizedStatus(progressItem, now) {
  if (!progressItem) return "new";
  if (progressItem.masteredAt || progressItem.status === "mastered" || progressItem.status === "已掌握") return "mastered";
  const status = {
    未开始: "new",
    思考中: "in-progress",
    已完成: "completed",
    错题: "reviewing",
    待复习: "reviewing",
    failed: "reviewing"
  }[progressItem.status] || progressItem.status || "new";
  if (progressItem.reviewAt && asDate(progressItem.reviewAt).getTime() <= asDate(now).getTime() && status === "completed") return "reviewing";
  return status;
}

export function derivePracticeStatus(progressItem, now = new Date()) {
  return normalizedStatus(progressItem, now);
}

export function getMasteryLevel(progressItem, now = new Date()) {
  const status = normalizedStatus(progressItem, now);
  if (status === "mastered") return "mastered";
  if (status === "reviewing") return "reviewing";
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
  if (!current.independentPassAt && !["completed", "mastered"].includes(current.status)) next.status = "in-progress";
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
  if (!next.independentPassAt && !["completed", "mastered"].includes(next.status)) next.status = "in-progress";
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
      if (progressItem.reviewAt && asDate(progressItem.reviewAt).getTime() > asDate(updatedAt).getTime()) {
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
