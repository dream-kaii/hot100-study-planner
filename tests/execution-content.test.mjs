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
  assert.deepEqual(contractErrors('160', q => {
    for (const item of q.cases) item.input = { headA: [], headB: [] };
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
