# Personal Blog 多页面沉浸式 WebGL 设计规格

状态：待用户审阅

日期：2026-11-03

## 1. 意图

把个人博客从“首页有一个 Three.js 主视觉”发展为一组彼此有辨识度的页面体验。共享的是渲染基础设施、输入、画质、资源生命周期和交接协议；首页、作品、阅读、资料库和关于页各自拥有适合内容的场景构图、材质、节奏与交互。

视觉负责空间、节奏、氛围和反馈。导航、标题、正文、作品信息、播放器、搜索、表单和焦点顺序继续由 DOM 提供。个人照片、影像、音乐和经历可以作为多个页面的创作素材，不把某一首歌、某个作品或某个 slug 变成一次性特效主题。

本规格以 `ddw/decompiled-source/reconstructed-app/src/unpacked-modules/lusionEngine.js` 和 personal-blog 当前 Vue 源码的调用关系为依据。`TECHNICAL_DETAILS.md` 只作研究辅助，不作为架构结论的唯一证据；参考实现只借鉴可验证的结构和技术思想，不复制其资源、文案、模型或代码。

## 2. 代码现状与依据

### 参考实现的实际结构

- `src/main.tsx` 导入引擎；引擎中的 `App.initEngine()` 创建共享 `WebGLRenderer`、基础 Scene / Camera，并建立后期处理队列（`lusionEngine.js:51305`）。
- `Stage3D` 继承 Three.js `Scene`。`Visuals` 维护多个 Stage3D，按 `isActive` 选择当前主场景；源码中至少有首页气球、首页隧道、About 主视觉等不同 Stage3D（`28642`、`29867`、`29462`、`38043`、`42149`）。因此，共享 renderer 并不等于所有页面只有同一个场景。
- `Page` 自己持有 `preUfxContainer` 与 `postUfxContainer`。`PageManager` 将它们装配到共享的前后效果场景，控制页面初始化、资源加载、隐藏、显示和页面容器可见性（`28207`、`47753`、`36627`、`45145`）。
- 页面类分别装配页面 section 并实现自己的 `show / hide / resize / update`。路由交接先运行离场和目标页预载，再隐藏旧页并进入新页；页面可以按路由关系选择专属过渡（`40400`、`45622`、`45806`）。
- 后处理既有共享队列，也有按需要注册的页面效果；例如 About 页面效果和首页隧道效果加入同一队列，并按活动状态控制（`38082`、`42210`）。
- `ScrollDomRange` 缓存 DOM 矩形并计算屏幕进度；`UfxMesh.syncDom()` 针对明确传入的 DOM 元素同步屏幕矩形（`27605`、`31387`）。它不是自动把整页 DOM 转成 WebGL。
- 主循环统一推进输入、滚动、PageManager、页面更新和后期渲染（`51836`）。

### personal-blog 的实际结构

- `frontend/src/main.ts` 创建 Vue 应用；路由把公共内容页放在 `MainLayout.vue` 下，管理后台由独立 `AdminLayout.vue` 承载（`frontend/src/router/index.ts`）。
- `MainLayout.vue` 持有 Header、`router-view`、Footer 和 `mode="out-in"` 的页面转场（`frontend/src/layouts/MainLayout.vue`）。
- `Home.vue` 在 Hero 区域局部挂载 `ImmersiveScene.vue`。该组件持有 pointer / visibility / reduced-motion 监听、ResizeObserver、IntersectionObserver 和 RAF；`liquidScene.ts` 又自行创建 Renderer、Scene、Camera，并在 dispose 时释放 renderer 和 WebGL context（`frontend/src/components/immersive/ImmersiveScene.vue`、`frontend/src/graphics/liquidScene.ts`）。因此当前实现是首页局部 WebGL，尚非全站运行时。
- `motion.ts` 已有阻尼、MotionEnergy、场景阶段和卡片交互；`quality.ts` 已有高 / 平衡 / 低档和阈值迟滞。它们可以作为共享运行时的实现基础。
- 作品详情通过 `Work.category` 区分 `code / film / music`，作品内容由 API 加载；`WorkPlayer.vue` 承担原生媒体交互。页面场景可读取类别和结构化状态，不应读取作品 slug 来分支。

