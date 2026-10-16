# Hot 100 Parallel Development Execution Guide

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Hot 100 学习平台改造拆成可由多个独立会话并行执行、最后由一个集成会话合并的开发批次。

**Architecture:** 先建立数据、状态和历史的纯函数契约，再并行开发内容、提示题解、编辑器运行器和进步展示。只有集成会话修改 `src/main.jsx`、`src/styles.css` 和跨组件组合，避免多个会话互相覆盖入口代码。

**Tech Stack:** React 19、Vite 7、JavaScript/JSX、Node `node:test`、本机 Python 3、JDK、Monaco Editor。

**Spec:** `docs/superpowers/specs/2026-10-14-hot100-learning-platform-design.md`

## Global Constraints

- 每个会话必须在独立分支或 worktree 中工作，不能多人直接写同一个工作区。
- 每个会话只修改自己计划列出的文件；发现需要越界时先把接口写入计划，不直接改别人的文件。
- Java 是默认语言，Python 作为并行语言；函数模式和 ACM 模式分别保存草稿。
- 本地运行优先，线上执行不属于本轮交付条件。
- 题解、提示和测试数据必须来自可核对内容；不生成没有依据的算法结论。
- 所有新增纯逻辑先写测试，所有数据脚本必须支持失败时给出题目 ID 和字段路径。

## Review Focus

- 两个会话导入同一份状态时，迁移和合并不丢失代码、笔记或历史。
- 题解缺少新字段时，页面降级显示，不白屏。
- 用户看过答案代码后，历史仍保留此前的独立通过记录。
- 运行器不会因为重复点击、无限循环或大输出拖垮本机。
- 合并后四份草稿、提示记录、阶段进度和题解折叠状态互不覆盖。

## Dependency Graph

```text
01 foundation
├── 02 content + validation
├── 03 hints + progressive solution
├── 04 editor + local runner
└── 05 history + dashboard
        └── 06 integration shell
                └── 07 verification
```

## Session Allocation

| 计划 | 会话负责 | 可并行 | 禁止修改 |
|---|---|---:|---|
| 01 | 状态、草稿、历史、Schema 运行契约 | 否，先完成 | `src/main.jsx`、`src/styles.css`、题解 JSON |
| 02 | 100 道题学习顺序、题解字段、校验脚本 | 是 | React 组件、运行器、`storage.js` |
| 03 | 提示阶梯、渐进题解纯逻辑和组件 | 是 | `main.jsx`、全局样式、题解内容批量生产 |
| 04 | Monaco 编辑器、四份草稿接入接口、本地运行器 | 是 | `main.jsx`、题解 JSON、Dashboard |
| 05 | 练习历史、阶段进度、薄弱点展示组件 | 是 | `main.jsx`、全局样式、运行器 |
| 06 | 页面组合、暖色视觉、浏览器流程和冲突修复 | 等 01–05 | 其他计划未交付前不独自改数据契约 |
| 07 | 全量测试、构建、数据和浏览器验收 | 等 06 | 不直接重构产品代码 |

子计划文件：

- `01-foundation-contracts-plan.md`
- `02-content-and-validation-plan.md`
- `03-hints-and-progressive-solution-plan.md`
- `04-editor-and-local-runner-plan.md`
- `05-history-and-dashboard-plan.md`
- `06-integration-and-acceptance-plan.md`
- `07-verification-and-release-plan.md`

## Merge Order

- [ ] 合并 01，运行 `npm test`。
- [ ] 并行合并 02、03、04、05；每个分支合并后单独运行自身测试，再运行完整 `npm test`。
- [ ] 合并 06，只由它处理 `main.jsx`、`styles.css` 和组件接线冲突。
- [ ] 合并 07 的验证结果；若失败，按失败文件回派给对应会话，不在验收会话里顺手重写功能。

## Handoff Contract

每个会话结束时必须留下：

1. 分支名和提交哈希。
2. 实际修改的文件清单。
3. 导出的函数、组件 props 和数据字段。
4. 已运行的命令及完整结果。
5. 已知限制，不用“应该可以”代替结果。

集成会话只依赖这些明确接口，不读取其他会话的聊天记录作为契约。
