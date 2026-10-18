# Hot 100 在线判题 · 本机执行方案（基于现有仓库的落地设计）

- 状态：待技术评审
- 日期：2025-10-14
- 目标仓库：`/Users/kaii/MyProjects/hot100-study-planner`
- 前置结论：**可行，且现有用例与判题逻辑可直接复用，不必重写**

> 本文档替代 `/Users/kaii/MyProjects/dsh/docs/superpowers/specs/2025-10-14-hot100-local-runner-design.md` 中"待确认项"部分。那份文档的架构结论仍成立，但组件边界因实际仓库状况发生实质变化（见 §2.3）。

---

## 1. 结论摘要（评审先看这五条）

1. **用例可以直接复用**：100 题 × 3 用例 = 300 条用例，加 8 种比较模式，全部现成，**实测两种语言 200/200 全通过**。
2. **判题逻辑也不必重写**：现有 `src/services/runner.js`（555 行）已经处理了链表/树/原地修改/操作序列等全部难题，把它整体搬进 Node 版 runner 即可。
3. **但"在线"这一步有一个绕不开的改造**：现有 runner 是 Vite 中间件，只在 `npm run dev` 下工作；线上 Worker 只返回静态资源。要在线可用，必须有一个常驻服务。
4. **有一个必须同时处理的安全问题**：`npm run build` 会把包含**答案代码和用例期望值**的 JSON 打进 `dist/assets/*.js`。直接开公网执行入口 = 当众交出答案（详见 §9）。
5. **工期修正**：因复用现有执行核心，我原先估的 6.5 天可压到约 4.5–5.5 天；但新增了一项"答案剥离"改造（约 0.5–1 天），净收益约 1 天。

---

## 2. 现状勘查结果（实测，非推测）

### 2.1 仓库与技术栈

| 项 | 实测 |
|---|---|
| 仓库 | `/Users/kaii/MyProjects/hot100-study-planner`，git 分支已有未提交改动（`src/components/CodeEditor.jsx` 等 10 个文件 modified），**开工前需先确认这些改动归属** |
| 构建 | Vite 7 + React 19 + Monaco，`vite.config.js` 中 `base: "./"` |
| 部署 | **Workers + Static Assets**（非 Pages）。`wrangler.jsonc`：`main: "src/worker.js"`、`assets.directory: "./dist"`、`not_found_handling: "single-page-application"`、`routes: []` |
| 现有 Worker | `src/worker.js` 仅 5 行：`return env.ASSETS.fetch(request)` |
| 数据 | `src/data/hot100.json`（100 题元数据）、`src/data/solutions.json`（聚合 878 KB）、`src/data/solutions/{id}.json`（**100 个分片，含 `func`/`cases`/`acm` 等完整字段**） |
| 前端加载 | `src/main.jsx:19` `import.meta.glob("./data/solutions/*.json", { eager: false })`，按题懒加载分片 |

### 2.2 现有执行链（这条链是整个方案的地基）

```
src/components/CodeEditor.jsx:94   run() → onRun({questionId, language, mode, func, cases, code, ...})
src/main.jsx:166-174              onRun → fetch("/__runner", POST JSON) → 返回结果
src/server/local-runner.mjs:48    Vite 插件中间件，只接受回环地址、只接受 application/json、body ≤ 256KB
src/services/runner.js:530        runExample() → 内部串行队列
                                  ├─ runSingleExample()  写临时目录 → spawn → 收 stdout
                                  ├─ pythonFunctionSource() / javaFunctionSource()  生成包裹代码
                                  └─ compareResult()     8 种比较模式
```

**`src/services/runner.js` 的关键能力（全部可复用）**

