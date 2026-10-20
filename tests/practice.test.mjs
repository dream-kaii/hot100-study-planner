import test from "node:test";
import assert from "node:assert/strict";
import { derivePracticeStatus, filterQuestions, justReachedZero, minutesFromTimer, normalizeStoredTimer, pickNextQuestion, shouldReportTimer, timerReducer } from "../src/services/practice.js";

const questions = [
  { id: "1", order: 1, title: "两数之和", category: "哈希", difficulty: "EASY" },
  { id: "2", order: 2, title: "二叉树", category: "二叉树", difficulty: "MEDIUM" },
  { id: "3", order: 3, title: "错题", category: "哈希", difficulty: "HARD" }
];
const progress = { "1": { status: "已完成" }, "2": { status: "错题" }, "3": { status: "错题" } };

test("filters by query, category, difficulty and status", () => {
  assert.deepEqual(filterQuestions(questions, progress, { query: "二叉", category: "全部", difficulty: "全部", status: "全部" }).map((q) => q.id), ["2"]);
  assert.deepEqual(filterQuestions(questions, progress, { query: "", category: "哈希", difficulty: "HARD", status: "错题" }).map((q) => q.id), ["3"]);
});

test("sequential mode follows Hot 100 order and random mode uses the provided random function", () => {
  assert.equal(pickNextQuestion(questions, { mode: "sequential", currentId: "1" }).id, "2");
  assert.equal(pickNextQuestion(questions, { mode: "random", random: () => 0.9 }).id, "3");
});

test("timer reducer starts, pauses, resets and clamps at zero", () => {
  let state = { remaining: 10, running: false };
  state = timerReducer(state, { type: "start" }); assert.deepEqual(state, { remaining: 10, running: true });
  state = timerReducer(state, { type: "tick", seconds: 4 }); assert.deepEqual(state, { remaining: 6, running: true });
  state = timerReducer(state, { type: "pause" }); assert.equal(state.running, false);
  state = timerReducer(state, { type: "tick", seconds: 9 }); assert.equal(state.remaining, 0);
  state = timerReducer(state, { type: "reset", duration: 25 }); assert.deepEqual(state, { remaining: 25, running: false });
});

test("timer duration changes reset the displayed remaining time", () => {
  assert.deepEqual(timerReducer({ remaining: 812, running: true }, { type: "set-duration", duration: 900 }), { remaining: 900, running: false });
});

test("practice service exposes the shared derived status contract", () => {
  assert.equal(derivePracticeStatus({ status: "已完成" }, "2026-10-14T00:00:00.000Z"), "completed");
});

test("sequential practice sorts by studyOrder instead of raw problem array order", () => {
  const mixed=[{id:"1",studyOrder:3},{id:"283",studyOrder:1},{id:"53",studyOrder:2}];
  assert.equal(pickNextQuestion(mixed).id,"283");
  assert.equal(pickNextQuestion(mixed,{currentId:"283"}).id,"53");
  assert.equal(pickNextQuestion(mixed,{currentId:"1"}),null);
});

test("main learning entry follows the earliest unfinished study item and ignores review dates", async () => {
  const practice=await import('../src/services/practice.js');
  const {default:hot100}=await import('../src/data/hot100.json',{with:{type:'json'}});
  const pick=practice.pickStudyQuestion;
  assert.equal(pick?.(hot100.questions,{})?.id,"283");
  assert.equal(pick(hot100.questions,{"283":{status:"completed"}}).id,"1");
  const first=hot100.questions.filter(q=>q.phase.startsWith('阶段一'));
  const progress=Object.fromEntries(first.map(q=>[q.id,{status:"completed",reviewAt:"2020-01-01T00:00:00Z"}]));
  assert.equal(pick(hot100.questions,progress).studyOrder,14);
  progress['283']={status:"reviewing",lastReviewOutcome:"independent",independentPassAt:"2020-01-01T00:00:00Z",reviewAt:"2020-01-01T00:00:00Z"};
  assert.equal(pick(hot100.questions,progress).studyOrder,14);
  progress['1']={status:"in-progress"};
  assert.equal(pick(hot100.questions,progress).id,"1");
  assert.equal(pick(hot100.questions,Object.fromEntries(hot100.questions.map(q=>[q.id,{status:"mastered"}]))),null);
});

