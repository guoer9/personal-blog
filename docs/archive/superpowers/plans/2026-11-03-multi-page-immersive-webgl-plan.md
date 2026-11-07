
# 多页面沉浸式 WebGL Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 将首页局部 WebGL 演进为公共 MainLayout 内的单一 Renderer / Canvas / RAF，并为 Home、Works、WorkDetail、About、Article、Archive、Library 建立彼此独立的页面场景模块，同时保持内容与交互由 DOM 提供。

**Architecture:** MainLayout 持有持久视觉主机，VisualRuntime 统一 Renderer、Canvas、RAF、输入、画质和资源生命周期。PageTransitionCoordinator 按 route identity 选择场景模块；页面通过类型化 bridge 显式发布筛选、作品类别、阅读进度等状态，模块只消费页面状态和注册的 DOM 锚点。

**Tech Stack:** Vue 3、Vue Router 4、TypeScript、Three.js、Vitest、Vue Test Utils、Playwright；复用现有 motion.ts、quality.ts 和浏览器质量脚本。

**Spec:** docs/archive/superpowers/specs/2026-11-03-multi-page-immersive-webgl-design.md

## Global Constraints

- Public MainLayout 内最多一个活动 WebGL Renderer / context、一个 Canvas 和一个 RAF。
- 场景模块不能创建 Renderer、RAF 或全局输入监听；模块只释放自己创建的资源。
- 七类页面拥有独立场景构成或交互逻辑，不用一个全站场景加颜色参数代替。
- WorkDetail 仅以 Work.category 和显式页面状态驱动；不按 slug、文件名、歌词或单曲分支。
- Transfer、Register、Admin、NotFound 默认不运行 WebGL；内容、媒体、表单、导航和焦点顺序继续由 DOM 提供。
- 保留 MainLayout 当前 out-in 转场；首版不做新旧场景透明叠加。
- Canvas 使用 aria-hidden 和 pointer-events: none；reduced-motion、低画质、WebGL 失败和 context lost 均有静态后备。
- 保留工作区已有未提交改动，包括 frontend/src/graphics/* 和未跟踪的 ddw/；不能重置、覆盖或清理它们。
- 不改 API、数据库、内容管理和发布流程；不引入全站视频纹理、GPGPU 流体或重量级通用后期。

## Review Focus

- 快速连续路由切换时，过期 preload / enter 不覆盖最新目标；在 Task 2 测 transition race。
- 同一 WorkDetail 组件切换 slug 时场景只接收 category / media 状态；在 Task 4 测 category update。
- document.hidden、画布离屏、手动暂停和 reduced-motion 切换时 RAF 正确停启；在 Task 2、Task 3 测生命周期。
- Renderer / shader 初始化失败或 context lost 时 DOM 仍可读、可聚焦和可操作；在 Task 2、Task 6、Task 7 测 fallback。
- 图片、字体或异步内容改变锚点尺寸后模块读到新缓存矩形，且 RAF 不遍历全部 DOM；在 Task 1、Task 5 测锚点缓存。

## File Map

### Create

- frontend/src/graphics/runtime/types.ts — 页面模块、共享状态、renderer adapter 和 bridge 类型。
- frontend/src/graphics/runtime/VisualState.ts — 平滑后的共享输入与 viewport / quality / 可见状态。
- frontend/src/graphics/runtime/DomAnchorRegistry.ts — 显式 DOM 锚点的注册、测量、缓存和注销。
- frontend/src/graphics/runtime/SceneRegistry.ts — route identity 到模块工厂的明确映射。
- frontend/src/graphics/runtime/PageTransitionCoordinator.ts — 页面模块 enter / leave / dispose 与过期转场保护。
- frontend/src/graphics/runtime/VisualRuntime.ts — 单 Renderer、Canvas、RAF、输入、resize、visibility、quality、fallback。
- frontend/src/graphics/runtime/usePageSceneState.ts — Vue 页面类型化状态 bridge。
- frontend/src/graphics/runtime/EffectQueue.ts — 页面按需注册 effect 的生命周期协议。
- frontend/src/graphics/scenes/pageStates.ts — Home、Works、WorkDetail、About、Article、Archive、Library 状态类型。
- frontend/src/graphics/scenes/home/HomeScene.ts — 首页场景。
- frontend/src/graphics/scenes/works/WorksScene.ts — 作品列表场景。
- frontend/src/graphics/scenes/work-detail/WorkDetailScene.ts — 作品详情场景。
- frontend/src/graphics/scenes/about/AboutScene.ts — 关于页场景。
- frontend/src/graphics/scenes/article/ArticleScene.ts — 文章阅读场景。
- frontend/src/graphics/scenes/archive/ArchiveScene.ts — 归档 / 搜索 / 标签场景。
- frontend/src/graphics/scenes/library/LibraryScene.ts — 资料库场景。
- frontend/src/components/immersive/SceneAnchor.vue — 页面主动注册 DOM 锚点的薄组件。
- frontend/scripts/quality/multi-page-immersive.mjs — Chromium 多页面真实浏览器验收。

### Modify

- frontend/src/graphics/liquidScene.ts — 接收共享 Renderer；dispose 只清理场景自有资源。
- frontend/src/layouts/MainLayout.vue、frontend/src/layouts/MainLayout.test.ts — 持久 canvas、runtime provider、转场生命周期；保留 skip link 和 footer 行为。
- frontend/src/views/blog/Home.vue、Works.vue、WorkDetail.vue、About.vue、PostDetail.vue、Archive.vue、TagPosts.vue、Search.vue、Documents.vue、DocumentDetail.vue — 发布显式业务状态并注册必要锚点。
- frontend/src/components/immersive/ImmersiveScene.vue — 不再拥有 Renderer / RAF；迁移后删除或成为兼容薄组件。
- frontend/src/components/works/WorkPlayer.vue — 仅在需要时发布媒体状态；DOM 仍拥有播放控制。
- frontend/src/graphics/motion.ts、quality.ts 和 frontend/src/style.css — 复用现有缓动、画质迟滞并接入持久 Canvas 样式。

### Test

- frontend/src/graphics/runtime/{VisualState,DomAnchorRegistry,SceneRegistry,PageTransitionCoordinator,VisualRuntime,usePageSceneState}.test.ts
- frontend/src/graphics/scenes/scenes.test.ts
- frontend/src/layouts/MainLayout.test.ts
- frontend/src/views/blog/Works.test.ts、WorkDetail.test.ts、About.test.ts — 若不存在则新增聚焦 bridge / 状态更新测试。
- 现有 PostDetail、Archive、Search、Documents、DocumentDetail 页面测试按 bridge 行为补充断言；真实浏览器结果由 multi-page-immersive.mjs 记录，不以截图替代单测。

---

### Task 1: 定义运行时契约、页面状态和 DOM 锚点

**Files:** Create runtime/types.ts、VisualState.ts、DomAnchorRegistry.ts、SceneRegistry.ts、usePageSceneState.ts、scenes/pageStates.ts 及对应 Vitest 文件。

**Interfaces:**

- PageSceneId: home | works | work-detail | about | article | archive | library。
- RouteVisualIdentity: routeName、pageId（可为 null）、params；params 不作为场景特效分支。
- RendererAdapter: domElement、setPixelRatio、setSize、render、dispose。
- VisualState: timeMs、deltaSeconds、pointerX、pointerY、pointerVelocity、scrollY、scrollVelocity、documentProgress、viewportWidth、viewportHeight、dpr、qualityTier、reducedMotion、documentHidden、canvasVisible。
- SceneContext: renderer、anchors、effects、getQualityTier() 和 isReducedMotion()；不提供 route params、Vue 组件实例或任意 DOM 查询权限。
- SceneRenderContext: renderer、visualState、viewportWidth、viewportHeight、dpr。
- PageSceneModule<T>: id、mount(context)、enter(context, from?)、leave(context, to?)、update(visualState, pageState)、resize(width, height, dpr)、render(context)、dispose()。
- PageSceneBridge<T>: setState、getState、registerAnchor、clear；不得暴露场景实例。
- DomAnchorRegistry.register(id, element) 返回注销函数；measure 更新缓存；get 只读缓存。
- 路由映射：Home→home，Works→works，WorkDetail→work-detail，About→about，PostDetail→article，Archive / TagPosts / Search→archive，Documents / DocumentDetail→library；Transfer、Register、Admin*、NotFound→null。

- [x] Step 1：写失败测试，覆盖 VisualState 对非法输入的归一化、锚点注册 / 更新 / 注销、完整路由映射和 bridge 状态隔离。
- [x] Step 2：运行 cd frontend && npx vitest run src/graphics/runtime/VisualState.test.ts src/graphics/runtime/DomAnchorRegistry.test.ts src/graphics/runtime/SceneRegistry.test.ts src/graphics/runtime/usePageSceneState.test.ts；预期因实现缺失而失败。
- [x] Step 3：实现纯 TypeScript 状态与映射；锚点仅测量已注册元素，RAF 消费缓存。
- [x] Step 4：重跑上述测试并运行 cd frontend && npm run build；预期测试及类型构建通过。

### Task 2: 实现单 Renderer runtime 与路由协调器

**Files:** Create VisualRuntime.ts、PageTransitionCoordinator.ts、EffectQueue.ts 及其测试。

**Interfaces:**

- VisualRuntime 注入 createRenderer(canvas)、requestFrame(callback)、cancelFrame(id)、now()，便于 fake renderer / RAF 测试。
- VisualRuntime 提供 mount(canvas)、start()、stop()、setRoute(identity)、setPageState(pageId, state)、measureAnchors()、dispose()；mount 只创建一次 Renderer。
- Coordinator 提供 setTarget(identity)、preloadTarget()、beforeLeave()、afterLeave()、afterEnter()、updatePageState(pageId, state)、dispose()；每次目标切换递增 id，丢弃过期异步结果。
- EffectQueue 提供 register、unregister、resize、render、dispose；仅运行显式启用的 effect。

- [x] Step 1：写失败测试，断言重复 start 只有一个 RAF；Home→Works 不重建 renderer；document.hidden、canvas 不可见和 stop 时不续帧；dispose 释放模块和 renderer；过期 preload 不覆盖新路由。
- [x] Step 2：运行 cd frontend && npx vitest run src/graphics/runtime/VisualRuntime.test.ts src/graphics/runtime/PageTransitionCoordinator.test.ts；预期失败。
- [x] Step 3：实现 runtime 单循环：事件写入目标状态，RAF 平滑并按“更新状态→更新模块→模块渲染→effects”顺序执行；无活动模块时停帧。
- [x] Step 4：实现顺序 route handoff；模块状态变化调用 update，同一模块参数变化不重建 renderer；无 WebGL 页面隐藏 Canvas 并停帧。
- [x] Step 5：实现默认空的 EffectQueue，不添加任何全站效果。
- [x] Step 6：重跑 runtime 测试，预期通过。

### Task 3: 接入 MainLayout 并迁移首页液态场景

**Files:** Modify MainLayout.vue / test、Home.vue、liquidScene.ts、motion.ts、quality.ts、style.css、ImmersiveScene.vue；Create SceneAnchor.vue；按需新增 liquidScene 测试。

**Interfaces:**

- MainLayout 公共生命周期持有一个持久 Canvas 并向路由页 provide VisualRuntimeHandle。
- SceneAnchor 接收 id / class，注册并注销 DOM 元素，不创建 Three.js 对象。
- createLiquidScene(renderer, initialState, quality) 复用共享 renderer；其 dispose 不调用 renderer.dispose 或 forceContextLoss。
- HomePageState 至少含 paused；首页阶段进度从共享 VisualState 来，现有 motion toggle 与静态 fallback 保持可用。

- [x] Step 1：写失败测试，覆盖 MainLayout 单 Canvas、skip link、footer，及 liquid controller 不释放共享 renderer。
- [x] Step 2：运行 cd frontend && npx vitest run src/layouts/MainLayout.test.ts src/graphics/liquidScene.test.ts；若无 liquidScene.test.ts，先建 focused 测试，预期失败。
- [x] Step 3：在 MainLayout 接入 VisualRuntime 和 Vue transition hooks，保留 out-in。
- [x] Step 4：改造 liquidScene 只拥有 Scene / Camera / geometry / material。
- [x] Step 5：迁移 Home 状态及锚点，删除 Home / ImmersiveScene 的独立 RAF、pointer、visibility 和 Renderer 所有权；内容请求及 DOM 控件不变。
- [x] Step 6：运行 focused tests 和 cd frontend && npm run build；预期通过。

### Task 4: 实现 Works、WorkDetail、About 独立场景

**Files:** Create WorksScene.ts、WorkDetailScene.ts、AboutScene.ts；修改 SceneRegistry、Works.vue、WorkDetail.vue、About.vue，按需修改 WorkPlayer.vue；补 scenes 与页面测试。

**Interfaces:**

- WorksPageState: category（all 或 WorkCategory）、itemCount、focusedIndex。
- WorkDetailPageState: category（WorkCategory 或 null）、hasMedia、playing、playbackProgress；不含 slug、歌词或文件名。
- AboutPageState: activeSection（approach | practice | now）。
- 三个模块分别拥有自己的场景对象 / 更新逻辑；筛选、媒体控制、章节导航和内容仍由 DOM 负责。

- [x] Step 1：写失败测试，验证模块独立、category 更新构成且不重建模块、生命周期资源释放。
- [x] Step 2：若 Works.test.ts、WorkDetail.test.ts 或 About.test.ts 不存在，先各自建立聚焦状态测试；运行 cd frontend && npx vitest run src/graphics/scenes/scenes.test.ts src/views/blog/Works.test.ts src/views/blog/WorkDetail.test.ts src/views/blog/About.test.ts；预期在场景实现前失败。
- [x] Step 3：实现 WorksScene，消费筛选、数量和显式锚点。
- [x] Step 4：实现 WorkDetailScene，category 驱动 code / film / music 构成；无效类别使用模块中性状态。
- [x] Step 5：实现 AboutScene，章节状态驱动专属空间结构。
- [x] Step 6：在三个 Vue 页面发布类型化状态；不将组件内部字段或 slug 交给 coordinator。
- [x] Step 7：运行上述测试及 cd frontend && npm run build；预期通过。

### Task 5: 实现 Article、Archive、Library 场景和页面 bridge

**Files:** Create ArticleScene.ts、ArchiveScene.ts、LibraryScene.ts；修改 SceneRegistry、PostDetail.vue、Archive.vue、TagPosts.vue、Search.vue、Documents.vue、DocumentDetail.vue；更新 scenes 和现有页面测试。

**Interfaces:**

- ArticlePageState: readingProgress、sectionCount、activeSection。
- ArchivePageState: mode（archive | tag | search）、query、resultCount、page、totalPages。
- LibraryPageState: mode（index | detail）、category、itemCount、page、readingProgress。
- 三个模块有各自构成和更新逻辑；TagPosts / Search 复用 archive 模块，Documents / DocumentDetail 复用 library 模块，但用 mode 和状态表达页面任务。

- [x] Step 1：写失败测试，覆盖阅读进度、query / page、资料 index / detail 状态，异步内容后的锚点重测和模块差异。
- [x] Step 2：运行相关场景和页面测试；预期 bridge / 模块实现前失败。
- [x] Step 3：实现 Article、Archive、Library 场景；正文、Notion blocks、评论、筛选和分页保留 DOM。
- [x] Step 4：接入 PostDetail、Archive 家族与 Library 家族，发布显式状态；保留原请求取消、错误与焦点行为。
- [x] Step 5：运行 cd frontend && npx vitest run src/graphics/scenes src/views/blog/PostDetail.test.ts src/views/blog/Search.test.ts src/views/blog/Documents.test.ts src/views/blog/DocumentDetail.test.ts 及 cd frontend && npm run build；预期通过。

### Task 6: 收口 fallback、质量、context 生命周期和无障碍

**Files:** Modify VisualRuntime.ts、PageTransitionCoordinator.ts、EffectQueue.ts、quality.ts、style.css、MainLayout.vue、SceneAnchor.vue；更新 runtime 与 MainLayout 测试。

- [x] Step 1：写失败测试，覆盖 Renderer / shader 初始化异常、context lost、reduced-motion、low quality 和共享 renderer ownership。
- [x] Step 2：运行 cd frontend && npx vitest run src/graphics/runtime src/layouts/MainLayout.test.ts；预期 fallback 行为实现前失败。
- [x] Step 3：context lost 停用模块并显示静态状态；恢复时重建当前页面模块，不创建第二个持久 renderer；恢复失败时保留 DOM fallback。
- [x] Step 4：复用现有 quality.ts 迟滞，将档位变化交给当前模块；effect 默认关闭。
- [x] Step 5：确认 Canvas 不挡 DOM；reduced-motion 静态显示；skip link、焦点、触控滚动、正文和播放器仍可用。
- [x] Step 6：运行 focused tests、cd frontend && npm test 和 cd frontend && npm run build；预期通过。

### Task 7: 完成真实浏览器验收

**Files:** Create frontend/scripts/quality/multi-page-immersive.mjs；仅在需要时给 frontend/package.json 增加 test:immersive script。截图 / 报告存临时目录，不提交凭据或临时产物。

**Interfaces:**

- Playwright 验收支持 BASE_URL、桌面 / 窄屏视口和 reduced-motion。
- 开发诊断状态提供 activePageId、rendererCount、rafActive、qualityTier、contextLost、frame timing。
- 覆盖 Home、Works、真实 WorkDetail、About、Writing、Search、Documents、可用的文章 / 资料详情和 Transfer / Admin 静态路由；缺少 fixture 的路由明确记为跳过。

- [x] Step 1：编写脚本逐路由记录页面、Canvas / renderer 数、RAF、关键 DOM 交互和截图。
- [x] Step 2：运行本地 Vite 与 node frontend/scripts/quality/multi-page-immersive.mjs；预期可用 fixture 路由正常且无重复 Renderer / Canvas。
- [x] Step 3：实测快速连续路由、分类筛选、WorkPlayer、About 章节、Search、Documents、skip link、窄屏和 reduced-motion。
- [x] Step 4：验证 hidden / visible、WebGL 初始化失败和静态 fallback；记录 context / RAF / 帧时间数据。
- [x] Step 5：按环境运行 npm run audit:axe、npm run audit:lighthouse、npm run check:bundle；逐项记录真实结果和无法执行项，不报告未执行项为通过。

## Self-Review Checklist

- [ ] 规格中的共享 runtime、独立模块、类型化状态、锚点、转场、资源所有权、fallback、quality、reduced-motion、DOM 可访问性和真实浏览器验收均有任务。
- [ ] 跨任务接口先定义后消费；WorkDetail 场景接口没有 slug / 歌词 / 单曲文件名。
- [ ] API、正文、播放器、焦点流程和管理后台职责未被转交给 WebGL。
- [ ] 每个任务都有可执行测试与验证命令；现有 dirty worktree 明确保留。