| 能力 | 位置 | 说明 |
|---|---|---|
| 函数模式代码包裹 | `pythonFunctionSource()` `:186`、`javaFunctionSource()` `:447` | 自动补 `class Solution` 外壳、补 `ListNode/TreeNode/Node` 定义、生成 `Main` 入口 |
| 返回值 JSON 序列化 | `:232` `__hot100_serialize`（Python）、`:138` `JAVA_JSON_HELPER` | 跨语言统一输出协议 |
| 链表/树/随机指针构造与回读 | `:203` `__hot100_convert`、`:321` `javaLiteral` | 含环形检测、`intersectVal/skipA/skipB/pos` 等特殊输入 |
| 原地修改回读 | `:314` `__hot100_result = __hot100_args[0]` | `in-place-mutate` 语义 |
| 操作序列题（LRU/Trie/MinStack/MedianFinder） | `:106` `operationSequence()`、`:117` `:166` | 4 道题的特殊形态 |
| 8 种比较模式 | `:24` `compareResult()` | 见 §3.1 |
| 多解验证 | `:421` `compareFunctionResult()` | `any-valid` + `longestPalindrome`/`sortedArrayToBST` 专项校验 |
| 进程组全杀 | `:47` `killProcessGroup()` | `process.kill(-pid, SIGKILL)`，**已正确实现** |
| 输出上限 | `:61` `append()` | 累计 64KB 截断并 kill |
| 超时 | `:80` | `RUN_TIMEOUT_MS = 3s`、`COMPILE_TIMEOUT_MS = 10s` |
| 串行队列 | `:13` `executionQueue`、`:524` `queued()` | 全局串行，避免并发打架 |

### 2.3 关键差异：现有 runner 是"开发服务器插件"，不是"服务"

`src/server/local-runner.mjs:48` 导出的是 Vite 插件（`configureServer`），因此：

- 只在 `npm run dev` 下存在 `/__runner`
- 线上 Worker 没有任何执行入口
- `src/main.jsx:194` 直接把运行按钮的可用性绑在 `import.meta.env?.DEV && selectedSolution?.func` 上——**线上是灰的，这是现状**

这印证了 README 的原话："线上静态页面没有这个接口，点运行会提示「请在本地开发环境运行」"。

**所以"能否在线运行"这个问题的技术本质是：需要一个不在 Vite dev server 里的、常驻的、可从公网访问的执行入口。** 这就是 §4 的改造点。

### 2.4 用例数据实测（这决定"能不能直接拿去用"）

| 指标 | 实测值 |
|---|---|
| 题数 | 100（`src/data/solutions/*.json` 与 `hot100.json` 一一对应） |
| 用例总数 | **300**（平均每题 3.0 条，分布 basic / boundary / adversarial） |
| `func` 契约覆盖率 | **100 / 100** |
| 大用例 | 无。JSON 化后最长输入 < 2000 字节 → **单帧 1MB 上限完全富余** |
| 比较模式分布 | `exact` 73、`unordered-array` 7、`in-place-mutate` 6、`operation-sequence` 4、`unordered-nested` 4、`identity` 3、`any-valid` 2、`float-tolerance` 1 |
| 参数/返回类型 | `int[]` 41、`int` 28、`String` 19、`TreeNode` 15、`ListNode` 14、`int[][]` 9、`char[][]` 2、`Node` 1、`ListNode[]` 1、`String[]` 1 等 |

### 2.5 全量实测结果（本机，Python 3.13.15 + javac 1.8.0_504）

用现有 `runExample()` 跑 **100 题 × 2 语言 × 3 用例**：

```
{"passed": 200, "failed": 0, "error": 0, "nocases": 0}
perLang {"python": {"passed":100}, "java": {"passed":100}}
real 2m10s（串行）
```

**结论：用例、判题逻辑、参考解三者当前是自洽的，零改造即可作为执行核心。** 这是本方案最重要的一个已验证事实。

### 2.6 现有沙箱能力实测

