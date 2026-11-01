# 阶段 3：原创自适应画质实验

## 本轮范围

- 日期：2026-11-01（Asia/Shanghai）。
- 分支：`codex/blog-v1.2`；Task 6 提交 `46eb499`，Task 7 后续提交为 `fd268e1`。本记录保留实验当时的数据，最终验收及修复以记录 23/24 为准。
- 浏览器：Chromium `141.0.7390.37`，Playwright Python `sync_api`。
- 运行场景：开发服务器 `5173` 做强制帧时间和生命周期断言；生产预览 `4173` 做性能与包体积复测。
- 网络：生产复测使用下载 `1.6 Mbps`、上传 `750 kbps`、延迟 `150 ms`；每个样本使用新的浏览器上下文和禁用缓存。
- 视口：桌面 `1440 × 900` DPR 1；移动 `390 × 844` DPR 2。
- 原始证据：
  - 强制转换与生命周期：`output/playwright/v1.2-20261101/adaptive-quality.json`。
  - 三次桌面/移动性能样本：`output/playwright/v1.2-20261101/adaptive-quality-performance.json`。
  - 构建与包体积：`output/playwright/v1.2-20261101/task7-build-green.log`、`task7-build-repeat.log`。
- 本轮没有查看或生成视觉截图；浏览器复测使用 DOM、网络、帧标记、画布 backing-store 尺寸和生命周期断言。

## 证据

### 实现边界（E2）

- `frontend/src/graphics/quality.ts` 只包含纯函数和常量，没有 DOM 或 Three.js import。
- `frameTimeEma` 使用 `alpha=0.12`，把有限负数限制到 `0`，非有限采样保留上一个有限结果。
- `resolveQualityState` 采用方向迟滞：`high → balanced` 为 EMA `≥19ms` 连续 `45` 帧，`balanced → low` 为 EMA `≥28ms` 连续 `45` 帧，`low → balanced` 为 EMA `<25ms` 连续 `90` 帧，`balanced → high` 为 EMA `<16ms` 连续 `90` 帧；反向计数在换方向时清零。
- `frontend/src/graphics/liquidScene.ts:32-37,123-177` 新增 `setQualityTier`，只改变粒子 `drawRange` 和 DPR 上限。初始设备质量档位作为上限；`balanced` 粒子数为设备上限的 `75%` 但不少于 `42`，`low` 不少于 `42`，不会重建几何体，也不会改变场景语义。
- `frontend/src/components/immersive/ImmersiveScene.vue:18-25,57-87` 在可见、播放中的绘制帧内采样帧时间；暂停、离屏、隐藏、减少动态效果和静态后备路径不更新 EMA。质量变化只写入 `data-quality-tier` 与 `data-quality-updates`，供浏览器证据读取。
- `window.__setSceneFrameTime` 只在开发环境注册，用于确定性实验；生产构建中不保留这个调试入口。

### 纯函数和强制转换复测（E1）

- 红灯：`npm --prefix frontend run test -- --run src/graphics/quality.test.ts` 在 `quality.ts` 不存在时因模块缺失失败。
- 绿灯：新增实现后 `quality.test.ts` 与 `motion.test.ts` 共 `2` 个文件、`26` 项测试通过。
- 强制帧时间路径：

| 阶段 | 触发帧时间 | 质量档位 | 更新计数 | 帧标记 |
| --- | ---: | --- | ---: | ---: |
| 初始 | — | `high` | 0 | 3 |
| 降档 1 | `24ms` | `balanced` | 1 | 46 |
| 降档 2 | `32ms` | `low` | 2 | 96 |
| 恢复 1 | `12ms` | `balanced` | 3 | 189 |
| 恢复 2 | `12ms` | `high` | 4 | 279 |

质量变化间隔为 `50、93、90` 帧，满足至少 `45` 帧的变化间隔，没有单帧抖动或来回切换。

### 生命周期复测（E1）

- 桌面离屏：状态 `playing → paused`，帧标记在 `300ms` 观察窗口内保持不变。
- 移动 DPR 2 离屏：状态为 `paused`，帧标记在 `300ms` 观察窗口内保持不变。
- 合成隐藏事件：状态为 `paused`，帧标记保持不变；本轮脚本明确标记为 `synthetic-visibilitychange`，不宣称是真实后台标签页功耗测量。
- 路由卸载：画布移除后，`300ms` 内 frame mutation 数保持不变。
- `prefers-reduced-motion: reduce`：移动 DPR 2 下场景状态为 `static`、帧标记为 `0`，没有 `liquidScene` 或 Three.js 请求。
- WebGL 创建失败：移动 DPR 2 下状态为 `static`、帧标记为 `0`，CSS poster 可见。

