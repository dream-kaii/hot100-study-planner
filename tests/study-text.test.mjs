import test from 'node:test';
import assert from 'node:assert/strict';
import { loadContent, validateContent } from '../scripts/validate-schema.mjs';

const textModule = await import('../src/services/study-text.js').catch(() => ({}));

test('普通文字去公式标记、HTML、重复句和空段落', () => {
  assert.equal(typeof textModule.normalizeStudyText, 'function');
  const actual = textModule.normalizeStudyText('　<p>时间 $O(n^2)$，用 \\textit{nums}。</p>\n\n　\n\n时间 $O(n^2)$，用 \\textit{nums}。。');
  assert.equal(actual, '时间 O(n²)，用 nums。');
  assert.equal(textModule.normalizeFormulaText('$2\\times 10^{5}, x \\le n, y \\ge 0, \\lfloor n/2 \\rfloor, \\lceil n/2 \\rceil$'), '2×10⁵, x ≤ n, y ≥ 0, ⌊n/2⌋, ⌈n/2⌉');
  assert.equal(textModule.normalizeFormulaText('$\\unknown{x}$').includes('\\'), false);
  assert.deepEqual(textModule.splitStudyParagraphs(' 第一段。\n \n\n\n第二段。\n\n'), ['第一段。', '第二段。']);
});

test('只清理说明字段，代码和第四级伪代码逐字保留', () => {
  assert.equal(typeof textModule.normalizeStudySolution, 'function');
  const code = '  def f():\n    print("$x\\\\y")\n\n\n    return 1\n';
  const pseudocode = '遍历每个值：\n    若值不是 0：\n        写入下一位置\n\n返回数组';
  const input = { description: '　$O(n^2)$。。 ', java: code, python: code, func: { methodName: '$x' }, cases: [{ input: { s: '$x' } }], hints: [{ level: 1, text: '　$text$。。' }, { level: 4, text: pseudocode }], complexity: { time: '$O(n^2)$' }, sources: [{ url: 'https://a/$x', label: '链接' }] };
  const result = textModule.normalizeStudySolution(input);
  assert.equal(result.description, 'O(n²)。');
  assert.equal(result.java, code);
  assert.equal(result.python, code);
  assert.equal(result.hints[1].text, pseudocode);
  assert.deepEqual(result.func, input.func);
  assert.deepEqual(result.cases, input.cases);
  assert.deepEqual(result.sources, input.sources);
  assert.equal(input.description, '　$O(n^2)$。。 ');
});

test('验证器定位普通字段里的坏格式和泛化模板', () => {
  const content = loadContent();
  for (const [field, bad] of [
    ['description', '$O(n)$'], ['explanation', '\\textit{n}'], ['thinking', '\\times'],
    ['recognition', '重复。。'], ['summaryText', '本题总结：结合题目约束选择合适的数据结构和算法，并检查边界条件。'],
    ['correctness', '第一段\n\n\n\n第二段'],
  ]) {
    const copy = structuredClone(content); copy.solutions[0][field] = bad;
    assert.ok(validateContent(copy).some(error => error.startsWith(`${copy.solutions[0].id}.${field}:`)), field);
  }
  const copy = structuredClone(content);
  copy.solutions[0].hints[1].text = '先按输入顺序推进指针或状态，记录数组的关键变化；发现约束不满足时只修正受影响的部分。';
  assert.ok(validateContent(copy).some(error => error.includes(`${copy.solutions[0].id}.hints[1].text`)));
  copy.solutions[0].python = '反转链表 - 力扣题解\ndef solve():\n    pass';
  assert.ok(validateContent(copy).some(error => error.includes(`${copy.solutions[0].id}.python`)));
});

test('验证器拒绝操作序列签名和参数数量不符', () => {
  const content = loadContent();
  for (const mutate of [
    s => { s.func.constructorParams = 'bad'; },
    s => { s.func.methods[0].params = [{ name: 'key' }]; },
    s => { s.cases[0].input.operations[1] = 'unknown'; },
    s => { s.cases[0].input.arguments.pop(); },
    s => { s.cases[0].input.arguments[0] = []; },
    s => { s.cases[0].input.arguments[1] = ['不是整数', 1]; },
    s => { s.cases[0].input.operations[0] = 'WrongClass'; },
  ]) {
    const copy = structuredClone(content); const solution = copy.solutions.find(s => s.id === '146'); mutate(solution);
    assert.ok(validateContent(copy).some(error => error.startsWith('146.func') || error.startsWith('146.cases')), String(mutate));
  }
});