## 3. 目标、边界和反目标

### 目标

1. 建立一个跨公共路由复用的 Renderer、Canvas、帧循环、输入、质量和资源管理运行时。
2. 让不同页面模块拥有自己的场景内容、空间构图、动画时间线和按需效果。
3. 让路由交接遵循页面离场 / 预载 / 入场生命周期，切换时不重建 WebGL context。
4. 让 DOM 与 WebGL 通过少量显式锚点协作，同时保持内容语义和交互可用。
5. 逐页扩展首页以外的沉浸体验，并用真实浏览器验证性能、降级和可访问性。
6. 允许用户用照片、影像、音乐、经历文字、草图或审美参考参与页面视觉设计。

### 非目标

- 不以一个全站通用场景或统一动效模板代替页面设计；
- 不为单首歌曲、单篇文章或单个作品制作 slug 专属效果；
- 不接管浏览器滚动，不把正文、播放器、表单或导航移入 Canvas；
- 第一阶段不做全站视频纹理、完整 GPGPU 流体或重量级后期链；
- 不要求管理后台、登录和传输等操作页面必须启用 WebGL；
- 不改变 API、数据库、内容管理和发布流程。

### 反目标

- 共享 Renderer 逐渐膨胀成所有页面共用的同一个 Scene / Shader / 构图；
- 每页自行创建 Renderer、RAF 和全局输入监听，造成多个 context 和重复生命周期；
- 页面装饰抢过文字、焦点、媒体控制或触控行为；
- 按 slug、文件名或歌词硬编码视觉分支；
- 页面离开后仍有场景持续运行或资源无法释放。

## 4. 方案比较与选择

### 方案 A：共享运行时 + 多个页面场景模块（采用）

在公共布局中持有一个持续存在的渲染主机。Renderer、Canvas、RAF、输入、质量和 effect queue 由运行时统一管理；场景注册表按页面身份创建独立的场景模块。场景模块可以拥有自己的 Scene / Camera / Object3D 层、Shader、动画参数和所需效果，但不创建第二个 Renderer。

优点：符合参考代码的共享渲染器、多 Stage3D、页面前后层和共享后期队列结构；保留页面视觉独立性；适合当前 Vue 路由与已有 Three.js 依赖。

代价：必须设计页面模块接口、场景交接和共享资源所有权；不能把页面差异压缩成若干调色参数。

### 方案 B：每页独立 Renderer / Canvas

每页继续由自己的 Vue 组件创建和销毁 Renderer。隔离边界直观，但会复制 RAF、输入和画质管理；页面转场时易同时存在多个 WebGL context。当前首页实现已体现这种组件与 Renderer 紧耦合，不适合作为全站扩展路线。

### 方案 C：一个通用场景，通过 route profile 改颜色和强度

改动较少，但页面主要只在调色和强弱上不同，无法支撑用户要求的多页面独立视觉，也不符合参考源码中的多个 Stage3D 与页面专属层。只保留 route metadata 作为“选择哪个页面模块、传入哪些内容状态”的索引，不采用它作为场景本身。

## 5. 总体架构

```text
Vue Router + 页面组件 refs / 结构化内容状态
                  ↓
        PageVisualRegistry 选择页面模块
                  ↓
     VisualRuntime / PageTransitionCoordinator
     ↙              ↓                 ↘
共享输入状态    多个独立页面模块    页面专属层 / effects
     ↘              ↓                 ↙
       一个 Renderer / Canvas / RAF / Context
                  ↓
       DOM 内容 + 页面自己的 WebGL 构图
```

建议落点：

