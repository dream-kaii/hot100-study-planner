# 状态、导航与代码契约修复报告

基线：`fcb9b96d5e54c73a186fe14217a1638d669b2c36`。

## 根因

1. `ProblemDetail.execute` 使用累计 `hintsUsed` / `viewedSolutionCode` 给当前运行分类，历史辅助行为污染了本次尝试；失败和成功又通过不完整的 `recordPracticeOutcome` 更新，导致历史失败被误当成当前错题。
2. 历史事件没有 attemptId，无法区分同一题的连续尝试；题解/提示查看也没有当前会话边界。
3. 详情页只有下一题，导航函数没有上一题边界接口。
4. Schema 已有入口签名校验，但没有拦截重新混入的 `Object... args` / `*args`。

## 修复

- 每题/语言/模式开始新 attempt，记录 `attemptId`、本次提示次数、本次是否查看题解；异步运行返回前校验 question/language/mode session，旧题结果不写新题。
- 历史事件保留最近20条，并保留 failed 与 independent 两条事件；当前状态由最近有效结果推进。提示后/看题解后通过进入 completed 并安排1天复习；随后失败才进入 reviewing；再次独立通过恢复 completed 并按复习阶梯推进。
- 手动把已完成且 reviewAt 尚未到期的题标为错题时不覆盖当前状态。
- 增加上一题按钮和学习顺序编号，上一题/下一题均按 studyOrder，第一题/最后一题禁用；题目切换仍使用已有异步 solution ID 防串题逻辑。
- Schema 增加代表题契约检查和泛化参数检查，拒绝 `Object... args`、`*args`、`**kwargs`。
- 时间线明确显示“第 N 次尝试”，避免历史失败被读成当前失败；薄弱点沿用最近有效事件判断。

## 文件

- `src/components/ProblemDetail.jsx`
- `src/main.jsx`
- `src/services/status.js`
- `src/services/history.js`
- `src/services/practice.js`
- `src/components/PracticeTimeline.jsx`
- `src/styles.css`
- `scripts/validate-schema.mjs`
- `tests/status.test.mjs`
- `tests/history.test.mjs`
- `tests/dashboard.test.mjs`
- `tests/practice.test.mjs`
- `tests/execution-content.test.mjs`
- `scripts/verify-state-navigation.mjs`

## 自动验证

- `npm test`：150/150 通过。
- `node scripts/validate-schema.mjs`：通过。
- `node scripts/validate-solutions.mjs`：100 records 通过。
- `npm run build`：通过。
- `git diff --check`：通过。

## 真实浏览器验证

脚本：`scripts/verify-state-navigation.mjs`，使用本机 Vite、真实 Java 编译运行和已有 Playwright/Chromium：

- 283 第一次运行编译失败，第二次不看题解、不用提示独立通过。
- 时间线保留 failed + independent 两条事件，attemptId 不同。
- 当前 progress 为 completed，reviewAt 保留；刷新后仍保留。
- 错题复习页不再显示移动零。
- 283 上一题禁用，下一题进入 studyOrder 2 的 1；最后题4下一题禁用。
- 原有 `scripts/verify-browser.mjs` 25/25 通过，代表题 Java/Python 复制运行、编辑器和左右布局未回退。

浏览器输出：`/tmp/hot100-state-navigation.log`。

## 限制

- 计时器仍由现有 Timer 组件按题目 progress 保存；本次没有重写计时器架构。
- attemptId 是本地会话标识，历史迁移数据没有旧 attemptId 时仍按旧事件兼容处理。
