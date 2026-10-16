# Hints and Progressive Solution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现逐级提示和渐进题解，让用户卡住时得到适量帮助，同时保留右侧编码区和练习历史。

**Architecture:** 提示和折叠题解先做成独立纯组件；组件通过回调报告 `recordHint`、`recordSolutionView` 和锚点跳转，不直接修改全局状态。集成会话再把回调接入 `main.jsx`。

**Tech Stack:** React 19、JSX、Node `node:test`。

**Spec:** `docs/superpowers/specs/2026-10-14-hot100-learning-platform-design.md`

## Global Constraints

- 只修改或新增 `src/components/HintLadder.jsx`、`src/components/ProgressiveSolution.jsx`、`src/components/SolutionView.jsx`、`src/services/hints.js` 及测试。
- 不修改 `src/main.jsx`、`src/styles.css`、题解 JSON 批量内容和存储服务。
- 第 1 层题解 `recognition` 默认展开；第 2–5 层默认折叠。
- 第 4 级提示只能是伪代码，组件不执行或复制为用户代码。

## Review Focus

- 重复点击提示不会跳过等级或产生大于 4 的值。
- 已展开提示和题解层保持可见，切换语言不会重置展开状态。
- 观看代码记录当前语言和时间，但不抹掉历史上的独立通过。
- 缺少新字段的旧题解显示兼容占位而不抛异常。
- 键盘可以打开折叠层和提示按钮。

### Task 1: Build hint state helpers

**Files:**
- Create: `src/services/hints.js`
- Test: `tests/hints.test.mjs`

**Interfaces:**
- `nextHintLevel(hintsUsed, hints) -> number`
- `getVisibleHints(hints, hintsUsed) -> Hint[]`
- `recordHintUsage(progressItem, level, now) -> ProgressItem`

- [ ] **Step 1: Test empty hints, repeated clicks, missing levels and maximum level 4.**
- [ ] **Step 2: Implement pure helpers that never mutate the input object.**
- [ ] **Step 3: Preserve `hintHistory` entries `{ level, createdAt }` without duplicate consecutive records.**
- [ ] **Step 4: Run `node --test tests/hints.test.mjs`.**

### Task 2: Implement `HintLadder`

**Files:**
- Create: `src/components/HintLadder.jsx`

**Interfaces:**
- Props: `{ hints, hintsUsed, onRequestHint, disabled, className }`
- Emits: `onRequestHint(nextLevel)` only when the user explicitly clicks.

- [ ] **Step 1: Render only the visible prefix of hints.**
- [ ] **Step 2: Render a single button labeled `我要提示（第 N 级）`; after level 4 render `再想不出来就看题解`.**
- [ ] **Step 3: Add accessible level labels and a non-code visual treatment for pseudocode.**
- [ ] **Step 4: Add a compatibility message when the record has fewer than four hints.**

### Task 3: Implement progressive solution groups

**Files:**
- Create: `src/components/ProgressiveSolution.jsx`
- Modify: `src/components/SolutionView.jsx`

**Interfaces:**
- Props: `{ question, solution, language, onLanguageChange, onViewCode, onJumpToEditor }`
- Emits: `onViewCode({ language, viewedAt })` when the code group opens.

- [ ] **Step 1: Render five native disclosure groups in the fixed order from the spec.**
- [ ] **Step 2: Keep `recognition` open by default and all other groups closed.**
- [ ] **Step 3: Put Java/Python code in the fifth group and call `onViewCode` once per open action.**
- [ ] **Step 4: Add source links and image fallbacks without blocking the rest of the solution.**
- [ ] **Step 5: Run component logic tests and `npm run build`.**

### Task 4: Commit isolated UI components

- [ ] **Step 1: Run `npm test`.**
- [ ] **Step 2: Run `git diff --check`.**
- [ ] **Step 3: Commit with `feat: add hint ladder and progressive solutions`.**