```text
frontend/src/graphics/
├── runtime/
│   ├── VisualRuntime.ts            # Renderer、RAF、共享输入和可见性
│   ├── VisualState.ts              # 采样、平滑后的通用输入状态
│   ├── PageTransitionCoordinator.ts# route / Vue transition 与场景生命周期
│   ├── SceneRegistry.ts            # 页面身份到模块工厂的映射
│   ├── SceneModule.ts              # 页面场景模块接口和渲染上下文
│   ├── DomAnchorRegistry.ts        # 注册的 DOM 矩形及可见进度
│   └── EffectQueue.ts              # 可选共享后期队列
├── scenes/
│   ├── home/                       # 首页叙事主视觉
│   ├── works/                      # 作品集空间构成
│   ├── work-detail/                # 类别驱动的作品详情场景
│   ├── about/                      # 关于页身份与经历场景
│   ├── article/                    # 文章阅读场景
│   ├── archive/                    # 归档 / 标签 / 搜索列表场景
│   └── library/                    # 公开资料库场景
└── effects/                        # 仅放跨模块可复用的后期实现
```

目录是渐进式建议；先稳定运行时协议和页面接口，再按需要移动现有 `liquidScene.ts`。不要为了目录统一制造无关重构。

页面场景不是 palette profile。注册表返回独立模块；可选的 `PageVisualConfig` 仅传路由类型、作品类别、页面阶段等数据，不定义页面最终构图。

建议的模块协议：

```ts
export interface PageSceneModule<TPageState = unknown> {
  readonly id: string
  mount(context: SceneContext): void
  enter(context: SceneContext, from?: string): void
  leave(context: SceneContext, to?: string): void
  update(state: Readonly<VisualState>, pageState: Readonly<TPageState>): void
  resize(width: number, height: number, dpr: number): void
  render(context: SceneRenderContext): void
  dispose(): void
}
```

`SceneContext` 提供共享 Renderer、共享输入、资源加载器、DOM 锚点和 effect queue 的受控接口。场景模块拥有自己的 Three.js 几何、材质、场景图和局部时间线；模块只能释放自己创建的资源。共享 Renderer 和全局监听由 VisualRuntime 统一释放。第一版优先按页面顺序渲染单个活动模块；只有真实转场需要前后页同时合成时，才增加 RenderTarget 合成。

### 页面状态的数据契约

- VisualRuntime 维护跨页通用状态；PageVisualRegistry 读取 route identity 并选择模块。
- 每个 Vue 页面通过页面作用域的 `usePageSceneState()` bridge 显式发布该模块需要的类型化状态，例如 WorkDetail 的 `category`、Works 的当前筛选、PostDetail 的阅读进度。页面数据在同一路由内变化时更新 `pageState`，不触发模块重建或重复 `enter`。
- route params 可用于页面取内容，但模块不根据 slug 分支。WorkDetail 等待内容加载后发布显式 `WorkCategory`；缺少有效类别时模块使用自身定义的中性状态。
- Coordinator 不读取 Vue 组件私有字段，也不通过 selector 遍历页面推断业务状态。DOM 尺寸与屏幕进度仅由页面注册的 anchor 提供。

此项作为当前设计的接口决策：页面拥有业务状态，运行时拥有共享状态与模块调度。它避免 route、DOM 和 WebGL scene 相互反向依赖。

## 6. 共享运行时实践路径

共享的是运行与资源协议，不是页面视觉。VisualRuntime 负责：

1. 创建一次 Renderer、Canvas 和公共渲染目标；页面切换不 dispose renderer、不 forceContextLoss。
2. 持有一个 RAF，按顺序采样输入、平滑状态、更新当前模块、执行模块渲染和后期队列。
3. 统一处理 resize、document visibility、画布可见性、reduced motion、质量档和 WebGL 失败后备。
4. 为快速连续路由切换添加 transition id；迟到的 preload / enter 回调不能覆盖最新目标路由。
5. 页面模块的 geometry、material、texture、render target 按模块所有权销毁；共享资源由运行时集中回收。

`VisualState` 建议包含时间 / delta、平滑指针坐标和速度、滚动坐标和速度、当前路由类型、页面与章节进度、viewport、quality tier、reduced motion、document hidden。场景模块不自行绑定全局 `scroll`、`pointermove` 或 `visibilitychange`。

迁移现有输入时，将 `Home.vue` 的 `storyProgress` 和暂停意图接入页面模块状态；保留 `motion.ts` 的 `damp`、`MotionEnergy` 与阶段函数。滚动监听只更新目标值，RAF 内统一平滑，避免每个页面重复开循环。

## 7. 页面身份与模块分配

