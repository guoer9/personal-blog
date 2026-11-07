# 阶段 1：现有站点体验审计

## 本轮范围

- 日期：2026-11-01（Asia/Shanghai），夜间续跑第 1 轮。
- 工作区：`/Volumes/2tb/mydata/code/vllm/personal-blog`，基线提交 `8776d80`；本轮未修改站点代码。
- 浏览器：Google Chrome 156.0.8078.74（Playwright CLI 会话 `audit`）。
- 桌面视口：`1280 × 720`，DPR 1。移动视口：`390 × 844`，DPR 1。
- 本地服务：Vite `http://127.0.0.1:5173/`；FastAPI `http://127.0.0.1:8000/health`。
- 网络：本机 localhost，未模拟慢网或离线。
- 动效偏好：常规路径关闭 reduced-motion；减少动态效果路径单独开启 `prefers-reduced-motion: reduce`。
- 数据条件：公共接口当前返回 0 篇文章、0 个标签，故文章成功详情页和真实标签成功列表无法在本轮验证；对应错误/空状态已审计。
- 本轮只推进阶段 1 的体验基线与门禁证据，不进入 DDW 结构拆解或实现实验。

## 证据

### E1：服务、页面与布局基线

- 后端健康检查返回 `{"status":"healthy"}`；`GET /api/v1/posts?page_size=6` 返回空列表，`GET /api/v1/tags` 返回空数组。
- 桌面各公共路径均完成路由并出现预期 H1，横向溢出均为 `0`：

| 路径 | H1 | 页面高度 | 横向溢出 |
| --- | --- | ---: | ---: |
| `/` | `Make ideas move.` | 4030 | 0 |
| `/writing` | `Writing, in chronological order.` | 1116 | 0 |
| `/search` | `Find your thread.` | 1224 | 0 |
| `/about` | `A builder collecting clarity.` | 4631 | 0 |
| `/tag/does-not-exist` | `#does-not-exist` | 1103 | 0 |
| `/post/does-not-exist` | `这篇文章不在档案里。` | 1053 | 0 |
| `/missing-baseline-audit` | `A blank in the map.` | 797 | 0 |

- 移动端各公共路径同样完成路由并出现预期 H1，横向溢出均为 `0`：

| 路径 | H1 | 页面高度 | 横向溢出 | 可见焦点项 |
| --- | --- | ---: | ---: | ---: |
| `/` | `Make ideas move.` | 5812 | 0 | 19 |
| `/writing` | `Writing, in chronological order.` | 1202 | 0 | 8 |
| `/search` | `Find your thread.` | 1153 | 0 | 9 |
| `/about` | `A builder collecting clarity.` | 4597 | 0 | 14 |
| `/tag/does-not-exist` | `#does-not-exist` | 1131 | 0 | 10 |
| `/post/does-not-exist` | `这篇文章不在档案里。` | 1131 | 0 | 10 |
| `/missing-baseline-audit` | `A blank in the map.` | 954 | 0 | 5 |

- 移动首页首屏内容顺序清晰：标题、简介、主操作、抽象场景、动效开关；后续为文章空状态、项目、原则、资源和页脚。页面虽长，但没有横向溢出。
- 视觉截图位于 `output/playwright/baseline-audit-20261101/`：`home-desktop.png`、`home-mobile-current.png`、`writing-mobile.png`、`notfound-mobile.png`、`post-404-mobile.png`、`tag-empty-mobile.png`。早期 `home-mobile.png` 是页面未完成渲染时的空白竞态捕获，不纳入证据。

### E1：加载与构建

- `npm --prefix frontend run build` 成功，Vite 7.3.1，3470 个模块，构建耗时约 4.14 秒。
- 关键产物：主 JS `1,067.83 kB` / gzip `353.12 kB`；`liquidScene` 懒加载块 `526.43 kB` / gzip `131.99 kB`；文章编辑块 `673.50 kB` / gzip `225.32 kB`；全局 CSS `355.64 kB` / gzip `49.24 kB`。
- 构建告警：大于 500 kB 的块存在，首页首屏仍依赖约 `1.07 MB` 的主 JS；WebGL 场景代码由动态导入拆出。
- 原始构建记录：`output/playwright/baseline-audit-20261101/build.txt`。

### E1：键盘与菜单

