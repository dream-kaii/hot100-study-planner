// 站点身份与外部链接的唯一来源。
//
// 为什么单独抽一个文件：这些值要同时出现在顶栏、页脚、以及将来的空态/关于页，
// 散落在各组件里改一处漏一处。现在只有这一个地方定义。
//
// 与博客的关系：kaii.homes 是主站（Astro），本平台是它的算法练习子域。
// 两边共用同一套图标家族（六边形 + 内芯）与同一组绿色令牌，所以「回主站」是
// 一级导航，不是页脚的装饰链接。
export const BRAND = {
  name: "Hot 100",
  owner: "kaii",
  tagline: "学习工作台",
  // 顶栏brandButton 的第二行。写成「hot100.kaii.homes」而不是「学习工作台」，
  // 是为了让访客一眼知道自己在哪个子域、属于谁。
  host: "hot100.kaii.homes",
};

export const BLOG = {
  name: "kaii.homes",
  url: "https://kaii.homes",
  // 博客的算法学习路线页 —— 「回主站」的默认落点比首页更有上下文：
  // 读者是从那条路线过来的，回去时应该回到路线继续看，而不是落在首页。
  pathUrl: "https://kaii.homes/learning-path/",
};