此表规定模块责任，不要求页面复制相同视觉模板。相邻页面可以共享工具或资产加载器，但需要各自的场景构图和交互决定。

| 页面 / 路由 | 页面模块 | 视觉工作与状态来源 |
|---|---|---|
| Home | `home` | 保留首页四阶段叙事和现有 liquid 主视觉；阶段由首页章节进度驱动，不外溢成全站主题 |
| Works | `works` | 根据作品数量、筛选类别和卡片锚点组织空间；卡片内容和筛选保持 DOM |
| WorkDetail | `work-detail` | 场景按 `Work.category`（code / film / music）选择构成或参数；不同 slug 不写专属逻辑；播放器与仓库链接仍是 DOM |
| About | `about` | 个人身份、实践经历、原则和联系章节形成专属空间叙事；允许使用用户提供的照片、手写、影像或音乐素材 |
| PostDetail | `article` | 文章标题、阅读进度、章节边界驱动轻量但独立的阅读构成；正文保持 DOM 与高可读性 |
| Archive / TagPosts / Search | `archive` | 面向浏览与筛选的列表场景；读取筛选结果数量、标签和滚动状态，不读取文章全文纹理化 |
| Documents / DocumentDetail | `library` | 资料索引、分类和文档阅读阶段拥有自己的秩序构成；内容仍由 DOM 展示 |
| Transfer / Register / Admin / NotFound | 不启用 WebGL 或静态状态 | 任务操作优先；管理后台由独立 AdminLayout 承载，不挂公共沉浸渲染主机 |

路由名选择模块，Vue 页面通过类型化 bridge 发布动态业务字段。作品视觉类别读取 `Work.category` 和 `WorkCategory`；类别缺失或未知时退回该模块的中性构成，不回退到统一全站场景。筛选和阅读进度由页面主动更新模块状态，不由 Coordinator 检查页面内部状态。

## 8. 页面模块实践路径

### 首页模块

先把现有 `createLiquidScene()` 改为接收共享 Renderer 与画布上下文，不在内部创建 Renderer。保持目前形体、线框、粒子、四阶段节奏和现有 DOM 后备作为视觉基线。确认首页画面与交互不退化后，才让新运行时接管首页的监听和帧循环。

### 作品集模块

先依据实际 `WorkCard` / `.works-grid` 布局设计专属作品空间：筛选改变作品集合的排列关系，指针聚焦影响附近项目的层次，滚动带动场景视点或空间结构。先做少量 2.5D 几何与 CSS 配合；只有当卡片视觉对象必须精准贴合 DOM 卡片时才上 WebGL DOM 锚点。作品标题、标签、链接和筛选继续可访问。

### 作品详情模块

同一个页面模块可按 `code / film / music` 创建不同场景子构成或材质策略；这不是全站统一 profile，而是同一内容页模板需要处理的三类媒体语境。封面、视频和音频从真实内容字段加载，播放、暂停、进度和错误仍以 `WorkPlayer.vue` 为准。不得通过 slug 判断作品身份来生成特效，也不自动读取歌词或声纹。

### 关于页模块

根据 About.vue 的真实章节组织空间变化；每个章节可以有自己的深度、对象关系和时间节奏。头像、履历和联系入口保持 DOM。用户提供的个人影像、作品素材、手写草图或经历时间线可成为场景设计的素材，而不是硬编码成“一个头像粒子场”。

### 文章、列表与资料库模块

文章详情的阅读推进与归档列表的筛选任务并非同一种页面，因此分别由 `article` 与 `archive` 模块呈现；资料库由 `library` 模块呈现。可以共享少量网格、噪点、字体或缓动工具，不能只换颜色就算页面差异。先从标题 / 列表 / 章节层级和页面滚动阶段找真实锚点，再决定要不要用 WebGL 对齐。

## 9. 页面交接与 DOM 锚点

### 路由交接

当前 `MainLayout.vue` 使用 Vue `<transition mode="out-in">`，与参考实现先完成离场、再显示目标页的生命周期可以配合。公共 VisualViewport 在公共路由之间保持挂载；由 Vue `before-leave / after-leave / before-enter / after-enter` 或等价的明确事件通知 `PageTransitionCoordinator`。

