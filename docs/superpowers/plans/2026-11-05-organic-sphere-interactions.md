# 首页球体按压反馈与粒子尾迹实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让首页自制 WebGL 球体对指针移动、点击和长按产生水波、脉冲与局部凹陷，并带有持续粒子尾迹，同时保持内容可读、滚动变形平滑和低性能设备可用。

**Architecture:** 保留公共视觉运行时的单一 Renderer、Canvas 和帧循环。首页把短按、按压开始和释放事件作为带递增序号的页面状态传给 `HomeScene`；液体场景通过 Three.js Raycaster 将指针位置映射到球面，Shader 绘制局部波纹、点击冲击和随按压时长渐深的凹陷，释放后弹性复原；程序化粒子按运动方向持续生成尾迹。所有新效果由既有质量档位、暂停状态和 reduced-motion 生命周期控制。

**Tech Stack:** Vue 3、TypeScript、Three.js 0.187、GLSL、Vitest、现有 immersive Playwright 验收脚本。

**Spec:** `docs/superpowers/specs/2026-11-03-multi-page-immersive-webgl-design.md`，以及 2026-11-05 用户提出的首页球体交互要求。

## Global Constraints

- 继续使用共享视觉运行时的单一 Renderer、Canvas、帧循环和质量管理。
- 正文、导航、故事轨道和操作控件继续由 DOM 提供；球体只作为视觉层，不拦截滚动或其他页面操作。
- 保留滚动放大和 03 到 04 阶段之间已修复的平滑变形。
- `liquidScene.test.ts` 中 03 到 04 平滑回归测试已由用户测试通过并审查；实现交互后重跑该测试作为防回归，不另行增加重复的浏览器断言。
- 保留手动暂停、系统 reduced-motion、页面可见性与 `high / balanced / low` 质量档位的既有语义。
- 不增加新的 WebGL、粒子或动画依赖，不引入 GPGPU 流体或全局后期链。
- 长按参数不直接凭经验固化。UIKit 和 Android 都有平台自己的长按识别配置，但这不能直接推出 Web 端的 CSS px 阈值。原型应把 `longPressDurationMs` 与 `allowableMovementCssPx` 作为注入参数比较；计划阶段不预设默认数值，需通过桌面、触摸和滚动原型验证后决定。
- 长按前移动超过可调整容差，或收到 `pointercancel`，取消按压识别；通过 `touch-action` 保留页面滚动语义。凹陷深度随按压时间平滑增加并封顶，释放回弹使用可调的时间曲线；原计划中的约 450ms 暂不作为确定验收数值。
- 点击波纹使用固定容量的环形缓冲区，容量由质量档和实际帧时间验证决定；原计划中的“最多 3 个”没有案例依据，不作为确定参数。

## Evidence Audit

本节只把可定位到规范条款、源码或可运行演示的内容称为证据。源码中出现的参数只能证明该案例选择了该值，不能证明该值适用于本项目，也不能单独证明体验质量或性能。

### 证据矩阵

