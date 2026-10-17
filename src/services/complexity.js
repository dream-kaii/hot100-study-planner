const ORDER = { "O(1)": 0, "O(log n)": 1, "O(n)": 2, "O(n log n)": 3, "O(n²)": 4, "O(n³)": 5, "O(mn)": 5, "O(V+E)": 2 };

function cleanCode(code = "") {
  return String(code)
    .replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '""')
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/#[^\n]*/g, " ");
}

export function normalizeComplexity(value) {
  if (!value) return "";
  const text = String(value).replace(/\s+/g, "").toLowerCase().replace(/²/g, "^2").replace(/³/g, "^3");
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

function isLoop(line) { return /\b(for|while)\b/.test(line); }

function loopDepth(code, language = "") {
  const lines = code.split("\n");
  let max = 0;
  const active = [];
  let braceDepth = 0;
  const python = language.toLowerCase().startsWith("py");
  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, "");
    if (!line.trim()) continue;
    if (python) {
      const indent = line.match(/^\s*/)?.[0].length || 0;
      while (active.length && active.at(-1) >= indent) active.pop();
      if (isLoop(line)) active.push(indent);
      max = Math.max(max, active.length);
      continue;
    }
    const before = braceDepth;
    while (active.length && active.at(-1) >= before) active.pop();
    if (isLoop(line)) active.push(before);
    max = Math.max(max, active.length);
    braceDepth += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
    braceDepth = Math.max(0, braceDepth);
  }
  return max;
}

export function estimateComplexity({ language = "", code = "" } = {}) {
  const clean = cleanCode(code);
  if (!clean.trim()) return { estimated: "unknown", confidence: "low", reason: "没有可分析的代码" };
  if (/\b(fib|factorial|solve)\s*\([^)]*\)[\s\S]*\b\1\s*\(/i.test(clean) || /return\s+[^\n]*\b\w+\s*\([^)]*\)[^\n]*\+[^\n]*\b\w+\s*\(/.test(clean)) return { estimated: "可能指数级", confidence: "medium", reason: "检测到可能的分叉递归" };
  if (/\b(bfs|dfs|graph|adjacency|邻接)/i.test(clean) && /\b(for|while)\b/.test(clean)) return { estimated: "O(V+E)", confidence: "medium", reason: "检测到图/树遍历结构" };
  if (/\b(sort|sorted|Arrays\.sort|Collections\.sort)\s*\(/.test(clean)) return { estimated: "O(n log n)", confidence: "medium", reason: "检测到排序调用，按常见比较排序估计" };
  if (/\bwhile\b[\s\S]{0,180}\b(mid|middle)\b/.test(clean) && /\b(left|right|low|high)\b/.test(clean)) return { estimated: "O(log n)", confidence: "medium", reason: "检测到区间折半更新" };
  const depth = loopDepth(clean, language);
  if (depth >= 3) return { estimated: "O(n³)", confidence: "medium", reason: "检测到三层嵌套循环" };
  if (depth === 2) return { estimated: "O(n²)", confidence: "high", reason: "检测到真正嵌套的两层循环" };
  if (depth === 1) return { estimated: "O(n)", confidence: "high", reason: "检测到一个或多个顺序执行的单层遍历，按加法合并为 O(n)" };
  if (/(Map|HashMap|HashSet|Set|dict|set\()/.test(clean)) return { estimated: "O(1)", confidence: "low", reason: "主要使用哈希表/集合操作，按平均常数查找估计" };
  return { estimated: "unknown", confidence: "low", reason: "未识别出可靠的循环、排序、二分或遍历结构" };
}

export function compareComplexity({ expected = "", requirement = expected, reference = "", estimated = "unknown" } = {}) {
  const normalizedRequirement = normalizeComplexity(requirement);
  const normalizedReference = normalizeComplexity(reference);
  const normalizedEstimated = normalizeComplexity(estimated) || estimated;
  const basis = normalizedRequirement ? "requirement" : normalizedReference ? "reference" : "none";
  const target = normalizedRequirement || normalizedReference;
  const base = { expected: normalizedRequirement, reference: normalizedReference, estimated: normalizedEstimated, basis };
  if (!target) return { ...base, verdict: "unknown", confidence: "low", reason: "题目没有明确规定复杂度，也没有可比较的参考解复杂度" };
  if (!normalizedEstimated || normalizedEstimated === "unknown" || !(normalizedEstimated in ORDER)) return { ...base, verdict: normalizedEstimated === "unknown" ? "unknown" : "uncertain", confidence: "low", reason: "代码复杂度无法可靠归类" };
  const targetRank = ORDER[target];
  const estimatedRank = ORDER[normalizedEstimated];
  const verdict = estimatedRank <= targetRank ? "meets" : "too-slow";
  const reason = basis === "requirement"
    ? verdict === "meets" ? "启发式估计未超过题目明确要求" : "启发式估计高于题目明确要求"
    : verdict === "meets" ? "启发式估计与参考解复杂度相当或更低" : "启发式估计可能高于参考解复杂度，不能据此证明代码错误";
  return { ...base, verdict, confidence: "medium", reason };
}
