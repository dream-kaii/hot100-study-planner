import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (id) => JSON.parse(fs.readFileSync(new URL(`../src/data/solutions/${id}.json`, import.meta.url)));
const contractIds = ['121', '11', '198', '21', '215', '763', '189', '34', '94', '105', '101', '347'];

test('all ordinary examples supply the parameters declared by their execution contract', () => {
  for (const id of contractIds) {
    const q = read(id);
    for (const item of q.cases) for (const param of q.func.params) {
      assert.ok(Object.hasOwn(item.input, param.name), `${id}/${item.id} missing ${param.name}`);
    }
  }
});

test('entry point names agree in the contract and both runnable language solutions', () => {
  for (const [id, method] of Object.entries({189:'rotate',34:'searchRange',94:'inorderTraversal',105:'buildTree',101:'isSymmetric',347:'topKFrequent'})) {
    const q = read(id);
    assert.equal(q.func.methodName, method, id);
    assert.match(q.java, new RegExp(`\\b${method}\\s*\\(`), id);
    assert.match(q.python, new RegExp(`def ${method}\\s*\\(`), id);
  }
});

test('comparison respects the actual result type and meaningful order within results', () => {
  for (const [id, compare] of Object.entries({49:'unordered-nested',128:'exact',41:'exact',238:'exact',79:'exact',17:'unordered-array',22:'unordered-array',46:'unordered-array',51:'unordered-array',131:'unordered-array',5:'any-valid',236:'identity',138:'exact'})) assert.equal(read(id).func.compare, compare, id);
});

test('runnable Java and Python fields contain one Solution implementation', () => {
  for (const id of ['234','739','226','763','198','279','139','1143','239']) {
    const q = read(id);
    assert.equal([...q.java.matchAll(/\bclass\s+Solution\b/g)].length, 1, `${id} Java`);
    assert.equal([...q.python.matchAll(/^class Solution\b/gm)].length, 1, `${id} Python`);
  }
  assert.doesNotMatch(read('142').python, /^（版本/m);
});

