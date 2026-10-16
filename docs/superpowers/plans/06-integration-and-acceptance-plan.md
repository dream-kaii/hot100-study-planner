# Hot 100 Integration and Acceptance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将基础契约、题解内容、提示、编辑器、运行器和进步展示接入一个完整的左右练习工作区。

**Architecture:** 本计划是唯一修改应用入口和全局样式的计划。它把各会话输出接入 `main.jsx`，统一保存状态和异步题解加载，重做练习页布局，并保证题解左侧展开不会重建右侧编辑器。

**Tech Stack:** React 19、Vite 7、CSS、现有 lucide-react。

**Spec:** `docs/superpowers/specs/2026-10-14-hot100-learning-platform-design.md`

## Global Constraints

- 只在 01–05 已合并并通过各自测试后开始。
- 本计划唯一允许修改 `src/main.jsx`、`src/styles.css`、`src/components/ProblemDetail.jsx`、`src/pages/ProblemBank.jsx`、`src/pages/Mistakes.jsx`、`README.md`。
- 左侧题面/题解切换不能卸载右侧编辑器；题目切换才切换草稿模型。
- 首次打开不强制选择备份目录；不支持文件夹权限时仍可用 localStorage 和导出。
- Java 默认语言；Python、函数/ACM 和学习/独立/面试模拟模式都要有明确的视觉状态。

## Review Focus

- 快速切题时，旧题解异步响应不能显示在新题目中。
- 同一题四份草稿互不覆盖，刷新后恢复代码、光标和滚动位置。
- 打开提示、题解代码和运行结果后，状态立即保存且刷新后仍在。
- 题面和题解两栏独立滚动；编辑器位置稳定；移动端上下排列。
- 线上没有本地运行接口时，编辑器仍可用，按钮提示“请在本地开发环境运行”。

### Task 1: Rewire state and route composition

**Files:**
- Modify: `src/main.jsx`

- [ ] **Step 1: Replace local-only drafts with version 3 `state.drafts` and callbacks from `storage.js`.**
- [ ] **Step 2: Add `recordHint`, `recordSolutionView`, `recordHistory`, `setDraft` callbacks using functional state updates.**
- [ ] **Step 3: Guard async solution loading with a request token or selected ID check.**
- [ ] **Step 4: Keep localStorage persistence immediate and make file backup optional.**
- [ ] **Step 5: Pass exact props to `ProblemDetail`, Dashboard, ProblemBank and Mistakes.**

### Task 2: Build the integrated practice workspace

**Files:**
- Modify: `src/components/ProblemDetail.jsx`

- [ ] **Step 1: Add left tabs `题目` and `题解`; mount `ProgressiveSolution` in the left pane.**
- [ ] **Step 2: Keep `CodeEditor` mounted in the right pane while switching left tabs.**
- [ ] **Step 3: Mount `HintLadder` above the editor and wire hint callbacks.**
- [ ] **Step 4: Add language and function/ACM mode controls, draft save indicator, run results and personal notes.**
- [ ] **Step 5: Add a “下一题” action using `studyOrder`, preserving the current stage and filters.**

### Task 3: Apply visual system and accessibility behavior

**Files:**
- Modify: `src/styles.css`

- [ ] **Step 1: Apply warm background `#F7F5F0`, panel `#FFFEFB`, dark text `#292824`, terracotta accent `#B65332`, and visible focus ring.**
- [ ] **Step 2: Build 45/55 resizable workspace with independent scroll containers and a collapse-reading control.**
- [ ] **Step 3: Add compact solution typography, code block spacing, image fallback, result colors and mobile stacking.**
- [ ] **Step 4: Ensure buttons expose text or `aria-label`; native disclosure controls are keyboard accessible.**
- [ ] **Step 5: Keep Monaco Tab indentation inside the editor; outside the editor Tab moves focus.**
- [ ] **Step 6: Verify accent/background and error/success pairs meet readable contrast using a local contrast check.**

### Task 4: Update daily entry and backup behavior

**Files:**
- Modify: `src/pages/ProblemBank.jsx`, `src/pages/Mistakes.jsx`, `README.md`

- [ ] **Step 1: Separate “今日复习” and “今日新题”; default new-question limit is 1 and remains editable.**
- [ ] **Step 2: Add “从上次草稿继续” and “空白重做” choices during review.**
- [ ] **Step 3: Document Java/Python prerequisites, function/ACM modes, local-only execution and optional backup.**

### Task 5: Run integration checks

- [ ] **Step 1: Run `npm test`.**
- [ ] **Step 2: Run `node scripts/validate-schema.mjs` and `node scripts/validate-solutions.mjs`.**
- [ ] **Step 3: Run `npm run build`.**
- [ ] **Step 4: Start the app and verify: open first study item, request two hints, open recognition only, edit Java, switch to Python, switch to ACM, reload, run a public case, open history and move to next question.**
- [ ] **Step 5: Commit with `feat: integrate learning workspace and warm visual system`.**