### 性能与包体积复测（E1）

生产预览使用新的浏览器上下文各采集三次，首页等待内容稳定两秒，再采集 `180` 个 rAF 间隔样本；之后执行与阶段 1 相同的搜索—文章交互，记录 LCP、INP candidate 和 long task。当前实验原始值如下：

| 视口 | LCP 中位数 | INP candidate 中位数 | 帧间隔 p50 / p95 / p99 中位数 | long task 样本数 | 画布 backing DPR |
| --- | ---: | ---: | --- | --- | ---: |
| 桌面 1440×900 | `1304ms` | `56ms` | `16.7 / 16.7 / 16.8ms` | `2, 2, 2` | `0.998` |
| 移动 390×844@2 | `1296ms` | `48ms` | `16.7 / 16.7 / 16.8ms` | `2, 2, 2` | `1.249` |

冻结阶段 1 的历史首页 LCP 中位数为桌面约 `2952ms`、移动约 `2952ms`，但本轮当前预览的导航 `DOMContentLoaded` 也明显早于冻结样本；因此这里只报告两组原始数据，不把 LCP 差异归因于自适应画质。历史动效记录中的帧间隔为 p50 `16.7ms`、p95 `16.9ms`、p99 `17.4ms`；当前三次样本的 p95/p99 未高于该历史记录。

包体积对照：

| 资源 | Task 5 冻结 | Task 7 当前 | 变化 | 门禁 |
| --- | ---: | ---: | ---: | --- |
| 公共主 JS 原始 | `154,473 B` | `154,473 B` | `0 B` | 通过 |
| 公共主 JS gzip | `60,298 B` | `60,299 B` | `+1 B` | 严格零增长残余风险 |
| 全局 CSS gzip | `2,253 B` | `2,253 B` | `0 B` | 通过 |
| `liquidScene` gzip | `131.99 kB` | `132.18 kB` | 约 `+0.14%` | `≤5%` 通过 |

公共主入口原始体积没有增长，gzip 多出的 `1 B` 来自异步 chunk 哈希变化写入入口依赖表；这不是新增公共运行时模块，但按计划的严格规则仍保留为发布残余风险。`npm --prefix frontend run check:bundle` 通过，公共主 JS 远低于 `230 kB` gzip 门禁，全局 CSS 远低于 `20 kB` gzip 门禁。

## 实验

- 假设：在不改变内容、场景语义或生命周期边界的前提下，EMA 加方向迟滞只降低 DPR 上限和粒子绘制数量，可以保护慢帧并避免画质档位抖动。
- 主要变量：质量档位的 DPR cap 与粒子 `drawRange`。
- 固定变量：原创场景几何、着色器、文案、滚动模型、静态后备、reduced-motion 路径和生命周期处理。
- 成功判据：纯函数门禁通过；强制路径按四条规则转换；正常三次样本不发生异常档位变化；`liquidScene` gzip 增长不超过 `5%`；主入口原始体积不增长；离屏/隐藏/卸载/reduced-motion/WebGL 失败路径保持通过。
- 失败判据：质量抖动、主入口实际代码体积增长、`liquidScene` 超过 `5%`、动态效果路径下载异常、静态后备或资源释放回归。

## 复测结果

- 单元测试：`2` 文件、`26` 项通过。
- 浏览器强制转换：通过，质量历史为 `balanced → low → balanced → high`，变化间隔 `50、93、90` 帧。
- 浏览器生命周期：桌面、移动 DPR 2、合成隐藏、卸载、reduced-motion 和 WebGL 失败全部通过。
- 构建：`npm --prefix frontend run build` 通过。
- 包体积：`npm --prefix frontend run check:bundle` 通过；`liquidScene` 增长约 `0.14%`。
- 视觉截图：按用户约束未查看；本轮没有给出视觉无回归结论，仍需在人工视觉验收时复核。
- 真实后台标签页：未在操作系统级后台窗口复测；当前结论只覆盖浏览器事件处理路径。

## 下一步假设

唯一优先假设：在保留自适应画质和生命周期门控的前提下，按最终发布协议复测全部公共与后台路线；若公共主 JS gzip 的 `+1 B` 无法通过稳定 chunk 命名或构建协议消除，则按严格规则回滚 Task 7 的运行时代码，只保留研究记录。

2026-11-01 发布复核补记：最终具名图标导入与请求错误保护修复后，三次公共主 JS gzip 均为 `60,288 B`，小于 Task 5 的 `60,298 B`，上述 `+1 B` 已消除。原始入口另增加 `12 B`，原因与裁决在记录 24 中单列。最终三路线性能为记录 23 的 18 个独立样本，不把本记录的历史帧间隔数字混写为最后复测。
