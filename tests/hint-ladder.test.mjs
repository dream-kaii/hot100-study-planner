import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

async function loadHintLadder() {
  const vite = await createServer({ root: process.cwd(), server: { middlewareMode: true, hmr: false, ws: false }, appType: "custom" });
  const module = await vite.ssrLoadModule("/src/components/HintLadder.jsx");
  return { Component: module.default, close: () => vite.close() };
}

test("HintLadder renders only unlocked hints and requests the next available level", async () => {
  const { Component, close } = await loadHintLadder();
  try {
    const html = renderToStaticMarkup(React.createElement(Component, {
      hints: [
        { level: 1, text: "先观察输入和输出。" },
        { level: 3, text: "维护一个从值到位置的映射。" }
      ],
      hintsUsed: 1,
      onRequestHint: () => {},
      className: "compact"
    }));
    assert.match(html, /先观察输入和输出/);
    assert.doesNotMatch(html, /维护一个从值到位置/);
    assert.match(html, /我要提示（第 3 级）/);
    assert.match(html, /第 1 级提示/);
    assert.match(html, /提示阶梯/);
  } finally {
    await close();
  }
});

test("HintLadder marks pseudocode as non-code and stops at level four", async () => {
  const { Component, close } = await loadHintLadder();
  try {
    const html = renderToStaticMarkup(React.createElement(Component, {
      hints: [
        { level: 1, text: "方向" },
        { level: 2, text: "动作" },
        { level: 3, text: "步骤" },
        { level: 4, text: "遍历 -> 查询 -> 返回" }
      ],
      hintsUsed: 4,
      onRequestHint: () => {}
    }));
    assert.match(html, /hintPseudocode/);
    assert.match(html, /伪代码提示/);
    assert.match(html, /再想不出来就看题解/);
    assert.doesNotMatch(html, /我要提示/);
  } finally {
    await close();
  }
});

test("HintLadder emits only the next level from an explicit button click", async () => {
  const { Component, close } = await loadHintLadder();
  try {
    const requested = [];
    const tree = Component({ hints: [{ level: 1, text: "方向" }, { level: 3, text: "步骤" }], hintsUsed: 1, onRequestHint: (level) => requested.push(level) });
    const button = tree.props.children.find((child) => child?.type === "button");
    assert.equal(requested.length, 0);
    button.props.onClick();
    assert.deepEqual(requested, [3]);
  } finally {
    await close();
  }
});

test("HintLadder assigns compatible levels when an old hint has no level field", async () => {
  const { Component, close } = await loadHintLadder();
  try {
    const tree = Component({ hints: [{ text: "旧版第一层" }, { level: 3, text: "第三层" }], hintsUsed: 1 });
    const list = tree.props.children.find((child) => child?.props?.className === "hintList");
    assert.match(list.props.children[0].props.children[0].props["aria-label"], /第 1 级提示/);
  } finally {
    await close();
  }
});
