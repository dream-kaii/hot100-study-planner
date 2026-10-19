# Hot 100 刷题学习工作台

一个针对力扣 Hot 100 的本地优先刷题工作台。不追求「刷完 100 题」，只解决一件事：**知道今天该练哪几道、为什么是这几道。**

## 它做什么

- **按专题看进度**：100 道题按专题分组，一眼看出哪块空了
- **生成今日计划**：输入每天能投入的时间、薄弱专题、每日新题上限，算出今天做什么
- **六种状态标记**：未开始 / 思考中 / 已完成 / 错题 / 待复习 / 已掌握。「错题」和「待复习」是两个独立状态：前者是没做出来，后者是到期该重做
- **多解法存档**：一道题可以存最多 5 份解法，各自保留代码、光标和「是否通过公开示例」。换思路不再需要删掉已经跑通的那份
- **渐进式提示**：卡住时逐层解锁提示，而不是直接看答案
- **本地运行公开示例**：Java / Python 两种语言，函数模式或 ACM 模式
- **刷题节奏控制**：顺序 / 随机、倒计时、到期复习
- **本地优先**：所有进度存浏览器 `localStorage`，可导出 JSON、可开启文件夹自动备份

## 技术栈

| | |
|---|---|
| 构建 | Vite 7 |
| UI | React 19 |
| 编辑器 | Monaco Editor（`@monaco-editor/react`）|
| 图标 | lucide-react |
| 部署 | Cloudflare Workers + Static Assets |

零后端依赖。所有学习数据存在浏览器本地，不上传。

## 本地运行

```bash
npm install
npm run dev
```

也可以直接双击 `scripts/start.command`（macOS）或 `scripts/start.bat`（Windows），启动脚本会检查依赖并自动打开页面。

### 数据存储

首次打开不需要配置任何东西。学习状态、提示解锁记录、历史、多解法存档，以及 Java/Python 的函数/ACM 四份草稿，全部先存进浏览器 `localStorage`。

多解法存在 `state.solutions[题目][语言][模式]`，是一组快照；正在编辑的那份仍然写在 `state.drafts` 里。备份 JSON 会一起带上，导入合并时按 `updatedAt` 取每份解法的较新版本。

页面底部可以选择一个文件夹开启自动备份，也可以随时导入（覆盖或合并）、导出 JSON。浏览器不支持文件夹权限时，应用照常可用，手动导出即可。损坏的或版本更高的 JSON 会被拒绝，当前数据不会被覆盖。

### 代码运行

题目代码**只在本机运行**，使用界面里的公开示例用例：

- **函数模式**：按题目签名调用，可以直接粘贴题解中的方法片段或完整类；运行器会补齐外壳和链表/树节点，并读回原地修改后的参数
- **ACM 模式**：运行完整程序，需要自己读取公开示例的标准输入
- **特殊题型**：LRU、Trie、MinStack、MedianFinder 走构造器 + 操作序列

限制：每次运行最多 **3 秒**、输出最多 **64KB**。结果只用于比对公开用例，**不等价于力扣隐藏测试**，代码不会上传。

运行器接口只接受回环地址（`127.0.0.1` / `::1`）的请求 —— 这是刻意的设计，避免被当成公开的任意代码执行服务。**线上静态页面没有这个接口，点运行会提示「请在本地开发环境运行」，其余功能不受影响。**

## 构建与检查

```bash
npm run build          # 产出 dist/
npm test               # 18 个测试文件
```

完整校验（含真实编译执行）：

```bash
node scripts/validate-schema.mjs      # 数据 schema
node scripts/validate-solutions.mjs   # 100 道题解完整性
node scripts/verify-reference-code.mjs # 真实编译并运行 100 题的两种语言
node scripts/smoke-check.mjs
git diff --check
```

`verify-reference-code.mjs` 支持 `--ids=283,1,206,146` 只检查代表题。

### 浏览器回归

浏览器脚本**不向应用添加依赖**，需要自备 Playwright 与 Chromium：

```bash
# 先分别启动 npm run dev / npm run preview
HOT100_PLAYWRIGHT_MODULE=/绝对路径/playwright/index.mjs node scripts/verify-browser.mjs
```

报告默认落在：

- 浏览器验证 → `/tmp/hot100-browser-verification.json`
- 参考代码执行 → `/tmp/hot100-reference-verification.json`

## 部署

```bash
npm run deploy:cloudflare
```

等价于 `npm run build && npx wrangler deploy`。站点配置在 `wrangler.jsonc`，`assets.directory` 指向 `./dist`，SPA 回退由 `not_found_handling: "single-page-application"` 处理。

如果改用 Cloudflare 面板的 Git 自动部署（Workers Builds），构建命令填 `npm run build`、部署命令填 `npx wrangler deploy`。注意两点：`dist/` 被 gitignore，**必须**先跑构建命令，否则 `assets.directory` 是空的；Vite 7 要求 Node `^20.19.0 || >=22.12.0`，构建镜像的默认版本可能不够，需要在环境变量里显式钉 `NODE_VERSION=22`。

## 已知说明

- **Monaco 编辑器从 CDN 加载**（`@monaco-editor/react` 默认行为），因此首次打开代码编辑器需要联网；其余功能离线可用。
- 切换编辑器语言时会销毁旧模型，可能产生第三方库的 `Canceled` 事件。这不影响草稿和运行，浏览器验证脚本会单独记录其调用栈。
- 「开始今日练习」按 `studyOrder` 推进到最早的未完成题目；到期题从「今日复习」单独进入；题目内的「下一题」同样沿学习顺序走。
