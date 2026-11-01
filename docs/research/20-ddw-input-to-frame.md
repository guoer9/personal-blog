# 阶段 2：DDW 输入到绘制链

## 本轮范围

- 日期：2026-11-01（Asia/Shanghai）。
- 分支：`codex/blog-v1.2`；Task 5 提交为 `5134d5a`，本轮只增加开发环境观测标记和研究记录。
- 浏览器：Chromium `141.0.7390.37`，Playwright Python `sync_api`。
- 浏览器场景：桌面 `1280 × 720`、普通动态效果；减少动态效果单独使用 `prefers-reduced-motion: reduce`。
- API：使用本轮脚本内的原创单文章夹具；未读取或修改真实数据库。
- 网络：未限速；本轮测量生命周期和调用链，不把它当作性能基线。
- 原始证据：`output/playwright/v1.2-20261101/ddw-lifecycle.json`；脚本为 `output/playwright/v1.2-20261101/ddw-lifecycle.py`。

## 证据

### 本站输入到绘制调用链

1. 首页监听 `scroll`，通过单个 `requestAnimationFrame` 合并更新，读取 `window.scrollY`、文档高度和视口高度，写入 `storyProgress`：`frontend/src/views/blog/Home.vue:43-55`。这条路径保留浏览器原生滚动。
2. 首页把 `storyProgress` 传给场景：`frontend/src/views/blog/Home.vue:116-132`。
3. 场景的 `renderLoop` 只有在组件已挂载、控制器存在、场景可见、标签页可见且没有手动暂停时继续；每帧先调用 `controller.setInput(...)`，再调用 `controller.render(time)`，最后申请下一帧：`frontend/src/components/immersive/ImmersiveScene.vue:57-69`。
4. 全局 `pointermove` 读取场景根节点的 `getBoundingClientRect()`，通过 `pointerToNdc` 转成 `[-1, 1]` 范围的局部坐标：`frontend/src/components/immersive/ImmersiveScene.vue:93-101`。坐标数学位于 `frontend/src/graphics/motion.ts:11-25`。
5. `liquidScene.setInput` 再次把指针限制到 `[-1, 1]`，把滚动限制到 `[0, 1]`：`frontend/src/graphics/liquidScene.ts:139-143`。
6. `liquidScene.render` 把帧时间限制到 `0.05s`，用指数阻尼更新当前指针和滚动，再写入原创场景的旋转、缩放、粒子和 uniform，最后调用 `renderer.render(scene, camera)`：`frontend/src/graphics/liquidScene.ts:144-181`。阻尼实现位于 `frontend/src/graphics/motion.ts:1-7`。

本轮加入的 `data-sceneInput` 和 `data-sceneFrame` 只在 `import.meta.env.DEV` 分支写入：`frontend/src/components/immersive/ImmersiveScene.vue:41-55,64-67,148-151`。输入标记包含当前指针坐标、滚动进度和 `performance.now()`；帧标记只在 `controller.render` 返回后递增，因此它用于证明绘制循环推进，不代表 GPU 已完成渲染。

### 浏览器复测结果（E1）

| 场景 | 结果 | 原始值 |
| --- | --- | --- |
| 初始可见 | PASS | `sceneFrame=4`，`renderState=playing`，输入 `0.000,0.000,0.000,...` |
| 指针移动 | PASS | 帧 `4 → 6`，输入变为 `-0.500,0.300,0.000,...` |
| 小幅滚动 | PASS | 帧 `6 → 13`，滚动输入从 `0.000 → 0.009` |
| 场景离屏 | PASS | 状态变为 `paused`，帧 `28` 在额外 `250ms` 内保持 `28` |
| 合成隐藏事件 | PASS | 状态变为 `paused`，帧 `4` 在额外 `250ms` 内保持 `4`；恢复后帧变为 `5` |
| 减少动态效果 | PASS | `renderState=static`、`sceneFrame=0`，没有 `liquidScene` 或 Three.js 请求 |
| WebGL 初始化失败 | PASS | `renderState=static`、`sceneFrame=0`，CSS poster 可见 |
| 路由离开输入 | PASS | 画布从 DOM 移除；卸载确认后的 `300ms` 内没有新的帧标记 |

