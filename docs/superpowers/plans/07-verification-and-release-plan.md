# Hot 100 Verification and Release Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在所有功能合并后进行全量自动验证和浏览器 smoke test，输出可供用户判断本地版是否达到交付标准的证据。

**Architecture:** 该会话不直接重构产品代码，只运行测试、构建、数据校验和浏览器流程；失败按文件和测试名称回派给对应开发会话。验证报告保存命令、退出码、失败摘要和环境信息。

**Tech Stack:** npm、Node `node:test`、Vite、Chrome/Edge 或 Codex 浏览器。

**Spec:** `docs/superpowers/specs/2026-10-14-hot100-learning-platform-design.md`

## Global Constraints

- 在 06 合并并提交后执行。
- 不修改产品代码；允许新增 `docs/superpowers/reports/2026-10-14-hot100-verification.md`。
- 任何“通过”结论必须有本次命令输出，不引用旧会话结果。
- 线上代码执行不属于本次验收条件；本地运行和静态线上页面分开验证。

## Review Focus

- 数据 100 道、学习顺序 1–100、提示 4 级、来源和 cases 全部完整。
- Java/Python 函数模式和 ACM 模式的代表题能运行。
- 状态、提示、看题解、历史和草稿刷新后保持。
- 空状态、缺少本地 Python/JDK、运行超时和线上无 `/__runner` 时有可读提示。
- 左右布局、暖色对比度、键盘操作和移动端不出现严重阻塞。

### Task 1: Run automated checks

- [ ] **Step 1: Run `npm test`; record exit code and test count.**
- [ ] **Step 2: Run `node scripts/validate-schema.mjs`; record all data errors.**
- [ ] **Step 3: Run `node scripts/validate-solutions.mjs`; record all content errors.**
- [ ] **Step 4: Run `npm run build`; record bundle and exit code.**
- [ ] **Step 5: Run the local runner tests with actual Python and Java commands.**

### Task 2: Run browser smoke flow

- [ ] **Step 1: Open the local app without selecting a backup directory; confirm the app remains usable.**
- [ ] **Step 2: Open study order item 1; request two hints; verify the progress state.**
- [ ] **Step 3: Expand recognition, thinking, then code; verify code view is recorded.**
- [ ] **Step 4: Enter Java function code, switch to Python and ACM, reload, and verify all drafts remain separate.**
- [ ] **Step 5: Run one passing case, one mismatch and one compile error; verify each result label.**
- [ ] **Step 6: Open the timeline, dashboard stages and weak points; click through to a question.**
- [ ] **Step 7: Switch to mobile viewport and verify the reading/editor flow remains usable.**

### Task 3: Produce verification report

**Files:**
- Create: `docs/superpowers/reports/2026-10-14-hot100-verification.md`

- [ ] **Step 1: Include environment, commands, exit codes, test count and browser flow results.**
- [ ] **Step 2: List failures by owning plan and exact file; do not silently fix unrelated code.**
- [ ] **Step 3: If all required checks pass, commit with `test: verify Hot 100 learning platform`; otherwise commit the report with failure status.**
