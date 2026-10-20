// 运行器会把用户代码拼进一段框架源码再执行，所以解释器报出的行号是「生成后」的行号。
// 用户照那个行号去编辑器里数，永远找不到自己的错。
// 这里把生成源码的行号换回用户编辑器里的行号，并把框架自己的栈帧整帧丢掉。

const CHAIN_ERROR = /^[A-Za-z_][\w.]*(Error|Exception|Interrupt|Exit)\b/;

function at(map, line) {
  const index = Number(line) - 1;
  if (!Number.isInteger(index) || index < 0 || index >= map.length) return 0;
  return map[index] || 0;
}

// 已经换好的帧要原样保留：不能再被第二遍替换拿生成源码行号去二次映射。
const REMAPPED = /^(\s*)File "你的代码", line \d+(, in .*)?$/;

function remapPython(text, map) {
  const lines = text.split("\n");
  // IndentationError 之类会把行号写在消息文字里，例如 "after function definition on line 13"。
  const rewrite = (line) => line.replace(/\b(on line|line) (\d+)\b/g, (whole, word, number) => {
    const userLine = at(map, number);
    return userLine ? `${word} ${userLine}` : whole;
  });
  const out = [];
  let index = 0;
  while (index < lines.length) {
    const frame = lines[index].match(/^(\s*)File "([^"]*)", line (\d+)(, in .*)?$/);
    if (!frame) { out.push(REMAPPED.test(lines[index]) ? lines[index] : rewrite(lines[index])); index++; continue; }
    let next = index + 1;
    const snippet = [];
    while (next < lines.length && lines[next].trim() && !/^\s+File "/.test(lines[next]) && !CHAIN_ERROR.test(lines[next])) snippet.push(lines[next++]);
    const userLine = at(map, frame[3]);
    if (userLine) {
      out.push(`${frame[1]}File "你的代码", line ${userLine}${frame[4] || ""}`);
      out.push(...snippet);
    }
    index = next;
  }
  return out.join("\n");
}

function remapJava(text, map) {
  const out = [];
  for (const line of text.split("\n")) {
    // 运行时栈帧："\tat Solution.singleNumber(Main.java:6)"
    const frame = line.match(/^(\s*at\s+)([\w.$<>]+)\((?:\w+\.java:)?(\d+)\)$/);
    if (frame) {
      const userLine = at(map, frame[3]);
      if (!userLine) continue; // 框架自己的调用帧，整帧丢掉
      out.push(`${frame[1]}${frame[2]}(你的代码:${userLine})`);
      continue;
    }
    // 编译诊断："/tmp/hot100-run-x/Main.java:6: 错误: 需要';'"
    const diagnostic = line.match(/^(?:.*[/\\])?Main\.java:(\d+)(:.*)$/);
    const userLine = diagnostic ? at(map, diagnostic[1]) : 0;
    out.push(userLine ? `你的代码:${userLine}${diagnostic[2]}` : line);
  }
  return out.join("\n");
}

/**
 * 把运行器原文里的行号换成用户编辑器里的行号。
 * map[i] = 生成源码第 i 行对应的用户行号，0 表示这一行是框架拼的。
 * 认不出格式、或者映射后什么都不剩时，原样返回，绝不吞掉报错。
 */
export function remapErrorLines(text, { language, map } = {}) {
  const raw = typeof text === "string" ? text : "";
  if (!raw || !Array.isArray(map) || !map.length) return raw;
  const remapped = language === "java" ? remapJava(raw, map) : remapPython(raw, map);
  return remapped.trim() ? remapped : raw;
}