| 项目 | 实测结果 | 判定 |
|---|---|---|
| 死循环超时 | `while True: pass` → 3005ms 后被终止，返回 `status: "timeout"` | ✅ 正常 |
| 进程残留 | 超时后 `ps` 无 `python3`/`java` 残留 | ✅ `killProcessGroup` 生效 |
| 输出上限 | 代码实现了 64KB 截断 + kill | ✅ 有（未单独压测） |
| 串行队列 | `executionQueue` 全局串行 | ✅ 有 |

**即我原方案里列为"M3 硬验收项"的沙箱三件套，现有代码已经具备。** 这是工期能压缩的主要原因。

### 2.7 本机环境（决定了分发形态）

```
go    : 未安装（which go → NO GO）
python3: 3.13.15
javac : 1.8.0_504（Zulu 8.96.0.205, macos-aarch64）
java  : openjdk 1.8.0_504
node  : v24.21.0
```

两条直接后果：

1. **Go 版 runner 需要先装 Go 工具链**（`brew install go`），否则第一条路走不通。
2. **本机 JDK 是 8**。现有 `runner.js` 只生成 `class Solution` / `class Main` 的 Java 8 兼容代码，所以现在跑得通；**若将来要支持 Java 17+ 的 `record`/`sealed` 等语法，或用户机器是 JDK 21，需要额外回归**。这条要写进评审风险。

---

## 3. 可直接复用的资产清单

### 3.1 用例本身（100% 复用）

格式（`src/data/solutions/1.json`）：

```jsonc
{ "func": { "className":"Solution", "methodName":"twoSum",
            "params":[{"name":"nums","type":"int[]"},{"name":"target","type":"int"}],
            "returns":"int[]", "compare":"unordered-array" },
  "cases": [ { "id":"1-basic-1", "input":{"nums":[2,7,11,15],"target":9},
               "expected":[0,1], "tags":["basic"] },
             { "id":"1-boundary-1", "input":{"nums":[3,3],"target":6},
               "expected":[0,1], "tags":["boundary"], "note":"..." } ] }
```

8 种 `compare` 语义（`src/services/runner.js:24`）：

| 模式 | 语义 | 题数 |
|---|---|---|
| `exact` | 结构化全等比较 | 73 |
| `unordered-array` | 多重集比较（顺序无关） | 7 |
| `in-place-mutate` | 比较 `mutated` 或首个参数 | 6 |
| `operation-sequence` | 构造器 + 操作序列，逐条比对返回值 | 4 |
| `unordered-nested` | 元素为数组时按多重集比较 | 4 |
| `identity` | 返回节点身份（`id` 映射），用于 138 等 | 3 |
| `any-valid` | 多解题目专用校验（回文/平衡 BST） | 2 |
| `float-tolerance` | 1e-6 容差 | 1 |

### 3.2 特殊题型清单（评审时容易漏的点）

**operation-sequence（4 道，需要构造器 + 方法派发，不能走普通函数模板）**

| 题号 | 类名 | 构造参数 | 方法 |
|---|---|---|---|
| 146 | `LRUCache` | `int capacity` | `get` / `put` |
| 155 | `MinStack` | 无 | `push` / `pop` / `top` / `getMin` |
| 208 | `Trie` | 无 | `insert` / `search` / `startsWith` |
| 295 | `MedianFinder` | 无 | `addNum` / `findMedian` |

**其他需要特殊处理的数据结构输入**

| 题型 | 涉及题目 | 现有处理 |
|---|---|---|
| `ListNode` | 14 处参数 / 10 处返回 | `javaLiteral("ListNode")` `:322`、`__hot100_convert` `:211` |
| `TreeNode` | 15 处参数 / 4 处返回 | 层序数组 ↔ 树 `:350` `:219` |
| `Node`（随机指针） | 138 | `__hot100_random` `:406`、独立副本校验 `:411` |
| 链表相交 | 160 | `intersectVal/skipA/skipB` `:296` |
| 环形链表 | 141 / 142 | `pos` 参数造环 `:304` |

### 3.3 前端与模板（部分复用）

