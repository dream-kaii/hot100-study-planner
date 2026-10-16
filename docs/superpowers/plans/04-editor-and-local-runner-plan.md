# Editor and Local Runner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用适合长期写代码的编辑器替换文本框，并为 Java/Python 函数模式与 ACM 模式提供可控的本地运行入口。

**Architecture:** 编辑器只负责模型、光标、滚动位置和输入事件；运行器只负责执行请求、限制进程和返回结构化结果。题型转换与比较策略从执行器中抽出纯函数，避免运行器猜测输入。

**Tech Stack:** React 19、Vite 7、Monaco Editor、Node `child_process`、Node `node:test`。

**Spec:** `docs/superpowers/specs/2026-10-14-hot100-learning-platform-design.md`

## Global Constraints

- 只修改 `package.json`、`package-lock.json`、`src/components/CodeEditor.jsx`、`src/services/editor.js`、`src/services/runner.js`、`src/server/local-runner.mjs`、`vite.config.js` 及运行器测试。
- 不修改 `src/main.jsx`、`src/styles.css`、题解 JSON 和 Dashboard。
- 本地中间件只绑定回环地址；编译 10 秒、单用例运行 3 秒、输出 64KB。
- 同一浏览器会话串行执行，运行中禁用按钮；进程超时必须杀掉子进程组并清理临时目录。

## Review Focus

- Python 的 `class Solution` 函数代码和 Java 的 `Solution` 方法代码不能被误判为缺少 `main`。
- Java 类设计题需要操作序列，不能套用数组输入。
- 运行器缺少 Python 或 JDK 时返回环境提示，不返回裸异常堆栈。
- 无限循环、输出爆炸、编译超时和重复运行都可恢复。
- 参考输入不应通过 shell 字符串拼接，用户代码不能修改项目源文件。

### Task 1: Add Monaco editor dependency and model wrapper

**Files:**
- Modify: `package.json`, `package-lock.json`
- Modify: `src/components/CodeEditor.jsx`
- Modify: `src/services/editor.js`
- Test: `tests/editor.test.mjs`

- [ ] **Step 1: Add `monaco-editor` and `@monaco-editor/react` as production dependencies.**
- [ ] **Step 2: Extend editor helpers with `getDraftKey(questionId, language, mode)` and `normalizeDraftRecord(record)`.**
- [ ] **Step 3: Replace the textarea with Monaco configured for Java/Python, line numbers, bracket matching, automatic indentation, find, undo/redo and a light high-contrast theme.**
- [ ] **Step 4: Emit `{ code, cursor, scrollTop }` through `onDraftChange`; do not persist drafts inside the component.**
- [ ] **Step 5: Test draft keys, mode separation and template selection.**

### Task 2: Implement structured comparison

**Files:**
- Modify: `src/services/runner.js`
- Test: `tests/runner.test.mjs`

**Interfaces:**
- `compareResult(compareMode, actual, expected) -> { passed, message }`
- `normalizeCaseInput(question, raw) -> AdapterInput`
- `runExample({ questionId, language, mode, code, cases }) -> RunResult`

- [ ] **Step 1: Test exact, unordered arrays, nested unordered arrays, in-place mutation, operation sequence and identity result modes.**
- [ ] **Step 2: Implement comparison without evaluating user-provided JavaScript.**
- [ ] **Step 3: Return per-case `{ caseId, status, input, expected, actual, error, durationMs }`.**

### Task 3: Harden process execution

**Files:**
- Modify: `src/services/runner.js`, `src/server/local-runner.mjs`, `vite.config.js`

- [ ] **Step 1: Validate JSON content type, body size and supported language/mode before spawning.**
- [ ] **Step 2: Use temporary directories and direct `spawn` argument arrays; never invoke a shell.**
- [ ] **Step 3: Add independent compile and run timers, output cap, cleanup in `finally`, and a per-process queue.**
- [ ] **Step 4: Add environment probes returning actual `python3 --version` and `javac -version` output.**
- [ ] **Step 5: Add tests for missing command, timeout, output limit, repeated requests and Java compile errors.**

### Task 4: Commit runner and editor

- [ ] **Step 1: Run `npm test`.**
- [ ] **Step 2: Run `npm run build`.**
- [ ] **Step 3: Commit with `feat: add Monaco editor and hardened local runner`.**
