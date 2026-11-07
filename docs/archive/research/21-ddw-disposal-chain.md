# 阶段 2：DDW 资源释放链

## 本轮范围

- 日期：2026-11-01（Asia/Shanghai）。
- 分支：`codex/blog-v1.2`；Task 5 提交为 `5134d5a`，Task 6 只增加开发环境观测标记、浏览器证据和研究文档。
- 浏览器：Chromium `141.0.7390.37`，Playwright Python `sync_api`。
- 场景：桌面 `1280 × 720`；普通动态效果、减少动态效果、合成隐藏事件、离屏、WebGL 初始化失败和同文档路由卸载。
- 原始证据：`output/playwright/v1.2-20261101/ddw-lifecycle.json`。

## 证据

### 本站释放和暂停链（E2）

| 触发条件 | 执行链 | 结果 |
| --- | --- | --- |
| `IntersectionObserver` 判定离屏 | `visibilityObserver` 设置 `isVisible=false` → `stopLoop()` → `cancelAnimationFrame(frame)`：`frontend/src/components/immersive/ImmersiveScene.vue:200-207,71-75` | 只暂停 rAF，控制器保留，回到视口可继续 |
| `visibilitychange` 且 `document.hidden` | `handleVisibility()` → `stopLoop()`：`frontend/src/components/immersive/ImmersiveScene.vue:109-112` | 只暂停 rAF；可见后 `startLoop()` 恢复 |
| 用户手动暂停 | `props.paused` watcher → `stopLoop()` 并写入 `paused`：`frontend/src/components/immersive/ImmersiveScene.vue:173-181` | 保留场景控制器，避免把可恢复的手动暂停当成销毁 |
| 初始或动态进入 reduced-motion | `initialize()` 在动态 import 前检查 `reducedMotion`；watcher 调用 `suspendScene()`：`frontend/src/components/immersive/ImmersiveScene.vue:135-151,168-171` | 初始减少动态效果不下载场景模块；已初始化场景主动释放 |
| WebGL 创建失败 | `catch` → `activatePoster()` → `suspendScene()`：`frontend/src/components/immersive/ImmersiveScene.vue:144-159` | 控制器和帧循环停止，CSS poster 保留 |
| 组件卸载 | `onBeforeUnmount()` 设置 `disposed`、停止 rAF、移除窗口/文档/媒体监听器、断开两个 observer、调用控制器 `dispose()`：`frontend/src/components/immersive/ImmersiveScene.vue:214-231` | 页面路由离开后不再持有场景运行循环 |

`liquidScene` 的 `dispose()` 进一步执行 `scene.clear()`，释放实体几何体、线框几何体、粒子几何体和三个材质，调用 `renderer.dispose()` 与 `renderer.forceContextLoss()`：`frontend/src/graphics/liquidScene.ts:183-195`。这里没有纹理加载或音频资源，因此没有额外资源释放分支可以声称。

### 浏览器复测结果（E1）

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 离屏暂停 | PASS | 场景从 `playing` 变为 `paused`；帧 `28` 在额外 `250ms` 内不变 |
| 隐藏事件暂停 | PASS | 合成 `visibilitychange` 后状态为 `paused`；帧 `4` 在额外 `250ms` 内不变，恢复后帧为 `5` |
| 减少动态效果 | PASS | `sceneFrame=0`、静态状态、动态场景请求数为 `0` |
| WebGL 初始化失败 | PASS | `sceneFrame=0`、静态状态、`.scene-poster` 可见 |
| 路由卸载 | PASS | `/about` 页面无 `canvas`；确认卸载后的 `300ms` 内 frame mutation 数保持不变（`16 → 16`） |

隐藏标签页采用合成 `document.hidden` 和 `visibilitychange` 事件，原因和边界见 `docs/archive/research/20-ddw-input-to-frame.md`；这条证据验证的是本站可见性处理器，不是操作系统切后台的功耗测量。

### 参考项目边界（E2/E4）

- 参考反编译源码的 ticker 有显式 `start`/`stop` 与 `cancelAnimationFrame`：`lusion.co-ddw/decompiled-source/reconstructed-app/src/engine/ .js:8050-8068`。本站的停止实现见上方 E2，二者只是相同的生命周期职责。
- 参考源码的 renderer 释放包含事件监听器移除、内部资源 dispose 和 ticker stop：`lusion.co-ddw/decompiled-source/reconstructed-app/src/engine/ .js:20699-20720`。参考 renderer 还暴露 `forceContextLoss`：`... .js:20549-20559`。本站只记录这些机制作为对照，没有复制参考源码。
- 参考 README 对离屏 DOM 范围和活跃状态有更复杂的缓存模型：`lusion.co-ddw/README.md:4438-4498`。本站使用浏览器原生 `IntersectionObserver` 门控整块装饰场景，不实现参考项目的 DOM 代理系统。

参考 README 的架构叙述属于 E4；只有本地反编译源码定位为 E2，不能把 README 中的性能数字或机制描述当成本站实测结果。

## 实验

- 假设：把“暂停”和“销毁”按生命周期区分，可以在恢复体验与释放 GPU 资源之间保持清晰边界。
- 变量：仅增加开发环境 marker 以观察既有链路；不改变暂停、销毁、静态后备的生产行为。
- 成功判据：离屏/隐藏不继续绘制；reduced-motion 和 WebGL 失败不留下控制器；路由卸载清除监听器、观察器和控制器；静态后备仍可见。
- 失败判据：离屏或隐藏帧继续增长、路由卸载后出现新帧、reduced-motion 下载 Three.js、WebGL 失败显示空白或资源未释放。

## 复测结果

- RED：在无 marker 的版本上，脚本无法等待 `sceneFrame`，因此未把不可观察的旧实现误记为通过。
- GREEN：加入开发环境 marker 后，生命周期脚本全部通过；raw JSON 位于 `output/playwright/v1.2-20261101/ddw-lifecycle.json`。
- 已验证的是代码路径和 DOM 可观察结果；未验证 GPU 内存曲线、真实操作系统切后台的电量影响、WebGL context loss 后恢复，以及 Safari/Firefox 的实现差异。

## 下一步假设

唯一优先假设：在不改变上述暂停/销毁边界的前提下，给原创场景增加有迟滞的自适应画质，能够降低慢帧并保持离屏、隐藏、reduced-motion、WebGL 失败和卸载路径的相同释放结果。