建议顺序：收到目标 route → 并行预载目标页面模块与所需轻量资源 → 当前模块播放 `leave` → 隐藏 / 释放当前页面专属层 → route view 进入后挂载目标模块 → 播放 `enter` → 交接结束。相同页面组件但 route params 改变时按模块规则更新内容状态；不自动重建 Renderer。登录、管理后台和 transfer 等无 WebGL 页面通知运行时隐藏画布并停用活动模块。

保留现有 `out-in` 的可读性和低并发成本作为初始转场策略。若未来艺术方向确实要求新旧页面同时可见，再单独设计双场景混合；不要默认每次切换都同时渲染两页。

### DOM 锚点

`DomAnchorRegistry` 只测量页面主动注册、确实参与空间构图的元素。滚动与 resize / 内容加载 / 路由入场时更新测量；RAF 读取已缓存的矩形和进度，不遍历所有 DOM、不在所有每帧反复 `getBoundingClientRect()`。

候选锚点依据当前模板：

- Home：`.hero-visual` 与首页章节根节点；
- Works：`.works-grid` 或需要映射的单个卡片媒体区；
- WorkDetail：`.detail-player` 或 `.repository-feature`；
- About：章节标题、经历媒体区；
- PostDetail：文章标题、章节节点或正文进度哨兵；
- Documents：分类栏和文档卡片 / 详情的封面区域。

锚点是页面模块的输入，不修改正文布局、焦点次序或交互 hit target。仅在视觉设计提出精确对齐需求时实现 `UfxMesh` 类屏幕空间网格；普通页面优先使用 CSS 变量、独立 3D 背景和现有 DOM 动画。

## 10. 后期、内容资产与创作参与

### 后期路线

1. 起步只使用模块自有材质、几何、渐变和 DOM/CSS 层，不为了“沉浸式”先建通用 FBO 管线。
2. 有多页实际需求后建立少量共享 effect queue（如调色、暗角或低强度 bloom）；页面模块可以选择注册需要的效果。每个 effect 必须支持 enable / needsRender / resize / dispose。
3. ScreenPaint、拖影、局部折射和高成本反馈纹理只在某个页面设计明确需要、低画质实测达标后加入；要可按页面、设备和 quality tier 关闭。

页面可有自己的局部效果，effect queue 共用的是资源管理和执行协议，不是强制每页启用同一后期链。

### 用户可提供的设计素材

- 个人照片、Vlog 静帧、短影像、专辑 / 演出视觉、手写或纸面草图；
- 个人经历的时间节点、地点、物件、颜色或触感词；
- 喜欢的页面 / 动效参考，以及明确指出喜欢的是构图、速度、材质还是交互；
- 反例：哪些效果看起来廉价、太炫、太像模板或影响阅读。

素材先影响页面模块的构图、材质和节奏，保留来源和用途。原始音视频由 DOM 媒体组件或普通纹理加载按需使用，不默认全量解码、预载，也不因某一首歌自动触发全站视觉。

## 11. 生命周期、性能与可访问性

- Public MainLayout 中最多一个活动 WebGL Renderer / context、一个 Canvas 和一个 RAF；页面模块可持有自己的 scene graph 与材质。
- 页面模块更换只创建 / 释放模块资源；Renderer 只在公共渲染主机卸载时释放。后台路由不挂该渲染主机。
- document hidden、无活动 WebGL 页面、WebGL host 不可见、用户暂停或设备降级时停止或降低绘制；reduced-motion 使用静态页面状态，不阻断内容。
- 初始化失败、context lost 或 shader 出错时切换到页面对应静态 CSS / poster；场景失败不使页面失效。
- quality tier 调整共享 Renderer 的 DPR、粒子预算和后期成本；每个页面模块可定义各自的高 / 中 / 低构成。
- 延续 `quality.ts` 的现有阈值迟滞作为初始实现，不把单一 FPS 数字写成已验证的跨设备承诺；浏览器验收记录实际帧时间与设备条件。
- Canvas 默认 `pointer-events: none`；交互仍由 DOM 处理。键盘焦点、屏幕阅读顺序、触控滚动和媒体控件不依赖 WebGL。

