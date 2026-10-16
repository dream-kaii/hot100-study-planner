# Hot 100 学习工作台实施计划（已被新版并行计划取代）

> 本文件保留作历史记录，不再作为执行依据。请使用 `docs/superpowers/plans/00-parallel-execution-guide.md` 及其 `01`–`07` 子计划；它们对应 2026-10-14 设计文件，已经补充提示阶梯、渐进题解、历史轨迹、Schema 和会话并行边界。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 Hot 100 Study Planner 上完成可本地刷题、运行 Java/Python、错题复习和自动备份的学习工作台。

**Architecture:** 保留 React/Vite 前端和现有 Hot 100 数据，按组件拆分页面；把学习状态、复习规则、备份和运行器拆成独立模块。浏览器负责界面和本地状态，Vite 本地中间件只负责在用户电脑上执行示例代码，不引入远程后端。

**Tech Stack:** React 19, Vite 7, JavaScript/JSX, lucide-react, 原生 localStorage/IndexedDB/File System Access API, Node `node:test`, 本机 Python 3 和 JDK。

**Spec:** `docs/superpowers/specs/2026-10-13-hot100-study-workbench-design.md`

## Global Constraints

- 直接改造现有公开项目，不重新搭建独立应用。
- 使用 React + Vite，保持轻量，不增加账号、云同步、多用户或线上后台。
- 第一版采用公开样例输入输出比较，不实现完整隐藏测试判题。
- 首次使用必须设置自动备份位置；之后状态变化自动写入备份文件，并支持一键导入。
- 题解优先搬运代码随想录中的文字、Java 和 Python 内容；没有对应内容时使用力扣内容，并保留来源链接和作者说明。
- 本地运行限制为 3 秒和 64KB 输出；不接受远程访问。

## Review Focus

- 用户首次没有选择备份位置时，不能进入主页面，且不会静默丢失状态。
- 导入旧备份、损坏 JSON 或版本较旧的备份时，原有数据不被覆盖破坏。
- 倒计时暂停、刷新和到点后的状态必须一致，不能出现负数或重复计时。
- Java 编译失败、Python 运行异常、超时和过大输出必须被安全地返回到页面。
- 题解数据缺失或链接失效时，题目仍可刷，且能显示力扣备用来源。

---

### Task 0: 初始化前端设计上下文

**Files:**
- Create: `.superdesign/init/components.md`
- Create: `.superdesign/init/layouts.md`
- Create: `.superdesign/init/routes.md`
- Create: `.superdesign/init/theme.md`
- Create: `.superdesign/init/pages.md`
- Create: `.superdesign/init/extractable-components.md`
- Create: `.superdesign/design-system.md`

- [ ] **Step 1: Run the installed Superdesign CLI preflight and verify the CLI is available and authenticated.**
- [ ] **Step 2: Analyze the current React/Vite source and write all six non-empty `.superdesign/init/` context files with actual component, layout, route, theme, and dependency information.**
- [ ] **Step 3: Write `.superdesign/design-system.md` with the approved slate/indigo/green/orange palette, Chinese typography, spacing, radius, focus, and responsive rules.**
- [ ] **Step 4: Run a design-context completeness check that confirms all six init files and the design-system file are non-empty.**
- [ ] **Step 5: Commit `docs: initialize frontend design context`.**

### Task 0.5: 建立纯逻辑测试入口

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add the `test` script as `node --test tests/*.test.mjs` without changing production behavior.**
- [ ] **Step 2: Run `npm test` and verify it exits successfully with no test files yet.**
- [ ] **Step 3: Commit `chore: add node test script`.**

### Task 1: 建立测试入口与学习状态模块

**Files:**
- Create: `tests/review.test.mjs`
- Create: `tests/storage.test.mjs`
- Create: `src/services/review.js`
- Create: `src/services/storage.js`
- Modify: `package.json`

**Interfaces:**
- `review.js` exports `getNextReviewAt(status, now)`, `isReviewDue(progressItem, now)`, and `advanceReview(progressItem, result, now)`.
- `storage.js` exports `createDefaultState()`, `mergeState(current, incoming)`, `serializeState(state)`, and `parseState(raw)`.
- Tests run with `node --test tests/*.test.mjs`.

