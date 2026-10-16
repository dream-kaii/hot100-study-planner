import test from "node:test";
import assert from "node:assert/strict";
import { compareResult, getEnvironmentStatus, normalizeCaseInput, runExample } from "../src/services/runner.js";

test("compares exact values and reports a useful mismatch", () => {
  assert.deepEqual(compareResult("exact", { value: 1 }, { value: 1 }), { passed: true, message: "" });
  const mismatch = compareResult("exact", [1], [2]);
  assert.equal(mismatch.passed, false);
  assert.match(mismatch.message, /期望/);
});

test("compares unordered arrays and nested unordered arrays structurally", () => {
  assert.equal(compareResult("unordered-array", [3, 1, 2], [1, 2, 3]).passed, true);
  assert.equal(compareResult("unordered-nested", [[2, 1], [3]], [[3], [1, 2]]).passed, true);
  assert.equal(compareResult("unordered-array", [1, 1], [1, 2]).passed, false);
});

test("compares in-place mutation, operation sequence and identity results", () => {
  assert.equal(compareResult("in-place-mutate", { returned: [1], mutated: [2, 3] }, { mutated: [2, 3] }).passed, true);
  assert.equal(compareResult("operation-sequence", [{ op: "get", value: 1 }], [{ op: "get", value: 1 }]).passed, true);
  assert.equal(compareResult("identity", { id: "node-1", value: 7 }, { id: "node-1", value: 7 }).passed, true);
  assert.equal(compareResult("identity", { id: "node-2", value: 7 }, { id: "node-1", value: 7 }).passed, false);
});

test("any-valid respects the expected validity contract", () => {
  assert.equal(compareResult("any-valid", { valid: true }, { valid: false }).passed, false);
});

test("normalizes case input from a question adapter without executing user code", () => {
  const question = { func: { params: [{ name: "nums", type: "int[]" }] } };
  assert.deepEqual(normalizeCaseInput(question, { nums: [1, 2] }), { nums: [1, 2] });
  assert.deepEqual(normalizeCaseInput({}, "raw input"), "raw input");
  assert.deepEqual(normalizeCaseInput({ func: { params: [{ name: "nums" }, { name: "target" }] } }, [[1, 2], 3]), { nums: [1, 2], target: 3 });
});

test("executes a Python function-mode case and compares the real return value", async () => {
  const result = await runExample({
    questionId: "1",
    language: "python",
    mode: "function",
    func: { className: "Solution", methodName: "twoSum", params: [{ name: "nums", type: "int[]" }, { name: "target", type: "int" }] },
    code: "class Solution:\n    def twoSum(self, nums, target):\n        return [0, 1]",
    cases: [{ id: "basic", input: { nums: [2, 7], target: 9 }, expected: [0, 1] }]
  });
  assert.equal(result.status, "passed");
  assert.equal(result.cases[0].status, "passed");
  assert.deepEqual(result.cases[0].actual, [0, 1]);
});

test("executes a Java function-mode case through the declared method signature", async () => {
  const result = await runExample({
    language: "java",
    mode: "function",
    func: { className: "Solution", methodName: "twoSum", params: [{ name: "nums", type: "int[]" }, { name: "target", type: "int" }], returns: "int[]" },
    code: "class Solution { public int[] twoSum(int[] nums, int target) { return new int[]{0, 1}; } }",
    cases: [{ id: "basic", input: { nums: [2, 7], target: 9 }, expected: [0, 1] }]
  });
  assert.equal(result.status, "passed");
  assert.deepEqual(result.cases[0].actual, [0, 1]);
});

test("does not let a client supplied actual value forge a passing case", async () => {
  const result = await runExample({
    language: "python",
    mode: "acm",
    code: "print('wrong')",
    cases: [{ id: "forged", input: "", expected: "right", actual: "right" }]
  });
  assert.equal(result.status, "failed");
  assert.equal(result.cases[0].status, "mismatch");
  assert.equal(result.cases[0].actual, "wrong");
});

test("returns a structured result for every requested case", async () => {
  const result = await runExample({
    questionId: "demo",
    language: "python",
    mode: "acm",
    code: "print('ok')",
    cases: [{ id: "one", input: "", expected: "ok" }, { id: "two", input: "", expected: "bad" }]
  });
  assert.equal(result.status, "failed");
  assert.deepEqual(result.cases.map((item) => [item.caseId, item.status]), [["one", "passed"], ["two", "mismatch"]]);
  assert.equal(typeof result.cases[0].durationMs, "number");
});

test("rejects unsupported languages", async () => {
  const result = await runExample({ language: "ruby", code: "puts 1" });
  assert.equal(result.status, "unsupported");
});

test("normalizes stdout and compares the public example", async () => {
  const result = await runExample({ language: "python", code: "print('ok')", input: "", expectedOutput: " ok \n" });
  assert.equal(result.status, "passed");
  assert.equal(result.output, "ok");
});

test("returns non-zero process failures", async () => {
  const result = await runExample({ language: "python", code: "raise RuntimeError('boom')" });
  assert.equal(result.status, "runtime_error");
  assert.match(result.error, /boom/);
});

