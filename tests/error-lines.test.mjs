import assert from "node:assert/strict";
import test from "node:test";
import { remapErrorLines } from "../src/services/error-lines.js";

// 生成源码里第 1 行是框架 import，用户代码从第 2 行开始依次是 1、2、3...
const map = [0, 1, 2, 3, 4, 0, 0, 0];

test("python 栈帧换成编辑器行号，框架帧整帧丢掉", () => {
  const raw = [
    'Traceback (most recent call last):',
    '  File "/tmp/hot100-run-x/main.py", line 7, in <module>',
    '    __hot100_result = getattr(Solution(), "f")(*__hot100_args)',
    '  File "/tmp/hot100-run-x/main.py", line 3, in f',
    '    return nums[0] / 0',
    'ZeroDivisionError: division by zero'
  ].join("\n");
  const out = remapErrorLines(raw, { language: "python", map });
  assert.match(out, /File "你的代码", line 2, in f/);
  assert.match(out, /return nums\[0\] \/ 0/);
  assert.match(out, /ZeroDivisionError/);
  // 框架自己在 line 7 的调用帧必须消失，否则用户会看到 __hot100_* 的实现细节。
  assert.ok(!out.includes("__hot100_"), out);
  assert.ok(!out.includes("line 7"), out);
});

test("python 语法错误没有 Traceback 也能换行号", () => {
  const raw = '  File "/tmp/hot100-run-x/main.py", line 3\n    //return nums[0]\n    ^^\nSyntaxError: invalid syntax';
  const out = remapErrorLines(raw, { language: "python", map });
  assert.match(out, /File "你的代码", line 2/);
  assert.match(out, /SyntaxError: invalid syntax/);
});

test("python 报错信息里单独引用的行号一起换掉", () => {
  const raw = '  File "/tmp/x/main.py", line 3\n    return 1\nIndentationError: expected an indented block after function definition on line 2';
  const out = remapErrorLines(raw, { language: "python", map });
  assert.match(out, /on line 1/);
  assert.ok(!out.includes("on line 2"), out);
});

test("java 栈帧换成编辑器行号，框架帧丢掉", () => {
  const raw = [
    'Exception in thread "main" java.lang.ArithmeticException: / by zero',
    "\tat Solution.f(Main.java:3)",
    "\tat Main.main(Main.java:6)"
  ].join("\n");
  const out = remapErrorLines(raw, { language: "java", map });
  assert.match(out, /at Solution\.f\(你的代码:2\)/);
  assert.match(out, /ArithmeticException/);
  assert.ok(!out.includes("Main.main"), out);
  assert.ok(!out.includes("Main.java:6"), out);
});

test("java 编译诊断换成编辑器行号", () => {
  const raw = "/tmp/hot100-run-x/Main.java:3: 错误: 需要';'\n        return nums[0]\n1 个错误";
  const out = remapErrorLines(raw, { language: "java", map });
  assert.match(out, /^你的代码:2: 错误: 需要';'$/m);
  assert.ok(!out.includes("Main.java"), out);
});

test("缺少映射或映射为空时原文返回，不吞报错", () => {
  const raw = '  File "/tmp/x/main.py", line 3\nSyntaxError: invalid syntax';
  assert.equal(remapErrorLines(raw, { language: "python", map: null }), raw);
  assert.equal(remapErrorLines(raw, { language: "python", map: [] }), raw);
  assert.equal(remapErrorLines("", { language: "python", map }), "");
  assert.equal(remapErrorLines(undefined, { language: "python", map }), "");
});

test("认不出的错误文本原样透传", () => {
  const raw = "本机未找到 python3，请安装运行环境后重试。";
  assert.equal(remapErrorLines(raw, { language: "python", map }), raw);
});

test("映射越界时不改成不存在的行号", () => {
  const raw = '  File "/tmp/x/main.py", line 99\n    boom()\nRuntimeError: boom';
  const out = remapErrorLines(raw, { language: "python", map });
  // 第 99 行不在 map 里 → 这一帧属于框架，整帧丢掉；报错类型仍然保留。
  assert.match(out, /RuntimeError: boom/);
  assert.ok(!out.includes("line 99"), out);
});