| 来源与可复查位置 | 实际证明 | 不能据此推出 |
| --- | --- | --- |
| [W3C Pointer Events Level 3 §4.1.3.3、§8](https://www.w3.org/TR/pointerevents3/) | 浏览器把触控用于滚动/缩放时会抑制该 pointer stream 并触发 `pointercancel`；页面通过 `touch-action` 声明允许的原生操作。按压状态机必须处理取消，且不能在开始事件后临时修改 `touch-action` 来抢回手势。 | 规范没有给 Web 长按时长、移动阈值或球面手势的 UX 参数。 |
| [Apple UIKit 长按手势说明](https://developer.apple.com/documentation/uikit/handling-long-press-gestures)；[`minimumPressDuration`](https://developer.apple.com/documentation/uikit/uilongpressgesturerecognizer/minimumpressduration)；[`allowableMovement`](https://developer.apple.com/documentation/uikit/uilongpressgesturerecognizer/allowablemovement) | UIKit 把长按建模为有开始、持续和结束阶段的连续手势，并提供识别时长与允许移动距离配置。 | UIKit 的参数属于其平台；不能据此确定浏览器长按阈值或 CSS px 容差。 |
| [Android `ViewConfiguration`](https://developer.android.com/reference/android/view/ViewConfiguration) | Android 提供系统长按时间和 `getScaledTouchSlop()` 设备缩放的滚动触控容差。 | 不提供跨平台 Web 阈值；不能把 Android 像素距离直接抄为 CSS px。 |
| [Three.js Raycaster 官方文档](https://threejs.org/docs/pages/Raycaster) | `setFromCamera()` 接受 NDC 和 Camera，交点数据包含 world-space point、face、UV 等，可用于球面命中与局部坐标映射。 | API 文档证明接口能力，不证明当前项目坐标变换/缩放下命中正确；该点仍须用本项目测试验证。 |
| [Three.js 地形球实验源码 `src/App.js`](https://github.com/sebastianvasquezechavarria1234/terrain-sphere-three-js-shader/blob/main/src/App.js) 及[项目说明](https://github.com/sebastianvasquezechavarria1234/terrain-sphere-three-js-shader) | 可运行实验在球体上做 Raycaster 命中、平滑 hover 状态、click pulse 衰减，并将 `uTime` / `uHover` / `uClick` 更新到 Shader；说明中列出 hover ripple 与 GPU 顶点位移。 | README 中的 `0.08`、`0.92` 等逐帧系数与网格细分是该实验的设置，不是与帧率无关的时间常数，也没有独立基准；不作为本项目参数。 |
| [Material Web `ripple.ts`](https://github.com/material-components/material-web/blob/main/ripple/internal/ripple.ts) | 源码有 `TOUCH_DELAY → HOLDING` 状态、`pointerup` / `pointercancel` 清理；注释明确等待 150ms 是为了区分 swipe/scroll，450ms 是 ripple 扩张动画。 | 这是 UI ripple，不是球面长按；150ms 不是长按时长，450ms 不是本球体的回弹时长。 |
| [Three.js 官方 `webgl_points_waves`](https://github.com/mrdoob/three.js/blob/dev/examples/webgl_points_waves.html)、[`webgl_points_dynamic`](https://github.com/mrdoob/three.js/blob/dev/examples/webgl_points_dynamic.html) | 官方示例使用固定 typed arrays、`BufferGeometry`、`THREE.Points`、`ShaderMaterial` 和 `DynamicDrawUsage` 更新点数据，证明此类粒子数据路径是 Three.js 的现成用法。 | 示例不是球面鼠标尾迹；其中点数、网格尺寸和每帧更新方案不构成本项目粒子预算或移动端性能证据。 |
| [`threejs-cursor-trail` 使用示例与配置](https://github.com/heinergiehl/threejs-cursor-trail/blob/master/EXAMPLES.md) | 文档示例给出 Three.js 鼠标尾迹的粒子池、发射率和寿命配置；样例默认 `maxParticles: 5000`，并建议从小数量开始逐步增加、用 DevTools Performance 检查。 | 这是仓库文档中的示例配置，不是经核验的部署案例或性能基准；5,000 只代表样例值，不能当本项目容量。 |
| [`liquid-ripple` WebGL 项目说明与演示入口](https://github.com/AsimRauf/liquid-ripple) | 仓库展示了单 fragment shader 绘制、由指针位置生成并扩散/消退的水波背景，并提供项目演示入口；可佐证水波视觉和 GPU shader 路径在 Web 中已有实际实现。 | 它是二维背景而非球面顶点形变；仓库首页没有足够证据支持此前写入的固定波纹槽数或任何本项目预算。 |
| [`m1ckc3s/ripple` 可运行 WebGL 案例](https://github.com/m1ckc3s/ripple) | 点击驱动的全屏 fragment shader 案例在接触点绘制软 dimple，并可调 pinch 强度、波前与 easing；这是“凹陷视觉 + 波纹”可组合的二维实例。 | 按下触发的是一次转场；它没有证明凹陷随真实长按持续加深、松手弹簧回弹，也不是 3D 球体顶点位移。 |

### 结论与实现门槛

- 证据分别覆盖了球面射线命中和 Shader 形变、Web 触控取消与长按状态、局部波纹/凹陷视觉、有限寿命粒子池。把这些机制组合到当前 Three.js 球体在工程上有依据，但最终观感、误触率、回弹手感和帧率仍没有现成案例替本项目背书。
- 目前未找到一个可核验案例同时实现“球面长按 → 接触点持续向内凹陷 → 松手弹性恢复 → 移动产生持续粒子尾迹”。因此不将组合效果描述成已经被完整验证的方案。
- 正式首页代码修改前，先制作与现有 `HomeScene` 隔离、可直接删除的原型。原型只验证一处球面交互；记录目标设备、浏览器、质量档、帧时间、滚动取消行为，并对比静止/移动、按住/松开的录屏。原型未达到预先审阅的验收标准，不进入正式场景。
- Web 端长按时长与移动容差不在计划阶段预设，待原型根据目标设备实测决定；平台手势系统的数值不换算成 CSS px。
- Material Web `PRESS_GROW_MS = 450`、`TOUCH_DELAY_MS = 150`、地形球逐帧 easing 系数和尾迹文档中的 `maxParticles: 5000` 都只记作各来源的局部实现/示例数据，不进入本项目验收常量。未核实的 BizUp 拆解细节与 liquid-ripple 槽数已从证据中移除。
- 回弹曲线/时长、凹陷深度/半径、脉冲强度、波纹并发数、粒子发射率/寿命/上限必须由隔离原型在目标设备测量并经用户审阅后确定；当前计划只约束效果边界、取消语义和固定容量结构，不预写经验数值。

## Review Focus

- 指针使用全视口 NDC；缩放、窗口尺寸变化和球体滚动变换后仍须命中正确球面位置。
- 指针在球体之外、离开首页或点击球体周围区域时不产生错误波纹；球面点击只触发一次冲击。
- 快速移动和连续点击不能无限堆积事件或造成亮度、形变跳变；活动点击波纹使用固定容量，新事件替换最早事件，容量由质量档和帧时间验证决定。
- 粗指针设备没有 hover 时，点击仍可触发反馈；低质量档降低尾迹粒子数量，不能改变点击命中语义。
- 短按释放只触发一次点击脉冲；达到长按阈值后保持局部凹陷，释放进入回弹，不同时再触发短按脉冲。
- 长按在移动端不能阻止页面正常滚动；按压移动超过配置容差、指针移动取消与 pointercancel 都要清除待触发状态。
- 手动暂停或系统减少动态效果时，不产生新的尾迹或脉冲；恢复后效果从当前输入状态继续，不补播积压事件。

---

### Task 1: 首页交互事件桥接

**Files:**
- Modify: `frontend/src/graphics/scenes/pageStates.ts`
- Modify: `frontend/src/views/blog/Home.vue`
- Modify: `frontend/src/graphics/scenes/home/HomeScene.ts`
- Test: `frontend/src/graphics/scenes/home/HomeScene.test.ts`
- Create: `frontend/src/views/blog/Home.test.ts`

**Interfaces:**
- `HomePageState` 增加带序号的球体交互事件，区分 `tap`、`press-start` 和 `press-end`，并携带全视口 NDC 坐标。
- 首页交互识别器在配置的长按时间内释放时产生一次 `tap`；按住达到阈值时产生 `press-start`，释放时产生 `press-end`；移动超过配置容差或 pointercancel 时取消。时长和移动容差由隔离原型注入，不预填经验默认值或平台 points 对应的 CSS px 数值。
- `HomeScene` 只在未暂停且非 reduced-motion 时派发新事件；识别成长按的手势释放后不补发 `tap`。

- [ ] **Step 1: Write the failing tests**：验证短按产生一次 tap、达到注入的长按时间后产生按压开始与释放、移动超过注入容差和 pointercancel 会取消、长按释放不生成 tap；验证坐标转成全视口 NDC，`HomeScene` 不重复派发且暂停或 reduced-motion 时不派发。
- [ ] **Step 2: Run focused tests and confirm they fail**：`cd frontend && npm test -- src/views/blog/Home.test.ts src/graphics/scenes/home/HomeScene.test.ts`；预期新增行为断言失败。
- [ ] **Step 3: Add the page-state event bridge**：在首页球体视觉区域识别 tap 与长按，并发布按压开始/结束事件；不要在场景 Canvas 上启用 pointer events，不拦截原生滚动，长按手势结束后抑制浏览器合成的 click。
- [ ] **Step 4: Run the focused tests**：重跑同一命令，预期通过。

### Task 2: 球面指针波纹与点击脉冲

**Files:**
- Modify: `frontend/src/graphics/liquidScene.ts`
- Modify: `frontend/src/graphics/shaders.ts`
- Test: `frontend/src/graphics/liquidScene.test.ts`
- Test: `frontend/src/graphics/shaders.test.ts`

**Interfaces:**
- `LiquidSceneController.triggerRipple(ndcX: number, ndcY: number): boolean`：命中球体时登记一次局部冲击并返回 `true`；未命中或已销毁时返回 `false`。
- `LiquidSceneController.beginPress(ndcX: number, ndcY: number): boolean` 与 `endPress(): void`：开始或结束球面局部按压；凹陷深度由场景时间连续计算，不按帧创建对象。
- 指针悬停使用已有平滑指针输入；Raycaster 未命中球体时清除 hover 响应。
- 使用固定容量的点击波纹环形缓冲区；容量先通过质量档、帧时间和视觉验收确定，再写入接口契约。Shader 使用球面方向与波纹年龄计算向外扩张、逐渐衰减的局部形变和亮度。

- [ ] **Step 1: Write failing scene tests**：覆盖正中球面命中、球体外未命中、固定容量波纹上限、dispose 后不再接受输入、hover 命中与离开，以及按压深度随持有时间增加、达到上限、释放后恢复。
- [ ] **Step 2: Run scene tests and confirm they fail**：`cd frontend && npm test -- src/graphics/liquidScene.test.ts`；预期控制器接口与波纹状态断言失败。
- [ ] **Step 3: Add raycast and bounded ripple state**：在 `liquidScene.ts` 使用现有 Camera / Mesh 做 NDC Raycaster 命中，将固定容量环形缓冲区中的球面方向与开始时间传给 Shader uniforms；容量由质量档和帧时间验证结果注入，动画年龄使用 render 时间，不依赖事件到达时的系统时钟。
- [ ] **Step 4: Write failing shader behavior tests**：验证顶点 Shader 包含随时间扩张并衰减的局部位移，片元 Shader 产生同步环形亮度反馈，且 hover 与点击使用不同强度；测试只锁定机制和能量上限，不把案例中的具体时长或波纹数量写成硬编码契约。
- [ ] **Step 5: Implement the ripple and press response**：在 `shaders.ts` 加入 hover 水波与点击脉冲；按球面方向在局部施加有上限的向内位移，持有期间平滑加深，释放后用阻尼回弹；波峰用平滑包络控制，避免多个冲击叠加导致突然放大。
- [ ] **Step 6: Run focused graphics tests**：`cd frontend && npm test -- src/graphics/liquidScene.test.ts src/graphics/shaders.test.ts src/graphics/scenes/home/HomeScene.test.ts`；预期全部通过。

### Task 3: 持续尾迹与画质适配

**Files:**
- Modify: `frontend/src/graphics/liquidScene.ts`
- Modify: `frontend/src/graphics/shaders.ts`
- Test: `frontend/src/graphics/liquidScene.test.ts`
- Test: `frontend/src/graphics/shaders.test.ts`

**Interfaces:**
- `SceneInput` 增加平滑后的指针速度输入；粒子尾迹沿球体最近运动方向生成，并以有限寿命循环，不逐帧创建或销毁 Three.js 对象。
- 复用现有粒子几何与 quality draw range；`balanced` 和 `low` 继续按既有档位减少活动粒子数量。
- 点击脉冲可短暂增强尾迹密度或亮度，但强度有上限且按时间衰减。

- [ ] **Step 1: Write failing tests**：验证尾迹由指针运动驱动、粒子随生命周期淡出并循环、脉冲能量有界，以及质量档位切换不重建 Renderer 或丢失几何资源。
- [ ] **Step 2: Run focused tests and confirm they fail**：`cd frontend && npm test -- src/graphics/liquidScene.test.ts src/graphics/shaders.test.ts`；预期速度输入与尾迹 Shader 行为断言失败。
- [ ] **Step 3: Pass smoothed movement into the scene**：从 `VisualState.pointerVelocity` 传递有限、平滑的指针速度；静止时尾迹回落到低可见度，不持续维持高亮。
- [ ] **Step 4: Add a bounded procedural trail**：复用现有 Points 与粒子数量上限，在粒子 Shader 中按 seed、时间和运动方向形成连续发射、有限寿命、渐隐的后随粒子；点击冲击只短时增强。
- [ ] **Step 5: Run focused tests**：重跑同一组 graphics 测试，预期全部通过。

### Task 4: 浏览器视觉与交互验收

**Files:**
- Test: `frontend/scripts/quality/multi-page-immersive.mjs`
- Test: `frontend/src/views/blog/Home.test.ts`
- Test: `frontend/src/graphics/scenes/home/HomeScene.test.ts`

- [ ] **Step 1: Extend browser assertions**：在首页桌面与移动尺寸验证 hover 水波、短按脉冲、长按凹陷与释放回弹，以及球外点击无反馈；03 到 04 的平滑性由现有已通过的 `liquidScene.test.ts` 回归测试覆盖。
- [ ] **Step 2: Verify motion and quality modes**：验证手动暂停、`prefers-reduced-motion` 和低质量档下没有持续尾迹堆积，DOM 页面操作仍可用。
- [ ] **Step 3: Run validation**：执行 `cd frontend && npm test -- src/views/blog/Home.test.ts src/graphics/liquidScene.test.ts src/graphics/scenes/home/HomeScene.test.ts src/graphics/shaders.test.ts`、`cd frontend && npm run build`、`cd frontend && npm run test:immersive`；预期测试、类型构建和浏览器验收通过。
- [ ] **Step 4: Inspect desktop and mobile screenshots**：检查球体在首屏的可读性、按压凹陷与回弹是否自然、尾迹是否抢过标题和故事轨道。
