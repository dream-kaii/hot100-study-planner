// scripts/build-runner.mjs
// 把 runner/index.mjs 及其依赖（含判题核心 src/services/runner.js）打成一个单文件。
//
// 产物：dist/download/hot100-runner.mjs
// 用户只需要「下载 + node 跑起来」，不需要克隆仓库。
//
// 为什么用 esbuild：它是 Vite 的既有依赖，不需要给项目新增 devDependency。
// 为什么能打成一个文件：runner 只用 Node 内置模块（fs/os/path/child_process）和
// 同仓库的两个纯 ESM 文件，没有任何第三方包。

import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = path.join(ROOT, "runner", "index.mjs");
const OUT_DIR = path.join(ROOT, "dist", "download");
const OUT_FILE = path.join(OUT_DIR, "hot100-runner.mjs");

/** 从 wrangler.jsonc 的 routes 里取自定义域名，作为双击版的默认隧道地址。 */
async function resolveEndpoint() {
  try {
    const config = await fs.readFile(path.join(ROOT, "wrangler.jsonc"), "utf8");
    // 只认 custom_domain: true 的 route，避免把通配路由误当域名。
    const match = config.match(/\{\s*"pattern"\s*:\s*"([^"]+)"[^}]*"custom_domain"\s*:\s*true/);
    if (match) return `wss://${match[1]}/ws`;
  } catch { /* 读不到就用占位地址 */ }
  return "wss://hot100-study-planner.example.workers.dev/ws";
}

const ENDPOINT = await resolveEndpoint();

/** 构建版本号：git 短哈希 + 是否脏。用来判断用户装的是不是最新版。 */
async function resolveVersion() {
  const { execFileSync } = await import("node:child_process");
  try {
    const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
    let dirty = "";
    try {
      const status = execFileSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" }).trim();
      if (status) dirty = "+dirty";
    } catch { /* ignore */ }
    return `${sha}${dirty}`;
  } catch {
    return `t${Date.now().toString(36)}`;
  }
}

const VERSION = await resolveVersion();

const RESULT = await build({
  entryPoints: [ENTRY],
  outfile: OUT_FILE,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node18",
  // Node 内置模块保持外部引用，不要尝试解析它们。
  packages: "external",
  // 单文件给用户看，保留可读性比压缩更重要：出问题时用户能自己审源码。
  minify: false,
  sourcemap: false,
  legalComments: "none",
  define: { __BUILD_VERSION__: JSON.stringify(VERSION) },
  banner: {
    js: [
      "#!/usr/bin/env node",
      `// Hot 100 本机运行助手（单文件构建，版本 ${VERSION}）`,
      "// 代码只在本机执行；不监听端口、不写入系统目录、不开机自启。",
      "// 用法： node hot100-runner.mjs --endpoint wss://<你的域名>/ws",
      ""
    ].join("\n")
  }
});

if (RESULT.errors?.length) {
  console.error("打包失败：", RESULT.errors);
  process.exit(1);
}

const stats = await fs.stat(OUT_FILE);
const sizeKb = (stats.size / 1024).toFixed(1);

// 自检：产物里不应该残留对仓库相对路径的 import，否则用户那边会解析失败。
const source = await fs.readFile(OUT_FILE, "utf8");
const leaks = [...source.matchAll(/from\s+["'](\.\.?\/(?!.*\.mjs)[^"']*)["']/g)].map((m) => m[1]);
if (leaks.length) {
  console.error("打包后仍有未内联的相对 import，用户机器上会失败：\n" + leaks.join("\n"));
  process.exit(1);
}

// 给用户一个稳定的下载名，避免部署后旧链接失效。
await fs.writeFile(
  path.join(OUT_DIR, "VERSION.txt"),
  [
    `version: ${VERSION}`,
    `built-at: ${new Date().toISOString()}`,
    `size: ${sizeKb} KB`,
    `entry: runner/index.mjs`,
    `node: >=18`
  ].join("\n") + "\n",
  "utf8"
);

// ── 生成双击即用的 .command ───────────────────────────────────────
// 把打包好的 JS 用 base64 内嵌进 shell 脚本：用户只需要下载一个文件、双击。
// 脚本首次运行时把 payload 释放到 ~/.hot100-runner/，之后直接复用。
const payload = (await fs.readFile(OUT_FILE)).toString("base64");
const COMMAND_NAME = "Hot100 运行助手.command";
const commandPath = path.join(OUT_DIR, COMMAND_NAME);