| 资产 | 路径 | 状态 |
|---|---|---|
| Monaco 编辑器 + 运行按钮 + 结果渲染 | `src/components/CodeEditor.jsx` | 复用，只改 `onRun` 的传输实现 |
| 函数模板生成（`class Solution` 外壳） | `src/services/editor.js:74` `createFunctionTemplates` | **可直接复用**，已实测生成正确模板 |
| ACM 模板 | `src/services/editor.js:107` `createAcmTemplates` | 复用 |
| 代码包裹 / 节点定义 | `src/services/function-contract.js` `wrapFunctionCode` `:49`、`nodeDefinitions` `:72` | **执行核心依赖，必须保留在服务端** |

实测 `createDraftTemplates()` 对题 1 的输出（本地跑通）：

```java
import java.util.*;

class Solution {
    public int[] twoSum(int[] nums, int target) {
        // 请在这里完成算法
        return null;
    }
}
```

```python
from typing import *

class Solution:
    def twoSum(self, nums: List[int], target: int) -> List[int]:
        # 请在这里完成算法
        pass
```

---

## 4. 架构选型：三条路，与为什么选第二条

线上页面（`https://<worker>.workers.dev`）要能跑本机代码，只有三条技术路径：

| # | 方案 | 可行性 | 判定 |
|---|---|---|---|
| **B0** | 保持现状，仅 localhost 可用 | 现在就行 | ❌ 不满足"在线"目标 |
| **B1** | 用户本机 `npx hot100-runner`，页面连 `ws://127.0.0.1` | **需要 HTTPS 页面连 `ws://`，会被浏览器拦** | ❌ 除非整站退回 http |
| **B2** | 用户本机跑本地服务，配 `mkcert` 自签证书，页面连 `wss://127.0.0.1:PORT` | 技术可行 | ⚠️ 要求用户装证书，对"有开发环境的人"可接受但摩擦明显 |
| **B3** | **Cloudflare Worker 用 Durable Object 做 WebSocket 中转，本机 runner 主动出站长连接** | 技术可行，免费额度足够 | ✅ **推荐** |

### 4.1 为什么选 B3

- 页面与 Worker **同源**，`wss://<domain>/ws` 天然合法：无 Mixed Content、无 CORS 预检、无 PNA 弹窗、无证书安装。
- runner **不监听端口**，只出站：免防火墙、免本地权限、免"任意网站调起本机执行"的攻击面（配对码约束来源）。
- 你已经在用 Workers（不是 Pages），加一个 DO 只是 `wrangler.jsonc` 里加 `durable_objects` 段，不引入新平台。
- 这套架构与 **runner 用什么语言写完全解耦**——见 §5 的两条实现路线。

### 4.2 最终数据流

```
浏览器  https://<worker-domain>/
   │ ① GET /api/cases/{id}          取题目 + func 契约 + cases（期望值走独立端点，见 §9）
   │ ② WSS /ws?sid=..&token=..      同源长连接
   ▼
Cloudflare Worker + DurableObject(Session)
   │ ③ 帧透传（不解析用例、不执行代码）
   ▼
本机 runner（Node 版或 Go 版，二选一）
   │ ④ 复用 src/services/runner.js 的 runExample()（Node 版）
   │    或 移植等价逻辑（Go 版）
   ▼
node/python3(javac+java)
```

---

## 5. 两条实现路线（这是评审最需要拍板的一处）

### 路线 N：Node 版 runner（推荐）

```
runner/                       新建 Node 小服务
  index.mjs                   启动、探测、连隧道、收帧
  server/run-example.mjs      ← 直接 import 现有 src/services/runner.js
  protocol/                   WS 客户端 + 帧编解码
```

**做法**：把 `src/services/runner.js` + `src/services/function-contract.js` 作为**共享模块**同时被前端构建与 runner 引用（前提：把 `runExample` 相关部分保持在纯 Node 侧，不要被打进浏览器 bundle）。runner 只是"把 `runExample()` 挂到 WebSocket 上"。

