import test from "node:test";
import assert from "node:assert/strict";
import {
  codeFingerprint,
  describeNextReview,
  describeOverdue,
  isReusedPassingCode,
  pickDailyNew,
  planFreshAttempt,
  sortDueQueue,
  sortReviewQueue
} from "../src/services/review-session.js";

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

test("另起一种解法：没满就新增，满了变成重置当前这份并给出原因", () => {
  assert.equal(planFreshAttempt([], 5).action, "add");
  assert.equal(planFreshAttempt([{ id: "a" }], 5).action, "add");
  const full = planFreshAttempt([{ id: "a", name: "解法 1" }, { id: "b", name: "解法 2" }], 2);
  assert.equal(full.action, "reset-active");
  assert.equal(full.reason, "full");
  assert.match(full.message, /2\/2/);
  // 文案里不能点名某一份存档：真正被重置的是「当前选中的这份」，
  // 服务层并不知道 UI 此刻选的是哪一份，猜名字会指着没动的存档说它被清了。
  assert.doesNotMatch(full.message, /解法 2/);
});

test("代码指纹忽略注释、缩进和空行，能让「原样再跑一次」被认出来", () => {
  const original = "class Solution {\n  int f() { return 1; } // 旧注释\n}";
  const reformatted = "class Solution {\n\n    int f() { return 1; }\n}";
  assert.equal(codeFingerprint(original), codeFingerprint(reformatted));
  assert.notEqual(codeFingerprint(original), codeFingerprint("class Solution {\n  int f() { return 2; }\n}"));
});

test("代码指纹不折叠行内空格：字符串字面量里的差异必须算作改过", () => {
  // 保守取舍：宁可把「只是重新排版」误判成改动（多记一次独立通过的风险），
  // 也不要把 `return "a b"` 与 `return "a  b"` 认成同一份代码 —— 后者会把
  // 一次真实修改吞掉，让间隔复习凭空推进一档。
  const a = 'class Solution { String f() { return "a b"; } }';
  const b = 'class Solution { String f() { return "a  b"; } }';
  assert.notEqual(codeFingerprint(a), codeFingerprint(b));
});

test("复用一份已通过的代码不算独立通过，改过就算", () => {
  const passed = ["class Solution { int f() { return 1; } }"];
  assert.equal(isReusedPassingCode("class Solution { int f() { return 1; } } // 又跑一遍", passed), true);
  assert.equal(isReusedPassingCode("class Solution { int f() { return 2; } }", passed), false);
  // 空代码永远不算复用，交给调用方按「未通过」处理。
  assert.equal(isReusedPassingCode("", passed), false);
  assert.equal(isReusedPassingCode("   ", passed), false);
});

// pickReviewVariant 需要 localStorage，用一个最小内存实现顶住。
test("「看上次的写法」落在最近一次通过的那份解法上", async () => {
  // local-store.js 走的是 window.localStorage（拿不到就静默降级成内存态），
  // 所以这里必须挂在 window 上，只设 globalThis.localStorage 是不生效的。
  const store = new Map();
  const memoryStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key)
  };
  globalThis.window = { localStorage: memoryStorage };
  const { pickReviewVariant, readActiveVariant, writeActiveVariant } = await import("../src/services/active-variant.js");
  const scope = [
    { id: "v1", verdict: "failed", verifiedAt: null, updatedAt: "2026-10-01T00:00:00.000Z" },
    { id: "v2", verdict: "needed-hint", verifiedAt: "2026-10-05T00:00:00.000Z", updatedAt: "2026-10-05T00:00:00.000Z" },
    { id: "v3", verdict: "independent", verifiedAt: "2026-10-09T00:00:00.000Z", updatedAt: "2026-10-09T00:00:00.000Z" }
  ];
  // 上次停在 v1（那份没通过），但复习要看的是最近通过过的 v3。
  writeActiveVariant("1", "java", "function", "v1");
  assert.equal(readActiveVariant("1", "java", "function", scope), "v1");
  assert.equal(pickReviewVariant("1", "java", "function", scope), "v3");

  // 一份都没通过过时退回默认规则（接着上次那份写），不能返回空。
  const loose = [{ id: "v1", verdict: null, updatedAt: "2026-10-01T00:00:00.000Z" }];
  assert.equal(pickReviewVariant("1", "java", "function", loose), "v1");
  // scope 为空时返回 null，界面据此显示初始模板。
  assert.equal(pickReviewVariant("1", "java", "function", []), null);
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
