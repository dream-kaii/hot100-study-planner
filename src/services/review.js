import { recordReviewOutcome } from "./status.js";

const REVIEW_INTERVALS = [1, 3, 7, 14];

function asDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError("Invalid date");
  return date;
}

export function getNextReviewAt(status, now = new Date()) {
  const days = {
    错题: REVIEW_INTERVALS[0],
    待复习: REVIEW_INTERVALS[1],
    已完成: REVIEW_INTERVALS[2],
    已掌握: REVIEW_INTERVALS[3],
    reviewing: REVIEW_INTERVALS[0],
    completed: REVIEW_INTERVALS[2],
    mastered: REVIEW_INTERVALS[3]
  }[status] || REVIEW_INTERVALS[0];
  const date = asDate(now);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

export function isReviewDue(progressItem, now = new Date()) {
  if (progressItem?.masteredAt || progressItem?.status === "mastered" || progressItem?.status === "已掌握") return false;
  if (!progressItem?.reviewAt) return false;
  return asDate(progressItem.reviewAt).getTime() <= asDate(now).getTime();
}

export { recordReviewOutcome };

export function advanceReview(progressItem = {}, result, now = new Date()) {
  if (["independent", "needed-hint", "needed-solution", "failed"].includes(result)) return recordReviewOutcome(progressItem, result, now);
  const updatedAt = asDate(now).toISOString();
  const reviewCount = Number(progressItem.reviewCount || 0) + 1;
  const status = result === "correct" ? "已掌握" : "错题";
  const intervalDays = result === "correct"
    ? REVIEW_INTERVALS[Math.min(reviewCount - 1, REVIEW_INTERVALS.length - 1)]
    : REVIEW_INTERVALS[0];
  const reviewDate = asDate(updatedAt);
  reviewDate.setUTCDate(reviewDate.getUTCDate() + intervalDays);
  return {
    ...progressItem,
    status,
    reviewCount,
    reviewAt: reviewDate.toISOString(),
    updatedAt
  };
}
