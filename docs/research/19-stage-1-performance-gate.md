# 阶段 1 性能门禁

## 本轮范围

- 日期：2026-11-01（Asia/Shanghai）。
- 分支：`codex/blog-v1.2`。
- 任务：Task 4，建立 v1.2 拆包和自适应画质实验使用的生产预览性能基线。
- 构建：`npm --prefix frontend run build`，使用当前 `frontend/dist`。
- 服务：`npm --prefix frontend run preview -- --host 127.0.0.1 --port 4173`。
- 浏览器：Playwright Chromium `141.0.7390.37`，无头模式。
- 视口：桌面 `1440x900`、DPR 1；移动 `390x844`、DPR 2。
- 网络：Chrome DevTools Protocol 限速，下载 `1.6 Mbps`、上传 `750 kbps`、延迟 `150 ms`。
- 缓存：每个样本新建浏览器上下文，并调用 `Network.setCacheDisabled`；每个路由各采样 3 次。
- 路由：`/`、`/writing`、`/post/perf-fixture`；首页额外执行打开搜索、输入关键词、提交、聚焦结果、打开文章的交互路径。
- API：Playwright 拦截全部 `**/api/v1/**` 请求并返回原创固定夹具；响应即时完成，因此本轮不测量后端 API 延迟。
- 原始证据：`output/playwright/v1.2-20261101/performance-baseline.json`、`performance-baseline-desktop.zip`、`performance-baseline-mobile.zip`。

## 证据

### E1：采样完整性

- 共完成 `18` 个冷上下文样本：2 个视口 × 3 条路由 × 3 次。
- 每个样本都记录了导航计时、LCP 条目、事件条目、长任务、资源 Timing 的传输/编码/解码字节和观察器错误。
- 观察器错误为 `0`；首页每个样本至少捕获一组带 `interactionId` 的事件。
- 首页交互三次均到达 `/post/perf-fixture`，文章标题为 `Measuring a Quiet Interface`。

### E1：LCP、INP candidate 和长任务

以下数值是每组三次样本的中位数，括号内为最小—最大值。LCP 来自 `largest-contentful-paint`；INP candidate 取本轮交互事件中最长的事件条目，属于实验室候选值，不等同于现场 INP。

| 视口 | 路由 | LCP 中位数 | INP candidate 中位数 | 长任务次数/样本 | 单样本长任务总时长中位数 |
| --- | --- | ---: | ---: | ---: | ---: |
| 桌面 | `/` | `2952 ms`（2932–3040） | `64 ms`（56–80） | 1–4 | `362 ms`（241–448） |
| 桌面 | `/writing` | `3548 ms`（3516–3560） | 未执行交互 | 0–1 | `0 ms`（0–91） |
| 桌面 | `/post/perf-fixture` | `3136 ms`（3132–3136） | 未执行交互 | 0 | `0 ms` |
| 移动 | `/` | `2952 ms`（2944–2952） | `56 ms`（48–64） | 1–2 | `256 ms`（199–359） |
| 移动 | `/writing` | `3516 ms`（3500–3524） | 未执行交互 | 0 | `0 ms` |
| 移动 | `/post/perf-fixture` | `3136 ms`（3128–3144） | 未执行交互 | 0 | `0 ms` |

首页三次采样都存在超过 `200 ms` 的长任务：桌面最大单条 `271 ms`，移动最大单条 `359 ms`。当前基线尚未满足全局目标 LCP `≤ 2500 ms` 和“没有新增超过 `200 ms` 的长任务”；这些结果作为优化前事实保留，不能当作 v1.2 通过结果。

### E1：资源传输与解码

Vite 构建输出是后续对照的包体积口径；Resource Timing 的 `encodedBodySize` 作为浏览器实际解码前传输证据。当前构建中没有字体或图片资源请求。

| 资源 | 原始体积 | Vite gzip | 浏览器编码体积 | 浏览器解码体积 |
| --- | ---: | ---: | ---: | ---: |
| 公共主 JS `index-HZE2qora.js` | `1,067,825 B` | `353.17 kB` | `353,167 B` | `1,067,825 B` |
| 全局 CSS `index-CV272lm5.css` | `355,641 B` | `49.24 kB` | `49,237 B` | `355,641 B` |
| 延迟场景 `liquidScene-DHbcNesg.js` | `526,428 B` | `131.99 kB` | `131,990 B` | `526,428 B` |

