import { derivePracticeStatus, recordReviewOutcome } from "./status.js";

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

// 「复习到期」的唯一判据。
//
// 以前这里只看 reviewAt 是否过期，不看派生状态，于是：
//   手动把一道题点成「思考中」后，旧的 reviewAt 还留在记录里 ——
//   总览的待复习统计按派生状态算是 0，错题页按这里算是 1，两处又对不上。
// 现在一律走 derivePracticeStatus：派生为 due 才算到期，单一来源。
export function isReviewDue(progressItem, now = new Date()) {
  return derivePracticeStatus(progressItem, now) === "due";
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
