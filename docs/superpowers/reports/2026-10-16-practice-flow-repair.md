# 刷题流程修复记录

基线：`codex/integration-hot100-workspace` / `e5f8868`。用户本次需求优先于历史计划的文件归属和独立滚动设计。

## 调查与复现（修改前）

- 真实 Chromium 浏览器，从首页开始练习进入 283，复制页面 Java 题解并运行：`compile_error`；读取 POST `/__runner` 的请求与响应，确认 func/cases 传递到后端。
- 283 Java：裸方法没有包类；生成了 `void __hot100_result = ...`。Python：裸方法没有包类，`NameError: Solution`。
- 1 Java：裸方法在类外；Python 基本示例通过。
- 206 Java：找不到 ListNode。Python：文章标题“（版本一）双指针法”引起 SyntaxError。
- 146：func.className 是 LRUCache，后端仍硬编码 Solution，且未执行构造器/操作序列。
- 数据流：solution JSON → ProblemDetail(solution.func / cases / template) → CodeEditor.run → main.onRun → localRunner → runExample → Java/Python 源码包装 → 编译/执行 → cases → CodeEditor。模板使用 Object... args；compare 未从 func 传到批量比较；UI 只展示顶层 error，丢失 case 编译诊断。
- 浏览器里 Monaco 上继续向下滚轮 700px：页面 scrollY 从 503 到 503。Monaco 未配置 alwaysConsumeMouseWheel；statementPane/editorPane 均 overflow:auto，左侧固定视口高度。
- 四项阶段统计 DOM 坐标：x 都为 143，y 为 790、838、886、934，确认纵排。
- 首页入口直接选择混合计划 plan[0]，到期复习排在新题前。题库顺序入口未排序；详情虽然预排序，底层 pickNextQuestion 仍依赖调用数组。
- 正文按每个换行创建 p，空行塞入 NBSP。提示第二/四级全部使用泛化模板；第三层重复拼接标题。文本未做公式转换。

## 执行顺序与验证

1. 函数契约真实模板与片段包装（先失败测试）。
2. void/None 原地修改与 func.compare；节点转换；操作序列（每个根因分别先回归测试）。
3. 模式/草稿边界和逐用例诊断展示。
4. 编辑器与页面滚动；真实浏览器滚轮检查。
5. studyOrder 主线与今日复习分离；阶段统计四列。
6. 普通文本集中清理，保留可执行代码和伪代码结构；修复 100 题提示并强化校验。
7. 全量自动验证、真实浏览器开发/生产流程，整理文件、证据、限制并提交。

## 执行结果

修复在本次基线分支上完成。未添加应用依赖；所有自动化浏览器操作使用已有临时 Playwright + Chromium。

### 修复内容与独立根因