- 桌面首页首次 Tab 聚焦“跳到正文”；元素约 `94 × 47 px`，位置 `(12, 12)`，有 `3 px solid` 可见外框。
- 按 Enter 后 URL 变为 `#main-content`，页面未明显滚动；焦点落到 `BODY`。连续复测 3 次结果一致，说明跳转目标缺少可编程焦点接收能力，键盘用户跳过后不会继续进入正文上下文。
- 移动菜单打开后 `aria-expanded="true"`、按钮标签变为“关闭导航”、菜单 `display: grid`，四个链接均约 `354 × 85 px`。按 Escape 可关闭，焦点保留在菜单按钮上。
- 搜索按钮打开后 `aria-expanded="true"`，搜索框出现并获得焦点。按 Escape 后搜索框隐藏、`aria-expanded="false"`，但焦点落到 `BODY`；连续复测 3 次结果一致。下一次 Tab 会回到页面首个可聚焦元素（首页是“阅读文章”），而不是返回搜索按钮。

### E1：搜索、空状态和错误路径

- `/search?q=test` 显示 `QUERY / “test”`、`0 RESULTS` 和“没有找到相关内容”空状态，无横向溢出。
- `/post/does-not-exist` 显示“这篇文章不在档案里”和返回归档/首页动作，保持主布局导航与页脚，无横向溢出。
- `/tag/does-not-exist` 显示 `#does-not-exist`、`0 篇相关文章` 和“这个主题还在等待第一篇文章”空状态，无横向溢出。
- 未匹配路由显示独立 404 页面“A blank in the map.”，包含当前错误地址、返回首页与浏览文章入口，无横向溢出。
- 文章成功页、真实标签列表和有内容搜索成功页本轮无法采集，因为公共数据为空。

### E1：减少动态效果和生命周期

- 在 reduced-motion 为 `true` 后重新加载首页，H1 正常，canvas `display: none`，场景状态为 `static`，显示 `STATIC / SIGNAL` 静态海报。
- 干净请求记录中仍加载 `ImmersiveScene.vue` 组件及样式，但没有请求 `liquidScene.ts`、`three.js` 或模型/音频资源。证明动态导入在减少动态效果路径被跳过，而不是仅隐藏 canvas。
- 常规动效下滚动至首页文章区后，WebGL 场景状态从 `playing` 变为 `paused`；抽样位于 `scrollY=718` 时已是 `paused`，后续项目区也保持暂停，说明 IntersectionObserver 的离屏暂停路径有效。
- 请求记录：`output/playwright/baseline-audit-20261101/reduced-motion-clean-requests.txt`。

### E1：滚动帧采样

- 工具：Playwright `page.evaluate` 中的 `requestAnimationFrame` 间隔采样，不是 Chrome Performance trace/CPU profile。
- 环境：Chrome 156、`1280 × 720`、DPR 1、localhost、常规动效、3 秒合成滚动，从 `scrollY=0` 至约 `1600` 后停留。
- 结果：181 个 rAF 样本，剔除前 3 个后 178 个；p50 `16.7 ms`，p95 `16.8 ms`，最大 `16.8 ms`；采样结束时 WebGL 状态为 `paused`。
- 解释边界：该结果只说明此环境下的主线程 rAF 节拍基本贴合 60 Hz，不能单独证明 GPU 片段耗时、长任务分布或低端移动设备表现。

### E2：源码定位

- `frontend/src/components/navigation/SiteHeader.vue:38-43`：Escape 只关闭菜单和搜索，没有把焦点返回触发按钮。
- `frontend/src/components/navigation/SiteHeader.vue:71-86`：搜索按钮通过 `aria-expanded` 与 `aria-controls` 关联面板，输入框有 `ref`，但关闭路径没有恢复焦点。
- `frontend/src/layouts/MainLayout.vue:8-16`：跳转链接指向 `#main-content`；目标 `main` 未设置 `tabindex="-1"`。
- `frontend/src/components/immersive/ImmersiveScene.vue:119-133`：减少动态效果在动态导入前提前返回；`146-149` 在偏好切换时释放控制器。
- `frontend/src/components/immersive/ImmersiveScene.vue:162-204`：监听器、ResizeObserver、IntersectionObserver 与 WebGL 控制器都有清理路径。
- `frontend/src/router/index.ts:10-110`：公共页面、后台页面与未匹配路由边界清楚；公开路径采用主布局，未匹配路由使用独立 404 布局。

### E3：历史证据

- 历史记录中的滚动帧数据为 p50 `16.7 ms`、p95 `16.9 ms`。本轮已重新采样，故历史数据仅用于对照，不替代本轮结果。
- 本轮没有做网络限速、冷缓存、Lighthouse、Chrome Performance trace 或真实移动设备测试。

## 实验

