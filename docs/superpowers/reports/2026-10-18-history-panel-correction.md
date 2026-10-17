# 本题练习历史折叠修复

复现发现：`details` 虽然没有 `open`，但 `.questionHistoryBody` 没有被明确隐藏，导致浏览器仍按正文和 flex 布局计算高度；右侧历史面板占满编码区下面的可用空间，看起来像没有收起。

修复：

- 关闭状态强制隐藏 `.questionHistoryBody`。
- 关闭状态固定为一行摘要高度；打开后限制最大高度，历史列表内部滚动。
- 保留所有有效历史，不删除失败或成功记录。
- 更新浏览器验收，检查关闭时正文 `display:none`、摘要高度、展开/收起切换及历史行数量。

验证：

- `npm test`：164/164。
- `node scripts/validate-schema.mjs`：通过。
- `node scripts/validate-solutions.mjs`：100 条通过。
- `npm run build`：通过。
- `git diff --check`：通过。
- `verify-history-complexity.mjs`：时间线摘要、复杂度面板、单题历史折叠/展开均通过。

本次只修改 `src/styles.css` 和 `scripts/verify-history-complexity.mjs`；其余未跟踪的 online runner 文件属于工作区既有内容，未纳入提交。
