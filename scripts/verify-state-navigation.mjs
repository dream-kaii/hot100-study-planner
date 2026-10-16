// 运行：HOT100_PLAYWRIGHT_MODULE=/绝对路径/playwright/index.mjs node scripts/verify-state-navigation.mjs
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.HOT100_PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.HOT100_DEV_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
const page = await context.newPage();
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
const state = () => page.evaluate(() => JSON.parse(localStorage.getItem('hot100-study-planner-v3') || '{}'));
async function paste(code) {
  await page.evaluate(text => navigator.clipboard.writeText(text), code);
  await page.locator('.monaco-editor').click({ position: { x: 110, y: 30 } });
  await page.keyboard.press(`${modifier}+A`);
  await page.keyboard.press(`${modifier}+V`);
  await page.waitForTimeout(350);
}
async function run() {
  const response = page.waitForResponse(request => request.url().endsWith('/__runner') && request.request().method() === 'POST');
  await page.getByRole('button', { name: '运行公开示例', exact: true }).click();
  return response.then(async request => request.json());
}
try {
  await page.goto(`${base}/?question=283`, { waitUntil: 'networkidle' });
  await page.locator('.monaco-editor').waitFor();
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('.monaco-editor').waitFor();
  await paste('class Solution { public void moveZeroes(int[] nums) { missingSymbol(); } }');
  assert.equal((await run()).status, 'failed');
  await paste('class Solution { public void moveZeroes(int[] nums) { int w=0; for(int n:nums) if(n!=0) nums[w++]=n; while(w<nums.length) nums[w++]=0; } }');
  assert.equal((await run()).status, 'passed');
  let saved = await state();
  const events = saved.history.filter(event => event.questionId === '283' && ['failed', 'independent'].includes(event.outcome));
  assert.deepEqual(events.map(event => event.outcome), ['failed', 'independent']);
  assert.notEqual(events[0].attemptId, events[1].attemptId);
  assert.equal(saved.progress['283'].status, 'completed');
  assert.ok(saved.progress['283'].reviewAt);
  await page.reload({ waitUntil: 'networkidle' });
  saved = await state();
  assert.equal(saved.progress['283'].status, 'completed');
  await page.getByRole('button', { name: '错题复习', exact: true }).click();
  assert.doesNotMatch(await page.locator('body').innerText(), /移动零/);
  await page.goto(`${base}/?question=283`, { waitUntil: 'networkidle' });
  await page.locator('.monaco-editor').waitFor();
  assert.equal(await page.getByRole('button', { name: /上一题/ }).isDisabled(), true);
  await page.getByRole('button', { name: '下一题 →', exact: true }).click();
  await page.locator('.monaco-editor').waitFor();
  assert.match(page.url(), /question=1/);
  assert.equal(await page.getByRole('button', { name: /上一题/ }).isDisabled(), false);
  await page.goto(`${base}/?question=4`, { waitUntil: 'networkidle' });
  await page.locator('.monaco-editor').waitFor();
  assert.equal(await page.getByRole('button', { name: '下一题 →', exact: true }).isDisabled(), true);
  console.log(JSON.stringify({ attempts: events.map(event => ({ outcome: event.outcome, attemptId: event.attemptId })), status: saved.progress['283'].status, first: '283', next: '1', last: '4' }, null, 2));
} finally {
  await browser.close();
}