- [ ] **Step 1: Add the failing review tests** for 1/3/7/14 day intervals, due-date detection, and a completed item becoming “已掌握”.
- [ ] **Step 2: Run `node --test tests/review.test.mjs` and verify the review tests fail because `src/services/review.js` does not exist.**
- [ ] **Step 3: Implement the smallest pure review functions with ISO timestamps and no browser dependencies.**
- [ ] **Step 4: Run `node --test tests/review.test.mjs` and verify the review tests pass.**
- [ ] **Step 5: Add failing storage tests** for default state, malformed JSON, version field, and ID-based merge behavior.
- [ ] **Step 6: Run `node --test tests/storage.test.mjs` and verify the new storage tests fail for the missing module.**
- [ ] **Step 7: Implement versioned state parsing, safe fallback to defaults, and timestamp-aware merge.**
- [ ] **Step 8: Run `npm test` and verify all current tests pass.**
- [ ] **Step 9: Commit `test: add review and storage foundations`.**

### Task 2: 补齐题解数据和题目详情数据

**Files:**
- Create: `src/data/solutions.json`
- Create: `scripts/validate-solutions.mjs`
- Create: `tests/solutions.test.mjs`
- Modify: `src/data/hot100.json`

**Interfaces:**
- Every Hot 100 question ID has a solutions record with `id`, `summary`, `java`, `python`, `examples`, `complexity`, `solutionSource`, and `fallbackSource`.
- `scripts/validate-solutions.mjs` exits non-zero when an ID is missing, duplicated, or lacks a fallback source.

- [ ] **Step 1: Write the validator test** requiring all IDs in `hot100.json` to appear exactly once in `solutions.json` and every record to contain both language keys and at least one example.
- [ ] **Step 2: Run `node --test tests/solutions.test.mjs` and verify it fails because the solution data is incomplete.**
- [ ] **Step 3: Build `solutions.json` from Hot 100 IDs, preserving CodeThinking/LeetCode source attribution and adding Java/Python snippets and public examples.**
- [ ] **Step 4: Run the validator and solution tests until all 100 records pass schema and ID checks.**
- [ ] **Step 5: Commit `data: add Hot 100 Java and Python solution records`.**

### Task 3: 自动备份、导入导出和首次设置

**Files:**
- Create: `src/services/backup.js`
- Create: `tests/backup.test.mjs`
- Create: `src/components/BackupSetup.jsx`
- Create: `src/components/BackupPanel.jsx`
- Modify: `src/services/storage.js`

**Interfaces:**
- `backup.js` exports `requestBackupDirectory()`, `hasBackupDirectory()`, `writeBackup(state)`, `readBackupFile(file)`, `mergeOrReplaceState(current, incoming, mode)`, and `exportBackup(state)`.
- Directory handles are stored in IndexedDB; state files use the JSON schema from the spec.

- [ ] **Step 1: Write failing pure tests** for malformed import data, replace/merge behavior, and JSON version validation.
- [ ] **Step 2: Run `npm test` and verify backup tests fail because the backup module is missing.**
- [ ] **Step 3: Implement pure backup serialization and merge behavior, keeping browser APIs behind small adapters.**
- [ ] **Step 4: Run `npm test` and verify backup tests pass.**
- [ ] **Step 5: Implement the first-use setup screen, IndexedDB directory-handle storage, debounced `hot100-backup.json` writes, immediate backup, import, export, and clear error messages for unsupported browsers.**
- [ ] **Step 6: Manually verify first-use blocking, successful folder selection, import merge, import replace, and recovery from malformed JSON.**
- [ ] **Step 7: Commit `feat: add local backup and restore workflow`.**

### Task 4: 重做页面和题目练习流程

**Files:**
- Create: `src/components/ProblemDetail.jsx`
- Create: `src/components/CodeEditor.jsx`
- Create: `src/components/Timer.jsx`
- Create: `src/components/ProblemCard.jsx`
- Create: `src/components/ProgressPanel.jsx`
- Create: `tests/practice.test.mjs`
- Create: `src/pages/Dashboard.jsx`
- Create: `src/pages/ProblemBank.jsx`
- Create: `src/pages/Mistakes.jsx`
- Modify: `src/main.jsx`
- Modify: `src/styles.css`

