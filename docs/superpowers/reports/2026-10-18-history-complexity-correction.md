# 时间线面板与复杂度判断修正

日期：2026-10-18（Asia/Shanghai）。基线为当前已有的布局、状态和运行器优化。

## 调查结论

右侧“本题练习历史”在当前基线已经使用原生 `details/summary` 默认折叠，单题读取有效事件，总览读取最近事件摘要；本次真实浏览器核对了折叠/展开/再次收起、移动端和单题失败+成功记录，未回退该功能。

复杂度误判的根因是旧 `loopDepth` 统计所有 `for/while` 出现次数，并把顺序执行的两个循环当成嵌套深度2。283 的 `complexity.time` 是推荐解复杂度 `O(n)`，题目文本的暴力方法 `O(n²)` 在 explanation 中出现，但不能作为硬性题目要求。

## 修复

- 复杂度循环识别按 Python 缩进、Java 花括号层级判断真正嵌套；顺序两个循环仍为 `O(n)`。
- `complexity.time` 作为兼容旧数据的参考解复杂度；可选 `complexity.requirement` 才表示题目明确硬性要求，`referenceTime` 可覆盖参考解字段。
- 面板分开显示：题目要求（没有时显示未明确规定）、参考解复杂度、你的代码估计、置信度和依据。无硬性要求时 verdict 语义为与参考解相当/可能高于参考解；无比较基准时 unknown。
- 复杂度仍是静态启发式估计，不能证明任意 Java/Python 程序的 Big-O，不阻止运行、不修改 progress/history。

## 修改文件

- `src/services/complexity.js`
- `src/components/ComplexityPanel.jsx`
- `src/components/CodeEditor.jsx`
- `tests/complexity.test.mjs`
- `scripts/verify-history-complexity.mjs`

时间线折叠和有效历史实现来自当前基线的 `history.js`、`PracticeTimeline.jsx`、`Dashboard.jsx`、`ProblemDetail.jsx`；本次对其做了浏览器回归验证，没有删除历史事件。

## 验证

- `npm test`：156/156 通过。
- `node scripts/validate-schema.mjs`：通过。
- `node scripts/validate-solutions.mjs`：100 条通过。
- `npm run build`：通过。
- `git diff --check`：通过。
- `verify-history-complexity.mjs`：桌面最近8条、移动最近5条、筛选/查看更多、单题历史折叠、双层循环 `O(n²)`、顺序循环 `O(n)`、运行结果不受影响均通过。
- `verify-reference-code.mjs`：200/200 组、600 个真实 Java/Python 用例通过。
- `verify-state-navigation.mjs`：失败后成功、历史保留、当前状态完成、上一题/下一题边界通过。

## 限制

复杂度分析无法可靠识别复杂控制流、跨函数成本、别名调用和部分递归模式时会返回 unknown/uncertain；这不会把代码判错。当前旧题数据没有逐题 `complexity.requirement`，因此现有题目默认按参考解复杂度比较，283 显示“题目未明确规定复杂度 · 参考解复杂度 O(n)”。