test("explains that LeetCode method snippets need a complete program entry", async () => {
  const python = await runExample({ language: "python", code: "class Solution:\n    def twoSum(self, nums, target):\n        return []" });
  const java = await runExample({ language: "java", code: "class Solution { public int[] twoSum(int[] nums, int target) { return new int[0]; } }" });
  assert.equal(python.status, "template");
  assert.equal(java.status, "template");
});

test("runs a complete Java program", async () => {
  const result = await runExample({ language: "java", code: "public class Main { public static void main(String[] args) { System.out.println(\"ok\"); } }", expectedOutput: "ok" });
  assert.equal(result.status, "passed");
});

test("returns a timeout response for a long-running program", async () => {
  const result = await runExample({ language: "python", code: "while True: pass" });
  assert.equal(result.status, "timeout");
});

test("rejects unsupported execution modes before spawning", async () => {
  const result = await runExample({ language: "python", mode: "shell", code: "print('unsafe')" });
  assert.equal(result.status, "unsupported");
  assert.match(result.error, /模式/);
});

test("limits explosive output and remains usable for the next request", async () => {
  const noisy = await runExample({ language: "python", code: "print('x' * 70000)" });
  assert.equal(noisy.status, "output_limit");
  const next = await runExample({ language: "python", code: "print('ok')", expectedOutput: "ok" });
  assert.equal(next.status, "passed");
});

test("counts stdout and stderr together toward the output limit", async () => {
  const result = await runExample({ language: "python", code: "import sys\nsys.stdout.write('x' * 40000)\nsys.stderr.write('e' * 40000)" });
  assert.equal(result.status, "output_limit");
});

test("serializes structured ACM input instead of passing an object to stdin", async () => {
  const result = await runExample({ language: "python", mode: "acm", code: "import sys\nprint(sys.stdin.read())", input: { nums: [1, 2] } });
  assert.equal(result.status, "completed");
  assert.match(result.output, /nums/);
});

test("returns Java compiler diagnostics without throwing", async () => {
  const result = await runExample({ language: "java", code: "public class Main { syntax error }" });
  assert.equal(result.status, "compile_error");
  assert.match(result.error, /error|错误/i);
});

test("reports local runtime availability", async () => {
  const environment = await getEnvironmentStatus();
  assert.equal(typeof environment.python3.available, "boolean");
  assert.equal(typeof environment.javac.available, "boolean");
  assert.match(environment.python3.version || environment.python3.error, /Python|不可用/);
});

test("accepts Java and Python method fragments as well as full custom classes", async () => {
  const func = { className: "Answer", methodName: "twoSum", params: [{ name: "nums", type: "int[]" }, { name: "target", type: "int" }], returns: "int[]", compare: "unordered-array" };
  const snippets = {
    java: "public int[] twoSum(int[] nums, int target) { Map<Integer,Integer> seen = new HashMap<>(); for(int i=0;i<nums.length;i++){ if(seen.containsKey(target-nums[i])) return new int[]{seen.get(target-nums[i]),i}; seen.put(nums[i],i); } return new int[0]; }",
    python: "def twoSum(self, nums: List[int], target: int) -> List[int]:\n    seen = {}\n    for i, n in enumerate(nums):\n        if target-n in seen: return [seen[target-n], i]\n        seen[n] = i\n    return []"
  };
  for (const language of ["java", "python"]) for (const full of [false, true]) {
    const code = !full ? snippets[language] : language === "java" ? `public class Answer { ${snippets.java} }` : `class Answer:\n${snippets.python.split("\n").map(line => '    '+line).join("\n")}`;
    const result = await runExample({language, mode: "function", func, code, cases: [{id:"pair", input:{nums:[3,2,4], target:6}, expected:[1,2]}]});
    assert.equal(result.status, "passed", `${language} full=${full}: ${JSON.stringify(result)}`);
  }
});

test("copied 283 Java and Python solutions compare mutated arrays, including empty input", async () => {
  const { default: solution } = await import('../src/data/solutions/283.json', { with: { type: 'json' } });
  for (const language of ["java", "python"]) {
    const result = await runExample({language, mode:"function", func:solution.func, code:solution[language], cases:[...solution.cases, {id:"empty",input:{nums:[]},expected:[]}]});
    assert.equal(result.status, "passed", `${language}: ${JSON.stringify(result)}`);
    assert.deepEqual(result.cases[0].actual, [1,3,12,0,0]);
    assert.deepEqual(result.cases.at(-1).actual, []);
  }
});

test("uses func.compare for return values instead of defaulting to exact comparison", async () => {
  const result = await runExample({language:"python",mode:"function",func:{className:"Solution",methodName:"twoSum",params:[],returns:"int[]",compare:"unordered-array"},code:"class Solution:\n    def twoSum(self): return [1, 0]",cases:[{id:"pair",input:{},expected:[0,1]}]});
  assert.equal(result.status, "passed", JSON.stringify(result));
});