- 假设 H1：搜索面板 Escape 关闭时，焦点丢失且不会返回触发按钮，是可稳定复现的键盘可访问性缺陷。
  - 方法：桌面首页连续 3 次打开搜索、确认输入框聚焦、按 Escape、读取 `document.activeElement`。
  - 判据：若 3/3 次均为 `BODY` 或下个 Tab 未回到搜索按钮，则确认为稳定缺陷。
  - 结果：3/3 次关闭后焦点均为 `BODY`；随后一次 Tab 进入首页“阅读文章”，未回到搜索按钮。H1 成立。
- 假设 H2：跳转正文链接只改变 hash，不会让正文目标获得键盘焦点。
  - 方法：桌面首页首次 Tab、Enter，读取 hash、活动元素和主内容位置；连续 3 次。
  - 判据：若 3/3 次 hash 正确但活动元素为 `BODY`，则确认跳转焦点不完整。
  - 结果：3/3 次均为 `#main-content`、活动元素 `BODY`。H2 成立。
- 假设 H3：减少动态效果不仅隐藏 canvas，还会跳过 WebGL 动态导入。
  - 方法：设置 reduced-motion、清空请求、重新加载、等待 H1，检查请求列表与场景状态。
  - 判据：出现静态状态、canvas 隐藏，且无 `liquidScene`/`three` 请求则成立。
  - 结果：均符合。H3 成立。
- 假设 H4：首页 WebGL 场景离开视口后会暂停动画循环。
  - 方法：常规动效下按不同滚动位置抽样 `data-render-state`。
  - 判据：首屏为 `playing`，离屏后连续为 `paused` 则成立。
  - 结果：`scrollY=0..480` 为 `playing`，约 `718` 及以后为 `paused`。H4 成立。
- 本轮没有修改代码，因此没有实现前后对照；实验均为只读浏览器行为验证。

## 复测结果

- 上一轮已有但未稳定的搜索 Escape 焦点问题已连续复测 3 次，稳定复现。
- 上一轮已有但未稳定的“跳到正文”焦点问题已连续复测 3 次，稳定复现。
- 上一轮 reduced-motion 请求是否跳过的疑问已用清空请求后的干净加载复测，确认跳过 `liquidScene`/`three` 动态导入。
- 首页桌面与移动端已用等待路由/H1 的方式重新采集，排除了早期移动截图未渲染完成的竞态结果。
- 构建已本轮重跑，结果与历史主包约 `1,067.64 kB` / gzip `353.07 kB` 基本一致；以本轮 `1,067.83 kB` / `353.12 kB` 为准。
- 滚动帧数据已本轮重测一次；仍需在后续性能门禁中增加多次样本、Chrome trace 和移动设备验证。
- 未复测：文章成功详情页、真实标签成功列表、非空搜索结果、慢网/离线、冷缓存首屏、Lighthouse、真实触控设备、WebGL 不可用降级路径。

## 下一步假设

**下一轮唯一优先假设：** 修复搜索面板关闭后的焦点恢复，是当前阶段 1 风险最低且用户收益最高的可迁移交互基线改动。

建议下一轮只做一个小实验：在关闭搜索面板时把焦点显式恢复到搜索触发按钮，并验证打开、Escape 关闭、再次打开、提交搜索四条路径；同时检查移动端与 reduced-motion 不影响该行为。该实验仍属于现有站点体验修复，不进入 DDW 机制移植。

## 本轮结论

### 完成项

- 完成桌面与移动端公共路由基线采集，覆盖首页、归档、搜索、关于、文章错误页、标签空状态和未匹配 404。
- 完成构建重测，记录主包、WebGL 懒加载块与 CSS 体积。
- 确认搜索 Escape 焦点丢失与跳转正文焦点不完整，均连续复测 3 次。
- 确认 reduced-motion 会跳过 WebGL 动态导入，且 WebGL 离屏后暂停。
- 完成一次桌面真实浏览器 rAF 滚动采样，并记录其测量边界。
- 建立 `docs/archive/research/01-baseline-audit.md`，未修改站点业务代码，未进入 DDW 结构拆解。

### 未决项

- 公共数据为空，文章成功页、真实标签列表和非空搜索成功路径尚无法验证。
- 搜索与跳转正文的焦点问题目前是已确认事实，但尚未实施修复和回归测试。
- 性能仅有一次桌面 rAF 采样，缺少 Chrome trace、慢网/冷缓存和真实移动设备数据。
- WebGL 不可用、上下文丢失和低端设备降级路径尚未复测。

### 下一轮唯一优先假设

下一轮只验证：**搜索面板 Escape 关闭后显式将焦点恢复到搜索触发按钮，能否在不改变面板开合状态和移动布局的前提下，稳定修复键盘焦点丢失。**

完成该实验或达到本轮停止条件后停止，不进入 DDW 结构工作。
