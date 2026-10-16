import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { STUDY_TEXT_FIELDS } from "../src/services/study-text.js";

export const COMPARE_VALUES = new Set([
  "exact",
  "unordered-array",
  "unordered-nested",
  "float-tolerance",
  "in-place-mutate",
  "any-valid",
  "operation-sequence",
  "identity",
]);
export const SOURCE_TYPES = new Set(["official", "codesuixianglu", "community", "site"]);
const PLACEHOLDER = /(请按题目要求填写|待补充|TODO|占位|见题解分析|your answer)/i;
const COMPLEXITY = /^O\(.+\)$/;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function loadContent(root = ROOT) {
  const hot100 = JSON.parse(fs.readFileSync(path.join(root, "src/data/hot100.json"), "utf8"));
  const solutionDirectory = path.join(root, "src/data/solutions");
  const solutions = fs.readdirSync(solutionDirectory)
    .filter((file) => /^\d+\.json$/.test(file))
    .sort((a, b) => Number(a.slice(0, -5)) - Number(b.slice(0, -5)))
    .map((file) => JSON.parse(fs.readFileSync(path.join(solutionDirectory, file), "utf8")));
  return { hot100, solutions };
}

function add(errors, location, message) {
  errors.push(`${location}: ${message}`);
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

const GENERIC_TEXT = /(先按输入顺序推进指针或状态|初始化与.+对应的状态|逐项读取输入并更新状态|哪些信息可以在扫描过程中保留下来|结合题目约束选择合适的数据结构和算法|练习时先说清楚状态含义，再验证边界和复杂度)|可以使用(.{8,})[：:]\2/;
const LATEX = /\$|\\|(?:begin|end)\{(?:cases|aligned|array)\}|\^\{/;

function checkStudyText(value, location, errors, pseudocode = false) {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) checkStudyText(item, `${location}[${index}]`, errors);
    if (new Set(value.filter(item => typeof item === "string")).size < value.filter(item => typeof item === "string").length) add(errors, location, "duplicate study paragraphs");
    return;
  }
  if (typeof value !== "string") return;
  if (LATEX.test(value)) add(errors, location, "raw LaTeX markup in study text");
  if (/<\/?[A-Za-z][\w-]*(?:\s+[A-Za-z][\w:-]*=(?:"[^"]*"|'[^']*'|[^\s>]+))*\s*\/?>/.test(value)) add(errors, location, "raw HTML in study text");
  if (/。{2,}/.test(value)) add(errors, location, "duplicate sentence punctuation");
  if (/\n[\t \u3000]*\n[\t \u3000]*\n/.test(value)) add(errors, location, "three or more consecutive newlines");
  if (GENERIC_TEXT.test(value)) add(errors, location, "generic study template");
  if (/([^。！？\n]{8,}[。！？])\s*\1/.test(value)) add(errors, location, "duplicate sentence");
  if (!pseudocode && (value !== value.trim() || /\u3000/.test(value))) add(errors, location, "untrimmed or full-width whitespace");
  checkNoPlaceholder(value, location, errors);
}

function validParams(params) {
  return Array.isArray(params) && params.every(param => hasText(param?.name) && hasText(param?.type)) && new Set(params.map(param => param.name)).size === params.length;
}

function matchesType(value, type) {
  if (/\[\]$/.test(type)) return Array.isArray(value) && value.every(item => matchesType(item, type.slice(0, -2)));
  if (["int", "long", "integer"].includes(type)) return Number.isInteger(value);
  if (["float", "double", "number"].includes(type)) return typeof value === "number" && Number.isFinite(value);
  if (["String", "string", "char"].includes(type)) return typeof value === "string";
  if (["boolean", "bool"].includes(type)) return typeof value === "boolean";
  return true;
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const validIdentifier = value => typeof value === "string" && IDENTIFIER.test(value);
const JAVA_TYPES = new Set([
  "int", "double", "boolean", "String", "void", "int[]", "int[][]", "String[]", "char[][]",
  "ListNode", "ListNode[]", "TreeNode", "Node", "List<Integer>", "List<String>",
  "List<List<Integer>>", "List<List<String>>",
]);
const compactType = value => typeof value === "string" ? value.replace(/\s+/g, "") : "";

// Keep line positions while excluding documentation and literals from signature searches.
function signatureSource(code, language) {
  const literals = language === "java"
    ? /\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g
    : /"""[\s\S]*?"""|'''[\s\S]*?'''|#[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g;
  return String(code || "").replace(literals, value => value.replace(/[^\n]/g, " "));
}

function splitSignatureParams(value) {
  const params = [];
  let depth = 0, start = 0;
  for (let index = 0; index < value.length; index++) {
    if ("<[(".includes(value[index])) depth++;
    if (">])".includes(value[index])) depth--;
    if (value[index] === "," && depth === 0) { params.push(value.slice(start, index).trim()); start = index + 1; }
  }
  if (value.slice(start).trim()) params.push(value.slice(start).trim());
  return params;
}

function javaEntry(source, func, location, errors) {
  const classes = [...source.matchAll(/\bclass\s+([A-Za-z_$][\w$]*)\b/g)];
  const owners = classes.filter(match => match[1] === func.className);
  if (owners.length > 1) {
    add(errors, `${location}.className`, "duplicate Java entry class");
    return null;
  }
  let body = source;
  if (owners.length) {
    const start = source.indexOf("{", owners[0].index);
    let depth = 1, end = start + 1;
    while (start >= 0 && end < source.length && depth) { if (source[end] === "{") depth++; if (source[end] === "}") depth--; end++; }
    body = start < 0 ? "" : source.slice(start + 1, end - 1);
  }
  const declarations = new RegExp(`\\b([A-Za-z_$][\\w$]*(?:\\s*<[^;{}\\n]*>)?(?:\\s*\\[\\s*\\])*)\\s+${func.methodName}\\s*\\(([^)]*)\\)\\s*\\{`, "g");
  for (const match of body.matchAll(declarations)) {
    let depth = 0;
    for (const char of body.slice(0, match.index)) { if (char === "{") depth++; if (char === "}") depth--; }
    if (depth !== 0) continue;
    const params = splitSignatureParams(match[2]).map(value => {
      const param = value.replace(/^final\s+/, "").match(/^(.+?)\s+([A-Za-z_$][\w$]*)$/);
      return param ? { type: compactType(param[1]), name: param[2] } : {};
    });
    return { returns: compactType(match[1]), params };
  }
  if (classes.length && !owners.length) add(errors, `${location}.className`, "declared Java class is missing and no top-level entry fragment exists");
  add(errors, `${location}.methodName`, "declared Java entry method is missing");
  return null;
}

function pythonEntry(source, func, location, errors) {
  const classes = [...source.matchAll(/^([ \t]*)class\s+([A-Za-z_$][\w$]*)[^\n]*:/gm)];
  const owners = classes.filter(match => match[2] === func.className);
  if (owners.length > 1) {
    add(errors, `${location}.className`, "duplicate Python entry class");
    return null;
  }
  let body = source;
  if (owners.length) {
    const owner = owners[0];
    const lines = source.slice(owner.index + owner[0].length).split("\n").slice(1);
    const end = lines.findIndex(line => line.trim() && line.match(/^[ \t]*/)[0].length <= owner[1].length);
    body = (end < 0 ? lines : lines.slice(0, end)).join("\n");
  }
  const methods = [...body.matchAll(/^([ \t]*)def\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*(?:->[^\n:]+)?\s*:/gm)];
  const entryIndent = classes.length && !owners.length ? 0 : Math.min(...methods.map(match => match[1].length));
  const method = methods.find(match => match[2] === func.methodName && match[1].length === entryIndent);
  if (!method) {
    if (classes.length && !owners.length) add(errors, `${location}.className`, "declared Python class is missing and no top-level entry fragment exists");
    add(errors, `${location}.methodName`, "declared Python entry method is missing");
    return null;
  }
  return splitSignatureParams(method[3]).map(value => value.split(/[=:]/, 1)[0].trim()).filter(name => name !== "self");
}

function checkFunctionContract(solution, errors) {
  const func = solution.func;
  if (!func || func.compare === "operation-sequence") return;
  const location = `${solution.id}.func`;
  let valid = true;
  for (const field of ["className", "methodName"]) if (!validIdentifier(func[field])) { add(errors, `${location}.${field}`, "must be a valid identifier"); valid = false; }
  if (!JAVA_TYPES.has(compactType(func.returns))) { add(errors, `${location}.returns`, "unsupported Java return type"); valid = false; }
  if (!Array.isArray(func.params)) return;
  const names = new Set();
  for (const [index, param] of func.params.entries()) {
    if (!validIdentifier(param?.name) || names.has(param.name)) { add(errors, `${location}.params[${index}].name`, "must be a unique valid parameter name"); valid = false; }
    names.add(param?.name);
    if (!JAVA_TYPES.has(compactType(param?.type)) || compactType(param?.type) === "void") { add(errors, `${location}.params[${index}].type`, "unsupported Java parameter type"); valid = false; }
  }
  if (!valid) return;
  const java = javaEntry(signatureSource(solution.java, "java"), func, location, errors);
  if (java) {
    if (java.returns !== compactType(func.returns)) add(errors, `${location}.returns`, `Java declares ${java.returns}, contract declares ${func.returns}`);
    if (java.params.length !== func.params.length) add(errors, `${location}.params`, "Java parameter count does not match contract");
    for (const [index, param] of func.params.entries()) if (java.params[index]) {
      for (const field of ["name", "type"]) if (java.params[index][field] !== (field === "type" ? compactType(param[field]) : param[field])) add(errors, `${location}.params[${index}].${field}`, `Java parameter ${field} does not match contract`);
    }
  }
  const python = pythonEntry(signatureSource(solution.python, "python"), func, location, errors);
  if (python) {
    if (python.length !== func.params.length) add(errors, `${location}.params`, "Python parameter count does not match contract");
    for (const [index, param] of func.params.entries()) if (python[index] !== undefined && python[index] !== param.name) add(errors, `${location}.params[${index}].name`, "Python parameter name does not match contract");
  }
  for (const [index, item] of (solution.cases || []).entries()) {
    for (const param of func.params) {
      const alias = String(solution.id) === "160" && func.methodName === "getIntersectionNode" ? { headA: "listA", headB: "listB" }[param.name] : undefined;
      const name = Object.hasOwn(item.input || {}, param.name) ? param.name : alias || param.name;
      if (!Object.hasOwn(item.input || {}, name)) add(errors, `${solution.id}.cases[${index}].input.${name}`, `missing required parameter ${param.name}`);
    }
  }
}

function checkOperationContract(solution, errors) {
  const func = solution.func;
  // 操作序列必须声明构造参数和方法；普通函数不需要这些扩展。
  if (!func || (func.compare !== "operation-sequence" && func.constructorParams === undefined && func.methods === undefined)) return;
  if (func.compare !== "operation-sequence") add(errors, `${solution.id}.func.compare`, "method signatures require operation-sequence");
  if (!validParams(func.constructorParams)) add(errors, `${solution.id}.func.constructorParams`, "must contain unique named and typed parameters");
  const methods = Array.isArray(func.methods) ? func.methods : [];
  if (!Array.isArray(func.methods) || !methods.length) add(errors, `${solution.id}.func.methods`, "must be a non-empty array");
  for (const [index, method] of methods.entries()) {
    if (!hasText(method?.methodName) || !validParams(method?.params) || !hasText(method?.returns)) add(errors, `${solution.id}.func.methods[${index}]`, "incomplete method signature");
  }
  if (new Set(methods.map(method => method?.methodName)).size !== methods.length) add(errors, `${solution.id}.func.methods`, "duplicate method names");
  for (const [caseIndex, item] of (solution.cases || []).entries()) {
    const location = `${solution.id}.cases[${caseIndex}].input`;
    const { operations, arguments: argumentsList } = item.input || {};
    if (!Array.isArray(operations) || !operations.length || !Array.isArray(argumentsList) || operations.length !== argumentsList.length) { add(errors, location, "operations and arguments must be non-empty arrays with matching lengths"); continue; }
    if (operations[0] !== func.className) add(errors, `${location}.operations[0]`, "first operation must be the constructor class name");
    if (!Array.isArray(item.expected) || item.expected.length !== operations.length) add(errors, `${solution.id}.cases[${caseIndex}].expected`, "must match the operation count");
    for (const [index, name] of operations.entries()) {
      const signature = index === 0 ? { params: func.constructorParams } : methods.find(method => method?.methodName === name);
      if (!signature) { add(errors, `${location}.operations[${index}]`, `unknown method ${name}`); continue; }
      const args = argumentsList[index];
      if (!Array.isArray(args) || !Array.isArray(signature.params) || args.length !== signature.params.length) { add(errors, `${location}.arguments[${index}]`, "argument count does not match signature"); continue; }
      for (const [paramIndex, param] of signature.params.entries()) if (hasText(param?.type) && !matchesType(args[paramIndex], param.type)) add(errors, `${location}.arguments[${index}][${paramIndex}]`, `expected ${param.type}`);
    }
  }
}

function checkNoPlaceholder(value, location, errors) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (text && PLACEHOLDER.test(text)) add(errors, location, "placeholder content");
}

function checkStudyOrder(hot100, errors) {
  const questions = hot100?.questions;
  if (!Array.isArray(questions) || questions.length !== 100) {
    add(errors, "hot100.questions", "expected exactly 100 questions");
    return;
  }
  const ids = new Set();
  const orders = new Set();
  const byId = new Map();
  for (const [index, question] of questions.entries()) {
    const location = `hot100.questions[${index}]`;
    if (!hasText(question.id)) add(errors, `${location}.id`, "missing id");
    if (ids.has(question.id)) add(errors, `${question.id}.id`, "duplicate question id");
    ids.add(question.id);
    byId.set(String(question.id), question);
    if (!Number.isInteger(question.studyOrder) || question.studyOrder < 1 || question.studyOrder > 100) {
      add(errors, `${question.id}.studyOrder`, "must be an integer from 1 to 100");
    } else if (orders.has(question.studyOrder)) {
      add(errors, `${question.id}.studyOrder`, "duplicate study order");
    } else orders.add(question.studyOrder);
    if (!hasText(question.phase)) add(errors, `${question.id}.phase`, "missing phase");
    if (!Array.isArray(question.concepts) || question.concepts.length === 0) add(errors, `${question.id}.concepts`, "must be a non-empty array");
    if (!Array.isArray(question.prerequisites)) add(errors, `${question.id}.prerequisites`, "must be an array");
  }
  for (const question of questions) {
    for (const prerequisite of question.prerequisites || []) {
      const target = byId.get(String(prerequisite));
      if (!target) add(errors, `${question.id}.prerequisites`, `unknown question ${prerequisite}`);
      else if (!(target.studyOrder < question.studyOrder)) add(errors, `${question.id}.prerequisites`, `${prerequisite} must be earlier in study order`);
    }
  }
  const visiting = new Set();
  const visited = new Set();
  function visit(id, trail = []) {
    if (visiting.has(id)) {
      const start = trail.indexOf(id);
      add(errors, `${id}.prerequisites`, `cycle ${[...trail.slice(start), id].join(" -> ")}`);
      return;
    }
    if (visited.has(id) || !byId.has(id)) return;
    visiting.add(id);
    for (const prerequisite of byId.get(id).prerequisites || []) visit(String(prerequisite), [...trail, id]);
    visiting.delete(id);
    visited.add(id);
  }
  for (const question of questions) visit(String(question.id));
}

function checkCases(solution, errors) {
  const location = `${solution.id}.cases`;
  if (!Array.isArray(solution.cases) || solution.cases.length < 3) {
    add(errors, location, "must contain at least three structured cases");
    return;
  }
  const ids = new Set();
  for (const [index, item] of solution.cases.entries()) {
    const itemLocation = `${location}[${index}]`;
    if (!hasText(item?.id)) add(errors, `${itemLocation}.id`, "missing stable case id");
    else if (ids.has(item.id)) add(errors, `${item.id}.id`, "duplicate case id");
    ids.add(item?.id);
    if (!item?.input || typeof item.input !== "object") add(errors, `${itemLocation}.input`, "must be structured data");
    if (!Object.prototype.hasOwnProperty.call(item || {}, "expected")) add(errors, `${itemLocation}.expected`, "missing expected value");
    if (!Array.isArray(item?.tags) || item.tags.length === 0) add(errors, `${itemLocation}.tags`, "must be a non-empty array");
  }
  for (const tag of ["basic", "boundary", "adversarial"]) {
    if (!solution.cases.some((item) => item.tags?.includes(tag))) add(errors, location, `missing ${tag} case`);
  }
}

function checkSolution(solution, errors) {
  const id = solution?.id || "unknown";
  const requiredText = ["recognition", "correctness"];
  for (const field of requiredText) if (!hasText(solution[field])) add(errors, `${id}.${field}`, "required text is missing");
  for (const field of ["steps", "walkthrough", "pitfalls"]) {
    if (!Array.isArray(solution[field]) || solution[field].length === 0) add(errors, `${id}.${field}`, "must be a non-empty array");
  }
  if (!Array.isArray(solution.hints) || solution.hints.length !== 4) add(errors, `${id}.hints`, "must contain levels 1 through 4");
  else {
    const levels = solution.hints.map((hint) => hint?.level);
    if (levels.join(",") !== "1,2,3,4") add(errors, `${id}.hints.level`, "must be ordered 1,2,3,4");
    for (const hint of solution.hints) if (!hasText(hint?.text)) add(errors, `${id}.hints[${hint?.level}].text`, "missing hint text");
  }
  const func = solution.func;
  if (!func || !hasText(func.className) || !hasText(func.methodName) || !Array.isArray(func.params) || !hasText(func.returns)) add(errors, `${id}.func`, "incomplete function contract");
  if (!COMPARE_VALUES.has(func?.compare)) add(errors, `${id}.func.compare`, "unsupported comparison strategy");
  checkCases(solution, errors);
  checkOperationContract(solution, errors);
  checkFunctionContract(solution, errors);
  if (!solution.acm || !hasText(solution.acm.input) || !hasText(solution.acm.output) || !Array.isArray(solution.acm.examples) || solution.acm.examples.length === 0) add(errors, `${id}.acm`, "input, output and examples are required");
  else for (const [index, example] of solution.acm.examples.entries()) {
    if (!hasText(example?.input) || !hasText(example?.output)) add(errors, `${id}.acm.examples[${index}]`, "input and output are required");
  }
  if (!Array.isArray(solution.sources) || solution.sources.length === 0) add(errors, `${id}.sources`, "at least one source is required");
  else for (const [index, source] of solution.sources.entries()) {
    if (!SOURCE_TYPES.has(source?.type)) add(errors, `${id}.sources[${index}].type`, "unsupported source type");
    if (!hasText(source?.label)) add(errors, `${id}.sources[${index}].label`, "missing source label");
    if (!/^https?:\/\//.test(source?.url || "")) add(errors, `${id}.sources[${index}].url`, "must be an http(s) URL");
  }
  if (!COMPLEXITY.test(solution.complexity?.time || "")) add(errors, `${id}.complexity.time`, "must use O(...) notation");
  if (!COMPLEXITY.test(solution.complexity?.space || "")) add(errors, `${id}.complexity.space`, "must use O(...) notation");
  for (const field of ["recognition", "steps", "walkthrough", "correctness", "pitfalls", "summaryText", "java", "python"]) checkNoPlaceholder(solution[field], `${id}.${field}`, errors);
  for (const field of ["java", "python"]) {
    if (!hasText(solution[field])) add(errors, `${id}.${field}`, "executable code is missing");
    else {
      if (/```/.test(solution[field])) add(errors, `${id}.${field}`, "executable code contains Markdown fence");
      if (func && func.params && /(?:Object\.\.\.|\*args|\*\*kwargs)/.test(signatureSource(solution[field], field)) && func.params.length > 0) add(errors, `${id}.${field}`, "generic variadic function parameters are not allowed");
      const uncommented = field === "java"
        ? solution[field].replace(/\/\*[\s\S]*?\*\//g, "")
        : solution[field].replace(/"""[\s\S]*?"""|'''[\s\S]*?'''/g, "");
      const prose = uncommented.split("\n").filter(line => !/^\s*(?:\/\/|#|\*)/.test(line));
      if (prose.some(line => /力扣题解|代码随想录|^\s*(?:#{1,6}\s*)?[（(]?(?:题目(?:描述)?|思路(?:分析)?|方法[一二三四]|Java\s*代码|Python\s*代码|总结|版本[一二三四])(?:[）)：:\s]|$)/.test(line))) add(errors, `${id}.${field}`, "article heading in executable code");
    }
  }
  for (const field of STUDY_TEXT_FIELDS) checkStudyText(solution[field], `${id}.${field}`, errors);
  for (const [field, value] of Object.entries(solution.complexity || {})) checkStudyText(value, `${id}.complexity.${field}`, errors);
  for (const [index, hint] of (solution.hints || []).entries()) {
    const pseudocode = hint?.level === 4 || hint?.kind === "pseudocode" || hint?.type === "pseudocode";
    checkStudyText(hint?.text, `${id}.hints[${index}].text`, errors, pseudocode);
    if (hint?.level === 3 && hint.text?.length < 55) add(errors, `${id}.hints[${index}].text`, "full approach is too brief");
    if (pseudocode && (hint.text?.split("\n").length < 5 || !/\n {2,}\S/.test(hint.text || ""))) add(errors, `${id}.hints[${index}].text`, "pseudocode needs concrete steps with line breaks and indentation");
  }
  for (const [index, example] of (solution.examples || []).entries()) checkStudyText(example.explanation, `${id}.examples[${index}].explanation`, errors);
  for (const [index, table] of (solution.tables || []).entries()) {
    checkStudyText(table.headers, `${id}.tables[${index}].headers`, errors);
    for (const [rowIndex, row] of (table.rows || []).entries()) for (const [column, value] of row.entries()) checkStudyText(value, `${id}.tables[${index}].rows[${rowIndex}][${column}]`, errors);
  }
}

export function validateContent({ hot100, solutions }) {
  const errors = [];
  checkStudyOrder(hot100, errors);
  const expectedIds = new Set((hot100?.questions || []).map((question) => String(question.id)));
  const seenIds = new Set();
  for (const solution of solutions || []) {
    const id = String(solution?.id || "unknown");
    if (!expectedIds.has(id)) add(errors, `${id}.id`, "solution id is not in Hot 100");
    if (seenIds.has(id)) add(errors, `${id}.id`, "duplicate solution id");
    seenIds.add(id);
    checkSolution(solution, errors);
  }
  for (const id of expectedIds) if (!seenIds.has(id)) add(errors, `${id}.solution`, "missing solution record");
  const summaries = new Map();
  for (const solution of solutions || []) {
    const text = solution.summaryText?.trim();
    if (!text) continue;
    summaries.set(text, [...(summaries.get(text) || []), solution.id]);
  }
  for (const [text, ids] of summaries) if (ids.length > 5) add(errors, `${ids[0]}.summaryText`, `generic summary repeated for ${ids.join(",")}`);
  return errors;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const errors = validateContent(loadContent());
  if (errors.length) {
    for (const error of errors) console.error(error);
    process.exitCode = 1;
  } else {
    console.log("validated Hot 100 schema and content");
  }
}

