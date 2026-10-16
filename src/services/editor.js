import { isVoid, nodeDefinitions, pythonType } from "./function-contract.js";

const EPOCH = "1970-01-01T00:00:00.000Z";

const RUN_RESULT_TITLES = {
  passed: "示例通过",
  completed: "运行完成",
  mismatch: "结果不匹配",
  template: "需要完整程序入口",
  compile_error: "编译错误",
  timeout: "运行超时",
  output_limit: "输出超限",
  runtime_error: "运行错误",
  compile_timeout: "编译超时",
  environment_error: "运行环境不可用",
  unavailable: "运行接口不可用",
  unsupported: "暂不支持此运行方式"
};

const FAILED_CASE_STATUSES = new Set([
  "mismatch",
  "compile_error",
  "timeout",
  "output_limit",
  "runtime_error",
  "compile_timeout",
  "environment_error",
  "template",
  "unsupported"
]);

export function getRunResultTitle(result) {
  if (!result || typeof result !== "object") return "";

  const caseStatus = Array.isArray(result.cases)
    ? result.cases.find((item) => FAILED_CASE_STATUSES.has(item?.status))?.status
    : undefined;
  const status = caseStatus || result.status;
  return status ? RUN_RESULT_TITLES[status] || "运行失败" : "";
}

export function getDraftKey(questionId, language = "java", mode = "function") {
  return `${String(questionId)}:${String(language)}:${String(mode)}`;
}

export function getRunResultDetails(result) {
  if (!result) return [];
  return (Array.isArray(result.cases) ? result.cases : [result]).map((item, index) => ({
    ...item,
    caseId: item.caseId || `case-${index + 1}`,
    title: getRunResultTitle(item)
  }));
}

export function getExecutionCases(solution, mode) {
  if (mode === "acm") return (solution.acm?.examples || []).map((item, index) => ({ id: `acm-${index + 1}`, input: item.input, expected: item.output }));
  return Array.isArray(solution.cases) ? solution.cases : [];
}

export function normalizeDraftRecord(record = {}) {
  const source = record && typeof record === "object" ? record : {};
  const updatedAt = typeof source.updatedAt === "string" && !Number.isNaN(Date.parse(source.updatedAt))
    ? source.updatedAt
    : EPOCH;
  return {
    code: typeof source.code === "string" ? source.code : "",
    cursor: Number.isFinite(source.cursor) && source.cursor >= 0 ? source.cursor : 0,
    scrollTop: Number.isFinite(source.scrollTop) && source.scrollTop >= 0 ? source.scrollTop : 0,
    updatedAt
  };
}

export function selectDraftRecord(drafts, questionId, language = "java", mode = "function") {
  return normalizeDraftRecord(drafts?.[questionId]?.[language]?.[mode]);
}

function createFunctionTemplates(solution = {}) {
  const func = solution.func;
  if (!func) return { java: "// 题目函数签名暂不可用，请稍后重试。\n", python: "# 题目函数签名暂不可用，请稍后重试。\n" };
  const { className, methodName, params, returns } = func;
  if (func.compare === "operation-sequence") {
    const javaParams = params => params.map(p => `${p.type} ${p.name}`).join(", ");
    const pyParams = params => params.map(p => `${p.name}: ${pythonType(p.type)}`).join(", ");
    const methods = func.methods || [];
    return {
      java: `import java.util.*;\n\nclass ${className} {\n    public ${className}(${javaParams(func.constructorParams)}) {\n        // 初始化数据结构\n    }\n${methods.map(m => `    public ${m.returns} ${m.methodName}(${javaParams(m.params)}) {\n        ${isVoid(m) ? "// 请完成操作" : `return ${m.returns === "boolean" ? "false" : "0"};`}\n    }`).join("\n")}\n}\n`,
      python: `from typing import *\n\nclass ${className}:\n    def __init__(self${func.constructorParams.length ? ", " + pyParams(func.constructorParams) : ""}):\n        pass\n${methods.map(m => `    def ${m.methodName}(self${m.params.length ? ", " + pyParams(m.params) : ""}) -> ${pythonType(m.returns)}:\n        pass`).join("\n")}\n`
    };
  }
  const javaParams = params.map(param => `${param.type} ${param.name}`).join(", ");
  const pyParams = params.map(param => `${param.name}: ${pythonType(param.type)}`).join(", ");
  const javaReturn = isVoid(func) ? "" : `\n        return ${returns === "boolean" ? "false" : /^(int|long|double|float)$/.test(returns) ? "0" : "null"};`;
  return {
    python: `from typing import *\n\n${nodeDefinitions("python", func)}\nclass ${className}:\n    def ${methodName}(self${pyParams ? ", " + pyParams : ""}) -> ${pythonType(returns)}:\n        # 请在这里完成算法\n        pass\n`,
    java: `import java.util.*;\n\n${nodeDefinitions("java", func)}\nclass ${className} {\n    public ${returns} ${methodName}(${javaParams}) {\n        // 请在这里完成算法${javaReturn}\n    }\n}\n`
  };
}

function createAcmTemplates(solution = {}) {
  const title = solution.title || "当前题目";
  return {
    python: `# ${title}\n# 请读取标准输入，完成题目后打印标准输出。\ndef main():\n    pass\n\nif __name__ == "__main__":\n    main()\n`,
    java: `import java.io.*;\nimport java.util.*;\n\npublic class Main {\n    public static void main(String[] args) throws Exception {\n        // ${title}\n        // 请读取标准输入，完成题目后打印标准输出。\n    }\n}\n`
  };
}

export function createLanguageDrafts(solution = {}, mode = "acm") {
  return mode === "function" ? createFunctionTemplates(solution) : createAcmTemplates(solution);
}

export function createDraftTemplates(solution = {}) {
  return {
    function: createLanguageDrafts(solution, "function"),
    acm: createLanguageDrafts(solution, "acm")
  };
}

export function selectLanguageCode(drafts, language, mode, questionId) {
  const scoped = questionId !== undefined && questionId !== null ? drafts?.[questionId] : drafts;
  const record = mode && scoped?.[language]?.[mode];
  if (typeof record?.code === "string") return record.code;
  if (mode && typeof scoped?.[mode]?.[language] === "string") return scoped[mode][language];
  if (mode && typeof scoped?.[mode]?.[language]?.code === "string") return scoped[mode][language].code;
  if (typeof scoped?.[language] === "string") return scoped[language];
  if (typeof scoped?.[language]?.code === "string") return scoped[language].code;
  if (typeof scoped?.function?.[language] === "string") return scoped.function[language];
  if (typeof scoped?.function?.[language]?.code === "string") return scoped.function[language].code;
  return "";
}