const launcher = `#!/bin/bash
# Hot 100 本机运行助手（双击启动）
# 这个文件把运行助手和它的判题逻辑都内嵌在里面，双击即可，不需要别的文件。
# 只做 macOS。

set -u

DIR="$HOME/.hot100-runner"
BIN="$DIR/hot100-runner.mjs"
mkdir -p "$DIR"

pause_exit() {
  echo ""
  echo "$1"
  echo ""
  read -n 1 -s -r -p "按任意键关闭这个窗口…"
  echo ""
  exit 1
}

# 找 node：launchd 的 PATH 很干净，所以这里列常见安装位置。
find_node() {
  if command -v node >/dev/null 2>&1; then command -v node; return; fi
  for candidate in /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node; do
    if [ -x "$candidate" ]; then echo "$candidate"; return; fi
  done
}

NODE="$(find_node)"
if [ -z "$NODE" ]; then
  pause_exit "没有找到 Node.js。请先安装：https://nodejs.org （或 brew install node），然后重新双击这个文件。"
fi

# 记下旧版本，好在更新后告诉用户发生了什么
OLD_VERSION=""
if [ -f "$BIN" ]; then
  OLD_VERSION="$("$NODE" "$BIN" --version 2>/dev/null | head -1 || true)"
fi

# 释放内嵌的运行助手（覆盖旧版本）
/usr/bin/base64 -D > "$BIN.tmp" <<'HOT100_PAYLOAD_EOF'
${payload}
HOT100_PAYLOAD_EOF

if [ ! -s "$BIN.tmp" ]; then
  rm -f "$BIN.tmp"
  pause_exit "运行助手解析失败，请重新下载这个文件。"
fi
mv "$BIN.tmp" "$BIN"
chmod 600 "$BIN"

NEW_VERSION="$("$NODE" "$BIN" --version 2>/dev/null | head -1 || true)"
echo ""
if [ -z "$OLD_VERSION" ] || [ "$OLD_VERSION" = "dev" ]; then
  echo "✔ 已安装运行助手\${NEW_VERSION:+（版本 $NEW_VERSION）}"
elif [ "$OLD_VERSION" = "$NEW_VERSION" ]; then
  echo "✔ 已是最新版本（$NEW_VERSION），无需更新"
else
  echo "✔ 运行助手已更新：$OLD_VERSION → $NEW_VERSION"
fi
echo ""

cd "$DIR" || pause_exit "无法进入 $DIR"
exec "$NODE" "$BIN" --launch --endpoint "${ENDPOINT}" "$@"

# 走到这里说明 node 异常退出，让窗口停住好让用户看到输出。
pause_exit "运行助手意外退出。"
`;

await fs.writeFile(commandPath, launcher, "utf8");
await fs.chmod(commandPath, 0o755);

// 打成 zip：浏览器下载不会保留可执行位，zip 会。
//
// 这里刻意不用 `ditto` / `zip` 命令：
//   2026-10-19 换成 Cloudflare Workers Builds 自动部署后才发现，
//   原实现只在 macOS 上成立 —— 构建跑在 Linux 容器里，没有 ditto，
//   catch 分支静默跳过，然后 dist/download/hot100-runner.zip 根本不存在。
//   页面上的下载链接于是返回 Cloudflare 的 1101（Worker exception），
//   用户点「下载双击版」直接 500。
//   纯 Node 的 deflate 实现没有平台依赖，本地和 CI 产出完全一致。
const zipPath = path.join(OUT_DIR, "hot100-runner.zip");
await fs.writeFile(zipPath, await makeZip([
  { name: COMMAND_NAME, data: Buffer.from(launcher, "utf8"), mode: 0o755 }
]));

const zipStat = await fs.stat(zipPath).catch(() => null);
console.log(`✔ runner 已打包 → dist/download/hot100-runner.mjs（${sizeKb} KB，版本 ${VERSION}）`);
console.log(`✔ 双击版 → dist/download/${COMMAND_NAME}（${(launcher.length / 1024).toFixed(1)} KB，隧道 ${ENDPOINT}）`);
if (!zipStat) throw new Error("zip 打包失败：hot100-runner.zip 未生成");
console.log(`✔ 压缩包 → dist/download/hot100-runner.zip（${(zipStat.size / 1024).toFixed(1)} KB）`);

/**
 * 生成一个只含少量文件的 zip（deflate）。
 * 只为「保留可执行位」这一件事存在，所以不做目录、不做多卷、不做 ZIP64。
 */
async function makeZip(entries) {
  const { deflateRawSync } = await import("node:zlib");
  const { crc32 } = await import("node:zlib");
  // crc32 是 Node 22.2+ 才有的；旧版本退回手算，避免 CI 版本差异。
  const crc = typeof crc32 === "function" ? (buf) => crc32(buf) : crc32Fallback;

  const now = new Date();
  const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xffff;
  const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;

  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const raw = entry.data;
    const packed = deflateRawSync(raw, { level: 9 });
    const checksum = crc(raw);
    // bit 11 表示文件名是 UTF-8，中文文件名靠它才能在解压时正确还原。
    const flags = 0x0800;
    const mode = (entry.mode ?? 0o644) >>> 0;
    const externalAttrs = ((mode << 16) | (mode & 0xffff)) >>> 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);          // version needed
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(8, 8);           // deflate
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);          // extra len
    locals.push(local, nameBuf, packed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x031e, 4);    // made by: unix, 3.0
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);        // extra
    central.writeUInt16LE(0, 32);        // comment
    central.writeUInt16LE(0, 34);        // disk
    central.writeUInt16LE(0, 36);        // internal attrs
    central.writeUInt32LE(externalAttrs, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + packed.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralBuf, end]);
}

/** CRC-32（IEEE），在没有 zlib.crc32 的 Node 上使用。 */
function crc32Fallback(buf) {
  let table = crc32Fallback.table;
  if (!table) {
    table = crc32Fallback.table = new Int32Array(256);
    for (let i = 0; i < 256; i += 1) {
      let c = i;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[i] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i += 1) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}
