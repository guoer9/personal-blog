# 阶段 1 续：文章详情失败状态的重复通知

日期：2026-11-01（Asia/Shanghai）

## 本轮范围

本轮仍处于阶段 1“现有站点体验审计”，只推进第 14 轮留下的唯一优先假设：文章详情接口返回 `503` 时，页面内错误状态与全局请求 toast 是否重复传达同一失败；若重复，仅让 `getPost()` 复用已有的静默错误选项。

覆盖范围：

- 桌面视口 `1280 × 720`。
- 移动视口 `390 × 844`。
- 移动视口 `390 × 844` 且 `prefers-reduced-motion: reduce`。
- 三种场景分别在 `0ms` 和 `1200ms` 响应延迟下复测。
- Playwright CLI 驱动的 Headless Chromium `156.0.0.0`，本地 Vite 开发服务器 `http://127.0.0.1:5173/`。
- 拦截文章接口并固定返回 `503`，原创错误夹具为 `{"detail":"unavailable"}`。
- 相关文件：`frontend/src/api/posts.ts`、`frontend/src/utils/request.ts`、`frontend/src/views/blog/PostDetail.vue`。

本轮不进入 DDW 结构拆解，不改变错误页文案，不扩展为评论、搜索或全站 API 的统一通知策略，也不复制 Lusion 的素材、着色器、模型、音频或文案。

## 证据

### E1：修复前的重复通知基线

原始输出：`output/playwright/baseline-audit-20261101/post-detail-toast-baseline-round15.txt`。

每次导航先回到 `about:blank`，再打开 `/post/round15-failure#discussion`，等待 `.article-state` 出现并稳定 `600ms` 后采集 DOM。

| 场景 | 页面内错误 | 可见 toast | toast 文案 | 活动元素 | `scrollY` | 横向溢出 |
| --- | --- | ---: | --- | --- | ---: | ---: |
| 桌面 | `503 / INTERRUPTED` | 1 | `unavailable` | `BODY` | 0 | 0 |
| 移动 | `503 / INTERRUPTED` | 1 | `unavailable` | `BODY` | 0 | 0 |
| 移动 + reduced motion | `503 / INTERRUPTED` | 1 | `unavailable` | `BODY` | 0 | 0 |

toast 节点带 `role="alert"`，宽度和高度都非零。三种场景均同时显示“文章暂时无法加载。”错误页和 `unavailable` toast，重复通知成立；首次 `Tab` 均为“跳到正文”。

### E2：源码与既有机制

源码事实：

- `frontend/src/utils/request.ts:34-75`：响应拦截器读取 `error.config?.suppressErrorToast`；普通 HTTP 失败会调用 `ElMessage.error()`，带有静默选项时跳过 toast。
- `frontend/src/api/posts.ts:54-60`：`searchPosts()` 已使用 `suppressErrorToast: true`，说明这已经是站内既有机制。
- `frontend/src/api/comments.ts:24-30`：评论读取也使用同一静默机制。
- `frontend/src/views/blog/PostDetail.vue:39-61`：文章失败由页面捕获，并分别设置 `notFound` 与 `loadError`。
- `frontend/src/views/blog/PostDetail.vue:212-224`：失败分支固定渲染状态码、说明、重试与离开动作，已经具备完整页面内恢复入口。
- 修复前 `frontend/src/api/posts.ts:62-65` 的 `getPost()` 没有传静默选项，因此页面与全局拦截器对同一次失败各通知一次。

### E3：与第 14 轮的关系

第 14 轮已复测 `503` 深链的错误页、`BODY` 起点、`scrollY: 0`、首次 `Tab` 和横向溢出，记录为 `docs/research/14-post-detail-failure-deep-link.md`。本轮复用相同失败边界，但新增通知计数；没有把第 14 轮的历史结果当作本轮修复后的结果。

## 实验

**假设：** 文章详情页已经有持久、可操作的页面内错误状态，因此 `getPost()` 应抑制全局 toast；这不会改变失败页、焦点起点、滚动位置或布局。

**单变量变更：**

- `frontend/src/api/posts.ts`：`getPost()` 增加 `{ suppressErrorToast: true }`。
- 新增 `frontend/src/api/posts.test.ts`：锁定详情请求携带静默选项。
- 不修改拦截器、错误页模板或全局路由。

**成功判据：**

- 三种基础场景不再出现 toast，但 `503 / INTERRUPTED` 错误页仍完整。
- 活动元素保持 `BODY`，`scrollY` 为 `0`，无讨论区节点，横向溢出为 `0`。
- 首次 `Tab` 仍为“跳到正文”。
- 三种 `1200ms` 延迟场景得到相同结果。
- 目标测试、全量测试、生产构建和差异检查通过。

**失败判据：** 错误页丢失、toast 仍出现、焦点或滚动改变、布局溢出、测试或构建失败。

**停止条件：** 只验证文章详情读取失败；不扩展到 404、评论、搜索或其他 API，也不评估全站统一通知架构。

