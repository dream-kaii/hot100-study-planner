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
  banner: {
    js: [
      "#!/usr/bin/env node",
      "// Hot 100 本机运行助手（单文件构建）",
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
    `built-at: ${new Date().toISOString()}`,
    `size: ${sizeKb} KB`,
    `entry: runner/index.mjs`,
    `node: >=18`
  ].join("\n") + "\n",
  "utf8"
);

console.log(`✔ runner 已打包 → dist/download/hot100-runner.mjs（${sizeKb} KB）`);
