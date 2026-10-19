// 状态文案与规范值之间的唯一映射。
//
// 之前这套映射在 main.jsx / ProblemDetail.jsx / ProblemCard.jsx / Mistakes.jsx /
// storage.js 里各写了一份，五份内容还不完全一致 —— 这是「统计显示 1 道错题、
// 题库筛出 0 条」的直接原因。现在只留这一份。

export const STATUS_VALUES = ["new", "in-progress", "completed", "reviewing", "due", "mastered"];

const CANONICAL = {
  未开始: "new",
  思考中: "in-progress",
  学习中: "in-progress",
  已完成: "completed",
  错题: "reviewing",
  待复习: "due",
  已掌握: "mastered",
  已稳固: "mastered",
  new: "new",
  "in-progress": "in-progress",
  completed: "completed",
  reviewing: "reviewing",
  due: "due",
  mastered: "mastered",
  failed: "reviewing"
};

const LABEL = {
  new: "未开始",
  "in-progress": "思考中",
  completed: "已完成",
  reviewing: "错题",
  due: "待复习",
  mastered: "已掌握"
};

export function canonicalStatus(value) {
  return CANONICAL[value] || "new";
}

export function statusLabel(value) {
  return LABEL[canonicalStatus(value)] || "未开始";
}

// 手动状态按钮的展示顺序与文案。
// 注意「错题」和「待复习」现在是两个独立状态，点了会立刻生效。
export const STATUS_BUTTONS = [
  { canonical: "in-progress", label: "思考中" },
  { canonical: "completed", label: "已完成" },
  { canonical: "reviewing", label: "错题" },
  { canonical: "due", label: "待复习" },
  { canonical: "mastered", label: "已掌握" }
];

export const STATUS_FILTER_OPTIONS = ["全部", "未开始", "思考中", "已完成", "错题", "待复习", "已掌握"];