| 问题 | 根因 | 修复 |
|---|---|---|
| 题解无法复制运行 | 模板使用 Object... args；裸方法无外壳；调用固定 Solution；void 被赋值 | 共享 function-contract，真实签名、按 func.className 包装，方法与完整类均可运行；void/None 读取首个已修改参数 |
| 链表/树/设计类运行失败 | 缺节点定义、所有节点按链表处理、设计题只调用单方法 | 补 ListNode/TreeNode/随机 Node；分开构造与序列化；操作序列声明 constructorParams/methods，按 operations/arguments 依次调用 |
| 特殊答案误判 | func.compare 未使用，标量误用数组比较，节点只看值，多解未验证 | 使用 func.compare；环与相交保留对象身份；深复制检查不引用原节点；最长回文与平衡搜索树独立验证合法性 |
| 真实编译错误不显示 | javac 输出保存在 cases，前端只读顶层 error | 每个用例显示状态、期望、实际、原始 error/stderr；区分编译错误、运行错误、超时、结果不匹配 |
| ACM/函数混用 | 前端猜测模式；ACM 沿用函数输入 | 直接遵循选定模式；ACM 使用自己的标准输入样例 |
| 编辑器滚动困住 | 多层 overflow:auto，Monaco 默认消费边缘滚轮 | 页面负责整体滚动；移除两栏额外滚动，alwaysConsumeMouseWheel=false；代码仍在420px区域内部滚动 |
| 草稿切换边界 | 编辑器实例/模型随语言与模式复用 | 按题号/语言/模式设置独立 key 与 model path，并恢复已存代码、光标、滚动位置 |
| 学习主线被复习打断 | 混合 plan[0] 作为开始入口；顺序函数依赖原数组 | studyOrder 唯一顺序，开始选最早未完成题；今日复习独立入口；下一题沿顺序，到末尾禁用 |
| 复习失败退回主线 | lastReviewOutcome 可被覆盖，没有持久完成时间 | 首次通过/手动完成记录 completedAt，后续失败保留；阶段入口可用且完整题库入口清除阶段筛选 |
| 阶段统计太长 | dl 默认纵排，无布局样式 | 桌面四列等宽对齐；移动端四列，极窄屏两列；保留阶段标题与操作 |
| 内容空白与公式源码 | 按单换行渲染空白 p；原抓取文本未转换 | 白名单普通字段统一清理与段落拆分，跳过空段；转换公式与HTML，代码原样保留 |
| 泛化提示 | 100题统一模板拼接、第三层重复句 | 全部100题手写题目对应的4级提示；第3级完整思路，第4级多行缩进伪代码；校验器拒绝原模板 |
| 内容执行契约漂移 | 抓取误选辅助方法/错误题目、多版本代码拼接、cases字段错误 | 定向修正43题执行字段；修复94/105错误题目代码并注明本地校正来源；100题Java签名/Python参数核对 |

### 变更文件

- 运行链：`src/services/function-contract.js`（新增）、`editor.js`、`runner.js`；`src/components/CodeEditor.jsx`、`ProblemDetail.jsx`。
- 学习与布局：`src/main.jsx`、`src/services/practice.js`、`status.js`、`src/pages/Dashboard.jsx`、`ProblemBank.jsx`、`src/components/StageProgress.jsx`、`src/styles.css`。
- 内容：`src/services/study-text.js`（新增）、`ProgressiveSolution.jsx`、`HintLadder.jsx`；`src/data/solutions/` 全部100题普通说明/提示，43题另有执行字段修正。
- 校验/验收：`scripts/validate-schema.mjs`；新增 `verify-reference-code.mjs`、`verify-browser.mjs`。`validate-solutions.mjs` 调用共享校验，因此同步获得新规则。
- 新增测试：`tests/study-text.test.mjs`、`node-adapters.test.mjs`、`execution-content.test.mjs`；扩充 `editor.test.mjs`、`runner.test.mjs`、`practice.test.mjs`、`status.test.mjs`。`README.md` 更新运行方式与验证方法。

### 回归测试证据

每类根因先观察失败再修复：真实模板2项、片段/完整类1项、原地修改/比较2项、节点2项、操作序列/JSON结果/模板3项、错误诊断1项、模式1项、学习顺序2项、特殊节点/多解/null 7项、执行内容8项、文本/校验8项。独立审查补充字符串期望类型、合法Java修饰符、片段自带节点定义、辅助完成后复习失败4项，以及阶段筛选浏览器回归。失败日志与通过日志本次运行已读取；未只改测试使其通过。

### 验证环境

macOS，Node v24.21.0，npm 11.19.0，Python 3.13.15，javac 1.8.0_504。浏览器为已有 Playwright + Chromium（本机无新增项目依赖）。用户日期按 Asia/Shanghai 记录。

### 自动验证

| 命令 | 退出码 | 本次结果 |
|---|---:|---|
| `npm test` | 0 | 142 tests，142 pass，0 fail（基线90项，新增52项） |
| `node scripts/validate-schema.mjs` | 0 | 100题结构、文本、func入口签名/类型/参数与cases协议通过 |
| `node scripts/validate-solutions.mjs` | 0 | validated 100 solution records |
| `node scripts/verify-reference-code.mjs` | 0 | 200/200组，600个真实Java/Python用例通过；最后包装器修复后重新全量执行 |
| `npm run build` | 0 | Vite生产构建成功（1.19s） |
| `git diff --check` | 0 | 无空白错误 |
| `scripts/verify-browser.mjs`（指定已有Playwright模块） | 0 | 25/25流程通过，未识别pageerror为0 |

