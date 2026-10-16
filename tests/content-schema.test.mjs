import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import hot100 from "../src/data/hot100.json" with { type: "json" };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const solutionDirectory = path.join(root, "src/data/solutions");
const compareValues = new Set([
  "exact",
  "unordered-array",
  "unordered-nested",
  "float-tolerance",
  "in-place-mutate",
  "any-valid",
  "operation-sequence",
  "identity",
]);
const sourceTypes = new Set(["official", "codesuixianglu", "community", "site"]);

function readSolutions() {
  return fs.readdirSync(solutionDirectory)
    .filter((file) => /^\d+\.json$/.test(file))
    .sort((a, b) => Number(a.slice(0, -5)) - Number(b.slice(0, -5)))
    .map((file) => JSON.parse(fs.readFileSync(path.join(solutionDirectory, file), "utf8")));
}

function assertNoPlaceholder(value, location) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  assert.ok(text && !/(请按题目要求填写|待补充|TODO|占位|见题解分析|版本一|your answer)/i.test(text), `${location}: placeholder content`);
}

test("Hot 100 study order is a unique acyclic 1..100 sequence", () => {
  const questions = hot100.questions;
  assert.equal(questions.length, 100);
  const ids = new Set(questions.map((question) => question.id));
  const orders = questions.map((question) => question.studyOrder);
  assert.equal(ids.size, 100, "question ids must be unique");
  assert.deepEqual([...orders].sort((a, b) => a - b), Array.from({ length: 100 }, (_, index) => index + 1));

  const byId = new Map(questions.map((question) => [question.id, question]));
  for (const question of questions) {
    assert.ok(typeof question.phase === "string" && question.phase.length > 0, `${question.id}.phase`);
    assert.ok(Array.isArray(question.concepts) && question.concepts.length > 0, `${question.id}.concepts`);
    assert.ok(Array.isArray(question.prerequisites), `${question.id}.prerequisites`);
    for (const prerequisite of question.prerequisites) {
      const target = byId.get(String(prerequisite));
      assert.ok(target, `${question.id}.prerequisites: unknown question ${prerequisite}`);
      assert.ok(target.studyOrder < question.studyOrder, `${question.id}.prerequisites: ${prerequisite} is not earlier`);
    }
  }

  const visiting = new Set();
  const visited = new Set();
  function visit(id, trail = []) {
    if (visiting.has(id)) {
      const start = trail.indexOf(id);
      throw new Error(`cycle: ${[...trail.slice(start), id].join(" -> ")}`);
    }
    if (visited.has(id)) return;
    visiting.add(id);
    const question = byId.get(id);
    for (const prerequisite of question.prerequisites) visit(String(prerequisite), [...trail, id]);
    visiting.delete(id);
    visited.add(id);
  }
  for (const question of questions) visit(question.id);
});

test("every solution has the learning, execution, source and ACM contract", () => {
  const solutions = readSolutions();
  const questionIds = new Set(hot100.questions.map((question) => question.id));
  assert.equal(solutions.length, 100);
  assert.equal(new Set(solutions.map((solution) => solution.id)).size, 100);
  for (const solution of solutions) {
    const prefix = `solution ${solution.id}`;
    assert.ok(questionIds.has(solution.id), `${prefix}: unknown id`);
    assert.ok(solution.recognition?.trim(), `${prefix}.recognition`);
    assert.ok(Array.isArray(solution.hints) && solution.hints.length === 4, `${prefix}.hints`);
    assert.deepEqual(solution.hints.map((hint) => hint.level), [1, 2, 3, 4], `${prefix}.hints.level`);
    for (const hint of solution.hints) {
      assert.ok(hint.text?.trim(), `${prefix}.hints[${hint.level}].text`);
      assertNoPlaceholder(hint.text, `${prefix}.hints[${hint.level}].text`);
    }
    assert.ok(Array.isArray(solution.steps) && solution.steps.length >= 2, `${prefix}.steps`);
    assert.ok(Array.isArray(solution.walkthrough) && solution.walkthrough.length >= 1, `${prefix}.walkthrough`);
    assert.ok(solution.correctness?.trim(), `${prefix}.correctness`);
    assert.ok(Array.isArray(solution.pitfalls) && solution.pitfalls.length >= 1, `${prefix}.pitfalls`);
    assert.ok(solution.func && typeof solution.func.className === "string", `${prefix}.func`);
    assert.ok(solution.func.methodName?.trim(), `${prefix}.func.methodName`);
    assert.ok(Array.isArray(solution.func.params), `${prefix}.func.params`);
    assert.ok(solution.func.returns?.trim(), `${prefix}.func.returns`);
    assert.ok(compareValues.has(solution.func.compare), `${prefix}.func.compare`);
    assert.ok(Array.isArray(solution.cases) && solution.cases.length >= 3, `${prefix}.cases`);
    const caseIds = new Set(solution.cases.map((item) => item.id));
    assert.equal(caseIds.size, solution.cases.length, `${prefix}.cases ids must be unique`);
    for (const item of solution.cases) {
      assert.ok(item.id?.trim(), `${prefix}.cases.id`);
      assert.ok(item.input && typeof item.input === "object", `${prefix}.${item.id}.input`);
      assert.ok(Object.prototype.hasOwnProperty.call(item, "expected"), `${prefix}.${item.id}.expected`);
      assert.ok(Array.isArray(item.tags) && item.tags.length > 0, `${prefix}.${item.id}.tags`);
    }
    assert.ok(solution.cases.some((item) => item.tags.includes("basic")), `${prefix}.cases.basic`);
    assert.ok(solution.cases.some((item) => item.tags.includes("boundary")), `${prefix}.cases.boundary`);
    assert.ok(solution.cases.some((item) => item.tags.includes("adversarial")), `${prefix}.cases.adversarial`);
    assert.ok(solution.acm?.input?.trim(), `${prefix}.acm.input`);
    assert.ok(solution.acm?.output?.trim(), `${prefix}.acm.output`);
    assert.ok(Array.isArray(solution.acm.examples) && solution.acm.examples.length > 0, `${prefix}.acm.examples`);
    for (const example of solution.acm.examples) {
      assert.ok(example.input?.trim() && example.output?.trim(), `${prefix}.acm.examples`);
    }
    assert.ok(Array.isArray(solution.sources) && solution.sources.length > 0, `${prefix}.sources`);
    for (const source of solution.sources) {
      assert.ok(sourceTypes.has(source.type), `${prefix}.sources.type`);
      assert.ok(source.label?.trim() && /^https?:\/\//.test(source.url), `${prefix}.sources.url`);
    }
    for (const field of ["recognition", "steps", "walkthrough", "correctness", "pitfalls", "summaryText"]) assertNoPlaceholder(solution[field], `${prefix}.${field}`);
    for (const code of [solution.java, solution.python]) {
      assert.ok(code?.trim(), `${prefix}: missing executable code`);
      assert.equal(/```/.test(code), false, `${prefix}: executable code contains Markdown fence`);
    }
  }
});