| 维度 | 评价 |
|---|---|
| 复用度 | **~95%**：执行、包裹、比较、沙箱、特殊题型全部现成 |
| 工期 | **1–1.5 天** |
| 前提 | 用户机器**必须已装 Node**（目标用户已满足），用 launcher 检查 `node -v ≥ 20` |
| 风险 | 依赖用户 Node 版本；`runner.js` 用了 `import` + `node:` 前缀，需 Node ≥ 18 |
| 分发 | 不能是单文件二进制；`npx hot100-runner` 或一个 `start.command` |

**为什么我认为这条路更对**：
1. 你的判题核心是那份 555 行 JS——`__hot100_serialize`、`javaLiteral`、`operationSequence`、8 种 compare 全在里面。**用 Go 重写一遍意味着重写这 555 行，并且必须重新验证 300 条用例的语义一致性。** 这是本方案里最不需要发生的风险。
2. 用户是"有开发环境的人"，装 Node 不是门槛。
3. 未来加 Windows 只是换个 `start.bat`，逻辑一行不改。

### 路线 G：Go 版 runner（我最初推荐，现降级为备选）

单二进制 `darwin/arm64|amd64`，自包含，不需要用户装任何运行时（除 node 和 python 本身）。

| 维度 | 评价 |
|---|---|
| 复用度 | **0%**，需重写全部包裹与比较逻辑 |
| 工期 | **5–6 天**（其中 3–4 天是移植 + 逐题回归 300 条用例） |
| 前提 | 需要 `brew install go`（本机未装） |
| 价值 | 分发更干净、启动更快、无 Node 版本依赖 |

**判断**：除非你要求"一个双击即用的二进制、不依赖用户的 Node 版本"，否则不值得为它重写 555 行核心逻辑并重跑 300 条用例回归。**我改变建议：先走路线 N，把 Go 留作第二阶段可选优化。**

> 这个改变是我看了你的仓库之后才敢下的结论。之前我看不到 `runner.js` 的实际内容，把"跑代码"当成了从零工作量。

---

## 6. 需要改造的四处（相对于现有代码）

### 6.1 Worker：从 5 行静态服务变成路由 + 中转

现状 `src/worker.js`：

```js
export default {
  async fetch(request, env) {
    return env.ASSETS.fetch(request);
  }
};
```

目标形态：`/api/*` 与 `/ws` 走自建逻辑，其余落到 `env.ASSETS`。`wrangler.jsonc` 增加：

```jsonc
"durable_objects": { "bindings": [{ "name": "SESSION", "class_name": "Session" }] },
"migrations": [{ "tag": "v1", "new_sqlite_classes": ["Session"] }]
```

DO 状态机：

```
IDLE ──pair──> PAIRED ──runner ws open──> ONLINE
                  │                          │
                  └─120s 无 bind──> EXPIRED   └─90s 无帧(alarm)──> DEAD
                                          └─ws close──> OFFLINE
```

**评审要求**：DEAD 必须由 `alarm()` 主动推进，不能只依赖 `close` 事件（网络半断开时 close 可能不触发）。这是 DO 最常见的僵尸会话来源。

### 6.2 前端：把 `onRun` 从 fetch 换成 WSS

`src/main.jsx:166` 现在是：

```js
const onRun = async (payload) => {
  try {
    const response = await fetch("/__runner", { method: "POST", ... });
    if (!response.ok) return { status: "unavailable", ... };
    return response.json();
  } catch { return { status: "unavailable", ... }; }
};
```

新增一条 WSS 通道后保留 `/__runner` 作为开发态后备（`npm run dev` 仍可用，不破坏你现在的开发体验）。同时 `src/main.jsx:194` 的 `runnerAvailable={Boolean(import.meta.env?.DEV && selectedSolution?.func)}` 需要改成"开发态 OR 隧道已连接"。

### 6.3 用例下发：复用现有分片，但拆出期望值

