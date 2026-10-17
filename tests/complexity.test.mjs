import test from "node:test";
import assert from "node:assert/strict";
import { compareComplexity, estimateComplexity } from "../src/services/complexity.js";

test("estimates simple loops, nested loops, sorting and binary search", () => {
  const one = estimateComplexity({ language: "python", code: "for value in nums:\n    print(value)" });
  const two = estimateComplexity({ language: "python", code: "for x in nums:\n    for y in nums:\n        print(x, y)" });
  const sort = estimateComplexity({ language: "java", code: "Arrays.sort(nums);" });
  const binary = estimateComplexity({ language: "python", code: "while left <= right:\n    mid = (left + right) // 2\n    right = mid - 1" });
  assert.equal(one.estimated, "O(n)");
  assert.equal(two.estimated, "O(n²)");
  assert.equal(sort.estimated, "O(n log n)");
  assert.equal(binary.estimated, "O(log n)");
});

test("compares estimated complexity without blocking execution", () => {
  assert.equal(compareComplexity({ expected: "O(n)", estimated: "O(n²)" }).verdict, "too-slow");
  assert.equal(compareComplexity({ expected: "O(n²)", estimated: "O(n²)" }).verdict, "meets");
  assert.equal(compareComplexity({ expected: "O(n)", estimated: "unknown" }).verdict, "unknown");
  assert.equal(compareComplexity({ expected: "", estimated: "O(n)" }).verdict, "unknown");
});

test("ignores comments and strings, and marks branching recursion uncertain", () => {
  const code = "# for x in nums:\ntext = 'for y in nums'\ndef fib(n):\n    if n <= 1: return n\n    return fib(n - 1) + fib(n - 2)";
  const result = estimateComplexity({ language: "python", code });
  assert.match(result.estimated, /指数|unknown|uncertain/);
  assert.ok(["low", "medium", "high"].includes(result.confidence));
});
