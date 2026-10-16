import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

async function loadProgressiveSolution() {
  const vite = await createServer({ root: process.cwd(), server: { middlewareMode: true, hmr: false, ws: false }, appType: "custom" });
  const module = await vite.ssrLoadModule("/src/components/ProgressiveSolution.jsx");
  return { Component: module.default, close: () => vite.close() };
}

test("ProgressiveSolution renders five ordered disclosure groups with recognition open", async () => {
  const { Component, close } = await loadProgressiveSolution();
  try {
    const html = renderToStaticMarkup(React.createElement(Component, {
      question: { id: "1", title: "两数之和" },
      solution: {
        learningGoal: "理解查找关系",
        thinking: "先枚举，再用映射降低查找成本。",
        steps: ["遍历数组", "查询互补值"],
        walkthrough: ["当前值为 2，互补值为 7。"],
        correctness: "每个元素只在遍历时被处理一次。",
        complexity: { time: "O(n)", space: "O(n)" },
        pitfalls: ["不要重复使用同一个下标。"],
        summaryText: "把查找关系和下标保存起来。",
        tables: [{ headers: ["结构"], rows: [["HashMap"]] }],
        java: "class Solution {}",
        python: "class Solution:\n    pass",
        sources: { explanation: { label: "题解来源", url: "https://example.com/solution" } },
        images: [{ alt: "变量演练", url: "/missing.png" }]
      },
      language: "python",
      onLanguageChange: () => {},
      onViewCode: () => {},
      onJumpToEditor: () => {}
    }));
    const labels = ["这道题在考什么", "思路方向", "完整步骤与变量演练", "正确性、复杂度和易错点", "Java/Python 参考代码"];
    const positions = labels.map((label) => html.indexOf(label));
    assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
    assert.equal((html.match(/<details/g) || []).length, 5);
    assert.match(html, /<details[^>]* open="">/);
    assert.equal((html.match(/ open=""/g) || []).length, 1);
    assert.match(html, /class Solution:/);
    assert.match(html, /HashMap/);
    assert.match(html, /把查找关系和下标保存起来/);
    assert.match(html, /题解来源/);
    assert.match(html, /imageFallback/);
  } finally {
    await close();
  }
});

test("ProgressiveSolution records each code disclosure opening with the active language", async () => {
  const { Component, close } = await loadProgressiveSolution();
  try {
    const viewed = [];
    const tree = Component({ question: { title: "题目" }, solution: { python: "pass" }, language: "java", onViewCode: (event) => viewed.push(event) });
    const details = tree.props.children.filter((child) => child?.type === "details");
    details[4].props.onToggle({ currentTarget: { open: true } });
    details[4].props.onToggle({ currentTarget: { open: true } });
    details[4].props.onToggle({ currentTarget: { open: false } });
    assert.equal(viewed.length, 2);
    assert.equal(viewed[0].language, "java");
    assert.match(viewed[0].viewedAt, /^\d{4}-\d{2}-\d{2}T/);
  } finally {
    await close();
  }
});

test("ProgressiveSolution keeps working when new solution fields are absent", async () => {
  const { Component, close } = await loadProgressiveSolution();
  try {
    const html = renderToStaticMarkup(React.createElement(Component, {
      question: { id: "2", title: "旧题解" },
      solution: { thinking: "旧字段思路", python: "print(1)" },
      language: "java",
      onLanguageChange: () => {},
      onViewCode: () => {},
      onJumpToEditor: () => {}
    }));
    assert.match(html, /旧字段思路/);
    assert.match(html, /暂无可用的完整步骤/);
    assert.match(html, /暂无来源链接/);
    assert.match(html, /暂无 java 参考代码/);
  } finally {
    await close();
  }
});

test("ProgressiveSolution defaults to Java reference code", async () => {
  const { Component, close } = await loadProgressiveSolution();
  try {
    const html = renderToStaticMarkup(React.createElement(Component, {
      question: { id: "3", title: "默认语言" },
      solution: { java: "class Solution {}", python: "class Solution: pass" },
      onLanguageChange: () => {}
    }));
    assert.match(html, /class Solution \{\}/);
    assert.match(html, /当前语言：Java/);
  } finally {
    await close();
  }
});
