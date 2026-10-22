// 复习会话：把「到期复习点进去以后会发生什么」从组件里抽出来的纯逻辑。
//
// 为什么单独一个文件：这套判定原来散在 Mistakes.jsx / main.jsx / ProblemDetail.jsx
// 三处，而且三处的口径互不相同 —— 今日新题一个页面按数组原序取、另一个页面按
// 学习顺序取，同一份数据给出完全不同的题；到期复习的日期直接用
// `String(reviewAt).slice(0, 10)` 切 ISO 串，在东八区晚上八点以后显示的是前一天。
// 这些都不报错，只是数字悄悄错了，所以必须能被单测钉住。

import { derivePracticeStatus } from "./status.js";
import { REVIEW_INTERVALS } from "./status.js";

/** 「重写」时编译器里那份空白模板应该来自哪里。 */
export const REVIEW_MODES = Object.freeze({
  rewrite: "rewrite",
  review: "review"
});

function asTime(value) {
  if (value === undefined || value === null || value === "") return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

/**
 * 到期队列的排序：逾期最久的排最前。
 *
 * 以前按 hot100.json 的数组原序显示，逾期 3 天的题可能排在昨天刚逾期的题后面。
 * 复习队列唯一有意义的顺序就是「谁欠得更久」。
 */
export function sortDueQueue(progress = {}, questions = []) {
  return questions
    .filter((question) => derivePracticeStatus(progress[question.id]) === "due")
    .sort((a, b) => {
      const left = asTime(progress[a.id]?.reviewAt) ?? Number.POSITIVE_INFINITY;
      const right = asTime(progress[b.id]?.reviewAt) ?? Number.POSITIVE_INFINITY;
      // 复习日相同的退化成学习顺序，保证排序稳定、刷新不跳动。
      return left - right || (a.studyOrder ?? Infinity) - (b.studyOrder ?? Infinity);
    });
}

/**
 * 首页「需要重做」那一栏的排序：到期复习排在错题前面，各自内部也有顺序。
 *
 * 到期复习按 reviewAt 升序（欠得最久的先还）；错题按 reviewCount 降序
 * （反复做错的先处理）。以前这里直接用 studyQuestions 的原序，
 * 于是逾期 20 天的题排在昨天刚到期后面，点进去的还是上次那份代码。
 */
export function sortReviewQueue(progress = {}, questions = []) {
  return questions
    .map((question) => ({ question, item: progress[question.id] || {}, status: derivePracticeStatus(progress[question.id]) }))
    .filter(({ status }) => status === "due" || status === "reviewing")
    .sort((a, b) => {
      const rank = (status) => (status === "due" ? 0 : 1);
      const byRank = rank(a.status) - rank(b.status);
      if (byRank) return byRank;
      if (a.status === "due") {
        return (asTime(a.item.reviewAt) ?? Number.POSITIVE_INFINITY) - (asTime(b.item.reviewAt) ?? Number.POSITIVE_INFINITY);
      }
      return Number(b.item.reviewCount || 0) - Number(a.item.reviewCount || 0);
    });
}

/**
 * 「逾期了多久」的人话。返回 `{ days, text }`，days 为负数表示还没到期。
 *
 * 只用日历日差，不用小时的浮点数 —— 复习间隔本身就是整天粒度，
 * 显示「逾期 0.7 天」对使用者没有任何意义。
 */
export function describeOverdue(reviewAt, now = new Date()) {
  const due = asTime(reviewAt);
  const current = asTime(now) ?? Date.now();
  if (due === null) return { days: null, text: "未安排复习" };
  const day = 24 * 60 * 60 * 1000;
  const days = Math.round((current - due) / day);
  if (days > 0) return { days, text: `已逾期 ${days} 天` };
  if (days === 0) return { days, text: "今天到期" };
  return { days, text: `还有 ${-days} 天到期` };
}

const REVIEW_PREFIXES = { java: "Java", python: "Python" };

/**
 * 复习通过后给的反馈文案：「下次复习：3 天后（10 月 17 日）」。
 *
 * 这是之前完全缺失的一环：题做对之后从列表里消失，用户不知道自己是被
 * 排到 3 天后还是 7 天后，也就无法判断「间隔复习」这件事到底有没有在工作。
 */
export function describeNextReview(progressItem = {}, now = new Date(), language = "java") {
  const status = derivePracticeStatus(progressItem, now);
  if (status !== "completed") return null;
  const due = asTime(progressItem.reviewAt);
  if (due === null) return null;
  const day = 24 * 60 * 60 * 1000;
  const days = Math.max(0, Math.round((due - (asTime(now) ?? Date.now())) / day));
  const date = new Date(due);
  const dateText = `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
  const prefix = REVIEW_PREFIXES[language] || "下次";
  return {
    days,
    dateText,
    text: `${prefix} · 下次复习：${days > 0 ? `${days} 天后` : "今天"}（${dateText}）`
  };
}

/**
 * 今日新题的唯一口径。
 *
 * ProblemBank 用 orderByStudyOrder、Mistakes 用数组原序 —— 于是同一份进度下
 * 两个页面给出完全不同的三题（实测：题库视角是 283/1/136，错题页视角是 1/49/128）。
 * 现在两边都只调这一个函数。
 */
export function pickDailyNew(questions = [], progress = {}, limit = 1, now = new Date()) {
  const size = Math.max(1, Number(limit) || 1);
  return [...questions]
    .sort((a, b) => (a.studyOrder ?? Infinity) - (b.studyOrder ?? Infinity))
    .filter((question) => derivePracticeStatus(progress[question.id], now) === "new")
    .slice(0, size);
}

/**
 * 「另起一种解法」在存档已满时的决策。
 *
 * 以前是 `if (scope.length >= maxVariants) return;` —— 点了毫无反应、也没有任何提示，
 * 用户只会以为按钮坏了。现在满了就退化成「重置当前这份」：仍然能开始重写，
 * 只是不再新增槽位，并且必须在界面上说清楚发生了什么。
 */
export function planFreshAttempt(scope = [], max = 5) {
  if (scope.length < max) return { action: "add", reason: "ok" };
  // 文案里不写具体是哪一份：真正被重置的是「当前选中的这份」，
  // 由调用方在重置后自己说清楚（这里猜错了会指着一个没动的存档说它被清了）。
  return {
    action: "reset-active",
    reason: "full",
    message: `存档已满（${scope.length}/${max} 份），这次直接在当前这份上重新开始；旧代码留了快照，可以撤销，也能切到别的解法继续写。`
  };
}

/**
 * 代码内容指纹：用来判断「这次通过是不是把上次那份原样又跑了一遍」。
 *
 * 去掉空白和注释之后比较。空手点运行不该拿到一次「独立通过」——
 * 那会让 1/3/7/14 的间隔被凭空推进一档，复习记录失去意义。
 */
export function codeFingerprint(code = "") {
  return String(code)
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, "").replace(/#.*$/, "").trim())
    .filter(Boolean)
    .join("\n");
}

/**
 * 这次运行是不是「复用了一份已经通过的代码」。
 * 只有「本次没有任何改动、且与某份已通过的快照逐字一致」才算。
 */
export function isReusedPassingCode(code, passedCodes = []) {
  const fingerprint = codeFingerprint(code);
  if (!fingerprint) return false;
  return passedCodes.some((candidate) => codeFingerprint(candidate) === fingerprint);
}

export { REVIEW_INTERVALS };
