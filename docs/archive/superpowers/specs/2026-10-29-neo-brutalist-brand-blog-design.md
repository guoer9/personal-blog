# Neo-Brutalist Personal Brand Blog Design

## Intent

把现有的通用博客模板改造成一个有明确个人识别度的技术品牌站：首屏先回答“我是谁、做什么、正在做什么”，随后用作品、文章和资源证明能力。视觉上向 Awwwards 上成熟的个人作品集和实验型站点致敬，但使用原创代码、原创文案和可替换的本地内容，不复制具体站点的源码或受保护素材。

## Goals

- 让个人身份、技术方向和代表作品在首屏可见。
- 用作品卡片展示结果、技术栈和链接，而不是堆一排普通白色卡片。
- 让文章和资源成为可扫描的编辑列表，支持长期积累。
- 在 390px 移动视口下保持品牌名、导航和主要操作完整可用。
- 保留现有 Vue 3、Vue Router、Pinia、Element Plus 和后端 API。
- 继续通过 Git 提交每个可验证阶段，并用构建、测试和浏览器截图验收。

## Non-goals

- 不抓取或复用 Awwwards 站点的页面源码、图片、字体或品牌资产，也不制作可识别的一比一整页副本；只提取公开可观察的设计规律并做原创致敬实现。
- 不迁移到 React/Next.js，不改变 Systemd + Nginx 部署路线。
- 不在本次改版中重做登录、管理后台和后端数据模型。
- 不让全站依赖 3D 场景；正文、导航和主要操作必须在 WebGL 不可用或开启减少动态效果时继续可用。

## Chosen Approach

采用新粗野主义作品集方向，原因是它能为单作者技术博客建立强记忆点，同时仍能用现有 Vue 结构快速落地。

其他考虑过的方向：

1. 编辑型技术品牌站：阅读体验最好，但与当前模板的差异不够大，无法解决“没有个人气质”的核心问题。
2. 深色开发者工作台：技术感强，但更像控制台，削弱作品和文章的展示能力。

## Visual System

- 页面底色：暖白纸张色 `#f4f1ea`。
- 主要文字：墨黑 `#111111`。
- 强调色：酸橙绿 `#c7ff2e`，只用于关键 CTA、标签和状态。
- 辅助色：电蓝 `#3767ff`，仅用于链接和少量交互状态。
- 边框：2px solid 墨黑。
- 阴影：硬阴影 `6px 6px 0 #111111`，悬停时平移到 `3px 3px`。
- 圆角：默认 0；头像、媒体缩略图和输入控件最多 8px。
- 内容宽度：`min(1180px, calc(100% - 40px))`。
- 标题使用紧凑粗体，正文保持 16px 以上和 1.7 行高。

### Motion and 3D layer

- 首屏使用原创 Three.js 场景作为个人标记：低多边形几何体、抽象字母或粒子场均可，避免复刻任何具体案例的资产。
- 场景沿用纸张色、墨黑、酸橙绿和电蓝，确保 3D 与 2D UI 是同一个品牌系统。
- 滚动只驱动少量明确状态：Hero 物体旋转、章节揭示和作品焦点切换，避免持续运动干扰阅读。
- 遵守 `prefers-reduced-motion`：使用静态海报式首帧，并保留全部文字和控件。
- WebGL 初始化失败时切换到 CSS/SVG 海报后备，不出现空白画布。
- 场景在首屏文字和导航完成后懒加载，优先保证输入和路由响应。

## Page Structure

### Global layout

- 顶部导航改为品牌标记、Writing、Projects、Resources、About 四个路径。
- 登录入口保留为小型工具操作，管理员入口只在登录后的用户菜单中显示。
- 搜索在桌面端位于导航右侧，移动端移到独立一行，避免品牌名被压缩或竖排。
- 页面底部显示简短身份说明、GitHub/邮箱入口和当前年份。

### Home

1. 全屏 Hero：大标题、明确定位、两个行动按钮，以及占据视觉场域的原创 3D 个人标记；桌面和移动首屏都要露出下一节标题。
2. Featured work：三张横向作品卡，每张包含类别、结果描述、技术栈和外链。
3. Latest writing：来自后端文章列表的编辑型时间线，显示日期、标题、摘要和标签。
4. Resources：展示可公开分享的工具、模板或笔记入口。
5. About strip：一句个人介绍和进入 About 页的入口。

当 API 暂不可用或没有内容时，Hero、作品和资源仍然显示；文章区使用内联空状态，不在首屏弹出重复错误 toast。

### About

改为个人简介、技术方向、工作方式和联系入口的长页面，复用同一视觉 token。

## Content Model

新增 `frontend/src/data/portfolio.ts`，只放公开、可替换的展示数据：

- `projects`: `title`, `type`, `description`, `stack`, `href`, `accent`。
- `resources`: `title`, `description`, `kind`, `href`。
- `profile`: `name`, `role`, `intro`, `location`, `availability`。

文章继续从现有 API 获取，避免改变后端契约。

## Accessibility and Quality

- 所有作品卡、导航和图标按钮提供可见焦点态、文字标签或 aria-label。
- 颜色对比度满足正文和主要交互的 WCAG AA 要求。
- 不依赖 hover 才能理解内容；硬阴影只强化层级。
- 动效只是渐进增强，不依赖动效才能发现内容；对减少动态效果用户提供静态路径。
- 图片使用明确的 `alt`，外链使用 `rel="noreferrer"`。
- 移动端不出现横向滚动，标题和按钮不得溢出。
- 页面首屏在 API 失败时仍有可用内容，避免白屏。

## Verification

- `npm run build` 通过。
- `scripts/check-repository-baseline.sh` 通过。
- Playwright 检查 `/`、`/login`、`/register` 和 404 路由。
- 生成 1440x900 与 390x844 首页截图，检查无横向溢出、无竖排品牌名和无重叠元素。
- 检查 Hero canvas 在桌面和移动尺寸下有非空像素、构图正确，并验证减少动态效果和 WebGL 失败后备。
- 用 Web Interface Guidelines 对 `MainLayout.vue`、`Home.vue` 和 `About.vue` 做一次复核。
