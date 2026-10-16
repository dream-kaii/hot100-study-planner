import test from "node:test";
import assert from "node:assert/strict";
import hot100 from "../src/data/hot100.json" with { type: "json" };
import solutions from "../src/data/solutions.json" with { type: "json" };

test("every Hot 100 question has one complete local solution record", () => {
  assert.equal(solutions.length, hot100.questions.length);
  const ids = solutions.map((solution) => solution.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const question of hot100.questions) {
    const solution = solutions.find((item) => item.id === question.id);
    assert.ok(solution, `missing solution ${question.id}`);
    assert.ok(solution.summary);
    assert.ok(solution.java);
    assert.ok(solution.python);
    assert.ok(Array.isArray(solution.examples) && solution.examples.length > 0);
    assert.ok(solution.complexity?.time);
    assert.ok(solution.complexity?.space);
    assert.ok(!/见题解分析/.test(`${solution.complexity.time}${solution.complexity.space}`));
    assert.ok(solution.solutionSource);
    assert.ok(solution.fallbackSource);
    assert.ok(solution.description?.length > 100);
    assert.ok(solution.explanation?.length > 100);
    assert.ok(solution.sources?.explanation?.url);
    assert.ok(solution.sources?.java?.url);
    assert.ok(solution.sources?.python?.url);
    assert.ok(solution.thinking?.length > 40);
    assert.ok(solution.summaryText?.length > 20);
    assert.ok(Array.isArray(solution.tables));
    assert.ok(Array.isArray(solution.images));
  }
});

test("solution content is separated into thinking, summary, tables and media", () => {
  for (const solution of solutions) {
    assert.equal(solution.explanation.includes("C++代码"), false, `${solution.id}: unrelated language leaked into explanation`);
    assert.equal(solution.explanation.includes("```"), false, `${solution.id}: code fence leaked into explanation`);
    for (const table of solution.tables) {
      assert.ok(table.headers.length > 0);
      assert.ok(table.rows.length > 0);
    }
    for (const image of solution.images) assert.match(image.url, /^(https?:\/\/|\/solutions\/)/);
  }
});

test("all problems contain real statements, public examples and source-specific solutions", () => {
  const programs = new Set();
  for (const question of hot100.questions) {
    const solution = solutions.find((item) => item.id === question.id);
    assert.ok(solution.description?.length > 100, `${question.id}: missing problem statement`);
    assert.ok(solution.explanation?.length > 100, `${question.id}: missing explanatory text`);
    assert.ok(!/经典算法完成题目|请按题目要求填写|return nums\s*$/.test(solution.summary + solution.python), `${question.id}: placeholder content`);
    assert.ok(solution.examples.every((item) => item.input && item.output && !/请按题目要求填写/.test(item.input + item.output)), `${question.id}: placeholder examples`);
    assert.ok(solution.sources?.java?.url && solution.sources?.python?.url && solution.sources?.explanation?.url, `${question.id}: missing exact attribution`);
    assert.ok(!/programmercarl\.com\/[^/]+\.html$/.test(solution.solutionSource) || solution.sources.explanation.label.includes("代码随想录"), `${question.id}: unverified Carl URL`);
    programs.add(solution.python);
  }
  assert.equal(programs.size, 100, "every problem must have its own algorithm");
});

test("code-thinking records keep the exact repository as their knowledge source", () => {
  const twoSum = solutions.find((item) => item.id === "1");
  assert.match(twoSum.sources.explanation.url, /programmercarl\.com\/0001\./);
  assert.match(twoSum.sources.java.url, /youngyangyang04\/leetcode-master/);
  assert.match(twoSum.sources.python.url, /youngyangyang04\/leetcode-master/);
  assert.match(twoSum.explanation, /哈希|map|Map/);
});