test("previous and next navigation follow studyOrder and stop at both ends", async () => {
  const { pickPreviousQuestion } = await import("../src/services/practice.js");
  const mixed=[{id:"last",studyOrder:3},{id:"first",studyOrder:1},{id:"middle",studyOrder:2}];
  assert.equal(pickPreviousQuestion(mixed,{currentId:"first"}),null);
  assert.equal(pickPreviousQuestion(mixed,{currentId:"middle"}).id,"first");
  assert.equal(pickPreviousQuestion(mixed,{currentId:"last"}).id,"middle");
  assert.equal(pickNextQuestion(mixed,{currentId:"last"}),null);
});

test("mistake filter matches the dashboard counter for overdue completions", () => {
  // 这条是回归测试：以前统计卡用派生状态（到期复习 → reviewing），
  // 题库筛选用原始 status，导致「顶部显示 1 道错题、筛选出来 0 条」。
  const now = new Date("2026-10-19T00:00:00.000Z");
  const overdue = { "1": { status: "completed", reviewAt: "2026-10-10T00:00:00.000Z" } };
  assert.deepEqual(filterQuestions(questions, overdue, { status: "错题" }, now).map((q) => q.id), []);
  assert.deepEqual(filterQuestions(questions, overdue, { status: "待复习" }, now).map((q) => q.id), ["1"]);
  const missed = { "2": { status: "reviewing" } };
  assert.deepEqual(filterQuestions(questions, missed, { status: "错题" }, now).map((q) => q.id), ["2"]);
  assert.deepEqual(filterQuestions(questions, missed, { status: "待复习" }, now).map((q) => q.id), []);
});

test("status filter accepts both canonical values and Chinese labels", () => {
  const now = new Date("2026-10-19T00:00:00.000Z");
  const missed = { "2": { status: "reviewing" } };
  assert.deepEqual(filterQuestions(questions, missed, { status: "reviewing" }, now).map((q) => q.id), ["2"]);
  assert.deepEqual(filterQuestions(questions, missed, { status: "错题" }, now).map((q) => q.id), ["2"]);
});

test("a mastered item never shows up as a mistake even with a stale reviewing status", () => {
  const now = new Date("2026-10-19T00:00:00.000Z");
  const mastered = { "1": { status: "reviewing", masteredAt: "2026-01-01T00:00:00.000Z" } };
  assert.deepEqual(filterQuestions(questions, mastered, { status: "错题" }, now).map((q) => q.id), []);
  assert.deepEqual(filterQuestions(questions, mastered, { status: "已掌握" }, now).map((q) => q.id), ["1"]);
});

test("the done counter does not drop when a completed item's review falls due", async () => {
  // 回归：总进度以前用派生状态数 ["completed","mastered"]。
  // 一道题通过后排了 1 天复习，第二天派生变成 due —— 已经做完的进度会凭空掉一格，
  // 看着像退步。现在「已完成」只问「曾经做完过没有」，与「只抽未完成」「学习主线」同源。
  const { hasCompletedLearning } = await import("../src/services/practice.js");
  const day1 = new Date("2026-10-14T00:00:00.000Z");
  const day3 = new Date("2026-10-16T00:00:00.000Z");
  const finished = { status: "completed", reviewAt: "2026-10-15T00:00:00.000Z" };
  assert.equal(derivePracticeStatus(finished, day1), "completed");
  assert.equal(derivePracticeStatus(finished, day3), "due");
  // 派生状态变了，但「做完过」这件事不变。
  assert.equal(hasCompletedLearning(finished), true);
});

test("only the due filter picks due items, mistake and due never overlap", () => {
  // 回归：「只抽到期复习」以前用 isReviewPending，把错题也算进去，
  // 于是和「只抽错题」抽出同一批题，第二个按钮等于重复。
  const now = new Date("2026-10-19T00:00:00.000Z");
  const mixed = {
    "1": { status: "reviewing" },                                    // 错题
    "2": { status: "completed", reviewAt: "2026-10-10T00:00:00Z" },  // 到期
    "3": { status: "due" }                                            // 到期
  };
  const statuses = ["1", "2", "3"].map((id) => derivePracticeStatus(mixed[id], now));
  assert.deepEqual(statuses, ["reviewing", "due", "due"]);
  assert.deepEqual(filterQuestions(questions, mixed, { status: "错题" }, now).map((q) => q.id), ["1"]);
  assert.deepEqual(filterQuestions(questions, mixed, { status: "待复习" }, now).map((q) => q.id), ["2", "3"]);
});

