// 复习会话：把「到期复习点进去以后会发生什么」从组件里抽出来的纯逻辑。
//
// 为什么单独一个文件：这套判定原来散在 Mistakes.jsx / main.jsx / ProblemDetail.jsx
// 三处，而且三处的口径互不相同 —— 今日新题一个页面按数组原序取、另一个页面按
// 学习顺序取，同一份数据给出完全不同的题；到期复习的日期直接用
// `String(reviewAt).slice(0, 10)` 切 ISO 串，在东八区晚上八点以后显示的是前一天。
// 这些都不报错，只是数字悄悄错了，所以必须能被单测钉住。

import { classifyAttemptOutcome, derivePracticeStatus } from "./status.js";
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
 * 用户只会以为按钮坏了。后来改成「满了就重置当前这份」。
 *
 * 现在复习不再吃槽位，满 5 份就真的意味着「你已经存了 5 种思路」，
 * 这时候悄悄清掉其中一份是最糟的处理：那 5 份都是用户主动存的。
 * 所以改成明确的「先删一份」—— 仍然给反馈（提示条），但不动任何数据。
 */
export function planFreshAttempt(scope = [], max = 5) {
  if (scope.length < max) return { action: "add", reason: "ok" };
  return {
    action: "blocked",
    reason: "full",
    message: `存档已满（${scope.length}/${max} 份），这里已经装了 ${scope.length} 种思路。想再存一种，先点「⋯ → 删除这份解法」腾出一个位置（删掉的那份会连它的历史版本一起消失，删之前可以先看一眼要留哪份）。`
  };
}

/**
 * 复习「重写」要怎么开始：在同一份解法上重新写，还是干脆不用动。
 *
 * 这一条是「存档膨胀」的根。原来复习 = appendVariant 一份新的，而 1/3/7/14 的
 * 阶梯意味着一道题走完一轮复习就会产生 4 份副本，加上最初的解法正好 5 份，
 * 把上限吃光 —— 于是一道真有两种思路的题（两数之和 = 暴力 / 哈希）反而没地方放。
 *
 * 现在：重写只发生在某一份解法内部，旧代码压进这份的 versions，槽位数不变。
 */
export function planReviewRewrite(variant, template = "") {
  if (!variant) {
    // 还没存过任何解法：直接在草稿里写，不需要为了「能重写」先造一个空槽。
    return { action: "draft-only", message: "还没有存过解法，这次写的会作为「解法 1」留下来。" };
  }
  const hasCode = String(variant.code || "").trim().length > 0;
  const blank = !variant.verdict && comparable(variant.code) === comparable(template) && comparable(template).length > 0;
  if (!hasCode || blank) {
    // 已经是一张空白模板了，再「重写」一次什么也不该发生 ——
    // 尤其不能再压一版空代码进历史。
    return { action: "already-blank", variantId: variant.id, message: `「${variant.name}」本来就是空白模板，直接写就行。` };
  }
  return {
    action: "snapshot-and-clear",
    variantId: variant.id,
    message: `已把「${variant.name}」上一次的代码收进历史版本，可以随时点「上一次的写法」取回来。`
  };
}

/** 空白判定要和 solutions.js 的判空口径一致：忽略所有空白差异。 */
function comparable(code) {
  return String(code || "").replace(/\s+/g, "");
}

/**
 * 这一次运行该记成什么结论。
 *
 * 这里以前还比过代码指纹：如果这次的代码和某份已经通过的快照逐字一致，就把
 * 结论降级成 "completed"。本意是防「点开到期复习、代码还在、直接点运行，
 * 复习间隔就白推一档」。但那个前提在「复习改成真的重写」之后已经不成立了
 * —— 重写会把编辑器清成空白模板，能跑通的代码只可能是重新写出来的。
 *
 * 留着它的实际后果是个死锁：移动零这类只有一种写法的题，用户重写后写出
 * 和上次一字不差的正确答案，被判成 "completed"；而 "completed" 在
 * recordPracticeOutcome 里不改动 progress，于是错题标记永远清不掉。
 * 写对了反而出不了错题池。
 *
 * 所以判据回到用户能理解的那一条：跑通了就算通过，用没用提示决定是不是
 * 独立通过。这个函数刻意不接受任何「代码内容」参数，避免再次退化成指纹比对。
 */
export function resolveRunOutcome({
  hardFailure = false,
  passed = false,
  hintsUsed = 0,
  viewedSolutionCode = false,
  previewing = false
} = {}) {
  // 只读预览历史版本时跑的那段代码不是这次写的，记成「运行完成」：
  // 进历史，但不动复习阶梯，也不清除任何错题标记。
  if (previewing) return "completed";
  if (hardFailure) return "failed";
  return classifyAttemptOutcome({
    passed,
    attemptHintsUsed: hintsUsed,
    attemptViewedSolutionCode: viewedSolutionCode
  });
}

export { REVIEW_INTERVALS };