test('the repaired source is Java 8 compatible and tree questions use tree algorithms', () => {
  for (const id of ['240','994','207','118']) assert.doesNotMatch(read(id).java, /\bvar\s+\w+|\bList\.of\(/, id);
  for (const id of ['94','105']) {
    assert.doesNotMatch(read(id).java, /\bclass Main\b|\bclass Edge\b/);
    assert.match(read(id).java, /TreeNode/);
    assert.match(read(id).python, /TreeNode/);
  }
});

test('island grids are actual rectangular character matrices', () => {
  for (const item of read('200').cases) {
    assert.ok(Array.isArray(item.input.grid), item.id);
    assert.ok(item.input.grid.every(row => Array.isArray(row) && row.length === item.input.grid[0].length && row.every(x => x === '0' || x === '1')), item.id);
  }
});

test('repaired examples contain distinct basic, boundary and adversarial inputs', () => {
  for (const id of [...contractIds, '234','739','226','279','139','1143','239','240','994','207','118','200','283','1','206','146','49','128','41','238','79','17','22','46','51','131','5','138','142','160','236']) {
    const q = read(id);
    assert.ok(q.cases.length >= 3, id);
    assert.ok(new Set(q.cases.map(x => JSON.stringify(x.input))).size >= 3, `${id} duplicate inputs`);
  }
});

test('every one of the 100 questions has pairwise-distinct case inputs', () => {
  // #136「只出现一次的数字」暴露过的问题：100 道题里有 56 道的 boundary / adversarial
  // 用例直接复制了 basic 的输入，甚至三个用例输入完全一样，正确答案也同为 1，
  // 跑起来三行结果一模一样 —— 用户看到的就是「运行实例都是重复运行」。
  // 根因是批量生成用例时没为每道题单独设计输入，而旧测试只盯着一张手写名单（44 题），
  // #136 恰好不在名单里，所以一路绿灯。
  // 这道闸门覆盖全部 100 题，任何一题退化成重复用例都会立刻失败。
  const dir = new URL('../src/data/solutions/', import.meta.url);
  const files = fs.readdirSync(dir).filter(name => name.endsWith('.json'));
  assert.equal(files.length, 100);

  const offenders = [];
  for (const file of files) {
    const id = file.replace(/\.json$/, '');
    const q = JSON.parse(fs.readFileSync(new URL(file, dir)));
    const signatures = (q.cases || []).map(item => stableSignature(item.input));
    const unique = new Set(signatures);
    if (unique.size !== signatures.length) {
      const dupes = signatures.filter((sig, index) => signatures.indexOf(sig) !== index).length;
      offenders.push(`${id}（${q.cases.length} 个用例里有 ${dupes} 个重复输入）`);
    }
    // 三个用例若连期望值都全同，答案也失去区分度，视为同一路信号。
    const expectations = (q.cases || []).map(item => stableSignature(item.expected));
    if (new Set(expectations).size === 1 && expectations.length > 1) {
      offenders.push(`${id}（所有用例期望值都是 ${JSON.stringify(q.cases[0].expected)}，没有区分度）`);
    }
  }
  assert.deepEqual(offenders, [], `存在重复用例：\n${offenders.join('\n')}`);
});

/** 键排序后的稳定序列化，判断两个用例输入/期望是否等价（与字段顺序无关）。 */
function stableSignature(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
  if (Array.isArray(value)) return `[${value.map(stableSignature).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map(key => `${JSON.stringify(key)}:${stableSignature(value[key])}`).join(',')}}`;
}

test('node identity and deep-copy expectations are structured machine-readable values', () => {
  for (const id of ['142','160','236']) for (const item of read(id).cases) {
    assert.ok(Object.hasOwn(item.expected, 'id'), `${id}/${item.id}`);
    assert.ok(item.expected.id === null || typeof item.expected.id === 'string');
  }
  for (const item of read('138').cases) {
    assert.ok(Array.isArray(item.expected.nodes));
    assert.equal(item.expected.independent, true);
  }
});

const { loadContent, validateContent } = await import('../scripts/validate-schema.mjs');
function contractErrors(id, mutate) {
  const content = loadContent();
  mutate(content.solutions.find(solution => solution.id === id));
  return validateContent(content).filter(error => error.startsWith(`${id}.`));
}

test('schema validator rejects entry names that are absent from Java or Python declarations', () => {
  assert.ok(contractErrors('283', q => { q.func.methodName = 'missingEntry'; }).some(error => error.startsWith('283.func.methodName:')));
  assert.ok(contractErrors('283', q => { q.python = q.python.replace('def moveZeroes(', 'def otherEntry('); }).some(error => error.startsWith('283.func.methodName:')));
});

test('schema validator requires valid named and typed parameters and matching Java return types', () => {
  for (const field of ['name', 'type']) assert.ok(contractErrors('283', q => { delete q.func.params[0][field]; }).some(error => error.startsWith(`283.func.params[0].${field}:`)), field);
  assert.ok(contractErrors('283', q => { q.func.params[0].name = 'bad-name'; }).some(error => error.startsWith('283.func.params[0].name:')));
  assert.ok(contractErrors('283', q => { q.func.params[0].name = ['nums']; }).some(error => error.startsWith('283.func.params[0].name:')));
  assert.ok(contractErrors('283', q => { q.func.params[0].type = 'UnknownType'; }).some(error => error.startsWith('283.func.params[0].type:')));
  assert.ok(contractErrors('283', q => { q.func.returns = 'int'; }).some(error => error.startsWith('283.func.returns:')));
  assert.ok(contractErrors('283', q => { q.func.params[0].type = 'String[]'; }).some(error => error.startsWith('283.func.params[0].type:')));
});

test('schema validator checks actual method parameter names in both languages', () => {
  assert.ok(contractErrors('283', q => { q.java = q.java.replace('int[] nums', 'int[] values'); }).some(error => error.startsWith('283.func.params[0].name:')));
  assert.ok(contractErrors('283', q => { q.python = q.python.replace('nums:', 'values:'); }).some(error => error.startsWith('283.func.params[0].name:')));
});

test('schema validator rejects missing ordinary input parameters and repeated Solution classes', () => {
  assert.ok(contractErrors('121', q => { delete q.cases[0].input.prices; }).some(error => error.startsWith('121.cases[0].input.prices:')));
  assert.ok(contractErrors('283', q => { q.java = `class Solution { ${q.java} }\nclass Solution {}`; }).some(error => error.startsWith('283.func.className:')));
});

test('schema validator requires the declared owner class but accepts runnable method fragments', () => {
  assert.ok(contractErrors('189', q => { q.func.className = 'WrongOwner'; }).some(error => error.startsWith('189.func.className:')));
  assert.ok(contractErrors('283', q => { q.func.className = ['Solution']; }).some(error => error.startsWith('283.func.className:')));
  assert.deepEqual(contractErrors('283', q => {
    q.java = 'public void moveZeroes(int[] nums) {}';
    q.python = 'def moveZeroes(self, nums):\n    pass';
  }), []);
});

test('schema validator ignores signatures in comments or strings and checks the entry rather than helpers', () => {
  assert.ok(contractErrors('283', q => {
    q.java = 'class Solution { String sample = "public void moveZeroes(int[] nums) {}"; /* public void moveZeroes(int[] nums) {} */ }';
  }).some(error => error.startsWith('283.func.methodName:')));
  assert.deepEqual(contractErrors('189', q => {
    q.java = '// void rotate(String[] wrong) {}\n' + q.java;
    q.python = '# def rotate(self, wrong):\n' + q.python;
  }), []);
});

test('schema validator accepts the real 100 contracts, operation sequences and special node input protocols', () => {
  assert.deepEqual(validateContent(loadContent()), []);
  assert.deepEqual(contractErrors('160', () => {}), []);
  // 空链表协议合法。注意三个用例的输入必须互不相同 —— 用例唯一性是硬约束，
  // 曾经用「三个都用 {headA:[],headB:[]}」来写这个断言，会撞上新加的唯一性闸门。
  // 这里改成三种不同的空/单边空组合，覆盖面更足，也仍然全部合法。
  assert.deepEqual(contractErrors('160', q => {
    const empties = [
      { headA: [], headB: [] },
      { headA: [], headB: [1] },
      { headA: [1], headB: [] }
    ];
    q.cases.forEach((item, index) => { item.input = empties[index]; });
  }), []);
  assert.deepEqual(contractErrors('141', () => {}), []);
  assert.deepEqual(contractErrors('146', () => {}), []);
});

test('operation-sequence contracts require complete constructor and method signatures', () => {
  for (const field of ['constructorParams', 'methods']) assert.ok(contractErrors('146', q => {
    delete q.func.constructorParams;
    delete q.func.methods;
  }).some(error => error.startsWith(`146.func.${field}:`)), field);
});

test('method fragments may include helper node classes but entries inside the wrong owner are rejected', () => {
  assert.deepEqual(contractErrors('283', q => {
    q.java = 'class ListNode { int val; ListNode next; }\n' + q.java;
    q.python = 'class ListNode:\n    pass\n\n' + q.python;
  }), []);
  assert.ok(contractErrors('283', q => {
    q.java = `class Wrong { ${q.java} }`;
  }).some(error => error.startsWith('283.func.className:')));
  assert.ok(contractErrors('283', q => {
    q.python = 'class Wrong:\n' + q.python.split('\n').map(line => '    ' + line).join('\n');
  }).some(error => error.startsWith('283.func.className:')));
});

test('schema validator rejects generic variadic parameters in executable solution code', () => {
  assert.ok(contractErrors('283', q => { q.java = 'class Solution { public void moveZeroes(Object... args) {} }'; }).some(error => error.startsWith('283.java:')));
  assert.ok(contractErrors('283', q => { q.python = 'class Solution:\n    def moveZeroes(self, *args):\n        pass'; }).some(error => error.startsWith('283.python:')));
});

test('representative solution contracts remain the single callable source', () => {
  const content = loadContent();
  const expected = {
    '283': ['Solution', 'moveZeroes', ['nums'], 'void', 'in-place-mutate'],
    '1': ['Solution', 'twoSum', ['nums', 'target'], 'int[]', 'unordered-array'],
    '206': ['Solution', 'reverseList', ['head'], 'ListNode', 'exact'],
    '146': ['LRUCache', 'get', ['key'], 'int', 'operation-sequence'],
    '200': ['Solution', 'numIslands', ['grid'], 'int', 'exact'],
    '102': ['Solution', 'levelOrder', ['root'], 'List<List<Integer>>', 'exact'],
    '739': ['Solution', 'dailyTemperatures', ['temperatures'], 'int[]', 'exact'],
    '322': ['Solution', 'coinChange', ['coins', 'amount'], 'int', 'exact']
  };
  for (const [id, [className, methodName, params, returns, compare]] of Object.entries(expected)) {
    const func = content.solutions.find(solution => solution.id === id)?.func;
    assert.deepEqual([func.className, func.methodName, func.params.map(param => param.name), func.returns, func.compare], [className, methodName, params, returns, compare], id);
  }
  assert.deepEqual(validateContent(content), []);
});