## 复测结果

### 测试先行

- 红灯：`output/playwright/baseline-audit-20261101/post-detail-toast-red-round15.txt`。新增测试失败，因为 `getPost()` 只传了 URL，没有传静默配置。
- 修复后目标测试：`output/playwright/baseline-audit-20261101/post-detail-toast-green-round15.txt`，`1/1` 通过。

### 浏览器复测

基础场景原始输出：`output/playwright/baseline-audit-20261101/post-detail-toast-recheck-round15.txt`。

| 场景 | 页面内错误 | toast 数 | 活动元素 | `scrollY` | 讨论区 | 横向溢出 | 首次 Tab |
| --- | --- | ---: | --- | ---: | --- | ---: | --- |
| 桌面 | `503 / INTERRUPTED` | 0 | `BODY` | 0 | 不存在 | 0 | “跳到正文” |
| 移动 | `503 / INTERRUPTED` | 0 | `BODY` | 0 | 不存在 | 0 | “跳到正文” |
| 移动 + reduced motion | `503 / INTERRUPTED` | 0 | `BODY` | 0 | 不存在 | 0 | “跳到正文” |

`1200ms` 延迟复测原始输出：`output/playwright/baseline-audit-20261101/post-detail-toast-delayed-recheck-round15.txt`。

| 场景 | 响应延迟 | 页面内错误 | toast 数 | 活动元素 | `scrollY` | 横向溢出 | 首次 Tab |
| --- | ---: | --- | ---: | --- | ---: | ---: | --- |
| 桌面 | 1200ms | “文章暂时无法加载。” | 0 | `BODY` | 0 | 0 | “跳到正文” |
| 移动 | 1200ms | “文章暂时无法加载。” | 0 | `BODY` | 0 | 0 | “跳到正文” |
| 移动 + reduced motion | 1200ms | “文章暂时无法加载。” | 0 | `BODY` | 0 | 0 | “跳到正文” |

截图：

- `output/playwright/baseline-audit-20261101/post-detail-toast-green-desktop-round15.png`
- `output/playwright/baseline-audit-20261101/post-detail-toast-green-mobile-round15.png`
- `output/playwright/baseline-audit-20261101/post-detail-toast-green-mobile-reduced-round15.png`

视觉检查确认错误页标题、说明和三个恢复动作完整，桌面与移动均无 toast、裁切或重叠。

### 工程验证

- 全量测试：`output/playwright/baseline-audit-20261101/test-round15.txt`，`10` 个测试文件、`45` 个测试通过。
- 生产构建：`output/playwright/baseline-audit-20261101/build-round15.txt`，类型检查与 Vite 构建通过。
- `PostDetail` 懒加载块：`11.45 kB`，gzip `4.76 kB`，与第 14 轮相同；本轮 API 调用配置未增加该路由块体积。
- 差异检查：`output/playwright/baseline-audit-20261101/diff-check-round15.txt`，写文档后重新执行。

**结论：** 在确定性 `503`、三种视口/动态偏好和两种响应延迟范围内，重复通知已消除；页面内错误状态仍是唯一通知，恢复入口、焦点起点、顶部滚动和响应式布局无回归。该结果不覆盖真实读屏播报、网络错误、404、重试成功或全站其他 API。

## 下一步假设

**下一轮唯一优先假设：** 直接打开 `/post/:slug#discussion` 且文章接口返回 `404` 时，应保留“这篇文章不在档案里”错误页、保持 `BODY` 与 `scrollY: 0`、无重复 toast、无横向溢出，首次 `Tab` 仍为“跳到正文”。

阻塞条件：只验证文章 `404` 失败路径，不扩展到全站错误处理、评论、搜索或重试成功后的恢复。

## 本轮结论

### 完成项

- 真实浏览器确认文章 `503` 同时产生页面内错误和全局 toast，三种场景稳定复现。
- 通过红灯测试锁定 `getPost()` 缺少 `suppressErrorToast: true`。
- 让文章详情复用既有静默错误机制，保留页面内单一恢复入口。
- 复测基础与 `1200ms` 延迟共六种组合，toast 均消失，焦点、滚动和布局无回归。
- 完成目标测试、全量测试、生产构建和差异检查。
- 未复制 Lusion 的素材、着色器、模型、音频或文案。

### 未决项

- 未验证文章 `404` 深链的通知、焦点和错误页边界。
- 未验证真实网络断开、请求超时、请求中断和重试成功路径。
- 未使用真实 VoiceOver、Safari 或 Firefox 验证播报次数与顺序。
- 未改变全站其他 API 的通知策略；评论写操作、管理端错误等仍按各自路径处理。
- 前轮全站其他页面与性能审计仍有未完成项。

### 下一轮唯一优先假设

下一轮只验证：**文章接口返回 `404` 且直接打开 `#discussion` 时，错误页、焦点、滚动、通知、键盘入口和布局是否保持正确。** 完成该实验或达到停止条件后停止，等待下一次调度。