test('100题分级提示包含完整思路和多行具体伪代码', () => {
  for (const solution of loadContent().solutions) {
    assert.equal(solution.hints.length, 4, solution.id);
    assert.ok(solution.hints[2].text.length >= 55, `${solution.id} 第三级需完整思路`);
    assert.ok(solution.hints[3].text.split('\n').length >= 5, `${solution.id} 第四级需详细多行伪代码`);
    assert.match(solution.hints[3].text, /\n {2,}\S/, `${solution.id} 伪代码缩进`);
  }
});

test('复杂公式降级为可读文字，比较运算不误当HTML标签', () => {
  assert.equal(textModule.normalizeStudyText('$2^{n\\times 2}$'), '2^(n×2)');
  assert.equal(textModule.normalizeStudyText('\\begin{cases}\na, & if x\\\\\nb, & if y\n\\end{cases}'), 'a, if x\nb, if y');
  assert.equal(textModule.normalizeStudyText('条件 x<n 且 y>0。'), '条件 x<n 且 y>0。');
});

test('对100题执行清理不改变代码、输入输出和引用结构', () => {
  for (const solution of loadContent().solutions) {
    const result = textModule.normalizeStudySolution(solution);
    for (const field of ['java', 'python', 'func', 'cases', 'sources']) assert.deepEqual(result[field], solution[field], `${solution.id}.${field}`);
    for (const [index, example] of (solution.examples || []).entries()) {
      assert.equal(result.examples[index].input, example.input, `${solution.id}.examples[${index}].input`);
      assert.equal(result.examples[index].output, example.output, `${solution.id}.examples[${index}].output`);
    }
    assert.equal(result.hints[3].text, solution.hints[3].text, `${solution.id}.hints[3]`);
  }
});

test('验证器拦截旧第三级拼接和裸文章小标题，允许中文代码注释', () => {
  const content = loadContent();
  const heading = structuredClone(content);
  heading.solutions[0].java = '方法一：哈希表\nclass Solution {}';
  assert.ok(validateContent(heading).some(error => error.startsWith(`${heading.solutions[0].id}.java:`)));
  const comments = structuredClone(content);
  comments.solutions[0].java = '// 方法一：哈希表\n/*\n方法一：哈希表\n*/\nclass Solution {}';
  comments.solutions[0].python = '# 这是中文算法说明\n"""\n方法一：哈希表\n"""\nclass Solution:\n    pass';
  assert.ok(!validateContent(comments).some(error => /\.(java|python):/.test(error)));
  const duplicate = structuredClone(content);
  const detail = '维护哈希表中的历史下标以查找当前值所需的另一个数';
  duplicate.solutions[0].hints[2].text = `可以使用${detail}：${detail}。`;
  assert.ok(validateContent(duplicate).some(error => error.includes(`${duplicate.solutions[0].id}.hints[2].text`)));
});

test('验证器拒绝带括号的版本与方法标题，保留合法代码和中文注释', () => {
  const content = loadContent();
  for (const title of ['（版本一）双指针法', '(版本一)双指针法', '（方法一）双指针法', '(方法一)双指针法']) {
    const copy = structuredClone(content);
    const solution = copy.solutions.find(item => item.id === '206');
    solution.python = `${title}\n${solution.python}`;
    assert.ok(validateContent(copy).some(error => error.startsWith('206.python:')), title);
  }
  const copy = structuredClone(content);
  const solution = copy.solutions.find(item => item.id === '206');
  solution.python = `# （版本一）双指针法\n"""\n（方法一）双指针法\n"""\n${solution.python}`;
  solution.java = `// （版本一）双指针法\n/*\n（方法一）双指针法\n*/\n${solution.java}`;
  assert.ok(!validateContent(copy).some(error => /^206\.(?:python|java):/.test(error)));
});