现有 `dist/solutions/{id}.json` 已经是分片静态资源（构建产物里实测存在 100 个）。改造点见 §9。

### 6.4 runner：新增 WS 层

`runExample()` 原样保留，外面加一层帧收发：

```js
ws.on("message", async (raw) => {
  const frame = decode(raw);
  if (frame.t !== "run") return;
  const result = await runExample(frame.payload);   // 现有实现，零修改
  send({ t: "done", id: frame.id, result });
});
```

`runExample()` 已有全局串行队列，天然不需要额外并发控制。

---

## 7. 协议补充（沿用前一份设计，此处只列与现有 `runExample` 返回值的映射）

| `runExample()` 返回 | 帧 |
|---|---|
| `{status:"passed"/"failed"/"completed", cases:[...], durationMs}` | `{t:"done", id, passed, total, cases, durationMs}` |
| `{status:"unavailable"}` | `{t:"error", code:"DISCONNECTED"}` |
| `{status:"environment_error"}` | `{t:"error", code:"ENV_MISSING", s:"本机未找到 javac"}` |
| `case.status: "timeout"` | 用例级 `why:"timeout"`（现有实现，3s 上限） |
| `case.status: "output_limit"` | 用例级 `why:"output_limit"`（64KB 上限） |
| `case.status: "compile_error"/"compile_timeout"` | 用例级 `why:"compile"` |

> 注意现有实现是"每个用例各起一次进程"（`runExample` 里的 `for` 循环），因此 Java 题每题要 `javac` 3 次。实测 100×2 串行耗时 2m10s，其中 Java 编译占大头。**体验优化点（非必须）**：把同一 `run` 下的 `javac` 提到循环外，编译一次跑 3 个用例。这属于路线 N 内部的小重构，约 2–3 小时，能显著降低首屏等待。

---

## 8. 沙箱：现有能力与必须补的缺口

| 项目 | 现状（实测） | 是否要改 |
|---|---|---|
| 进程组全杀 | `killProcessGroup()` `:47` 已正确 | 不改 |
| 单次运行超时 | `RUN_TIMEOUT_MS = 3000` | 可沿用（比原方案的 2000ms 更宽松，300 条用例实际都在 30ms 内） |
| 输出上限 | `MAX_OUTPUT = 64 * 1024`，超限 kill | 不改 |
| 并发控制 | 全局串行队列 | 建议改为"每连接一个队列"，避免多用户互相阻塞 |
| 临时目录清理 | `fs.mkdtemp` + `finally fs.rm` `:490` `:519` | 不改 |
| 内存上限 | **无**（Java 未传 `-Xmx`） | **建议补 `-Xmx256m`**（一行） |
| 编码固定 | Java 与 Python 都未显式设 UTF-8 | **建议补**（macOS 默认 UTF-8，风险低于 Windows，但显式更稳） |
| 网络隔离 | 无 | 不做（已确认不在范围） |
| 输入大小校验 | body ≤ 256KB（`local-runner.mjs:3`） | 沿用，改到 WS 帧层 |

**结论：沙箱缺口只剩"内存上限"和"编码固定"两处，各一行。** 我原方案里列为最大技术风险的"进程组全杀"，现有代码已经做对了。

---

## 9. 必须解决的副作用：答案随构建产物上线

### 9.1 事实

`npm run build` 把 100 个题解分片输出到 `dist/assets/{id}-{hash}.js`。实测 `dist/assets/1-DZkT6Ytq.js` 内容包含：

- `"1-basic-1"`（用例 id）→ **用例表在线上**
- `"expected"` 字段 → **期望值在线上**
- 完整 `java` / `python` 参考解

这部分**不会因为"不做防作弊"就无害**——它会直接损害产品本身：用户搜索题号即可看到完整答案，等于平台上每道题的答案都在浏览器缓存里。

### 9.2 量化：答案是否已经在题面里