test("copied 1 and 206 Java/Python solutions pass every structured case", async () => {
  for (const id of ["1", "206"]) {
    const { default: solution } = await import(`../src/data/solutions/${id}.json`, { with: { type: 'json' } });
    for (const language of ["java", "python"]) {
      const result = await runExample({questionId:id, language, mode:"function", func:solution.func, code:solution[language], cases:solution.cases});
      assert.equal(result.status,"passed",`${id} ${language}: ${JSON.stringify(result)}`);
    }
  }
});

test("TreeNode uses level-order construction and serialization rather than linked-list logic", async () => {
  const func={className:"Solution",methodName:"invertTree",params:[{name:"root",type:"TreeNode"}],returns:"TreeNode",compare:"exact"};
  const codes={java:"class Solution { public TreeNode invertTree(TreeNode root) { if(root==null)return null; TreeNode left=root.left;root.left=invertTree(root.right);root.right=invertTree(left);return root;} }",python:"class Solution:\n    def invertTree(self, root: TreeNode) -> TreeNode:\n        if root:\n            root.left, root.right = self.invertTree(root.right), self.invertTree(root.left)\n        return root"};
  for(const language of ["java","python"]) {
    const result=await runExample({language,mode:"function",func,code:codes[language],cases:[{id:"sparse",input:{root:[1,null,2,3]},expected:[1,2,null,null,3]},{id:"empty",input:{root:[]},expected:[]}]});
    assert.equal(result.status,"passed",`${language}: ${JSON.stringify(result)}`);
  }
});

test("copied LRU, Trie and MinStack Java/Python code executes constructors and operation sequences", async () => {
  for (const id of ["146", "208", "155"]) {
    const {default:solution}=await import(`../src/data/solutions/${id}.json`,{with:{type:'json'}});
    for(const language of ["java","python"]) {
      const result=await runExample({questionId:id,language,mode:"function",func:solution.func,code:solution[language],cases:solution.cases});
      assert.equal(result.status,"passed",`${id} ${language}: ${JSON.stringify(result)}`);
    }
  }
});

test("function results serialize nested strings and booleans as JSON", async () => {
  const result=await runExample({language:"java",mode:"function",func:{className:"Solution",methodName:"words",params:[],returns:"List<List<String>>",compare:"exact"},code:'class Solution { public List<List<String>> words() { return Arrays.asList(Arrays.asList("a\\\"b", "中文")); }}',cases:[{id:"strings",input:{},expected:[['a"b','中文']]}]});
  assert.equal(result.status,"passed",JSON.stringify(result));
});

test("malformed function inputs return readable errors without rejecting the entire run", async () => {
  const result=await runExample({language:"java",mode:"function",func:{className:"Solution",methodName:"value",params:[{name:"nums",type:"int[]"}],returns:"int",compare:"exact"},code:"class Solution { public int value(int[] nums){return 0;} }",cases:[{id:"invalid",input:{nums:"not-an-array"},expected:0}]});
  assert.equal(result.status,"failed");
  assert.match(result.cases[0].error,/int\[\]/);
  const next=await runExample({language:"python",mode:"acm",code:"print('ok')",expectedOutput:"ok"});assert.equal(next.status,"passed");
});

test("structured expected strings retain their type even when they look like JSON", async () => {
  for(const language of ["java","python"]) {
    const result=await runExample({language,mode:"function",func:{className:"Solution",methodName:"value",params:[{name:"s",type:"String"}],returns:"String",compare:"exact"},code:language==="java"?'class Solution {public String value(String s){return s;}}':'class Solution:\n    def value(self, s): return s',cases:["true","null","123","[1]"].map(s=>({id:s,input:{s},expected:s}))});
    assert.equal(result.status,"passed",`${language}: ${JSON.stringify(result)}`);
  }
});

test("full Java class modifiers and source strings are preserved correctly", async () => {
  const result=await runExample({language:"java",mode:"function",func:{className:"Solution",methodName:"value",params:[],returns:"String",compare:"exact"},code:'public final class Solution {public String value(){return "public class Example";}}',cases:[{id:"modifiers",input:{},expected:"public class Example"}]});
  assert.equal(result.status,"passed",JSON.stringify(result));
});

test("node definitions remain top-level when pasted together with method fragments",async()=>{
  const func={className:"Solution",methodName:"reverseList",params:[{name:"head",type:"ListNode"}],returns:"ListNode",compare:"exact"};
  const codes={java:'class ListNode {int val; ListNode next; ListNode(int val){this.val=val;}}\npublic ListNode reverseList(ListNode head){ListNode prev=null;while(head!=null){ListNode next=head.next;head.next=prev;prev=head;head=next;}return prev;}',python:'class ListNode:\n    def __init__(self, val=0, next=None):\n        self.val, self.next = val, next\n\ndef reverseList(self, head):\n    prev = None\n    while head:\n        nxt = head.next\n        head.next = prev\n        prev, head = head, nxt\n    return prev'};
  for(const language of ["java","python"]){const r=await runExample({language,mode:"function",func,code:codes[language],cases:[{id:"reverse",input:{head:[1,2,3]},expected:[3,2,1]}]});assert.equal(r.status,"passed",`${language}: ${JSON.stringify(r)}`);}
});
