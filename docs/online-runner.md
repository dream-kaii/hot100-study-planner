# 在线运行：部署与使用

这份文档讲怎么把「线上页面 + 本机执行」打开，以及打开之后的完整行为。

---

## 1. 它是什么

```
浏览器（Cloudflare 上的静态站）
   │  ① GET /api/pair            申请 6 位配对码
   │  ② WSS /ws?sid=…           同源长连接
   ▼
Cloudflare Worker + 两个 Durable Object
   │  Session：一个会话（一个浏览器 ↔ 一台电脑）
   │  Lobby  ：配对码 → 会话的短期索引
   ▼
本机运行助手（单文件，用户自己下载）
   │  出站长连接，不监听端口
   ▼
本机 java / python3
```

三条边界：

- **Worker 不解析用例、不执行代码**，只转发字节。
- **runner 不监听端口**，所以没有证书、防火墙、CORS、混合内容这一整类问题。
- **代码不出本机**，只有「通过/失败」这类结论回到页面。

---

## 2. 怎么打开（4 步）

### 2.1 改 `wrangler.jsonc`

把 `wrangler.online-runner.example.jsonc` 的内容合并进去，关键三处：

```jsonc
{
  "main": "src/online/index.js",          // 原来是 src/worker.js
  "durable_objects": {
    "bindings": [
      { "name": "SESSION", "class_name": "Session" },
      { "name": "LOBBY",   "class_name": "Lobby" }
    ]
  },
  "migrations": [
    { "tag": "v1", "new_sqlite_classes": ["Session", "Lobby"] }
  ]
}
```

`assets` 段保持原样（`directory: "./dist"`、`not_found_handling: "single-page-application"`）。

> `migrations` 的 `tag` 一旦部署过就不能改。以后再加 DO 类，追加一条 `{ "tag": "v2", "new_sqlite_classes": ["新类"] }`。

### 2.2 确认下载地址

`npm run build` 会自动把 runner 打包到 `dist/download/hot100-runner.mjs`。不需要额外命令。

页面上的下载链接是相对路径 `download/hot100-runner.mjs`，刻意不用绝对域名 —— 换域名、加自定义域、用 `workers.dev` 预览地址都不会失效。

### 2.3 部署

```bash
npm run deploy:cloudflare
```

等价于 `npm run build && npx wrangler deploy`。

### 2.4 自检

部署完打开站点，随便进一道题，点「运行公开示例」：

- 出现「在你的电脑上运行」面板 + 6 位配对码 → 线上入口已生效
- 直接报「这个站点的在线运行还未启用」→ `main` 没指向 `src/online/index.js`

---

## 3. 用户看到什么

1. 写代码，点「运行公开示例」。
2. 首次会弹出面板，三步：
   - 下载 `hot100-runner.mjs`（约 58 KB 单文件，判题逻辑已内联）
   - 复制页面上给出的命令（已带上当前域名）
   - 把 6 位配对码粘进终端
3. 终端显示环境自检 + 「已连上隧道」。点面板里的「我连上了，重新运行」。
4. 之后每次点运行都不再需要配对码：runner 把 `sid + token` 存在 `~/.hot100-runner/session.json`（目录 0700 / 文件 0600）。

关闭终端窗口 = 停止。runner 不监听端口、不开机自启、不常驻后台。

### 3.1 runner 的命令行

```bash
node hot100-runner.mjs                      # 启动（首次会让你输入配对码）
node hot100-runner.mjs --doctor             # 只做环境自检，不连接
node hot100-runner.mjs --code 123456        # 直接用配对码启动
node hot100-runner.mjs --endpoint wss://…   # 指定隧道地址
node hot100-runner.mjs --unpair             # 清除本地凭据
```

`--code` 会强制重新配对（忽略本地旧 token）。这是刻意的：用户手上有新码，说明他要连的是这次会话。

### 3.2 本地开发不受影响

`npm run dev` 仍然走 Vite 插件提供的 `/__runner`，不经过隧道、不需要配对码。线上入口只有在部署时才生效。

---

## 4. 运行限制

| 项 | 值 | 说明 |
|---|---|---|
| 单次运行 | 3 秒 | `src/services/runner.js` 的 `RUN_TIMEOUT_MS` |
| Java 编译 | 10 秒 | `COMPILE_TIMEOUT_MS` |
| 输出上限 | 64 KB | stdout + stderr 合计，超了直接杀进程 |
| Java 堆 | 256 MB | `-Xmx256m`，编译用 `-J-Xmx256m` |
| 进程清理 | 整组杀 | `process.kill(-pid, SIGKILL)`，不留孤儿 |
| 编码 | 强制 UTF-8 | `-Dfile.encoding=UTF-8` / `PYTHONIOENCODING=utf-8` |
| 帧上限 | 1 MB | 单帧超过直接拒绝 |

---

## 5. 安全模型

| 面 | 做法 |
|---|---|
| 配对码 | 6 位数字，10 分钟有效，**一次性**（换到 token 即焚） |
| 配对码防爆破 | Session 侧 60 秒内最多 5 次尝试；Lobby 侧 60 秒内最多 30 次失败查找 |
| 会话 id | 32 位随机 hex，不可猜 |
| token | 32 字节随机，恒定时间比较，存本机 0600 文件 |
| 跨站调用 | 页面无法驱动**别人**的 runner：token 只存在于那台电脑上 |

一个明确的边界：**配对码在 6 位空间里，靠限流挡住枚举**。如果你要更强的保证，把 `PAIR_CODE_LENGTH` 改成 8 位（`runner/protocol.mjs` 和 `src/online/protocol.js` 要一起改，两端有测试盯着一致性）。

---

## 6. 费用

Workers Free 额度（[Durable Objects Pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)）：

| 计费项 | Free |
|---|---|
| Requests | 100,000 / 天（WebSocket 消息按 20:1 折算） |
| Duration | 13,000 GB-s / 天 ≈ 28 小时活跃连接 |
| SQLite 存储 | 5 GB |

因为用了 **WebSocket Hibernation**，空闲连接不计 duration。个人使用远低于额度；真要几十人天天在线，再考虑 Workers Paid（$5/月起）。

---

## 7. 回滚

1. `wrangler.jsonc` 的 `main` 改回 `src/worker.js`
2. 删掉 `durable_objects` 和 `migrations` 两段
3. `npm run deploy:cloudflare`

站点回到「纯静态 + 本地开发才能运行」的状态。DO 类留着不影响。

---

## 8. 已知未完成

- **Windows 未验证**：runner 是纯 Node ESM，理论上跨平台，但 `process.kill(-pid)` 在 Windows 上行为不同，需要单独适配。
- **答案随构建产物上线**：`dist/assets` 里仍含参考解与用例期望值。这是已知取舍（不做防作弊、不做答案剥离），如果要改，方向是把 `cases` 从客户端 bundle 里移出去。
- **`RunnerPairPanel` 里的下载体积文字是硬编码**「约 57 KB」，rebuild 后如果体积变化要手动改。