可持久核对的浏览器结果：`2026-10-16-browser-results.json`；全100题逐语言/逐用例状态：`2026-10-16-reference-results.json`。原始本次完整终端日志保存在 `/tmp/hot100-final-tests.log`、`/tmp/hot100-final-schema.log`、`/tmp/hot100-final-solutions.log`、`/tmp/hot100-final-build.log`，浏览器完整报告在 `/tmp/hot100-browser-verification.json`。

独立只读审查发现的5项边界和2项验收脚本问题均处理：expected字符串保持类型、首次完成持久标记、阶段筛选退出、自带节点定义片段、Java final等修饰符；ACM验收真实读取输入，超时验收实际追加正确运行。新增函数契约校验9项与括号文章标题校验1项也已先RED再GREEN。

### 真实浏览器验收

完整脚本：`scripts/verify-browser.mjs`。25/25 项通过，非取消类 pageerror 为0。

| 验收流程 | 结果 |
|---|---|
| 新用户“开始今日练习”进入283，显示第一阶段/学习顺序1，下一题原因清楚 | 通过 |
| 桌面七阶段每行四项横向且数字对齐 | 通过（检查实际DOM坐标） |
| 第一题无空白p，题解无原始LaTeX，提示有具体思路和缩进伪代码 | 通过 |
| 283 Java/Python：从页面题解复制，剪贴板粘贴到编辑器，运行全部用例 | 两语言通过 |
| 1 Java/Python：同上 | 两语言通过 |
| 206 Java/Python：同上 | 两语言通过 |
| 146 Java/Python：同上，真实构造器和get/put序列 | 两语言通过 |
| javac错误含Main.java行号与missingSymbol；结果不匹配/运行异常/超时分别显示 | 通过 |
| 超时结束后重新粘贴正确代码仍可运行 | 通过 |
| Java/Python函数/ACM四份草稿切换、刷新、再逐一检查编辑器代码 | 通过 |
| ACM两语言实际读取stdin并计算移动零输出 | 通过（未用打印固定答案冒充） |
| 长代码滚动；内部到底/到顶后滚轮继续推动页面 | 通过（分别检查代码坐标与window.scrollY） |
| 题面、题解整页滚动，无额外嵌套滚动区 | 通过 |
| 第一题已完成后进入1；到期146不抢占；第一阶段完成后进入11（顺序14） | 通过 |
| 阶段按钮13题，按顺序进入283，再点完整题库恢复100题 | 通过 |
| 390×844、320×844两种移动端，146题面/题解无横向溢出 | 通过（scrollWidth≤clientWidth） |
| 生产预览能阅读/编辑，说明需本地运行并禁用运行按钮 | 通过 |

第一次浏览器完整运行24/25：滚动验收点击内部滚动后的view-lines元素坐标不可靠；调整为点击编辑器可见区域、等待Monaco快捷键滚动完成后，25/25。并未用禁用页面滚动掩盖问题。

浏览器检查中记录7次Monaco模型销毁的第三方 `Canceled` 异步取消。调用栈均包含 CDN editor.api cancel/dispose/setModel 与 React卸载；窄范围单独记录，其他页面异常仍判失败。本次未发现草稿丢失或编辑/运行中断。

### 限制

- 本地只验证公开结构化用例，不能替代力扣隐藏测试；多解验证只为当前已声明的题型提供规则，未知多解明确失败。
- 在线静态页面仍无Java/Python执行服务，需要 `npm run dev` 与本机Python/JDK。
- Monaco仍从CDN加载，首次使用需要网络；上文已记录切语言模型销毁时的第三方取消事件。
- 函数契约仍用现有Java类型描述，Python模板做类型对应转换；原地void/None题按当前数据契约读取第一个可变参数。
- 94/105已明确标注站内按本题重写校正，保留参考链接供概念核对；未声称修正代码是错误抓取来源的逐字原文。

最终提交哈希见本报告所在提交（`git log -1 --format=%H`），用户交付消息给出精确哈希。
