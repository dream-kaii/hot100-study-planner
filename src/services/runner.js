import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { isVoid, nodeDefinitions, wrapFunctionCode } from "./function-contract.js";

export const MAX_OUTPUT = 64 * 1024;
export const COMPILE_TIMEOUT_MS = 10_000;
export const RUN_TIMEOUT_MS = 3_000;
export const SUPPORTED_LANGUAGES = ["python", "java"];
export const SUPPORTED_MODES = ["function", "acm"];

let executionQueue = Promise.resolve();

function normalize(value = "") { return String(value).replace(/\r\n/g, "\n").trim(); }
function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  return value;
}
function stableStringify(value) { return JSON.stringify(stableValue(value)); }
function multiset(value) { return value.map(stableStringify).sort(); }

export function compareResult(compareMode = "exact", actual, expected) {
  let passed = false;
  if (compareMode === "exact" || compareMode === "operation-sequence") passed = stableStringify(actual) === stableStringify(expected);
  else if (compareMode === "unordered-array") passed = Array.isArray(actual) && Array.isArray(expected) && actual.length === expected.length && multiset(actual).every((item, index) => item === multiset(expected)[index]);
  else if (compareMode === "unordered-nested") {
    const actualItems = Array.isArray(actual) ? actual.map((item) => Array.isArray(item) ? multiset(item) : item) : [];
    const expectedItems = Array.isArray(expected) ? expected.map((item) => Array.isArray(item) ? multiset(item) : item) : [];
    passed = Array.isArray(actual) && Array.isArray(expected) && actualItems.length === expectedItems.length && multiset(actualItems).every((item, index) => item === multiset(expectedItems)[index]);
  } else if (compareMode === "in-place-mutate") passed = stableStringify(actual?.mutated ?? actual) === stableStringify(expected?.mutated ?? expected);
  else if (compareMode === "identity") passed = actual?.id !== undefined && actual?.id === expected?.id;
  else if (compareMode === "float-tolerance") passed = Number.isFinite(Number(actual)) && Number.isFinite(Number(expected)) && Math.abs(Number(actual) - Number(expected)) <= 1e-6;
  else if (compareMode === "any-valid") passed = expected?.valid === undefined ? Boolean(actual?.valid ?? actual === true) : actual?.valid === expected.valid;
  else return { passed: false, message: `不支持的比较方式：${compareMode}` };
  return { passed, message: passed ? "" : `结果不匹配，期望：${stableStringify(expected)}，实际：${stableStringify(actual)}` };
}

export function normalizeCaseInput(question = {}, raw) {
  if (raw && typeof raw === "object" && Object.hasOwn(raw, "input")) return raw.input;
  const params = question?.func?.params;
  if (Array.isArray(params) && Array.isArray(raw)) return Object.fromEntries(params.map((param, index) => [param.name, raw[index]]));
  return raw;
}

function killProcessGroup(child) {
  if (!child?.pid) return;
  try { process.kill(-child.pid, "SIGKILL"); } catch { try { child.kill("SIGKILL"); } catch { /* already exited */ } }
}

function execute(command, args, { cwd, input = "", timeoutMs }) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, detached: true, stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    let error = "";
    let outputBytes = 0;
    let timedOut = false;
    let tooLarge = false;
    let spawnError = null;
    const append = (current, chunk) => {
      const text = chunk.toString();
      const bytes = Buffer.byteLength(text);
      const remaining = MAX_OUTPUT - outputBytes;
      if (bytes > remaining) {
        tooLarge = true;
        outputBytes = MAX_OUTPUT;
        killProcessGroup(child);
        return current + Buffer.from(text).subarray(0, Math.max(0, remaining)).toString();
      }
      outputBytes += bytes;
      return current + text;
    };
    child.stdout.on("data", (chunk) => { output = append(output, chunk); });
    child.stderr.on("data", (chunk) => { error = append(error, chunk); });
    child.on("error", (cause) => { spawnError = cause; });
    const inputText = typeof input === "string" ? input : JSON.stringify(input ?? "");
    if (inputText) child.stdin.write(inputText);
    child.stdin.end();
    const timer = setTimeout(() => { timedOut = true; killProcessGroup(child); }, timeoutMs);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, output, error, timedOut, tooLarge, spawnError });
    });
  });
}

