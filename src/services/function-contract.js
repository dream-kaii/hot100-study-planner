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

function removePublicClassModifier(code) {
  const masked = maskNonCode(code, 'java');
  const matches = [...masked.matchAll(/\bpublic\s+(?=(?:(?:final|abstract|strictfp)\s+)*class\b)/g)];
  for (const match of matches.reverse()) code = code.slice(0,match.index) + code.slice(match.index+match[0].length);
  return code;
}

export function wrapFunctionCode(code, language, func) {
  const className = func.className;
  if (language === 'java') {
    const imports = [];
    const body = code.replace(/^\s*import\s+[^;]+;[ \t]*$/gm, line => { imports.push(line.trim()); return ''; });
    const full = new RegExp(`\\bclass\\s+${className}\\b`).test(maskNonCode(body, language));
    let source = body;
    if (!full) {
      const ranges = javaClasses(body);
      const classes = ranges.map(([start,end])=>body.slice(start,end));
      let methods = body;
      for (const [start,end] of ranges.reverse()) methods = methods.slice(0,start) + methods.slice(end);
      source = `${classes.join('\n')}\nclass ${className} {\n${methods}\n}`;
    }
    return `import java.util.*;\nimport java.io.*;\n${imports.join('\n')}\n${removePublicClassModifier(source)}\n`;
  }
  const full = new RegExp(`^class\\s+${className}\\b`, 'm').test(maskNonCode(code, language));
  if (full) return code;
  const imports = [];
  const body = code.replace(/^(?:from\s+\S+\s+import\s+[^\n]+|import\s+[^\n]+)$/gm, line => { imports.push(line); return ''; });
  const classes = [], methods = [];
  let inClass = false;
  for (const line of body.split('\n')) {
    if (/^class\s+\w+/.test(line)) inClass = true;
    else if (/^\S/.test(line) && !/^#/.test(line)) inClass = false;
    (inClass ? classes : methods).push(line);
  }
  return `${imports.join('\n')}\n${classes.join('\n')}\nclass ${className}:\n${methods.map(line => `    ${line}`).join('\n')}\n`;
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
