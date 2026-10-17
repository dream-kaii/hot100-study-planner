const ORDER = { "O(1)": 0, "O(log n)": 1, "O(n)": 2, "O(n log n)": 3, "O(n²)": 4, "O(n³)": 5, "O(mn)": 5, "O(V+E)": 2 };

function cleanCode(code = "") {
  return String(code)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/#[^\n]*/g, " ")
    .replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, "\"\"");
}

export function normalizeComplexity(value) {
  if (!value) return "";
  const text = String(value).replace(/\s+/g, "").toLowerCase()
    .replace(/²/g, "^2").replace(/³/g, "^3").replace(/o\(/g, "o(");
  if (/o\(1\)/.test(text)) return "O(1)";
  if (/o\(logn\)/.test(text)) return "O(log n)";
  if (/o\(nlogn\)/.test(text)) return "O(n log n)";
  if (/o\(n\^2\)/.test(text)) return "O(n²)";
  if (/o\(n\^3\)/.test(text)) return "O(n³)";
  if (/o\(mn\)/.test(text)) return "O(mn)";
  if (/o\(v\+e\)/.test(text)) return "O(V+E)";
  if (/o\(n\)/.test(text)) return "O(n)";
  return "";
}

function loopDepth(code) {
  const lines = code.split(/\n/);
  let max = 0;
  const stack = [];
  for (const line of lines) {
    const indent = line.match(/^\s*/)?.[0].length || 0;
    while (stack.length && stack.at(-1) >= indent) stack.pop();
    if (/\b(for|while)\b/.test(line)) { stack.push(indent); max = Math.max(max, stack.length); }
  }
  const braceDepth = (code.match(/\b(for|while)\b/g) || []).length;
  return Math.max(max, braceDepth >= 3 ? 3 : braceDepth >= 2 ? 2 : braceDepth ? 1 : 0);
}

export function estimateComplexity({ language = "", code = "", func, solution } = {}) {
  const clean = cleanCode(code);
  const reasons = [];
  if (!clean.trim()) return { estimated: "unknown", confidence: "low", reason: "没有可分析的代码" };
  if (/\b(fib|factorial|solve)\s*\([^)]*\)[\s\S]*\b\1\s*\(/i.test(clean) || /return\s+[^\n]*\b\w+\s*\([^)]*\)[^\n]*\+[^\n]*\b\w+\s*\(/.test(clean)) {
    reasons.push("检测到可能的分叉递归");
    return { estimated: "可能指数级", confidence: "medium", reason: reasons.join("；") };
  }
  if (/\b(bfs|dfs|graph|adjacency|邻接)/i.test(clean) && /\b(for|while)\b/.test(clean)) {
    reasons.push("检测到图/树遍历结构");
    return { estimated: "O(V+E)", confidence: "medium", reason: reasons.join("；") };
  }
  if (/\b(sort|sorted|Arrays\.sort|Collections\.sort)\s*\(/.test(clean)) {
    reasons.push("检测到排序调用，按常见比较排序估计");
    return { estimated: "O(n log n)", confidence: "medium", reason: reasons.join("；") };
  }
  if (/\bwhile\b[\s\S]{0,180}\b(mid|middle)\b/.test(clean) && /\b(left|right|low|high)\b/.test(clean)) {
    reasons.push("检测到区间折半更新");
    return { estimated: "O(log n)", confidence: "medium", reason: reasons.join("；") };
  }
  const depth = loopDepth(clean);
  if (depth >= 3) { reasons.push("检测到三层嵌套循环"); return { estimated: "O(n³)", confidence: "medium", reason: reasons.join("；") }; }
  if (depth === 2) { reasons.push("检测到两层嵌套循环"); return { estimated: "O(n²)", confidence: "high", reason: reasons.join("；") }; }
  if (depth === 1) { reasons.push("检测到单层遍历"); return { estimated: "O(n)", confidence: "high", reason: reasons.join("；") }; }
  if (/(Map|HashMap|HashSet|Set|dict|set\()/.test(clean)) {
    reasons.push("主要使用哈希表/集合操作，按平均常数查找估计");
    return { estimated: "O(1)", confidence: "low", reason: reasons.join("；") };
  }
  return { estimated: "unknown", confidence: "low", reason: "未识别出可靠的循环、排序、二分或遍历结构" };
}

export function compareComplexity({ expected = "", estimated = "unknown" } = {}) {
  const normalizedExpected = normalizeComplexity(expected);
  const normalizedEstimated = normalizeComplexity(estimated) || estimated;
  if (!normalizedExpected) return { expected: "", estimated: normalizedEstimated, verdict: "unknown", confidence: "low", reason: "题目没有明确复杂度要求" };
  if (!normalizedEstimated || normalizedEstimated === "unknown") return { expected: normalizedExpected, estimated: "unknown", verdict: "unknown", confidence: "low", reason: "代码复杂度无法可靠归类" };
  if (!(normalizedEstimated in ORDER)) return { expected: normalizedExpected, estimated: normalizedEstimated, verdict: "uncertain", confidence: "low", reason: "代码复杂度无法可靠归类" };
  const expectedRank = ORDER[normalizedExpected];
  const estimatedRank = ORDER[normalizedEstimated];
  return { expected: normalizedExpected, estimated: normalizedEstimated, verdict: estimatedRank <= expectedRank ? "meets" : "too-slow", confidence: "medium", reason: estimatedRank <= expectedRank ? "启发式估计未超过题目要求" : "启发式估计高于题目要求" };
}
