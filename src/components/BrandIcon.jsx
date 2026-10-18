// BrandIcon —— 顶栏品牌方块里的图标。
//
// 为什么是独立组件而不是内联在 main.jsx：同一份图形要出现在三个地方
// （顶栏 34px 方块、将来可能的空态页、以及 public/favicon.svg 的视觉同源），
// 抽成一个组件后只有这一处定义，改一次三处同步。
//
// 图形与 public/favicon.svg 逐字同源（只把底色的圆角矩形交给 CSS 的 .brandMark，
// 这里只画六边形 + 对勾，viewBox 与描边粗细完全一致）：
//   - 六边形路径 M16 6.5… 与博客 kaii.homes 的 favicon 完全相同
//   - 内芯是「对勾」而不是「H」：32px 下 H 的三条笔画会糊成一坨（实测 16px 不可辨）
//
// 颜色用 currentColor 以外的固定值，是因为它必须在绿底方块上始终是浅绿，
// 不跟随文字颜色变化（顶栏 hover / active 会改 color）。
export default function BrandIcon({ size = 22 }) {
  return (
    <span className="brandMark" aria-hidden="true">
      <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
        <path
          d="M16 6.5l8 4.5v9L16 24.5 8 20v-9l8-4.5z"
          stroke="#B5CA4D"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <path
          d="M12.4 16.3l2.8 2.8 5.2-5.8"
          stroke="#B5CA4D"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