隐藏标签页场景使用浏览器内注入的 `document.hidden` getter 和 `visibilitychange` 事件，因为当前无头 Chromium 的 CDP 不接受 `hidden` 生命周期状态；这证明本站事件处理路径，不能替代真实操作系统后台标签页测量。

### 与参考项目的机制级对比

- 本地参考 README 描述了 rAF ticker、性能计时和最大时间步限制：`lusion.co-ddw/README.md:1539-1569`。本站已有自己的 rAF 和 `0.05s` 时间步上限，代码证据见上方 E2 位置；这属于同类机制，不是参考代码移植。
- 参考 README 描述输入采样、滚动积分、场景更新和 GPU 绘制的分阶段执行：`lusion.co-ddw/README.md:2189-2260`。本站也把输入提交和场景绘制放在同一帧顺序中，但继续使用原生滚动与 Vue 状态传递。
- 参考 README 明确描述虚拟滚动并拦截原生滚轮：`lusion.co-ddw/README.md:2010-2044`。本站没有采用这一机制；`Home.vue` 直接读取 `window.scrollY`，因此不能声称具有参考项目的虚拟滚动同步精度。
- 参考 README 中的 DOM 范围缓存与屏幕坐标映射位于 `lusion.co-ddw/README.md:4438-4498`。本站只使用 `ResizeObserver` 做尺寸变化和 `IntersectionObserver` 做可见性门控，不实现参考项目的 DOM 代理网格或虚拟坐标系统。

参考目录只用于机制核对，未复制其素材、着色器、模型、音频、文案或运行时代码。

## 实验

- 假设：在不改变场景行为的前提下，开发环境标记可以把“输入已采样 → 控制器已提交 → 绘制循环推进”变成可重复的浏览器证据。
- 变量：仅加入开发环境 dataset 标记和 Playwright 生命周期断言；不改变生产逻辑、场景参数、素材或滚动模型。
- 成功判据：指针和滚动标记可观察变化；可见场景帧计数增长；离屏、隐藏和卸载后帧计数停止；减少动态效果和 WebGL 失败不加载动态场景并显示静态后备。
- 失败判据：出现离屏持续帧、卸载后新帧、减少动态效果请求 Three.js、WebGL 失败空白或横向布局回归。

## 复测结果

- RED：首次运行生命周期脚本在等待 `sceneFrame >= 3` 时超时，证明没有标记时脚本不能伪造成功。
- GREEN：加入开发环境标记后，`ddw-lifecycle.py` 全部场景通过，结果写入 `ddw-lifecycle.json`。
- 本轮未重新测量 LCP、INP 或长任务；性能数字继续以 `docs/research/19-stage-1-performance-gate.md` 的协议和结果为准。

## 机制筛选

| 机制 | 用户体验收益 | 实现成本 | 性能/可访问性风险 | v1.2 判断 |
| --- | --- | --- | --- | --- |
| 输入采样与绘制顺序可观测 | 能定位滚动、指针与场景状态不同步 | 低 | 生产零成本；不影响内容语义 | 保留 |
| 生命周期门控与资源释放 | 离屏和隐藏时减少无意义绘制，失败时仍可读 | 低到中 | 需持续验证卸载和恢复 | 保留 |
| 自适应画质 | 在设备差异下保护帧时间 | 中 | 可能出现降档抖动；必须有迟滞和回滚 | 保留，交给 Task 7 单变量实验 |
| 虚拟滚动与 DOM/WebGL 代理同步 | 可能提高复杂场景的同步精度 | 高 | 破坏原生滚动、键盘、辅助技术和历史位置 | 延后 |
| 复杂后处理或 ping-pong 模拟 | 视觉表现空间更大 | 高 | 包体积、GPU 内存和降级路径风险高 | v1.2 放弃 |

## 下一步假设

唯一优先假设：在保留当前生命周期门控和静态后备的前提下，使用 EMA 与方向迟滞只降低原创场景的 DPR 上限和粒子绘制数量，可以减少慢帧而不改变内容、主包和 reduced-motion 路径。