// 计时器的三处判定抽成纯函数后逐条钉住。
// 「时间到」的提示曾经整整一版从未触发过：reducer 在减到 0 的同一拍
// 已经把 running 置回 false，而旧代码判的是 `remaining === 0 && running`。
test("justReachedZero fires exactly on the tick that runs out", () => {
  assert.equal(justReachedZero(1, 0), true);
  assert.equal(justReachedZero(600, 599), false);
  // 挂载时计时器本来就在 0（上次就归零了），不该再弹一次
  assert.equal(justReachedZero(0, 0), false);
  assert.equal(justReachedZero(undefined, 0), false);
});

test("justReachedZero is reachable through the real reducer path", () => {
  let state = { remaining: 2, running: true };
  const seen = [];
  let previous = state.remaining;
  for (let i = 0; i < 4; i++) {
    state = timerReducer(state, { type: "tick", seconds: 1 });
    if (justReachedZero(previous, state.remaining)) seen.push(i + 1);
    previous = state.remaining;
  }
  // 旧判据 remaining===0 && running 永远为 false，一次都命中不了
  assert.deepEqual(seen, [2]);
  assert.equal(state.running, false);
});

test("timer reporting is throttled while running but immediate when it settles", () => {
  const tick = (remaining, running = true) => ({ remaining, running });
  const snap = (remaining, running = true) => JSON.stringify({ remaining, running });
  // 距上次写盘不到 5 秒：不写（否则 25 分钟要写 1500 次）
  assert.equal(shouldReportTimer({ timer: tick(1499), lastSnapshot: snap(1500), lastReportedAt: 1500 }), false);
  assert.equal(shouldReportTimer({ timer: tick(1496), lastSnapshot: snap(1500), lastReportedAt: 1500 }), false);
  // 攒满 5 秒：写
  assert.equal(shouldReportTimer({ timer: tick(1495), lastSnapshot: snap(1500), lastReportedAt: 1500 }), true);
  assert.equal(shouldReportTimer({ timer: tick(1490), lastSnapshot: snap(1495), lastReportedAt: 1495 }), true);
  // 一次 tick 跨过阈值也算写
  assert.equal(shouldReportTimer({ timer: tick(1400), lastSnapshot: snap(1500), lastReportedAt: 1500 }), true);
  // 内容没变就不写
  assert.equal(shouldReportTimer({ timer: tick(1500), lastSnapshot: snap(1500), lastReportedAt: 1500 }), false);
  // 暂停 / 归零：立刻写，否则刷新会退回几秒前
  assert.equal(shouldReportTimer({ timer: tick(1499, false), lastSnapshot: snap(1500), lastReportedAt: 1500 }), true);
  assert.equal(shouldReportTimer({ timer: tick(0, false), lastSnapshot: snap(3), lastReportedAt: 3 }), true);
  // 首次挂载：立刻写
  assert.equal(shouldReportTimer({ timer: tick(1500), lastSnapshot: "", lastReportedAt: 0 }), true);
});

test("a malformed stored timer degrades to the chosen duration", () => {
  assert.deepEqual(normalizeStoredTimer({ remaining: {}, running: true }, 1500), { remaining: 1500, running: true });
  assert.deepEqual(normalizeStoredTimer({ remaining: -5, running: false }, 1500), { remaining: 1500, running: false });
  assert.deepEqual(normalizeStoredTimer({ remaining: "abc" }, 900), { remaining: 900, running: false });
  assert.deepEqual(normalizeStoredTimer(null, 900), { remaining: 900, running: false });
  assert.deepEqual(normalizeStoredTimer({ remaining: 300.7, running: false }, 1500), { remaining: 300, running: false });
});

test("the duration dropdown follows the stored timer instead of snapping to 25", () => {
  assert.equal(minutesFromTimer({ remaining: 2700 }), 45);
  assert.equal(minutesFromTimer({ remaining: 900 }), 15);
  assert.equal(minutesFromTimer({ remaining: 1500 }), 25);
  // 计时进行中的值不是整分钟，退回默认，别把 25 分钟显示成 24
  assert.equal(minutesFromTimer({ remaining: 1493 }), 25);
  assert.equal(minutesFromTimer({ remaining: {} }), 25);
  assert.equal(minutesFromTimer(null), 25);
});