async function probe(command, args) {
  const result = await execute(command, args, { cwd: process.cwd(), timeoutMs: 2_000 });
  if (result.spawnError || result.code !== 0) return { available: false, version: "", error: "本机未找到可用命令" };
  return { available: true, version: normalize(`${result.output}${result.error}`), error: "" };
}

export async function getEnvironmentStatus() {
  return { python3: await probe("python3", ["--version"]), javac: await probe("javac", ["-version"]) };
}

function looksLikeFunction(code = "") { return /class\s+Solution\b/.test(code); }

function templateStatus(language, code, mode, func) {
  if (mode === "function" && !func) return { status: "template", output: "", error: "函数模式需要题目函数签名。", durationMs: 0 };
  if (mode === "acm" && ((language === "python" && /class\s+Solution\s*:/.test(code) && !/if\s+__name__\s*==/.test(code)) || (language === "java" && /class\s+Solution\b/.test(code) && !/static\s+void\s+main\s*\(/.test(code)))) return { status: "template", output: "", error: "这是力扣方法题解模板，请切换到函数模式，或补充 ACM 程序入口后再运行。", durationMs: 0 };
  return null;
}

function operationSequence(func, input) {
  const operations = input?.operations;
  const args = input?.arguments;
  if (!Array.isArray(operations) || !Array.isArray(args) || operations.length !== args.length || operations[0] !== func.className) throw new TypeError("操作序列需要以类名开头的 operations 和对应 arguments");
  return operations.map((name, index) => {
    const spec = index === 0 ? { params: func.constructorParams, returns: "void" } : func.methods?.find(method => method.methodName === name);
    if (!spec || !Array.isArray(args[index]) || spec.params.length !== args[index].length) throw new TypeError(`操作 ${name} 与 func 契约不一致`);
    return { name, args: args[index], ...spec };
  });
}

function pythonOperationSource(code, func, input) {
  operationSequence(func, input);
  return `from __future__ import annotations
from typing import *
from collections import *
from heapq import *
from math import *
from operator import *
from bisect import *
from itertools import *
import json, sys, collections, heapq
${wrapFunctionCode(code, "python", func)}
payload = json.loads(sys.stdin.read())
instance = ${func.className}(*payload['arguments'][0])
results = [None]
for name, args in zip(payload['operations'][1:], payload['arguments'][1:]):
    results.append(getattr(instance, name)(*args))
print(json.dumps(results, ensure_ascii=False, separators=(',', ':')))
`;
}

const JAVA_JSON_HELPER = String.raw`
  static String __hot100_json(Object value) {
    if(value==null)return "null";
    if(value instanceof String || value instanceof Character){
      StringBuilder out=new StringBuilder("\"");
      for(char c:String.valueOf(value).toCharArray()){
        if(c=='"'||c=='\\')out.append('\\').append(c);
        else if(c<32)out.append(String.format("\\u%04x",(int)c));
        else out.append(c);
      }
      return out.append('"').toString();
    }
    if(value instanceof Map){
      StringBuilder out=new StringBuilder("{");boolean first=true;
      for(Object raw:((Map<?,?>)value).entrySet()){Map.Entry<?,?> entry=(Map.Entry<?,?>)raw;if(!first)out.append(',');first=false;out.append(__hot100_json(String.valueOf(entry.getKey()))).append(':').append(__hot100_json(entry.getValue()));}
      return out.append('}').toString();
    }
    if(value instanceof Number || value instanceof Boolean)return String.valueOf(value);
    List<Object> items=new ArrayList<>();
    if(value.getClass().isArray())for(int i=0;i<java.lang.reflect.Array.getLength(value);i++)items.add(java.lang.reflect.Array.get(value,i));
    else if(value instanceof Iterable)for(Object item:(Iterable<?>)value)items.add(item);
    else throw new IllegalArgumentException("无法序列化运行结果: "+value.getClass());
    StringBuilder out=new StringBuilder("[");
    for(int i=0;i<items.size();i++){if(i>0)out.append(',');out.append(__hot100_json(items.get(i)));}
    return out.append(']').toString();
  }
`;

function javaOperationSource(code, func, input) {
  const sequence = operationSequence(func, input);
  const calls = sequence.map((op, index) => {
    const args = op.params.map((p,i)=>javaLiteral(op.args[i],p.type)).join(", ");
    if (index === 0) return `${func.className} instance = new ${func.className}(${args}); results.add(null);`;
    const call = `instance.${op.name}(${args})`;
    return isVoid(op) ? `${call}; results.add(null);` : `results.add(${call});`;
  }).join("\n    ");
  return `${wrapFunctionCode(code, "java", func)}
public class Main {
${JAVA_JSON_HELPER}
  public static void main(String[] args) {
    List<Object> results = new ArrayList<>();
    ${calls}
    System.out.println(__hot100_json(results));
  }
}
`;
}

function pythonFunctionSource(code, func, input) {
  if (func.compare === "operation-sequence") return pythonOperationSource(code, func, input);
  const definitions = nodeDefinitions("python", func, code);
  const params = func.params;
  return `from __future__ import annotations
from typing import *
from collections import *
from functools import *
from heapq import *
from math import *
from operator import *
from bisect import *
from itertools import *
import json, sys, collections, heapq, math, functools, bisect
${definitions}
${wrapFunctionCode(code, "python", func)}

def __hot100_convert(value, kind):
    if kind == 'Node':
        nodes = [Node(pair[0]) for pair in value or []]
        for index, pair in enumerate(value or []):
            nodes[index].next = nodes[index+1] if index+1 < len(nodes) else None
            nodes[index].random = nodes[pair[1]] if pair[1] is not None else None
            __hot100_originals.add(id(nodes[index]))
        return nodes[0] if nodes else None
    if kind == 'ListNode':
        head = tail = None
        for item in value or []:
            node = ListNode(item)
            if head is None: head = node
            else: tail.next = node
            tail = node
        return head
    if kind == 'TreeNode':
        if not value or value[0] is None: return None
        root = TreeNode(value[0]); queue = [root]; index = 1
        for node in queue:
            for side in ['left', 'right']:
                if index < len(value) and value[index] is not None:
                    child = TreeNode(value[index]); setattr(node, side, child); queue.append(child)
                index += 1
        return root
    if kind.endswith('[]'):
        return [__hot100_convert(item, kind[:-2]) for item in value]
    return value

def __hot100_serialize(value, kind):
    if ${JSON.stringify(func.compare || "exact")} == 'identity':
        return {'id': None if value is None else __hot100_ids.get(id(value), 'external')}
    if kind == 'Node':
        nodes = []; indexes = {}; independent = True
        while value is not None:
            if id(value) in indexes: raise ValueError('结果链表存在环')
            if id(value) in __hot100_originals: independent = False
            indexes[id(value)] = len(nodes); nodes.append(value); value = value.next
        pairs = []
        for node in nodes:
            if node.random is not None and id(node.random) not in indexes: independent = False
            pairs.append([node.val, None if node.random is None else indexes.get(id(node.random))])
        return {'nodes': pairs, 'independent': independent}
    if kind == 'ListNode':
        values = []; seen = set()
        while value is not None:
            if id(value) in seen: raise ValueError('结果链表存在环')
            seen.add(id(value)); values.append(value.val); value = value.next
        return values
    if kind == 'TreeNode':
        if value is None: return []
        values = []; queue = [value]; seen = set()
        for node in queue:
            if node is None: values.append(None); continue
            if id(node) in seen: raise ValueError('结果树存在环')
            seen.add(id(node)); values.append(node.val); queue.extend([node.left, node.right])
        while values and values[-1] is None: values.pop()
        return values
    return value

__hot100_ids = {}
__hot100_originals = set()

def __hot100_register_list(node, label):
    index = 0
    while node is not None and id(node) not in __hot100_ids:
        __hot100_ids[id(node)] = label + ':' + str(index)
        index += 1
        node = node.next

def __hot100_register_tree(root, label):
    if root is None: return
    queue = [root]
    for index, node in enumerate(queue):
        if node is None or id(node) in __hot100_ids: continue
        __hot100_ids[id(node)] = label + ':' + str(index)
        queue.extend([node.left, node.right])

def __hot100_find(root, value):
    if root is None or root.val == value: return root
    return __hot100_find(root.left, value) or __hot100_find(root.right, value)

def __hot100_arguments(payload, specs):
    shared = 'listA' in payload and 'listB' in payload and len(specs) == 2
    args = []
    for index, (name, kind) in enumerate(specs):
        if shared:
            raw = payload['listA'] if index == 0 else payload['listB'][:payload['skipB']] if payload['intersectVal'] else payload['listB']
        else: raw = payload[name]
        value = __hot100_find(args[0], raw) if kind == 'TreeNode' and isinstance(raw, int) and args else __hot100_convert(raw, kind)
        args.append(value)
        if kind == 'ListNode': __hot100_register_list(value, ('listA' if index == 0 else 'listB') if shared else name)
        if kind == 'TreeNode': __hot100_register_tree(value, name)
    if shared and payload['intersectVal']:
        shared_node = args[0]
        for _ in range(payload['skipA']): shared_node = shared_node.next
        if args[1] is None: args[1] = shared_node
        else:
            tail = args[1]
            while tail.next: tail = tail.next
            tail.next = shared_node
    if payload.get('pos', -1) >= 0 and args and specs[0][1] == 'ListNode':
        entry = tail = args[0]
        for _ in range(payload['pos']): entry = entry.next
        while tail.next: tail = tail.next
        tail.next = entry
    return args

__hot100_payload = json.loads(sys.stdin.read() or '{}')
__hot100_args = __hot100_arguments(__hot100_payload, ${JSON.stringify(params.map(p=>[p.name,p.type]))})
__hot100_result = getattr(${func.className}(), ${JSON.stringify(func.methodName)})(*__hot100_args)
${isVoid(func) ? "__hot100_result = __hot100_args[0]" : ""}
print(json.dumps(__hot100_serialize(__hot100_result, ${JSON.stringify((isVoid(func) ? params[0]?.type : func.returns) || "Object")}), ensure_ascii=False, separators=(',', ':')))
`;
}

function javaLiteral(value, type = "Object") {
  if (value === null || value === undefined) return "null";
  if (type === "Node") return `__hot100_random(${javaLiteral(value, "Integer[][]")})`;
  if (type === "ListNode") return `__hot100_list(${javaLiteral(value, "int[]")})`;
  if (type === "TreeNode") return `__hot100_tree(${javaLiteral(value, "Integer[]")})`;
  if (type.endsWith("[]") && Array.isArray(value)) {
    const itemType = type.slice(0, -2);
    return `new ${itemType}[]{${value.map(item=>javaLiteral(item,itemType)).join(", ")}}`;
  }
  if (type === "String") return JSON.stringify(String(value));
  if (type === "char") return `'${String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
  if (type === "boolean" || type === "Boolean") return value ? "true" : "false";
  if (/^(int|long|double|float|short|byte|Integer|Long|Double|Float)$/.test(type)) return String(value) + (type === "long" ? "L" : type === "float" ? "f" : "");
  if (/^List<.+>$/.test(type) && Array.isArray(value)) return `new ArrayList<>(Arrays.asList(${value.map(item=>javaLiteral(item,type.slice(5,-1))).join(", ")}))`;
  throw new TypeError(`无法将输入转换为 ${type}`);
}

function javaNodeHelpers(func) {
  const types = [...func.params.map(p=>p.type),func.returns].join(' ');
  return (types.includes("ListNode") ? `
  static ListNode __hot100_list(int[] values) {
    ListNode head=null,tail=null;
    for(int v:values){ListNode node=new ListNode(v);if(head==null)head=node;else tail.next=node;tail=node;}
    return head;
  }
  static Object __hot100_values(ListNode node) {
    List<Integer> values=new ArrayList<>(); Set<ListNode> seen=Collections.newSetFromMap(new IdentityHashMap<ListNode,Boolean>());
    while(node!=null){if(!seen.add(node))throw new IllegalArgumentException("结果链表存在环");values.add(node.val);node=node.next;}
    return values;
  }
` : "") + (types.includes("TreeNode") ? `
  static TreeNode __hot100_tree(Integer[] values) {
    if(values.length==0||values[0]==null)return null;
    TreeNode root=new TreeNode(values[0]); List<TreeNode> queue=new ArrayList<>();queue.add(root);int index=1;
    for(int i=0;i<queue.size()&&index<values.length;i++){
      TreeNode node=queue.get(i);
      if(index<values.length&&values[index]!=null){node.left=new TreeNode(values[index]);queue.add(node.left);}index++;
      if(index<values.length&&values[index]!=null){node.right=new TreeNode(values[index]);queue.add(node.right);}index++;
    }
    return root;
  }
  static Object __hot100_values(TreeNode root) {
    List<Integer> values=new ArrayList<>();if(root==null)return values;
    List<TreeNode> queue=new ArrayList<>();queue.add(root);Set<TreeNode> seen=Collections.newSetFromMap(new IdentityHashMap<TreeNode,Boolean>());
    for(int i=0;i<queue.size();i++){TreeNode node=queue.get(i);if(node==null){values.add(null);continue;}if(!seen.add(node))throw new IllegalArgumentException("结果树存在环");values.add(node.val);queue.add(node.left);queue.add(node.right);}
    while(!values.isEmpty()&&values.get(values.size()-1)==null)values.remove(values.size()-1);
    return values;
  }
` : "");
}

function javaArgumentSetup(func, input) {
  const params = func.params;
  const shared = Array.isArray(input?.listA) && Array.isArray(input?.listB) && params.filter(p=>p.type === 'ListNode').length === 2;
  const lines = [];
  for (const [index, p] of params.entries()) {
    let value = input?.[p.name];
    if (shared) value = index === 0 ? input.listA : input.intersectVal ? input.listB.slice(0,input.skipB) : input.listB;
    const rootIndex = params.findIndex(param=>param.type === 'TreeNode' && Array.isArray(input?.[param.name]));
    const literal = p.type === 'TreeNode' && typeof value === 'number' && rootIndex >= 0 ? `__hot100_find(__hot100_arg${rootIndex}, ${value})` : javaLiteral(value, p.type);
    lines.push(`${p.type} __hot100_arg${index} = ${literal};`);
    if (p.type === 'ListNode') lines.push(`__hot100_register(__hot100_arg${index}, ${JSON.stringify(shared ? index === 0 ? 'listA' : 'listB' : p.name)});`);
    if (p.type === 'TreeNode') lines.push(`__hot100_register(__hot100_arg${index}, ${JSON.stringify(p.name)});`);
  }
  if (shared && input.intersectVal) lines.push(`ListNode shared=__hot100_arg0; for(int i=0;i<${input.skipA};i++)shared=shared.next; if(__hot100_arg1==null)__hot100_arg1=shared;else{ListNode tail=__hot100_arg1;while(tail.next!=null)tail=tail.next;tail.next=shared;}`);
  const listIndex = params.findIndex(p=>p.type === 'ListNode');
  if (listIndex >= 0 && Number.isInteger(input?.pos) && input.pos >= 0) lines.push(`ListNode entry=__hot100_arg${listIndex}, tail=entry;for(int i=0;i<${input.pos};i++)entry=entry.next;while(tail.next!=null)tail=tail.next;tail.next=entry;`);
  return lines.join('\n    ');
}

function javaIdentityHelpers(func) {
  const types = [...func.params.map(p=>p.type),func.returns].join(' ');
  return `static IdentityHashMap<Object,String> __hot100_ids = new IdentityHashMap<>();\n` + (types.includes('ListNode') ? `
  static void __hot100_register(ListNode node,String label) {
    int i=0;while(node!=null&&!__hot100_ids.containsKey(node)){__hot100_ids.put(node,label+":"+i++);node=node.next;}
  }
` : '') + (types.includes('TreeNode') ? `
  static void __hot100_register(TreeNode root,String label) {
    if(root==null)return;List<TreeNode> queue=new ArrayList<>();queue.add(root);
    for(int i=0;i<queue.size();i++){TreeNode node=queue.get(i);if(node==null||__hot100_ids.containsKey(node))continue;__hot100_ids.put(node,label+":"+i);queue.add(node.left);queue.add(node.right);}
  }
  static TreeNode __hot100_find(TreeNode root,int value) {
    if(root==null||root.val==value)return root;
    TreeNode found=__hot100_find(root.left,value);return found!=null?found:__hot100_find(root.right,value);
  }
` : '') + (/(^|\W)Node($|\W)/.test(types) ? `
  static Set<Node> __hot100_originals=Collections.newSetFromMap(new IdentityHashMap<Node,Boolean>());
  static Node __hot100_random(Integer[][] data) {
    Node[] nodes=new Node[data.length];for(int i=0;i<nodes.length;i++){nodes[i]=new Node(data[i][0]);__hot100_originals.add(nodes[i]);}
    for(int i=0;i<nodes.length;i++){nodes[i].next=i+1<nodes.length?nodes[i+1]:null;nodes[i].random=data[i][1]==null?null:nodes[data[i][1]];}
    return nodes.length==0?null:nodes[0];
  }
  static Object __hot100_copy(Node node) {
    List<Node> nodes=new ArrayList<>();IdentityHashMap<Node,Integer> indexes=new IdentityHashMap<>();boolean independent=true;
    while(node!=null){if(indexes.containsKey(node))throw new IllegalArgumentException("结果链表存在环");indexes.put(node,nodes.size());nodes.add(node);if(__hot100_originals.contains(node))independent=false;node=node.next;}
    List<Object> values=new ArrayList<>();
    for(Node current:nodes){if(current.random!=null&&!indexes.containsKey(current.random))independent=false;values.add(Arrays.asList(current.val,current.random==null?null:indexes.get(current.random)));}
    Map<String,Object> result=new LinkedHashMap<>();result.put("nodes",values);result.put("independent",independent);return result;
  }
` : '');
}

function compareFunctionResult(func, input, actual, expected) {
  if (func?.compare !== 'any-valid') return compareResult(func?.compare || 'exact', actual, expected);
  if (func.methodName === 'longestPalindrome') {
    const text = input.s;
    let longest = 0;
    for (let center=0;center<text.length;center++) for (const offset of [0,1]) {
      let left=center,right=center+offset;
      while(left>=0&&right<text.length&&text[left]===text[right]) {longest=Math.max(longest,right-left+1);left--;right++;}
    }
    const passed = typeof actual === 'string' && text.includes(actual) && actual === [...actual].reverse().join('') && actual.length === longest;
    return {passed,message:passed?'':'结果不是输入中的最长回文子串'};
  }
  if (func.methodName === 'sortedArrayToBST') {
    if (!Array.isArray(actual)) return {passed:false,message:'结果必须为二叉树层序数组'};
    const nodes=actual.map(value=>value===null?null:{value,left:null,right:null});
    const queue=nodes[0]?[nodes[0]]:[];let index=1;
    for(const node of queue) for(const side of ['left','right']) {node[side]=nodes[index++]||null;if(node[side])queue.push(node[side]);}
    const inorder=[];let balanced=true;
    function height(node){if(!node)return 0;const left=height(node.left);inorder.push(node.value);const right=height(node.right);if(Math.abs(left-right)>1)balanced=false;return Math.max(left,right)+1;}
    height(nodes[0]);
    const passed=balanced&&stableStringify(inorder)===stableStringify(input.nums)&&index>=actual.length;
    return {passed,message:passed?'':'结果必须包含输入全部元素，且中序有序、每个子树高度平衡'};
  }
  return {passed:false,message:'当前函数缺少可靠的多解验证方式'};
}

function javaFunctionSource(code, func, input) {
  if (func.compare === "operation-sequence") return javaOperationSource(code, func, input);
  const params = func.params;
  const declarations = javaArgumentSetup(func, input);
  const args = params.map((_, index) => `__hot100_arg${index}`);
  const call = `__hot100_solution.${func.methodName}(${args.join(", ")})`;
  const invocation = isVoid(func) ? `${call};` : `${func.returns || "Object"} __hot100_result = ${call};`;
  const value = isVoid(func) ? "__hot100_arg0" : "__hot100_result";
  const type = isVoid(func) ? params[0]?.type : func.returns;
  const print = func.compare === "identity" ? `Collections.singletonMap("id", ${value}==null?null:__hot100_ids.containsKey(${value})?__hot100_ids.get(${value}):"external")` : type === "Node" ? `__hot100_copy(${value})` : type === "ListNode" || type === "TreeNode" ? `__hot100_values(${value})` : value;
  return `${wrapFunctionCode(code, "java", func)}
${nodeDefinitions("java",func,code)}
public class Main {
${javaNodeHelpers(func)}
${javaIdentityHelpers(func)}
${JAVA_JSON_HELPER}
  public static void main(String[] args) {
    ${func.className} __hot100_solution = new ${func.className}();
    ${declarations}
    ${invocation}
    System.out.println(__hot100_json(${print}));
  }
}
`;
}

function parseStructuredOutput(value) {
  if (typeof value !== "string") return value;
  const text = normalize(value);
  try { return JSON.parse(text); } catch { /* Java arrays may contain spaces. */ }
  if (/^\[[\d,\-\s.]+\]$/.test(text)) {
    try { return JSON.parse(text.replace(/\s+/g, "")); } catch { /* keep text */ }
  }
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  if (text === "true" || text === "false") return text === "true";
  return text;
}

async function runSingleExample({ language, mode = "acm", code = "", input = "", expectedOutput, func }) {
  if (!SUPPORTED_LANGUAGES.includes(language) || !SUPPORTED_MODES.includes(mode)) return { status: "unsupported", output: "", error: "仅支持 Python/Java 的 function/acm 模式", durationMs: 0 };
  const template = templateStatus(language, code, mode, func);
  if (template) return template;
  const started = Date.now();
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "hot100-run-"));
  try {
    const isFunction = mode === "function";
    const source = language === "python" ? path.join(directory, "main.py") : path.join(directory, "Main.java");
    const sourceCode = isFunction ? (language === "python" ? pythonFunctionSource(code, func, input) : javaFunctionSource(code, func, input)) : code;
    await fs.writeFile(source, sourceCode, "utf8");
    if (language === "java") {
      const compile = await execute("javac", [source], { cwd: directory, timeoutMs: COMPILE_TIMEOUT_MS });
      if (compile.spawnError) return { status: "environment_error", output: "", error: "本机未找到 javac，请安装 JDK 后重试。", durationMs: Date.now() - started };
      if (compile.timedOut) return { status: "compile_timeout", output: compile.output, error: "Java 编译超过 10 秒", durationMs: Date.now() - started };
      if (compile.tooLarge) return { status: "output_limit", output: compile.output, error: "编译输出超过 64KB", durationMs: Date.now() - started };
      if (compile.code !== 0) return { status: "compile_error", output: compile.output, error: compile.error || "Java 编译失败", durationMs: Date.now() - started };
    }
    const command = language === "python" ? "python3" : "java";
    const args = language === "python" ? [source] : ["-cp", directory, "Main"];
    const result = await execute(command, args, { cwd: directory, input, timeoutMs: RUN_TIMEOUT_MS });
    const durationMs = Date.now() - started;
    if (result.spawnError) return { status: "environment_error", output: "", error: `本机未找到 ${command}，请安装运行环境后重试。`, durationMs };
    if (result.timedOut) return { status: "timeout", output: result.output, stderr: result.error, error: "程序运行超过 3 秒", durationMs };
    if (result.tooLarge) return { status: "output_limit", output: result.output, stderr: result.error, error: "输出超过 64KB", durationMs };
    if (result.code !== 0) return { status: "runtime_error", output: normalize(result.output), stderr: normalize(result.error), error: normalize(result.error) || `进程退出码 ${result.code}`, durationMs };
    const output = normalize(result.output);
    const actual = isFunction ? parseStructuredOutput(output) : output;
    if (expectedOutput === undefined) return { status: "completed", output, actual, stderr: normalize(result.error), error: "", durationMs };
    const expected = isFunction ? parseStructuredOutput(expectedOutput) : normalize(expectedOutput);
    const comparison = isFunction ? compareFunctionResult(func, input, actual, expected) : compareResult("exact", actual, expected);
    return { status: comparison.passed ? "passed" : "mismatch", output, actual, stderr: normalize(result.error), error: comparison.passed ? "" : comparison.message, durationMs };
  } catch (error) {
    return { status: "runtime_error", output: "", error: `运行输入与函数契约不一致：${error.message}`, durationMs: Date.now() - started };
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

function queued(task) {
  const next = executionQueue.then(task, task);
  executionQueue = next.catch(() => undefined);
  return next;
}

export function runExample(request = {}) {
  return queued(async () => {
    const mode = request.mode || (request.func || looksLikeFunction(request.code) ? "function" : "acm");
    if (!SUPPORTED_LANGUAGES.includes(request.language) || !SUPPORTED_MODES.includes(mode)) return { status: "unsupported", output: "", error: "仅支持 Python/Java 的 function/acm 模式", durationMs: 0 };
    if (!Array.isArray(request.cases)) return runSingleExample({ ...request, mode });
    const started = Date.now();
    const results = [];
    for (const item of request.cases) {
      const rawInput = normalizeCaseInput({ func: request.func }, item.input);
      const result = await runSingleExample({ language: request.language, mode, code: request.code, input: rawInput, expectedOutput: undefined, func: request.func });
      const hasExpected = item.expected !== undefined || item.expectedOutput !== undefined;
      const expected = Object.hasOwn(item, "expected") ? item.expected : mode === "function" ? parseStructuredOutput(item.expectedOutput) : item.expectedOutput;
      const actual = Object.hasOwn(result, "actual") ? result.actual : result.output;
      const hardFailure = ["runtime_error", "compile_error", "compile_timeout", "timeout", "output_limit", "environment_error", "template", "unsupported"].includes(result.status);
      const comparison = !hasExpected || hardFailure ? { passed: false, message: "" }
        : mode === "function"
          ? compareFunctionResult({ ...request.func, compare: item.compare || request.func?.compare || request.compare || "exact" }, rawInput, actual, expected)
          : compareResult(item.compare || request.compare || "exact", actual, normalize(expected));
      const status = hardFailure ? result.status : hasExpected ? comparison.passed ? "passed" : "mismatch" : "completed";
      results.push({ caseId: item.id || item.caseId || `case-${results.length + 1}`, status, input: rawInput, expected, actual, error: hardFailure ? result.error : comparison.passed ? result.error : comparison.message, stderr: result.stderr || "", durationMs: result.durationMs });
    }
    const hasFailure = results.some((item) => ["mismatch", "runtime_error", "compile_error", "compile_timeout", "timeout", "output_limit", "environment_error", "template", "unsupported"].includes(item.status));
    const hasIncomplete = results.some((item) => item.status === "completed");
    return { status: hasFailure ? "failed" : hasIncomplete ? "completed" : "passed", cases: results, durationMs: Date.now() - started };
  });
}