## 12. 实施阶段与交付

### Phase 0：确认运行时和模块边界

建立 VisualRuntime、VisualState、SceneRegistry、PageSceneModule 和 route transition 协议；明确共享资源与模块资源所有权。补充有意义的模块状态和清理测试，不改变页面最终视觉。

### Phase 1：首页迁移到共享 Renderer

在 MainLayout 的公共区域挂载持久视觉主机；将 Renderer / RAF / 全局监听从 ImmersiveScene 拆出；改造首页液态实现以复用 Renderer，并由 Home scene module 组合。保留现有画面为基线，保证公共路由转场不创建新 context。

### Phase 2：实现第一组不同页面场景

先做 Works、WorkDetail、About 三类模块，验证“共用底座但各自有空间构图”。按类别读取作品元数据；优先完成离场 / 入场状态、移动降级和必要的 DOM 锚点。

### Phase 3：扩展到阅读与资料页面

实现 Article、Archive 和 Library 模块。它们可以克制，但各自回应阅读、检索、资料导航的不同操作，不采用一个通用阅读背景换 route 名。

### Phase 4：按页面设计加入专属和共享 effects

只有浏览器画面已通过功能与性能检查后，加入真实设计需要的页面效果或共享队列；逐个模块验收，不追求全站效果数量。

### Phase 5：真实浏览器验收

使用 Chromium 覆盖桌面 / 窄屏、鼠标 / 触控、快速连续路由、页面错误状态、WebGL 不可用和 reduced motion。检查 Canvas/context 数、RAF 是否停启正确、DOM 锚点是否对齐、播放器与焦点是否可用，并留存截图及测量结果。

## 13. 验收标准

- 至少 Home、Works、WorkDetail、About、Article、Archive、Library 使用独立页面模块；它们可以共享 runtime 和少量工具，但有各自的场景对象、构图或交互逻辑。
- 公共路由切换期间 Renderer / context 不重复创建；后台和无场景页面不产生无意义的持续 RAF。
- 首页现有视觉回归通过；页面模块可以正确 enter / leave / resize / dispose。
- WorkDetail 视觉分支基于类别和显式数据，不出现作品 slug 专属特效。
- 注册锚点对齐 DOM；页面内容仍是可读、可聚焦和可操作的 DOM。
- reduced motion、低画质、WebGL 初始化失败和 context lost 均有静态后备路径。
- 浏览器验收记录页面路由、视口、设备模拟、context 数、帧间隔和主要交互结果。

## 14. 已选决策与留给实现者的判断

### 已选决策

1. 采用“共享运行时 + 多个页面场景模块”。共享基础设施，不共享为单一视觉符号。
2. 在公共 MainLayout 生命周期内使用一个 Renderer / Canvas / RAF；不让每个页面持有独立 Renderer。
3. Home、Works、WorkDetail、About、Article、Archive、Library 作为独立视觉模块；组件和 shader 可共享，但不以统一 profile 替代模块设计。
4. Admin 与明确的任务页默认不运行 WebGL；静态 DOM 内容永远可独立工作。
5. Route identity 选择场景模块；Work.category 提供类别输入；slug 不作为场景分支条件。
6. 首轮转场继续采用离场完成再入场的顺序交接；不预设双场景透明叠加。
7. Vue 页面通过类型化的 page-scene bridge 显式发布动态业务状态；Coordinator 仅负责 route 到模块的映射，不从组件内部或任意 DOM 推断状态。

### 实现者可以决定

- 最终文件拆分和组件命名；
- 各模块具体 Scene / Camera / Object3D 组合和动画数值；
- 哪些锚点真正满足设计需要；
- 每页是否需要独立后期 pass、纹理及高低档参数；
- 根据真实浏览器数据对现有 quality 阈值做调整。

若实施中发现共享 Renderer 无法满足已选页面设计，先说明具体的绘制或转场需求，再提出局部 RenderTarget 合成方案；不要直接退回多 Renderer 架构。

## 15. 待用户审阅

请审阅页面模块范围和个人素材使用边界。本文获用户批准后，再拆成实现计划；此规格本身不授权直接修改产品代码。
