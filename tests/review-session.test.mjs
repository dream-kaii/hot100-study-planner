import test from "node:test";
import assert from "node:assert/strict";
import {
  describeNextReview,
  describeOverdue,
  pickDailyNew,
  planFreshAttempt,
  planReviewRewrite,
  resolveRunOutcome,
  sortDueQueue,
  sortReviewQueue
} from "../src/services/review-session.js";
import { derivePracticeStatus, recordReviewOutcome } from "../src/services/status.js";

const now = "2026-10-14T00:00:00.000Z";

function q(id, studyOrder) {
  return { id, studyOrder, title: `题 ${id}` };
}

test("到期队列按逾期时长排序，而不是按文件的数组原序", () => {
  const questions = [q("1", 2), q("49", 6), q("283", 1), q("136", 3)];
  const progress = {
    // 283 逾期最久，应该排最前 —— 尽管它在 hot100.json 里排第 4 个。
    "283": { status: "completed", reviewAt: "2026-10-01T00:00:00.000Z" },
    "1": { status: "completed", reviewAt: "2026-10-13T00:00:00.000Z" },
    "136": { status: "completed", reviewAt: "2026-10-10T00:00:00.000Z" },
    "49": { status: "completed", reviewAt: "2026-12-01T00:00:00.000Z" }
  };
  assert.deepEqual(sortDueQueue(progress, questions).map((item) => item.id), ["283", "136", "1"]);
});

test("到期队列在复习日相同时退回学习顺序，排序稳定不跳动", () => {
  const questions = [q("9", 30), q("7", 10), q("8", 20)];
  const same = "2026-10-01T00:00:00.000Z";
  const progress = { "7": { status: "completed", reviewAt: same }, "8": { status: "completed", reviewAt: same }, "9": { status: "completed", reviewAt: same } };
  assert.deepEqual(sortDueQueue(progress, questions).map((item) => item.id), ["7", "8", "9"]);
});

test("错题不进到期队列（错题有自己的池子）", () => {
  const questions = [q("1", 1), q("2", 2)];
  const progress = { "1": { status: "reviewing" }, "2": { status: "completed", reviewAt: "2026-10-01T00:00:00.000Z" } };
  assert.deepEqual(sortDueQueue(progress, questions).map((item) => item.id), ["2"]);
});

test("逾期天数用日历日算，不用小时浮点", () => {
  assert.equal(describeOverdue("2026-10-11T00:00:00.000Z", now).text, "已逾期 3 天");
  assert.equal(describeOverdue("2026-10-14T00:00:00.000Z", now).text, "今天到期");
  assert.equal(describeOverdue("2026-10-17T00:00:00.000Z", now).text, "还有 3 天到期");
  // 坏数据不能炸整个列表。
  assert.equal(describeOverdue("not-a-date", now).text, "未安排复习");
  assert.equal(describeOverdue(undefined, now).text, "未安排复习");
});

