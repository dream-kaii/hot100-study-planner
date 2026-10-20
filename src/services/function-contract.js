// func 使用 Java 类型作为跨语言契约，Python 模板在这里做对应转换。
export function pythonType(type = "Object") {
  if (type.endsWith("[]")) return `List[${pythonType(type.slice(0, -2))}]`;
  const generic = type.match(/^List<(.+)>$/);
  if (generic) return `List[${pythonType(generic[1])}]`;
  return { void: "None", None: "None", int: "int", Integer: "int", long: "int", double: "float", float: "float", boolean: "bool", String: "str", char: "str", Object: "Any" }[type] || type;
}

export function isVoid(func) { return ["void", "None"].includes(func?.returns); }

function maskNonCode(code, language) {
  const pattern = language === 'java'
    ? /\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g
    : /"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|#[^\n]*/g;
  return code.replace(pattern, text => text.replace(/[^\n]/g, ' '));
}

function javaClasses(code) {
  const masked = maskNonCode(code, 'java');
  const ranges = [];
  const pattern = /\b(?:(?:public|final|abstract|static|strictfp)\s+)*class\s+\w+[^{};]*\{/g;
  for (const match of masked.matchAll(pattern)) {
    let depth = 0;
    for (const char of masked.slice(0,match.index)) { if(char === '{')depth++;else if(char === '}')depth--; }
    if (depth !== 0) continue;
    const start = match.index;
    let end = start + match[0].length;
    depth = 1;
    while(end < masked.length && depth) { const char=masked[end++];if(char === '{')depth++;else if(char === '}')depth--; }
    ranges.push([start,end]);
  }
  return ranges;
}

// ---- 行映射基础设施 ----
// 生成源码的每一行都要能追溯回用户编辑器里的第几行（1 起）。
// 框架自己拼的行记为 0，回显报错时整帧丢掉，避免把 __hot100_* 暴露给用户。

function lineTable(text) {
  const table = new Array(text.length + 1);
  let line = 1;
  for (let i = 0; i < text.length; i++) { table[i] = line; if (text[i] === "\n") line++; }
  table[text.length] = line;
  return table;
}

// 等价于 text.slice(from, to).split("\n")，但每行额外带上它起始字符的原始行号。
function sliceLines(text, origin, from = 0, to = text.length) {
  const out = [];
  let start = from;
  for (let i = from; i <= to; i++) {
    if (i === to || text[i] === "\n") {
      out.push({ text: text.slice(start, i), orig: start < to && start < text.length ? origin[start] : 0 });
      start = i + 1;
    }
  }
  return out;
}

// 把带 orig 的行数组重新拼成字符串，同时给出「每个字符属于哪一行」。
function joinParts(parts) {
  const text = parts.map(part => part.text).join("\n");
  const lineOf = new Array(text.length + 1);
  let index = 0;
  parts.forEach((part, position) => {
    for (let k = 0; k < part.text.length; k++) lineOf[index++] = part.orig;
    if (position < parts.length - 1) lineOf[index++] = part.orig;
  });
  lineOf[text.length] = 0;
  return { text, lineOf };
}

// 挖掉若干字符区间，剩下的字符保留各自的原始行号。
function dropRanges(text, lineOf, ranges) {
  let result = "";
  const origin = [];
  let cursor = 0;
  for (const [start, end] of ranges) {
    for (let i = cursor; i < start; i++) { result += text[i]; origin.push(lineOf[i]); }
    cursor = end;
  }
  for (let i = cursor; i < text.length; i++) { result += text[i]; origin.push(lineOf[i]); }
  origin.push(0);
  return { text: result, lineOf: origin };
}

// 用 exec 复刻 String.replace 的匹配顺序，保证生成的源码与旧实现逐字节一致。
function splitOffLines(code, pattern, transform) {
  const table = lineTable(code);
  const removed = [];
  const ranges = [];
  pattern.lastIndex = 0;
  for (let match = pattern.exec(code); match; match = pattern.exec(code)) {
    const start = match.index;
    const end = start + match[0].length;
    removed.push({ text: transform(match[0]), orig: table[Math.min(start, code.length)] });
    ranges.push([start, end]);
    if (!match[0].length) pattern.lastIndex++;
  }
  const body = dropRanges(code, table, ranges);
  return { body: body.text, lineOf: body.lineOf, removed };
}

function identityMap(code) { return code.split("\n").map((_, index) => index + 1); }

function pythonWrapWithMap(code, className) {
  const full = new RegExp(`^class\\s+${className}\\b`, 'm').test(maskNonCode(code, 'python'));
  if (full) return { source: code, map: identityMap(code) };
  const { body, lineOf, removed } = splitOffLines(code, /^(?:from\s+\S+\s+import\s+[^\n]+|import\s+[^\n]+)$/gm, text => text);
  const classes = [], methods = [];
  let inClass = false;
  for (const item of sliceLines(body, lineOf, 0, body.length)) {
    if (/^class\s+\w+/.test(item.text)) inClass = true;
    else if (/^\S/.test(item.text) && !/^#/.test(item.text)) inClass = false;
    (inClass ? classes : methods).push(item);
  }
  const parts = [
    ...(removed.length ? removed : [{ text: '', orig: 0 }]),
    ...(classes.length ? classes : [{ text: '', orig: 0 }]),
    { text: `class ${className}:`, orig: 0 },
    ...(methods.length ? methods.map(item => ({ text: `    ${item.text}`, orig: item.orig })) : [{ text: '', orig: 0 }]),
    { text: '', orig: 0 }
  ];
  return { source: parts.map(part => part.text).join('\n'), map: parts.map(part => part.orig) };
}

function stripPublicClassModifier(text, lineOf) {
  const masked = maskNonCode(text, 'java');
  const ranges = [...masked.matchAll(/\bpublic\s+(?=(?:(?:final|abstract|strictfp)\s+)*class\b)/g)]
    .map(match => [match.index, match.index + match[0].length]);
  return dropRanges(text, lineOf, ranges);
}

function javaWrapWithMap(code, className) {
  const { body, lineOf, removed } = splitOffLines(code, /^\s*import\s+[^;]+;[ \t]*$/gm, text => text.trim());
  const full = new RegExp(`\\bclass\\s+${className}\\b`).test(maskNonCode(body, 'java'));
  let sourceLines;
  if (full) {
    sourceLines = sliceLines(body, lineOf, 0, body.length);
  } else {
    const ranges = javaClasses(body);
    const classLines = [];
    for (const [start, end] of ranges) classLines.push(...sliceLines(body, lineOf, start, end));
    const methods = dropRanges(body, lineOf, ranges);
    sourceLines = [
      ...(classLines.length ? classLines : [{ text: '', orig: 0 }]),
      { text: `class ${className} {`, orig: 0 },
      ...sliceLines(methods.text, methods.lineOf, 0, methods.text.length),
      { text: '}', orig: 0 }
    ];
  }
  const joined = joinParts([
    { text: 'import java.util.*;', orig: 0 },
    { text: 'import java.io.*;', orig: 0 },
    ...(removed.length ? removed : [{ text: '', orig: 0 }]),
    ...sourceLines,
    { text: '', orig: 0 }
  ]);
  const stripped = stripPublicClassModifier(joined.text, joined.lineOf);
  return { source: stripped.text, map: sliceLines(stripped.text, stripped.lineOf, 0, stripped.text.length).map(line => line.orig) };
}

/**
 * 和 wrapFunctionCode 生成完全相同的源码，但额外返回行映射。
 * map[i] = 生成源码第 i 行（0 起）对应的用户编辑器行号（1 起）；框架行记 0。
 */
export function wrapFunctionCodeWithMap(code, language, func) {
  return language === 'java' ? javaWrapWithMap(code, func.className) : pythonWrapWithMap(code, func.className);
}

export function wrapFunctionCode(code, language, func) {
  return wrapFunctionCodeWithMap(code, language, func).source;
}

export function nodeDefinitions(language, func, code = "") {
  const types = [...func.params.map(param => param.type), func.returns].join(" ");
  const definitions = {
    java: {
      ListNode: "class ListNode { int val; ListNode next; ListNode() {} ListNode(int val) { this.val=val; } ListNode(int val,ListNode next) { this.val=val; this.next=next; } }",
      Node: "class Node { int val; Node next,random; Node(int val) { this.val=val; } }",
      TreeNode: "class TreeNode { int val; TreeNode left,right; TreeNode() {} TreeNode(int val) { this.val=val; } TreeNode(int val,TreeNode left,TreeNode right) { this.val=val;this.left=left;this.right=right; } }"
    },
    python: {
      ListNode: "class ListNode:\n    def __init__(self, val=0, next=None):\n        self.val, self.next = val, next\n",
      Node: "class Node:\n    def __init__(self, val=0, next=None, random=None):\n        self.val, self.next, self.random = val, next, random\n",
      TreeNode: "class TreeNode:\n    def __init__(self, val=0, left=None, right=None):\n        self.val, self.left, self.right = val, left, right\n"
    }
  };
  const source = maskNonCode(code, language);
  return Object.entries(definitions[language]).filter(([type]) => new RegExp(`(^|[^A-Za-z])${type}([^A-Za-z]|$)`).test(types) && !new RegExp(`\\bclass\\s+${type}\\b`).test(source)).map(([,definition])=>definition).join("\n");
}
