import test from "node:test";
import assert from "node:assert/strict";
import {
  createLanguageDrafts,
  getDraftKey,
  getRunResultTitle,
  normalizeDraftRecord,
  selectDraftRecord,
  selectLanguageCode
} from "../src/services/editor.js";

test("uses the first failed case status for a mismatch title", () => {
  assert.equal(getRunResultTitle({
    status: "failed",
    cases: [{ status: "passed" }, { status: "mismatch" }]
  }), "结果不匹配");
});

test("uses the first failed case status for a compile error title", () => {
  assert.equal(getRunResultTitle({
    status: "failed",
    cases: [{ status: "compile_error" }]
  }), "编译错误");
});

test("returns an empty title for null or undefined run results", () => {
  assert.doesNotThrow(() => getRunResultTitle(null));
  assert.equal(getRunResultTitle(null), "");
  assert.doesNotThrow(() => getRunResultTitle(undefined));
  assert.equal(getRunResultTitle(undefined), "");
});

test("returns an empty title for empty or non-object run results", () => {
  assert.equal(getRunResultTitle({}), "");
  assert.equal(getRunResultTitle("failed"), "");
  assert.equal(getRunResultTitle(42), "");
});

test("editor drafts are runnable templates separate from solution code", () => {
  const drafts = createLanguageDrafts({ title: "两数之和" });
  assert.match(selectLanguageCode(drafts, "java"), /public static void main/);
  assert.match(selectLanguageCode(drafts, "python"), /if __name__/);
  assert.notEqual(selectLanguageCode(drafts, "java"), "class Solution {}");
  assert.notEqual(selectLanguageCode(drafts, "python"), "def solve(): pass");
  const changed = { ...drafts, java: "class Solution { int x; }" };
  assert.match(selectLanguageCode(changed, "python"), /if __name__/);
});

test("draft keys keep question, language and mode independent", () => {
  assert.equal(getDraftKey("1", "java", "function"), "1:java:function");
  assert.notEqual(getDraftKey("1", "java", "function"), getDraftKey("1", "java", "acm"));
  assert.notEqual(getDraftKey("1", "java", "function"), getDraftKey("1", "python", "function"));
});

test("draft records normalize missing editor state without sharing mutable defaults", () => {
  const first = normalizeDraftRecord({ code: "class Solution {}" });
  const second = normalizeDraftRecord();
  assert.deepEqual(first, { code: "class Solution {}", cursor: 0, scrollTop: 0, updatedAt: "1970-01-01T00:00:00.000Z" });
  assert.deepEqual(second, { code: "", cursor: 0, scrollTop: 0, updatedAt: "1970-01-01T00:00:00.000Z" });
  first.cursor = 99;
  assert.equal(second.cursor, 0);
});

test("selects code from persisted question language and mode draft records", () => {
  const drafts = { "1": { java: { function: { code: "java function" }, acm: { code: "java acm" } } } };
  assert.equal(selectLanguageCode(drafts, "java", "function", "1"), "java function");
  assert.equal(selectLanguageCode(drafts, "java", "acm", "1"), "java acm");
  assert.deepEqual(selectDraftRecord(drafts, "1", "java", "function"), { code: "java function", cursor: 0, scrollTop: 0, updatedAt: "1970-01-01T00:00:00.000Z" });
});

test("function templates use the actual Java and Python contract", () => {
  const func = { className: "Answer", methodName: "twoSum", params: [{ name: "nums", type: "int[]" }, { name: "target", type: "int" }], returns: "int[]", compare: "unordered-array" };
  const drafts = createLanguageDrafts({ func }, "function");
  assert.match(drafts.java, /class Answer/);
  assert.match(drafts.java, /public int\[\] twoSum\(int\[\] nums, int target\)/);
  assert.match(drafts.python, /class Answer:/);
  assert.match(drafts.python, /def twoSum\(self, nums: List\[int\], target: int\) -> List\[int\]:/);
  assert.doesNotMatch(drafts.java + drafts.python, /Object\.\.\.|\*args/);
});

test("void function templates expose an in-place signature", () => {
  const func = { className: "Solution", methodName: "moveZeroes", params: [{ name: "nums", type: "int[]" }], returns: "void" };
  const drafts = createLanguageDrafts({ func }, "function");
  assert.match(drafts.java, /public void moveZeroes\(int\[\] nums\)/);
  assert.doesNotMatch(drafts.java, /return null/);
  assert.match(drafts.python, /nums: List\[int\]\) -> None:/);
});

test("operation-sequence templates include the declared constructor and every operation", async () => {
  const {default:solution}=await import('../src/data/solutions/146.json',{with:{type:'json'}});
  const drafts=createLanguageDrafts(solution,"function");
  assert.match(drafts.java,/public LRUCache\(int capacity\)/);
  assert.match(drafts.java,/public void put\(int key, int value\)/);
  assert.match(drafts.python,/def __init__\(self, capacity: int\)/);
  assert.match(drafts.python,/def put\(self, key: int, value: int\) -> None:/);
});

test("case diagnostics retain javac output and distinguish runtime, timeout and mismatch", async () => {
  const editor = await import('../src/services/editor.js');
  const result = {status:"failed", cases:[{caseId:"compile",status:"compile_error",error:"Main.java:4: error: cannot find symbol",stderr:"compiler stderr"},{caseId:"runtime",status:"runtime_error",error:"ZeroDivisionError"},{caseId:"slow",status:"timeout",error:"程序运行超过 3 秒"},{caseId:"wrong",status:"mismatch",actual:0,expected:1,error:"结果不匹配"}]};
  const details = editor.getRunResultDetails?.(result);
  assert.equal(details?.length,4);
  assert.deepEqual(details.map(item=>item.title),["编译错误","运行错误","运行超时","结果不匹配"]);
  assert.match(details[0].error,/Main.java:4: error: cannot find symbol/);
  assert.equal(details[3].actual,0);
});

test("ACM mode uses stdin examples instead of function argument cases", async () => {
  const editor=await import('../src/services/editor.js');
  const solution={cases:[{id:"function",input:{nums:[1]},expected:[1]}],acm:{examples:[{input:"1\n1\n",output:"1"}]}};
  assert.deepEqual(editor.getExecutionCases?.(solution,"acm"),[{id:"acm-1",input:"1\n1\n",expected:"1"}]);
  assert.deepEqual(editor.getExecutionCases(solution,"function"),solution.cases);
});
