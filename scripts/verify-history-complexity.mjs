// 运行：HOT100_PLAYWRIGHT_MODULE=/绝对路径/playwright/index.mjs node scripts/verify-history-complexity.mjs
import assert from "node:assert/strict";
const { chromium } = await import(process.env.HOT100_PLAYWRIGHT_MODULE || "playwright");
const base = process.env.HOT100_DEV_URL || "http://127.0.0.1:5173";
const { default: hot100 } = await import("../src/data/hot100.json", { with: { type: "json" } });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ["clipboard-read", "clipboard-write"] });
const page = await context.newPage();
const modifier = process.platform === "darwin" ? "Meta" : "Control";
const state = () => page.evaluate(() => JSON.parse(localStorage.getItem("hot100-study-planner-v3") || "{}"));
async function paste(code) { await page.evaluate((text) => navigator.clipboard.writeText(text), code); await page.locator(".monaco-editor").click({ position: { x: 110, y: 30 } }); await page.keyboard.press(`${modifier}+A`); await page.keyboard.press(`${modifier}+V`); await page.waitForTimeout(300); }
async function run() { const response = page.waitForResponse((r) => r.url().endsWith("/__runner") && r.request().method() === "POST"); await page.getByRole("button", { name: "运行公开示例", exact: true }).click(); return response.then((r) => r.json()); }
try {
  const history = Array.from({ length: 100 }, (_, index) => ({ id: `h-${index}`, questionId: String((index % 100) + 1), language: "java", mode: "function", outcome: index % 2 ? "failed" : "independent", hintsUsed: 0, viewedSolutionCode: false, caseId: `case-${index}`, durationMs: 50, createdAt: `2026-10-16T00:${String(index).padStart(2, "0")}:00.000Z` }));
  await page.goto(base);
  await page.evaluate((history) => { localStorage.clear(); localStorage.setItem("hot100-study-planner-v3", JSON.stringify({ version: 3, profile: { dailyMinutes: 90, dailyNewLimit: 1, defaultLanguage: "java" }, progress: {}, drafts: {}, notes: {}, history, settings: {}, updatedAt: new Date().toISOString() })); }, history);
  await page.reload({ waitUntil: "networkidle" });
  const visible = await page.locator(".timelineRow").count();
  assert.ok(visible <= 8, `desktop recent count ${visible}`);
  assert.match(await page.locator(".timelineSummary").innerText(), /最近练习/);
  await page.getByRole("button", { name: "失败", exact: true }).click();
  assert.ok((await page.locator(".timelineRow").allTextContents()).every((text) => text.includes("运行失败")));
  await page.getByRole("button", { name: "全部", exact: true }).click();
  if (await page.getByRole("button", { name: "查看更多", exact: true }).count()) { await page.getByRole("button", { name: "查看更多", exact: true }).click(); assert.ok((await page.locator(".timelineRow").count()) > visible); }
  await page.setViewportSize({ width: 390, height: 844 }); await page.reload({ waitUntil: "networkidle" }); const mobileTimeline = await page.locator(".timelineRow").count(); assert.ok(mobileTimeline > 0 && mobileTimeline <= 5, `mobile timeline ${mobileTimeline}`);

  await page.setViewportSize({ width: 1440, height: 900 }); await page.goto(`${base}/?question=283`, { waitUntil: "networkidle" }); await page.locator(".monaco-editor").waitFor();
  const quadratic = `class Solution:\n    def moveZeroes(self, nums):\n        for i in nums:\n            for j in nums:\n                pass\n        nums[:] = nums\n`;
  await page.getByRole("tab", { name: "Python", exact: true }).click(); await paste(quadratic); const bad = await run(); assert.ok(["passed", "failed"].includes(bad.status)); assert.match(await page.locator(".complexityPanel").innerText(), /O\(n²\)|可能不满足/);
  const linear = `class Solution:\n    def moveZeroes(self, nums):\n        write = 0\n        for value in nums:\n            if value != 0:\n                nums[write] = value\n                write += 1\n        while write < len(nums):\n            nums[write] = 0\n            write += 1\n`;
  await paste(linear); const good = await run(); assert.equal(good.status, "passed"); assert.match(await page.locator(".complexityPanel").innerText(), /O\(n\)|可能满足/);
  assert.match(await page.locator(".complexityPanel").innerText(), /静态启发式估计/);

  const saved = await state(); assert.ok(["completed", "reviewing"].includes(saved.progress?.["283"]?.status));
  await page.getByRole("tab", { name: "题解", exact: true }).click(); assert.ok(await page.locator(".questionHistory").count());
  console.log(JSON.stringify({ desktopTimeline: visible, mobileTimeline, bad: bad.status, good: good.status, historyRows: await page.locator(".questionHistoryRow").count() }, null, 2));
} finally { await browser.close(); }
