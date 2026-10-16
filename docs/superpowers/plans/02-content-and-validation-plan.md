# Hot 100 Content and Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 100 道力扣 Hot 100 题整理为可学习、可运行、可验证的统一内容数据，并补齐学习顺序、提示、机器测试用例和来源字段。

**Architecture:** 题目元数据继续放在 `hot100.json`，每道题的内容继续放在 `src/data/solutions/<id>.json`。脚本只读这些文件并报告问题，不在运行时猜测缺失字段。没有可信依据的字段必须显式标记为缺失并让验证失败，不能编造。

**Tech Stack:** JSON、Node ES modules、Node `node:test`。

**Spec:** `docs/superpowers/specs/2026-10-14-hot100-learning-platform-design.md`

## Global Constraints

- 只修改 `src/data/hot100.json`、`src/data/solutions/*.json`、`scripts/validate-solutions.mjs`，新增 `scripts/validate-schema.mjs`、`tests/content-schema.test.mjs`。
- 不修改 React 组件、存储服务和运行器。
- 题目必须仍然是 100 道，`studyOrder` 全局唯一 1–100。
- `examples` 是阅读文本，`cases` 是机器结构化数据，不能混用。
- 每道题必须有真实来源记录；来源不可访问时保留链接但不声称已经读取全文。

## Review Focus

- 两数之和等题目的复杂度必须与代码一致。
- 反转链表等题目的约束和代码不得截断或混入“版本一”标题。
- 多解、原地修改、对象身份和操作序列题不能使用普通字符串比较。
- 题解图片不能因为第三方资源失效导致页面数据加载失败。
- 未完成内容必须能被校验脚本定位到题目 ID 和字段路径。

### Task 1: Add learning-order metadata

**Files:**
- Modify: `src/data/hot100.json`
- Test: `tests/content-schema.test.mjs`

- [ ] **Step 1: Add `studyOrder`, `phase`, `concepts`, and `prerequisites` to all 100 questions using the seven-phase order in the spec.**
- [ ] **Step 2: Add a test that every ID occurs once, every order from 1 to 100 occurs once, and prerequisites point to earlier questions.**
- [ ] **Step 3: Add a graph cycle check and fail with the cycle path.**
- [ ] **Step 4: Run `node --test tests/content-schema.test.mjs`; fix all missing or duplicated IDs.**

### Task 2: Normalize each solution record

**Files:**
- Modify: `src/data/solutions/*.json`
- Test: `tests/content-schema.test.mjs`

- [ ] **Step 1: Add `recognition`, `hints`, `steps`, `walkthrough`, `correctness`, `pitfalls`, `func`, `cases`, `acm`, and `sources` to every record.**
- [ ] **Step 2: Write four hints per question; level 1 asks a directional question, level 2 gives an action, level 3 states the method, and level 4 gives non-runnable pseudocode.**
- [ ] **Step 3: Replace generic summaries with a question-specific learning takeaway.**
- [ ] **Step 4: Remove code fences, truncated snippets, source-page headings and unrelated-language paragraphs from executable code fields.**
- [ ] **Step 5: Add at least one basic, one boundary, and one adversarial structured case for each question where the problem permits it.**
- [ ] **Step 6: Add `func.compare` from the closed enum in the spec and write the expected structure for each case.**
- [ ] **Step 7: Run the validator; every error must include `<id>.<field>`.**

### Task 3: Add schema and content validators

**Files:**
- Create: `scripts/validate-schema.mjs`
- Modify: `scripts/validate-solutions.mjs`
- Test: `tests/content-schema.test.mjs`

- [ ] **Step 1: Validate required fields, array types, hint levels 1–4, source types, compare enums, and non-empty cases.**
- [ ] **Step 2: Reject placeholder phrases, repeated generic summaries, blank paragraphs over a configured threshold, and executable code containing Markdown fences.**
- [ ] **Step 3: Validate that all cases have stable IDs and that ACM examples contain input and output text.**
- [ ] **Step 4: Run `node scripts/validate-schema.mjs` and `node scripts/validate-solutions.mjs`; both must exit 0.**

### Task 4: Run content smoke checks

- [ ] **Step 1: Run `node --test tests/content-schema.test.mjs`.**
- [ ] **Step 2: Run `npm run build` to confirm JSON imports remain valid.**
- [ ] **Step 3: Commit with `data: normalize Hot 100 learning content`.**
