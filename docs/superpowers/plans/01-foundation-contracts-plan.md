# Foundation Contracts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立统一的学习状态、四份代码草稿、练习历史、掌握度和数据版本迁移契约。

**Architecture:** 所有状态计算放进纯 JavaScript 服务，React 只调用服务并渲染。旧版 `version: 2` 数据迁移到新版结构时保留已有进度、笔记、计时和备份字段；历史只从迁移后开始记录。

**Tech Stack:** JavaScript ES modules、Node `node:test`、现有 `src/services/storage.js`。

**Spec:** `docs/superpowers/specs/2026-10-14-hot100-learning-platform-design.md`

## Global Constraints

- 只修改 `src/services/storage.js`、`src/services/practice.js`，新增 `src/services/status.js`、`src/services/history.js` 及对应测试。
- 不修改 React 入口、全局样式、题解 JSON 和运行器。
- `STATE_VERSION` 升级为 3；旧版本解析失败必须返回明确错误，不覆盖原始数据。
- 不把完整代码输出存进历史，只保存结果摘要和最多 20 条最近事件。

## Review Focus

- 旧的 `已完成` 状态迁移为 `completed`，并增加 `legacyImported: true`，不能伪装成已稳固。
- `viewedSolutionCode` 不覆盖过去的独立通过记录。
- `hintsUsed`、草稿和历史按题目 ID、语言、模式分别保存。
- 复习失败后间隔回到 1 天，14 天独立通过后标记 `mastered`。
- 合并导入按每条记录的 `updatedAt` 选择较新值，取消导入不修改状态。

### Task 1: Define the version 3 state shape

**Files:**
- Modify: `src/services/storage.js`
- Test: `tests/storage.test.mjs`

**Interfaces:**
- `createDefaultState() -> StateV3`
- `parseState(raw) -> StateV3`
- `serializeState(state) -> string`
- `mergeState(current, incoming) -> StateV3`
- `migrateState(value) -> StateV3`

- [ ] **Step 1: Add failing tests for `drafts`, `history`, per-record timestamps, and version 2 migration.**
- [ ] **Step 2: Run `node --test tests/storage.test.mjs`; confirm failures identify missing version 3 fields.**
- [ ] **Step 3: Implement this exact shape:**

```js
{
  version: 3,
  profile: { dailyMinutes: 90, dailyNewLimit: 1, defaultLanguage: "java" },
  progress: {},
  drafts: {},
  notes: {},
  history: [],
  timer: null,
  settings: { backupConfigured: false },
  updatedAt: "1970-01-01T00:00:00.000Z"
}
```

- [ ] **Step 4: Store drafts under `drafts[questionId][language][mode]` with `{ code, cursor, scrollTop, updatedAt }`.**
- [ ] **Step 5: Migrate old statuses without inventing mastery; retain old fields under `legacy` when needed.**
- [ ] **Step 6: Run `npm test`; all storage and existing backup tests must pass.**

### Task 2: Implement progress and mastery rules

**Files:**
- Create: `src/services/status.js`
- Modify: `src/services/review.js`
- Modify: `src/services/practice.js`
- Test: `tests/status.test.mjs`, `tests/practice.test.mjs`

**Interfaces:**
- `derivePracticeStatus(progressItem, now) -> string`
- `getMasteryLevel(progressItem) -> "new" | "learning" | "reviewing" | "mastered"`
- `recordHint(progressItem, level, now) -> progressItem`
- `recordSolutionView(progressItem, language, now) -> progressItem`
- `recordReviewOutcome(progressItem, outcome, now) -> progressItem`

- [ ] **Step 1: Test `new`, `in-progress`, `completed`, `reviewing`, and `mastered` derivation from one shared function.**
- [ ] **Step 2: Test hint counts do not erase a previous independent pass.**
- [ ] **Step 3: Implement review intervals 1/3/7/14 days; after a 14-day independent pass set `masteredAt` and stop ordinary due selection.**
- [ ] **Step 4: Implement outcomes `independent`, `needed-hint`, `needed-solution`, `failed`; failed and hinted outcomes reset the next interval to 1 day.**
- [ ] **Step 5: Run `npm test`.**

### Task 3: Implement bounded practice history

**Files:**
- Create: `src/services/history.js`
- Test: `tests/history.test.mjs`

**Interfaces:**
- `appendHistory(state, event) -> StateV3`
- `getQuestionHistory(state, questionId) -> HistoryEvent[]`
- `summarizeQuestionHistory(events) -> Summary`
- `findRepeatedFailure(events, caseId) -> HistoryEvent | null`

- [ ] **Step 1: Test append order, 20-event cap per question, and stable `caseId` repeated-failure lookup.**
- [ ] **Step 2: Implement event fields `{ id, questionId, language, mode, outcome, hintsUsed, viewedSolutionCode, caseId, durationMs, createdAt }`.**
- [ ] **Step 3: Keep failed output text out of persisted history; store only a short error code and message summary.**
- [ ] **Step 4: Run `node --test tests/history.test.mjs`.**

### Task 4: Commit the foundation

- [ ] **Step 1: Run `npm test`.**
- [ ] **Step 2: Run `git diff --check`.**
- [ ] **Step 3: Commit with `feat: add learning state and history contracts`.**
