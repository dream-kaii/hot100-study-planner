# Hot 100 Study Planner
<img width="1316" height="668" alt="image" src="https://github.com/user-attachments/assets/93721eb4-67c8-42d2-921f-a3679f921a42" />

一个针对力扣 Hot 100 的个人刷题学习工作台，支持：

- 按专题查看 100 道题的完成进度
- 根据每日可投入时间、薄弱专题和每日新题上限生成今日计划
- 标记未开始、复习、错题、已完成状态
- 为每道题记录本地备注
- 题目详情、渐进式提示和题解、Java/Python 公开示例运行
- 顺序/随机刷题、倒计时、错题复习和本地自动备份
- Cloudflare Workers Static Assets 部署

线上地址：[https://hot100.mayuanyuan.top/](https://hot100.mayuanyuan.top/)

## 本地运行

```bash
npm install
npm run dev
```

也可以直接双击 `scripts/start.command`（macOS）或 `scripts/start.bat`（Windows）。启动脚本会检查依赖并打开本地页面。

首次打开不需要选择备份文件夹。学习状态、提示记录、题解解锁、历史和 Java/Python 的函数/ACM 四份草稿会先保存到浏览器 `localStorage`；页面底部可以选择文件夹开启自动备份，也可以随时导入（覆盖或合并）和导出 JSON。浏览器不支持文件夹权限时，应用仍然可以正常学习和手动导出。损坏或更高版本的 JSON 会被拒绝，当前数据不会被替换。

题目代码只在本机运行公开示例。函数模式按题目签名调用，ACM 模式运行完整程序；Python 需要 `python3`，Java 需要 JDK（`javac` 和 `java`）。每次运行最多 3 秒、输出最多 64KB，结果只用于比较公开用例，不等价于力扣隐藏测试，也不会上传代码。静态线上页面没有本地运行接口时，会显示“请在本地开发环境运行”的提示。

## 构建

```bash
npm run build
```

完整检查：

```bash
npm test
node scripts/validate-solutions.mjs
node scripts/smoke-check.mjs
```

## 部署

```bash
npm run deploy:cloudflare
```

“开始今日练习”按 `studyOrder` 继续最早未完成的题目；到期题从“今日复习”单独进入。题目内“下一题”也沿学习顺序推进。

函数模式可以直接粘贴题解中的 Java/Python 方法片段或完整类；运行器会按 `solution.func` 补齐外壳和节点，并读取原地修改后的参数。LRU、Trie、MinStack 和 MedianFinder 使用构造器与操作序列。ACM 模式则需要自行读取界面公开示例的标准输入并输出结果。

本次执行与页面回归检查：

```bash
npm test
node scripts/validate-schema.mjs
node scripts/validate-solutions.mjs
node scripts/verify-reference-code.mjs
npm run build
git diff --check
```

`verify-reference-code.mjs` 会真实编译执行 100 题的两种语言，也可用 `--ids=283,1,206,146` 只检查代表题。

浏览器回归脚本不向应用添加依赖。准备可用的 Playwright 与 Chromium，分别启动 `npm run dev`、`npm run preview` 后运行：

```bash
HOT100_PLAYWRIGHT_MODULE=/绝对路径/playwright/index.mjs node scripts/verify-browser.mjs
```

浏览器报告默认保存到 `/tmp/hot100-browser-verification.json`，参考代码执行报告保存到 `/tmp/hot100-reference-verification.json`。Monaco 当前从 CDN 加载，首次使用编辑器需要联网；切换语言销毁旧模型时可能产生不影响草稿和运行的第三方 `Canceled` 事件，浏览器报告会单独记录其调用栈。
