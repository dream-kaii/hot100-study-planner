// SiteFooter —— 站点归属页脚。
//
// 只做身份与出口，不参与做题流程：两列 —— 左边「谁做的站」，右边「去哪」。
// 为什么要有它：这是一个独立子域，从博客点进来的人需要一条明确的回去路径，
// 也需要知道这个工具是同一个人的。（顶栏那条「回 kaii.homes」在窄屏会被挤，
// 页脚是兜底。）
//
// 刻意不做的事：
//   - 不放版本号 / 构建时间：每次部署都变，没有信息价值
//   - 不放备案 / 版权年份以外的法务文本：这是个人工具站
import BrandIcon from "./BrandIcon.jsx";
import { BRAND, BLOG } from "../brand.js";

export default function SiteFooter() {
  return (
    <footer className="siteFooter">
      <div className="footBrand">
        <BrandIcon size={18} />
        <span>
          <b>{BRAND.name}</b> · {BRAND.tagline}
          <br />
          by <a href={BLOG.url} target="_blank" rel="noopener noreferrer">{BRAND.owner}</a>
          {" "}· 数据只在你自己的浏览器里
        </span>
      </div>
      <div className="footLinks">
        <a href={BLOG.url} target="_blank" rel="noopener noreferrer">主站 {BLOG.name}</a>
        <a href={BLOG.pathUrl} target="_blank" rel="noopener noreferrer">算法学习路线</a>
      </div>
    </footer>
  );
}