我写了检查：把 `solutions/*.json` 剔除 `java/python/bruteForce/func/cases/acm/sources/solutionSource/...` 后，看用例期望值是否仍出现在剩余文本（题面/思路/示例）中。

```
cases: 300
非平凡期望值（JSON 长度 > 6）出现在 description 中的: 74
```

其中大量是结构性巧合（如题面"示例 1: 输入… 输出 [1,3,12,0,0]"本身就写着示例输出）。**这意味着：很多题的"示例用例"答案本来就在题面里，藏不住。** 但**边界用例（boundary）和对抗用例（adversarial）的期望值，绝大多数不在题面里**——这部分是有价值的。

### 9.3 建议做法（三档，按成本递增）

| 档 | 做法 | 成本 | 效果 |
|---|---|---|---|
| **S1（最小）** | 把 `cases` 从客户端 bundle 中移出，改为 runner 侧通过静态端点取 | 2–3 小时 | 答案不再随首屏加载；但端点公开可请求 |
| **S2（推荐）** | S1 + 期望值走需配对 token 的端点（`/api/cases/:id/expect`，`Authorization: device-token`） | 0.5 天 | 需持有配对 token 才能取到期望值 |
| **S3（最彻底）** | 用例完全不出服务端，由 runner 从本地 `solutions/*.json` 读取（runner 与站点同仓库分发） | 1 天 + 分发体变大 | 答案永不上线；但 runner 体积 +878KB，且改题要重新分发 |

**我的建议是 S2**：既解决"构建产物含答案"，又不要求用户重新下载 runner 才能改题。S3 的"答案永不上线"很诱人，但和你"C7 改题零发版"的诉求冲突。

> 注意这条改造与你说的"不做防作弊"不矛盾。防作弊 = 防止用户绕过判题；这里要解决的是 = **答案不该被搜索引擎索引、不该出现在首屏 JS 里**。两者的产品含义完全不同。

---

## 10. 里程碑（路线 N，macOS 首发）

| # | 里程碑 | 交付物 | 验收标准 | 预估 |
|---|---|---|---|---|
| **M0** | 基线固定 | 把现有 `runExample()` 抽出为可被外部 import 的纯 Node 模块；跑通 300 条用例回归 | 输出 `200/200 passed`（本机已验证过，此步确认抽取后不回归） | 0.5 天 |
| **M1** | 打通链路 | `runner/index.mjs` + Worker `/ws` + DO + 前端 WSS 客户端 | 线上页面发 `print(1)`，页面显示 `1` | 1 天 |
| **M2** | 函数模式全量 | 复用 `runExample`，前端渲染逐用例结果 | 任选 5 题（含 146/138/160/141）在线上跑通 | 0.5 天 |
| **M3** | 沙箱补齐 | `-Xmx256m` + UTF-8 显式固定 + 每连接串行队列 | 死循环 3s 终止且无残留；400MB 数组触发 OOM 而非拖垮机器 | 0.5 天 |
| **M4** | 配对与鉴权 | `/api/pair`、`/api/bind`、DO 状态机、`alarm` 僵尸清理 | 无 token 无法建连；断网 90s 内转 OFFLINE | 1 天 |
| **M5** | 答案剥离（S2） | cases/expected 分出客户端 bundle + 带 token 的期望值端点 | `grep '"expected"' dist/assets/*.js` 为空 | 0.5 天 |
| **M6** | 分发与引导 | 下载页、`start.command`、`--doctor`、Gatekeeper 右键说明 | 一台干净 mac 上从零到跑通 ≤ 5 分钟 | 0.5 天 |
| **M7** | 断线重连 | 30s 心跳 + 指数退避 + 按 id 重放 | 合盖 1 分钟后打开，页面自动恢复 | 0.5 天 |

**合计 ≈ 5 天**（不含 M0 的回归验证时间约 25 分钟）。

### 10.1 顺序约束

