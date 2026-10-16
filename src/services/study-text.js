// 仅清理明确列出的显示字段；代码、执行输入和来源链接不进入清理流程。
export const STUDY_TEXT_FIELDS = [
  "description", "summary", "explanation", "thinking", "summaryText", "sourceNote",
  "learningGoal", "recognition", "bruteForce", "direction", "correctness",
  "steps", "walkthrough", "pitfalls",
];

const superscripts = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "-": "⁻", "+": "⁺", n: "ⁿ" };
const symbols = { times: "×", cdot: "·", le: "≤", leq: "≤", ge: "≥", geq: "≥", lt: "<", gt: ">", lfloor: "⌊", rfloor: "⌋", lceil: "⌈", rceil: "⌉", oplus: "⊕", Sigma: "Σ", sum: "Σ", infty: "∞", to: "→", in: "∈", circ: "°", dots: "…", ldots: "…", cdots: "…", bmod: "mod", log: "log", min: "min", max: "max" };

export function normalizeFormulaText(value) {
  if (typeof value !== "string") return "";
  let text = value.replace(/\$/g, "").replace(/\\(?:left|right|limits)\b/g, "")
    .replace(/\\?(?:begin|end)\{(?:cases|aligned|align\*?|array)\}(?:\{[^{}]*\})?/g, "")
    .replace(/\\\\\n?/g, "\n").replace(/&\s*(?=if\b)/g, "");
  // 重复展开嵌套的文字包装，例如 O(\\textit{n}^{2})。
  for (let count = 0; count < 6; count += 1) {
    text = text.replace(/\\(?:textit|text|tex|mathrm|mathbf|operatorname)\s*\{([^{}]*)\}/g, "$1")
      .replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, "($1)/($2)")
      .replace(/\\sqrt\s*\{([^{}]*)\}/g, "√($1)");
  }
  text = text.replace(/\\([A-Za-z]+)/g, (_, command) => symbols[command] ?? command)
    .replace(/\^\{([0-9n+-]+)\}|\^([0-9n+-]+)/g, (_, wrapped, plain) => [...(wrapped || plain)].map(char => superscripts[char]).join(""))
    .replace(/\^\{([^{}]+)\}/g, "^($1)")
    .replace(/\\(?:textit|text|tex)\s*\{?([^\n]*)$/g, "$1")
    .replace(/\\[()[\]]/g, "")
    .replace(/\\([{}_%#&])/g, "$1")
    .replace(/\\[,;! ]/g, " ")
    .replace(/\s*×\s*/g, "×")
    .replace(/([⌊⌈])\s+/g, "$1").replace(/\s+([⌋⌉])/g, "$1")
    .replace(/\\/g, "");
  return text;
}

export function normalizeStudyText(value) {
  if (typeof value !== "string") return "";
  let text = value.replace(/\r\n?/g, "\n")
    .replace(/<\s*(script|style)\b[^>]*>[\s\S]*?<\/\s*\1\s*>/gi, "")
    .replace(/<\s*\/?(?:p|div|br|li|h[1-6])\b[^>]*>/gi, "\n")
    .replace(/<\/?[a-z][\w-]*(?:\s+[a-z][\w:-]*=(?:"[^"]*"|'[^']*'|[^\s>]+))*\s*\/?>/gi, "")
    .replace(/&nbsp;|&#160;|&#xA0;/gi, " ")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  text = normalizeFormulaText(text)
    .replace(/[\u3000\u00a0]/g, " ")
    .replace(/。{2,}/g, "。")
    .replace(/本题总结：结合题目约束选择合适的数据结构和算法，并检查边界条件。?/g, "")
    .split("\n").map(line => line.replace(/[\t ]+/g, " ").trim()).join("\n")
    .replace(/\n{3,}/g, "\n\n").trim();
  // 合并紧邻的重复句；不同示例仍保留各自段落。
  const paragraphs = [];
  const seen = new Set();
  for (const paragraph of text.split(/\n\s*\n/)) {
    const clean = paragraph.replace(/([^。！？\n]{3,}[。！？])(?:\s*\1)+/g, "$1").trim();
    if (clean && !seen.has(clean)) { paragraphs.push(clean); seen.add(clean); }
  }
  return paragraphs.join("\n\n");
}

export function splitStudyParagraphs(value) {
  const text = normalizeStudyText(value);
  return text ? text.split(/\n+/).filter(Boolean) : [];
}

export function normalizeStudySolution(solution) {
  if (!solution || typeof solution !== "object") return solution;
  const result = { ...solution };
  for (const field of STUDY_TEXT_FIELDS) {
    if (typeof solution[field] === "string") result[field] = normalizeStudyText(solution[field]);
    else if (Array.isArray(solution[field])) result[field] = [...new Set(solution[field].map(value => typeof value === "string" ? normalizeStudyText(value) : value).filter(Boolean))];
  }
  if (solution.complexity && typeof solution.complexity === "object") result.complexity = Object.fromEntries(Object.entries(solution.complexity).map(([key, value]) => [key, typeof value === "string" ? normalizeStudyText(value) : value]));
  if (Array.isArray(solution.hints)) result.hints = solution.hints.map((hint, index) => {
    const pseudocode = Number(hint?.level ?? index + 1) === 4 || hint?.kind === "pseudocode" || hint?.type === "pseudocode";
    if (pseudocode) return hint;
    if (typeof hint === "string") return normalizeStudyText(hint);
    return { ...hint, ...Object.fromEntries(["text", "content", "description"].filter(key => typeof hint?.[key] === "string").map(key => [key, normalizeStudyText(hint[key])])) };
  });
  if (Array.isArray(solution.examples)) result.examples = solution.examples.map(example => ({ ...example, ...(typeof example.explanation === "string" ? { explanation: normalizeStudyText(example.explanation) } : {}) }));
  if (Array.isArray(solution.tables)) result.tables = solution.tables.map(table => ({ ...table, ...(Array.isArray(table.headers) ? { headers: table.headers.map(normalizeStudyText) } : {}), ...(Array.isArray(table.rows) ? { rows: table.rows.map(row => row.map(value => typeof value === "string" ? normalizeStudyText(value) : value)) } : {}) }));
  return result;
}
