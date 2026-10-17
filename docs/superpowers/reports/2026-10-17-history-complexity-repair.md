# 时间线摘要与复杂度启发式修复报告

日期：2026-10-17（Asia/Shanghai）。基线保留现有运行器、Monaco、左右对照布局和状态修复。

## 根因

- 总览直接读取整个 `state.history`；单题 scope 的20条上限并不能限制跨题总览。`started` 事件也参与原有 scope 计数，既占配额又让打开题目变得很密。
- 页面缺少“有效练习事件”抽象，无法同时满足总览最近记录、单题完整记录和旧数据兼容。
- 没有复杂度分析服务或运行结果下方的独立展示区域。

## 时间线修复

- `history.js` 新增 `isEffectivePracticeEvent`、`pruneHistory`、`getEffectivePracticeEvents`、`getRecentHistory`、`getQuestionHistorySummary`、`getHistorySummary`。
- 有效事件为 failed、independent、needed-hint、needed-solution、completed；started/unknown 不进入总览或单题有效历史。
- 每个题目/语言/模式最多保留20条有效事件；每个 scope 最多保留一条 started 兼容旧数据，避免打开题目无限增长。
- Dashboard 默认读取最多20条最近有效记录，界面桌面初始显示8条、手机5条；支持全部/失败/通过/独立通过筛选和“查看更多”。顶部摘要显示总次数、独立通过、失败和最近时间。
- 详情页显示该题全部有效历史，保留失败与后续成功，显示结果、语言、模式、提示次数、题解查看状态、耗时和时间。
- `PracticeTimeline` 文案明确“第 N 次尝试”，历史失败不会被解释为当前失败。

## 复杂度修复

新增 `src/services/complexity.js`、`src/components/ComplexityPanel.jsx`：

- 支持 O(1)、O(log n)、O(n)、O(n log n)、O(n²)、O(n³)、O(mn)、O(V+E) 的常见归一化。
- 静态去除注释和字符串后识别：单/双/三层循环、排序、二分、图/树遍历、哈希/集合、分叉递归。
- 返回 estimated、confidence、reason；与 solution.complexity.time 比较后返回 meets、too-slow、uncertain、unknown。
- 复杂度面板位于编辑器下方，明确“这是静态启发式估计，不是形式化证明”，不会阻止运行、改变运行结果或修改错题状态。
- 无法判断或没有题目要求时显示 unknown/uncertain，而不是硬猜。

## 修改文件

- `src/services/history.js`、`src/services/storage.js`
- `src/components/PracticeTimeline.jsx`、`src/pages/Dashboard.jsx`
- `src/components/ProblemDetail.jsx`、`src/components/CodeEditor.jsx`、`src/components/ComplexityPanel.jsx`
- `src/services/complexity.js`、`src/styles.css`
- `scripts/verify-history-complexity.mjs`、`scripts/verify-browser.mjs`
- `tests/history.test.mjs`、`tests/complexity.test.mjs`

## 验证

- `npm test`：155/155 通过。
- `node scripts/validate-schema.mjs`：通过。
- `node scripts/validate-solutions.mjs`：100 条通过。
- `npm run build`：通过。
- `git diff --check`：通过。
- `verify-reference-code.mjs`：200/200 组、600 个真实 Java/Python 用例通过。

真实浏览器 `verify-history-complexity.mjs`：

- 总览桌面默认8条，手机默认5条；筛选和查看更多可用。
- 283 单题历史同时显示失败与成功两条记录。
- 双层循环显示 O(n²) 和可能不满足；单层代码显示 O(n) / 可能满足，运行结果仍独立判断。
- 无复杂度要求或无法识别时使用 unknown/uncertain。
- 复杂度分析不改变 progress、history 或运行结果。

真实浏览器 `verify-state-navigation.mjs`：

- 283 第一次失败、第二次独立通过；时间线保留两条，attemptId 不同。
- 当前状态 completed，刷新后 reviewAt 和历史保留；错题页不再显示该题。
- 第一题上一题禁用，下一题进入 studyOrder 2；最后题4下一题禁用。

原有代表题参考代码仍通过 200/200 组真实执行，现有布局/编辑器专项流程保持通过。

## 限制

- 复杂度检查是正则和结构启发式，不是编译器级控制流或形式化 Big-O 证明；复杂递归、别名调用、跨函数成本可能返回 uncertain/unknown。
- “通过”筛选包含辅助通过与独立通过；独立通过单独有筛选。
- 旧历史没有 attemptId 时保留兼容字段，无法还原历史会话边界；新运行记录会写入 attemptId。