**Interfaces:**
- `ProblemDetail` receives `question`, `solution`, `progressItem`, `note`, `onProgressChange`, `onNoteChange`, and `onRun`.
- `Timer` receives `durationSeconds`, `persistedTimer`, `onChange`, and `onComplete`.
- `ProblemBank` receives the Hot 100 records, filters, and a stable `onOpenQuestion(id)` callback.

- [ ] **Step 1: Add component-level pure tests for filtering, sequential selection, random selection, and timer transitions using extracted helpers.**
- [ ] **Step 2: Run `npm test` and verify the new tests fail before helpers are implemented.**
- [ ] **Step 3: Implement selection and timer helpers, then rerun tests to green.**
- [ ] **Step 4: Split the current monolithic render into dashboard, bank, detail, and mistakes views while preserving existing daily-plan behavior.**
- [ ] **Step 5: Add Java/Python tabs, source links, sample input/output, notes, error-reason buttons, review date, sequential/random practice, and timer controls.**
- [ ] **Step 6: Replace the red/black poster styling with a restrained slate/indigo/green/orange design system, responsive layout, readable Chinese typography, accessible focus states, and no decorative noise layers.**
- [ ] **Step 7: Connect every state mutation to storage and debounced backup.**
- [ ] **Step 8: Run `npm run build` and manually smoke-test the main flows in a browser.**
- [ ] **Step 9: Commit `feat: redesign study workspace and practice flow`.**

### Task 5: 本地 Java/Python 示例运行器

**Files:**
- Create: `src/services/runner.js`
- Create: `src/server/local-runner.mjs`
- Create: `tests/runner.test.mjs`
- Modify: `vite.config.js`
- Modify: `src/components/CodeEditor.jsx`

**Interfaces:**
- `runner.js` exports `runExample({ language, code, input, expectedOutput })` and returns `{ status, output, error, durationMs }`.
- The Vite middleware handles `POST /__runner` with `{ language, code, input, expectedOutput }` and returns the same result shape.

- [ ] **Step 1: Add failing runner tests** for unsupported language, output normalization, timeout response, and non-zero process exit.
- [ ] **Step 2: Run `npm test` and verify runner tests fail because the runner module is missing.**
- [ ] **Step 3: Implement the Node-side process runner with temporary directories, `python3`/`javac`/`java`, 3-second timeout, 64KB output limit, and cleanup in `finally`.**
- [ ] **Step 4: Run `npm test` and verify runner tests pass without relying on a live browser.**
- [ ] **Step 5: Add the Vite middleware and browser-side request adapter.**
- [ ] **Step 6: Add runtime checks for Python and Java availability and show compile/runtime errors in the detail page.**
- [ ] **Step 7: Run a real Java example and Python example through the local dev server, then commit `feat: add local Java and Python example runner`.**

### Task 6: 一键启动、说明和完整验证

**Files:**
- Create: `scripts/start.command`
- Create: `scripts/start.bat`
- Create: `scripts/smoke-check.mjs`
- Modify: `README.md`
- Modify: `.gitignore`

- [ ] **Step 1: Write `scripts/smoke-check.mjs`** that verifies package install, required data count, build success, and start-script paths.
- [ ] **Step 2: Run the smoke check and verify it fails before the scripts and final documentation are complete.**
- [ ] **Step 3: Implement macOS and Windows one-click startup scripts that install missing dependencies, start Vite, and open the local URL.**
- [ ] **Step 4: Document Chrome/Edge requirement for automatic folder backups, local Java/Python prerequisites, sample-only judging, and backup recovery.**
- [ ] **Step 5: Run `npm test`, `npm run build`, the data validator, and the browser smoke flow; read all outputs.**
- [ ] **Step 6: Remove temporary reference clones, generated screenshots, transient logs, and unused files; keep only project source, required data, docs, and lockfile.**
- [ ] **Step 7: Commit `chore: add startup scripts and verification docs`.**

## Final Verification

Run from `/Users/kaii/myprojects/hot100-study-planner`:

```bash
npm test
node scripts/validate-solutions.mjs
npm run build
```

Then start the local app and verify first-use backup setup, sequential practice, random practice, timer persistence, Java/Python example execution, wrong-answer review, import merge/replace, and a fresh browser reload. Only report completion after these checks produce evidence.
