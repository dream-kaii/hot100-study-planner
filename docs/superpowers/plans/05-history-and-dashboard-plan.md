# Practice History and Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把练习历史、七阶段进度和薄弱点变成用户能直接理解的总览和题目时间线。

**Architecture:** 使用 01 计划提供的 `history.js` 和 `status.js`，本计划只负责聚合和展示，不重新定义学习状态。组件通过 props 接收数据，集成会话再接入全局状态。

**Tech Stack:** React 19、JSX、Node `node:test`。

**Spec:** `docs/superpowers/specs/2026-10-14-hot100-learning-platform-design.md`

## Global Constraints

- 只修改或新增 `src/components/PracticeTimeline.jsx`、`src/components/StageProgress.jsx`、`src/components/WeakPoints.jsx`、`src/pages/Dashboard.jsx`、`src/components/ProblemCard.jsx` 及测试。
- 不修改 `src/main.jsx`、`src/styles.css`、运行器和数据 JSON。
- 所有文案同时显示机器状态和易懂解释，例如“用了 2 级提示 · 还没有独立通过”。
- 空历史必须显示下一步建议，不显示空白卡片。

## Review Focus

- 一题练习三次后按时间升序展示完整时间线。
- 阶段统计区分独立完成、提示完成、参考题解和已稳固。
- 薄弱点规则不把一次看过题解的旧记录误判为永远不会做。
- 重复失败只在 `caseId` 相同且结果仍失败时提示。
- 长题名、空历史和移动端布局不会破坏页面。

### Task 1: Add aggregation helpers

**Files:**
- Create: `src/services/dashboard.js`
- Test: `tests/dashboard.test.mjs`

**Interfaces:**
- `buildStageProgress(questions, state, now) -> StageProgress[]`
- `findWeakPoints(questions, state, now) -> WeakPoint[]`
- `buildQuestionTimeline(state, questionId) -> TimelineItem[]`

- [ ] **Step 1: Test seven stages, no-progress questions, mastered questions and weak-point reasons.**
- [ ] **Step 2: Implement aggregation using `derivePracticeStatus` and `summarizeQuestionHistory`; do not duplicate status conditions.**
- [ ] **Step 3: Sort weak points by due date, hint usage, then latest failure.**
- [ ] **Step 4: Run `node --test tests/dashboard.test.mjs`.**

### Task 2: Implement timeline and stage components

**Files:**
- Create: `src/components/PracticeTimeline.jsx`
- Create: `src/components/StageProgress.jsx`
- Create: `src/components/WeakPoints.jsx`

- [ ] **Step 1: Render timeline rows with date, language, mode, outcome, hint count and duration.**
- [ ] **Step 2: Render stage cards with counts and a button callback for opening a filtered list.**
- [ ] **Step 3: Render weak-point reason text and `onOpenQuestion(questionId)` callback.**
- [ ] **Step 4: Add empty and loading states with accessible labels.**

### Task 3: Add per-question history surface

**Files:**
- Modify: `src/components/ProblemCard.jsx`
- Modify: `src/pages/Dashboard.jsx`

- [ ] **Step 1: Add a compact mastery progress line to `ProblemCard` using props only.**
- [ ] **Step 2: Add stage cards and weak points to Dashboard without changing global routing.**
- [ ] **Step 3: Run `npm test` and `npm run build`.**

### Task 4: Commit dashboard work

- [ ] **Step 1: Run `git diff --check`.**
- [ ] **Step 2: Commit with `feat: show practice history and learning progress`.**
