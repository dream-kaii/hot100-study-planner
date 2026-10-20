import test from "node:test";
import assert from "node:assert/strict";
import { derivePracticeStatus, filterQuestions, pickNextQuestion, timerReducer } from "../src/services/practice.js";

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