test("复习日期显示按本地日历，不走 String.slice 切 UTC 串", () => {
  // 固定成东八区再断言，否则测试机在 UTC 时会假通过。
  // 2026-10-16T21:30Z 在 UTC 是 10 月 16 日，在东八区是 10 月 17 日 05:30。
  // 旧的 `${String(reviewAt).slice(0, 10)}` 会把两种时区都显示成 10-16。
  const original = process.env.TZ;
  process.env.TZ = "Asia/Shanghai";
  try {
    const next = describeNextReview({ status: "completed", reviewAt: "2026-10-16T21:30:00.000Z" }, now, "java");
    assert.equal(next.dateText, "10 月 17 日");
    assert.equal(next.days, 3);
    assert.match(next.text, /Java · 下次复习：3 天后（10 月 17 日）/);
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});

test("复习日已经过期时不再提示下下次，交给「待复习」状态表达", () => {
  // reviewAt 在过去 → derivePracticeStatus 派生为 due，不是 completed。
  assert.equal(describeNextReview({ status: "completed", reviewAt: "2026-10-13T00:00:00.000Z" }, now), null);
});

test("复习反馈只在「已完成」时给出，错题和未开始不提示下次复习", () => {
  assert.equal(describeNextReview({ status: "reviewing" }, now), null);
  assert.equal(describeNextReview({}, now), null);
  assert.equal(describeNextReview({ status: "completed" }, now), null);
  const next = describeNextReview({ status: "completed", reviewAt: "2026-10-17T00:00:00.000Z" }, now, "python");
  assert.equal(next.days, 3);
  assert.match(next.text, /^Python · 下次复习：3 天后/);
});

test("今日新题两个页面口径一致，都按学习顺序取", () => {
  // 回归：题库按 orderByStudyOrder、错题页按数组原序，实测给出 283/1/136 vs 1/49/128。
  const questions = [q("1", 2), q("49", 6), q("128", 7), q("283", 1), q("136", 3)];
  const progress = {};
  assert.deepEqual(pickDailyNew(questions, progress, 3).map((item) => item.id), ["283", "1", "136"]);
  // 已经动过的题不算新题。
  assert.deepEqual(pickDailyNew(questions, { "283": { status: "in-progress" } }, 3).map((item) => item.id), ["1", "136", "49"]);
});

test("今日新题数量下限兜到 1，避免被传成 0 时列表空掉", () => {
  const questions = [q("1", 1), q("2", 2)];
  assert.equal(pickDailyNew(questions, {}, 0).length, 1);
  assert.equal(pickDailyNew(questions, {}, undefined).length, 1);
});

test("另起一种解法：没满就新增，满了只解释、不动任何一份存档", () => {
  assert.equal(planFreshAttempt([], 5).action, "add");
  assert.equal(planFreshAttempt([{ id: "a" }], 5).action, "add");
  // 满 5 份现在意味着「真的存了 5 种思路」——复习重写不再占用槽位，
  // 所以不能再像以前那样悄悄把当前这份重置掉，那会销毁用户主动存下的思路。
  const full = planFreshAttempt([{ id: "a", name: "解法 1" }, { id: "b", name: "解法 2" }], 2);
  assert.equal(full.action, "blocked");
  assert.equal(full.reason, "full");
  assert.match(full.message, /2\/2/);
  // 文案里不能点名某一份存档：服务层并不知道 UI 此刻选的是哪一份，
  // 猜名字会指着一份没动的解法说它被清了。
  assert.doesNotMatch(full.message, /解法 2/);
});

test("复习重写：有代码就压版本再清空，空白模板不重复压", () => {
  const template = "class Solution {\n    // 请在这里完成算法\n}";
  // 一份写过、通过过的解法：应该压版本（旧代码不能丢）
  const written = planReviewRewrite({ id: "v1", name: "快慢指针", code: "class Solution { void f() {} }", verdict: "independent" }, template);
  assert.equal(written.action, "snapshot-and-clear");
  assert.equal(written.variantId, "v1");
  // 本来就是一坨空白模板：再点一次「重写」什么都不该发生，
  // 尤其不能往版本栈里塞一版空代码把真的历史挤掉。
  const blank = planReviewRewrite({ id: "v2", name: "解法 2", code: `  ${template}  `, verdict: null }, template);
  assert.equal(blank.action, "already-blank");
  // 还没存过任何解法：直接在草稿里写，不该为了能重写先造一个空槽。
  assert.equal(planReviewRewrite(null, template).action, "draft-only");
});

test("跑通就算独立通过，哪怕代码和上次通过的逐字相同", () => {
  // 这条曾经是反的：指纹一致就降级成「运行完成」，而「运行完成」不改动 progress，
  // 于是错题标记永远清不掉 —— 移动零这类只有一种写法的题，用户重写后写出
  // 和上次一字不差的正确答案，反而被永久锁在错题池里。
  // 现在的判据是「跑通了 + 没用提示」，与代码内容无关。
  assert.equal(resolveRunOutcome({ passed: true }), "independent");
  assert.equal(resolveRunOutcome({ passed: true, hintsUsed: 0, viewedSolutionCode: false }), "independent");
});

test("用没用提示决定是哪种通过，没通过就是失败", () => {
  assert.equal(resolveRunOutcome({ passed: true, hintsUsed: 1 }), "needed-hint");
  assert.equal(resolveRunOutcome({ passed: true, viewedSolutionCode: true }), "needed-solution");
  // 看过题解优先于用过提示：题解比提示给的信息更多，记更保守的那个。
  assert.equal(resolveRunOutcome({ passed: true, hintsUsed: 2, viewedSolutionCode: true }), "needed-solution");
  assert.equal(resolveRunOutcome({ passed: false }), "failed");
  assert.equal(resolveRunOutcome({ passed: false, hintsUsed: 3 }), "failed");
});

test("硬失败压过一切，预览只记运行完成", () => {
  assert.equal(resolveRunOutcome({ hardFailure: true, passed: true }), "failed");
  assert.equal(resolveRunOutcome({ hardFailure: true, hintsUsed: 1 }), "failed");
  // 预览历史版本跑通的代码不是这次写的：进历史，但不动复习阶梯。
  assert.equal(resolveRunOutcome({ previewing: true, passed: true }), "completed");
  assert.equal(resolveRunOutcome({ previewing: true, passed: true, hintsUsed: 2 }), "completed");
  // 预览时跑挂了也不记失败：翻旧代码不该被罚成错题。
  // 记 failed 会把题目推进 reviewing，用户只是点开看了一眼就得去重做。
  assert.equal(resolveRunOutcome({ previewing: true, hardFailure: true }), "completed");
});

// pickReviewSnapshot 需要 localStorage，用一个最小内存实现顶住。
test("「看上次的写法」优先落在最近一次通过的代码上，包括历史版本里的", async () => {
  // local-store.js 走的是 window.localStorage（拿不到就静默降级成内存态），
  // 所以这里必须挂在 window 上，只设 globalThis.localStorage 是不生效的。
  const store = new Map();
  const memoryStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key)
  };
  globalThis.window = { localStorage: memoryStorage };
  const { pickReviewSnapshot, pickReviewVariant, readActiveVariant, writeActiveVariant } = await import("../src/services/active-variant.js");
  const scope = [
    { id: "v1", name: "暴力", code: "class S { void a() {} }", verdict: "failed", verifiedAt: null, updatedAt: "2026-10-01T00:00:00.000Z", versions: [] },
    { id: "v2", name: "哈希", code: "class S { void b() {} }", verdict: "needed-hint", verifiedAt: "2026-10-05T00:00:00.000Z", updatedAt: "2026-10-05T00:00:00.000Z", versions: [] },
    { id: "v3", name: "双指针", code: "class S { void c() {} }", verdict: "independent", verifiedAt: "2026-10-09T00:00:00.000Z", updatedAt: "2026-10-09T00:00:00.000Z", versions: [] }
  ];
  // 上次停在 v1（那份没通过），但复习要看的是最近通过过的 v3。
  writeActiveVariant("1", "java", "function", "v1");
  assert.equal(readActiveVariant("1", "java", "function", scope), "v1");
  assert.equal(pickReviewVariant("1", "java", "function", scope), "v3");
  assert.equal(pickReviewSnapshot("1", "java", "function", scope).code, "class S { void c() {} }");

  // 一份都没通过过时退回默认规则（接着上次那份写），不能返回空。
  const loose = [{ id: "v1", name: "解法 1", code: "class S { void a() {} }", verdict: null, updatedAt: "2026-10-01T00:00:00.000Z", versions: [] }];
  assert.equal(pickReviewVariant("1", "java", "function", loose), "v1");
  assert.equal(pickReviewSnapshot("1", "java", "function", loose).code, "class S { void a() {} }");
  // scope 为空时返回 null，界面据此显示初始模板。
  assert.equal(pickReviewSnapshot("1", "java", "function", []), null);

  // 复习重写之后：当前这份被清成模板，通过过的代码躺在 versions 里。
  // 这时必须翻到历史版本，否则复习一轮之后点「看上次的写法」会看到一张空白模板，
  // 用户第一反应就是「我的代码丢了」。
  const rewritten = [{
    id: "v1",
    name: "双指针",
    code: "",
    verdict: null,
    verifiedAt: null,
    updatedAt: "2026-10-20T00:00:00.000Z",
    versions: [
      { id: "ver-old", code: "class S { void old() {} }", verdict: "needed-hint", verifiedAt: "2026-10-01T00:00:00.000Z", savedAt: "2026-10-15T00:00:00.000Z", reason: "复习重写" },
      { id: "ver-new", code: "class S { void best() {} }", verdict: "independent", verifiedAt: "2026-10-12T00:00:00.000Z", savedAt: "2026-10-18T00:00:00.000Z", reason: "复习重写" }
    ]
  }];
  const fromHistory = pickReviewSnapshot("1", "java", "function", rewritten);
  assert.equal(fromHistory.variantId, "v1");
  assert.equal(fromHistory.versionId, "ver-new");
  assert.equal(fromHistory.code, "class S { void best() {} }");
  // 标签要能说清「这是哪份解法的哪一版」，预览条直接把它显示给用户看。
  assert.match(fromHistory.label, /双指针/);
  assert.match(fromHistory.label, /复习重写/);
});