桌面首页样本的资源 Timing 还确认：主 JS 传输耗时约 `2174–2180 ms`，全局 CSS 约 `652–658 ms`，`liquidScene` 约 `848–904 ms`。这些开销发生在固定慢网条件下，说明公共首屏和场景块仍是 Task 5/7 的主要测量对象。

### E1：源码定位

- `frontend/src/views/blog/Home.vue:16-66,130`：首页首屏并行加载文章/标签，挂载 `ImmersiveScene`。
- `frontend/src/components/immersive/ImmersiveScene.vue:121-145`：场景通过动态 import 加载 `liquidScene`。
- `frontend/src/graphics/liquidScene.ts:69-121`：创建 Three.js 场景、几何体、材质和粒子资源。
- `frontend/src/router/index.ts:4-84`：公共页面通过路由级动态 import 分发。

## 实验

**假设：** 在固定生产构建、冷缓存、慢网和原创 API 夹具下，三次采样可以稳定揭示公共首屏的主 JS、全局 CSS、`liquidScene`、LCP、交互事件和长任务基线，供 Task 5 与 Task 8 使用。

**变更：** 新增被忽略的 `output/playwright/v1.2-20261101/performance-baseline.py`。脚本只读取生产构建并拦截 API，不读取或修改真实数据库，也不使用参考站点素材、着色器、模型、音频或文案。

**成功判据：** 2 个视口、3 条公共路线、每条 3 次冷上下文采样；每次有 LCP 和资源数据；首页交互产生至少一个带 `interactionId` 的事件；桌面与移动 trace 均保存；结果能区分压缩传输体积与解码体积。

**停止条件：** 首屏性能基线完成后停止，不在本轮引入拆包、自适应画质或视觉行为改动。

## 复测结果

- 18/18 样本完成，原始 JSON 写入 `output/playwright/v1.2-20261101/performance-baseline.json`。
- 桌面与移动 trace 均生成，分别为 `performance-baseline-desktop.zip` 和 `performance-baseline-mobile.zip`。
- 首页交互路径 6/6 到达文章详情；事件观察器在 6 个首页样本中均捕获到交互事件。
- 主 JS、全局 CSS 与 `liquidScene` 的 Vite gzip 数字与冻结基线一致：`353.17 kB`、`49.24 kB`、`131.99 kB`。
- 由于这是优化前基线，LCP 和长任务目标尚未满足；该事实不会阻止阶段 1 研究证据关闭，但会阻止把当前构建标为交付通过。

## 阶段门禁结论

阶段 1 的性能采集门禁可以关闭：规定的视口、网络、缓存、路由、样本数、交互、资源、长任务和 trace 证据均已留下。性能交付门禁保持未通过，原因是冻结构建的公共主 JS、全局 CSS、LCP 和长任务数据仍高于 v1.2 目标；Task 5 必须先完成公共入口拆分，再用相同协议复测。

## 未验证项

- API 响应为本地即时夹具，不能代表真实后端延迟、认证状态或生产网络。
- 未覆盖 Firefox、Safari、真实 iOS/Android 设备、低端 CPU、合盖睡眠和其他网络配置。
- INP 仅为本轮人工交互产生的实验室候选值，未替代真实用户 INP。
- 没有通过图片查看判断视觉回归；后续视觉相关门禁继续使用 DOM、网络、焦点、滚动、帧标记和溢出断言。

## 下一步假设

**唯一优先验证点：** 将 Element Plus、全局 UI CSS、中文语言包和后台图标从公共入口移出后，在相同生产预览协议下验证公共主 JS gzip `≤ 230 kB`、全局 CSS gzip `≤ 20 kB`，并复测认证/后台路径仍能按需加载 UI。

## 本轮结论

### 完成项

- 完成阶段 1 性能三次采样基线。
- 记录首页、归档、文章的 LCP、首页交互 INP candidate、长任务和资源传输数据。
- 保存桌面/移动 Chrome trace 和原始 JSON。
- 确认性能主成本集中在公共主 JS、全局 CSS 和延迟 `liquidScene`。

### 未决项

- 当前公共包体积和首屏性能目标未通过，等待 Task 5/Task 8 的对照复测。
- 真实 API 延迟、真实设备和其他浏览器仍未验证。

### 下一轮唯一优先假设

先拆分 Element Plus 公共入口，再用包体积门禁和公共/后台浏览器网络矩阵验证拆分没有破坏认证、后台和反馈交互。