1. **M0 必须最先**：抽取时若破坏了 300 条用例中的任何一条，后面全白做。
2. **M3 在 M4 之前，且在向他人分发之前**：先鉴权后沙箱会留下一段"半受信任执行后端"。
3. **M5 可以晚于 M4，但不能晚于公开发布**：答案剥离是发布门槛，不是优化项。

---

## 11. 风险清单（基于实测修订）

| # | 风险 | 概率 | 影响 | 对策 |
|---|---|---|---|---|
| R1 | **构建产物泄露答案**（§9） | **确定发生** | 产品价值受损 | M5 的 S2 方案 |
| R2 | 仓库有 10 个未提交改动 | 确定 | M0 抽取可能与进行中的改动冲突 | 开工前先确认 `git status` 里那批改动的归属 |
| R3 | 用户 Node 版本过低（< 18） | 中 | runner 起不来 | launcher 检查 `node -v`，给 nvm 指引 |
| R4 | 本机 JDK 是 8，用户是 21 | 中 | 用户写了 Java 17 语法会 CE | `java -version` 上报到页面；文档写明"支持 Java 8 语法" |
| R5 | Gatekeeper 首次拦截 | 高 | 转化率 | 下载页首屏写明右键打开 + `xattr -d com.apple.quarantine` |
| R6 | Java 每题编译 3 次（现有实现按用例循环） | 中 | 首屏等待长 | 建议把 `javac` 提到用例循环外（§7 备注） |
| R7 | 僵尸 DO 会话 | 中 | "显示在线但连不上" | `alarm()` 主动推进 DEAD |
| R8 | 合盖/切网断连 | 高 | 页面卡"运行中" | M7 心跳 + 重连 + 按 id 重放 |
| R9 | 多标签页并发执行 | 低 | 串行队列互相阻塞 | 每连接一份队列 |

已确认不做：防作弊、用例保密（除 §9 的"不上线"以外）、账户体系、网络隔离、托盘常驻、Windows 首发。

---

## 12. 需要你回答才能定稿的三个问题

| # | 问题 | 为什么卡在这 |
|---|---|---|
| **Q1** | runner 走**路线 N（Node，复用 555 行核心）**还是**路线 G（Go，重写并回归）**？ | 这是 1.5 天 vs 6 天的差别。我的建议是 N。 |
| **Q2** | §9 的答案剥离取 **S1 / S2 / S3** 哪一档？ | S2 我推荐；若你接受"答案随 runner 分发"，S3 一劳永逸但要重发 runner。 |
| **Q3** | 仓库里 10 个未提交改动（`CodeEditor.jsx`、`ProblemDetail.jsx`、`main.jsx`、`storage.js`、`styles.css` 等）是进行中的工作吗？ | M0 要动 `runner.js` 与这些文件的引用关系，需知道是否能先提交/stash。 |

---

## 13. 评审时应当挑战的点

1. **路线 N 的共享模块边界**：`runner.js` 目前同时被 Vite（dev 中间件）与未来的 runner 使用，必须确保它**不会被 Vite 打进浏览器 bundle**（它 `import fs/os/path/child_process`，天然不会，但抽取时要显式验证 `dist/assets` 里不含这些）。
2. **DO 与 Worker 免费额度**：一个会话一个 DO 实例，空闲时 DO 会休眠；重连是否要重建状态需实测。
3. **`runExample` 的串行队列改并发**：现在全局串行是"安全"的，改成每连接一份后，同一用户多标签页仍会串行（合理），但不同用户之间隔离，需要确认没有共享可变状态（`executionQueue` 是模块级变量，要改）。
4. **§9 的 S2 是否够**：`case.id`、`tags`、`note` 是否也要一并剥离？如果 `note`（如"两个相同值需要不同索引"）本身就是提示，是否该留在客户端？
5. **Java 8 语义**：现有参考解全部是 Java 8 风格，若用户用 JDK 21 运行且写了新语法，`javac` 会通过但平台不承诺兼容——要不要在模板里加版本注释。