test("首页「需要重做」：到期在前按逾期升序，错题在后按做错次数降序", () => {
  const questions = [
    { id: "1", studyOrder: 1 },
    { id: "2", studyOrder: 2 },
    { id: "3", studyOrder: 3 },
    { id: "4", studyOrder: 4 },
    { id: "5", studyOrder: 5 }
  ];
  const now = new Date("2026-10-20T00:00:00.000Z");
  const progress = {
    // 到期：2 号欠得最久，其次 1 号
    "1": { status: "completed", reviewAt: "2026-10-15T00:00:00.000Z" },
    "2": { status: "completed", reviewAt: "2026-10-01T00:00:00.000Z" },
    // 错题：4 号做过 3 次，3 号 1 次
    "3": { status: "reviewing", reviewCount: 1 },
    "4": { status: "reviewing", reviewCount: 3 },
    // 5 号没动过，不该出现
    "5": {}
  };
  const queue = sortReviewQueue(progress, questions);
  assert.deepEqual(queue.map((entry) => entry.question.id), ["2", "1", "4", "3"]);
  // 前端要能区分两种语气：到期是「该复习了」，错题是「没做出来」。
  assert.deepEqual(queue.map((entry) => entry.status), ["due", "due", "reviewing", "reviewing"]);
});

test("重做跑通后必须离开错题池：错题 + 独立通过 → 不再是 reviewing", () => {
  // 移动零（#283）只有一种写法。用户被标成错题后点「重写」，写出和上次
  // 一字不差的正确答案，跑通了却还留在错题池 —— 这就是死锁的现场。
  // 两个环节都必须成立：判定给出 independent，且这个结论真的推进了状态。
  const reviewing = {
    status: "reviewing",
    reviewAt: "2026-10-19T00:00:00.000Z",
    reviewCount: 1,
    completedAt: "2026-10-01T00:00:00.000Z"
  };
  const outcome = resolveRunOutcome({ passed: true });
  assert.equal(outcome, "independent");

  const next = recordReviewOutcome(reviewing, outcome, "2026-10-20T08:00:00.000Z");
  assert.notEqual(next.status, "reviewing");
  assert.equal(derivePracticeStatus(next, new Date("2026-10-20T08:00:00.000Z")), "completed");
  // 也不能反过来直接变成「已掌握」—— 错题重做一次只是回到正常复习节奏。
  assert.equal(next.status, "completed");
  assert.ok(next.reviewAt > "2026-10-20T08:00:00.000Z");
});

test("只有预览历史版本时跑的代码不改变错题标记", () => {
  // 预览是「翻阅」，不是「重做」。它记成 completed，而 completed 不改 progress，
  // 所以错题依旧是错题 —— 这是有意的，和上面那条并不矛盾。
  assert.equal(resolveRunOutcome({ previewing: true, passed: true }), "completed");
});
