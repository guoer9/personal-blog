# 阶段 1 续：文章详情的讨论区深层链接时序

日期：2026-11-01（Asia/Shanghai）

## 本轮范围

本轮仍处于阶段 1“现有站点体验审计”，只推进第 12 轮留下的唯一优先假设：直接打开 `/post/:slug#discussion` 时，文章异步加载完成后是否应把键盘焦点移到讨论区；同时确认普通文章入口仍落在 `BODY`，首次 `Tab` 仍为“跳到正文”。

覆盖范围：

- 桌面视口 `1280 × 720`。
- 移动视口 `390 × 844`。
- 移动视口 `390 × 844` 且 `prefers-reduced-motion: reduce`。
- Playwright CLI 驱动的 Headless Chromium `156.0.0.0`，本地 Vite 开发服务器 `http://127.0.0.1:5173/`。
- 拦截文章与评论接口，使用本轮原创标题、正文和空评论夹具；不复制 Lusion 的素材、着色器、模型、音频或文案。
- 相关文件：`frontend/src/router/index.ts`、`frontend/src/style.css`、`frontend/src/views/blog/PostDetail.vue`、`frontend/src/views/blog/PostDetail.test.ts`。

本轮不进入 DDW 结构拆解，不扩展为全站路由焦点策略。

## 证据

### E1：干净冷启动下的直接深层链接基线

基线原始输出：`output/playwright/baseline-audit-20261101/browser-post-discussion-direct-clean-round13.txt`。

每次场景先导航到 `about:blank`，再打开 `/post/round13-deep-link#discussion`，等待文章与空评论状态出现后读取状态：

| 场景 | 活动元素 | `scrollY` | 讨论区顶部 | 横向溢出 |
| --- | --- | ---: | ---: | ---: |
| 桌面 | `BODY` | 0 | 1381px | 0 |
| 移动 | `BODY` | 0 | 1518px | 0 |
| 移动 + reduced motion | `BODY` | 0 | 1518px | 0 |

因此，浏览器保留了 URL 哈希 `#discussion`，但异步文章出现后没有滚动到讨论区，也没有把焦点带过去。先前的连续复用页面实验出现过混合状态，不能作为干净基线；本轮以此冷启动结果为准。

浏览器控制台同时记录了 Vue Router 警告：`Couldn't find element using selector "#discussion" returned by scrollBehavior.`。原始日志见 `.playwright-cli/console-2026-11-01T01-55-18-471Z.log:3`。

### E2：路由时序、源码与测试

源码事实：

- `frontend/src/router/index.ts:6-10`：路由的 `scrollBehavior` 在存在 hash 时返回 `{ el: to.hash, behavior: 'smooth', top: 92 }`。
- `frontend/src/views/blog/PostDetail.vue:39-67`：文章由 `fetchPost()` 异步加载；目标节点只有在文章响应成功并完成渲染后才存在。
- 初始加载时，路由已经在异步文章节点挂载前处理 `#discussion`，与浏览器控制台警告一致。
- `frontend/src/views/blog/PostDetail.vue:147-155`：新增 `focusDiscussionDeepLink()`，先使用 `focus({ preventScroll: true })` 将活动元素设为讨论区，再按动态偏好选择 `smooth` 或 `auto` 并调用 `scrollIntoView({ block: 'start' })`。
- `frontend/src/style.css:21`：全局 `[id] { scroll-margin-top: 92px; }` 让显式滚动停在固定偏移，而不是贴住视口顶部。
- `frontend/src/views/blog/PostDetail.vue:282`：讨论区已有 `tabindex="-1"`，可作为脚本焦点目标，但不会进入正常 `Tab` 顺序。

测试位置：

- `frontend/src/views/blog/PostDetail.test.ts:150-156`：直接打开带 `#discussion` 的文章路径后，焦点应进入讨论区。
- `frontend/src/views/blog/PostDetail.test.ts:158-164`：普通文章入口的活动元素仍为 `document.body`。
- `frontend/src/views/blog/PostDetail.test.ts:166-174`：文章返回 `503`、讨论区不存在时，不尝试聚焦。

### E3：与第 12 轮的关系

- 第 12 轮记录：`docs/research/12-post-detail-keyboard-reading-start.md`。该轮已修复显式点击“参与讨论”后的焦点落点，并把直接 hash 深层链接保留为未决项。
- 第 12 轮结论已由本轮冷启动基线复测，无需补测：普通入口仍是 `BODY`，首次 `Tab` 仍是“跳到正文”；点击“参与讨论”仍进入讨论区。
- 本轮只补齐“文章异步完成后、URL 已带 `#discussion`”的时序，不改路由全局滚动策略。

## 实验

**假设：** 在文章成功加载并完成 DOM 更新后，仅当当前 URL 精确包含 `#discussion` 时聚焦讨论区，可以让深层链接把键盘用户带到目标内容，同时不改变普通文章入口、错误页和全站 hash 行为。

**变更范围：**

- `frontend/src/views/blog/PostDetail.vue`
- `frontend/src/views/blog/PostDetail.test.ts`

**变量：**

- 响应延迟：`0ms` 与 `1200ms`。
- 视口与动态偏好：桌面、移动、移动 + reduced motion。
- 入口：直接深层链接、普通文章入口、显式点击“参与讨论”。

**成功判据：**

- 直接深层链接在文章成功后活动元素为 `SECTION#discussion`。
- 讨论区顶部保持约 `92px`，且 reduced motion 不执行平滑滚动。
- 普通文章入口活动元素仍为 `BODY`，首次 `Tab` 仍为“跳到正文”。
- 文章加载失败时不聚焦、不滚动不存在的目标。
- 无横向溢出、无可见整块焦点轮廓。
- 目标测试、全量测试、生产构建和 `git diff --check` 通过。

**停止条件：** 出现普通入口焦点改变、跳过链接失效、讨论区滚动偏移错误、横向溢出、错误页异常聚焦、测试或构建失败时停止并记录；不扩展为全站焦点管理或路由滚动策略重构。

实现先产生了有效红灯：`output/playwright/baseline-audit-20261101/post-discussion-direct-red-round13.txt` 中，深层链接测试实际仍为 `<body>`，其余 5 项通过。

首版聚焦修复也暴露了滚动偏移问题。原始输出：`output/playwright/baseline-audit-20261101/browser-post-discussion-direct-current-round13.txt`。

| 场景 | 活动元素 | 讨论区顶部 | 滚动位置 |
| --- | --- | ---: | ---: |
| 桌面 | `SECTION#discussion` | 73px | 1308px |
| 移动 | `SECTION#discussion` | 29px | 1489px |
| 移动 + reduced motion | `SECTION#discussion` | 29px | 1489px |

焦点已经正确，但浏览器默认聚焦滚动与固定偏移叠加，使目标没有停在统一的 `92px`。随后改为 `focus({ preventScroll: true })` 加显式 `scrollIntoView`，并未修改路由全局行为。

## 复测结果

最终六场景原始输出：`output/playwright/baseline-audit-20261101/browser-post-discussion-direct-offset-round13.txt`。

| 场景 | 响应延迟 | 活动元素 | 讨论区顶部 | `scrollY` | 横向溢出 |
| --- | ---: | --- | ---: | ---: | ---: |
| 桌面 | 0ms | `SECTION#discussion` | 92px | 1289px | 0 |
| 移动 | 0ms | `SECTION#discussion` | 92px | 1426px | 0 |
| 移动 + reduced motion | 0ms | `SECTION#discussion` | 92px | 1426px | 0 |
| 桌面 | 1200ms | `SECTION#discussion` | 92px | 1289px | 0 |
| 移动 | 1200ms | `SECTION#discussion` | 92px | 1426px | 0 |
| 移动 + reduced motion | 1200ms | `SECTION#discussion` | 92px | 1426px | 0 |

六场景的 hash 均保留为 `#discussion`，讨论区计算样式均未显示可见轮廓，横向溢出均为 `0`。

普通入口与点击锚点回归原始输出：`output/playwright/baseline-audit-20261101/browser-post-deep-link-regression-round13.txt`。

| 场景 | 普通入口 | 首次 Tab | 点击“参与讨论”后 | 讨论区顶部 | 横向溢出 |
| --- | --- | --- | --- | ---: | ---: |
| 桌面 | `BODY`，`scrollY: 0` | `A.skip-link`“跳到正文” | `SECTION#discussion` | 92px | 0 |
| 移动 | `BODY`，`scrollY: 0` | `A.skip-link`“跳到正文” | `SECTION#discussion` | 92px | 0 |
| 移动 + reduced motion | `BODY`，`scrollY: 0` | `A.skip-link`“跳到正文” | `SECTION#discussion` | 92px | 0 |

验证记录：

- 目标测试：`output/playwright/baseline-audit-20261101/post-discussion-direct-edge-green-round13.txt`，`7/7` 通过。
- 全量测试：`output/playwright/baseline-audit-20261101/test-round13.txt`，`9` 个测试文件、`44` 个测试通过。
- 生产构建：`output/playwright/baseline-audit-20261101/build-round13.txt`，类型检查与 Vite 构建通过。`PostDetail` 懒加载块为 `11.45 kB`（gzip `4.76 kB`）；第 12 轮为 `11.18 kB`（gzip `4.69 kB`），约增加 `0.27 kB`（gzip `0.07 kB`），原有分块警告未变化。
- 差异检查：`output/playwright/baseline-audit-20261101/diff-check-round13.txt`，写文档后重新执行并更新。

**结论：** 在本轮 Chromium 自动化、确定性夹具、`0ms`/`1200ms` 响应延迟和三种视口/动态偏好场景范围内，直接打开 `#discussion` 深层链接会在文章成功后把焦点和视口带到讨论区；普通文章入口和显式“参与讨论”路径没有回归。该结论不代表全站 hash 焦点策略已完成，也不保证真实读屏软件的播报顺序或延迟。

## 下一步假设

**下一轮唯一优先假设：** 直接打开 `/post/:slug#discussion` 且文章接口返回 `503` 时，应保留错误页、保持活动元素为 `BODY`，不尝试聚焦或滚动不存在的讨论区，首次 `Tab` 仍为“跳到正文”。

阻塞条件：下一轮只验证该文章失败深链路径，不扩展为全站路由焦点策略，也不改动文章成功加载的深层链接行为。

## 本轮结论

### 完成项

- 用干净冷启动复现并记录直接 `#discussion` 深层链接落在 `BODY`、未滚动的基线。
- 定位路由 `scrollBehavior` 早于异步文章渲染执行的时序，并关联浏览器控制台警告。
- 在文章成功后仅针对精确 `#discussion` 补做讨论区聚焦。
- 修正首版默认聚焦造成的 `73px`/`29px` 偏移，最终统一停在 `92px`。
- 覆盖桌面、移动、reduced motion 与 `0ms`/`1200ms` 响应延迟六场景。
- 回归普通文章入口、首次 `Tab` 跳过链接和点击“参与讨论”。
- 完成目标测试、全量测试、生产构建和差异检查。

### 未决项

- 未使用真实 VoiceOver、Safari、Firefox 或其他读屏软件验证实际播报顺序、次数和延迟。
- 仅验证 `0ms` 和 `1200ms` 响应延迟；未验证更慢响应、请求中断或快速切换文章。
- 仅支持精确的 `#discussion`；不代表全站 hash 深层链接已有统一焦点策略。
- 文章失败深链路径目前只有单元测试覆盖，尚无浏览器中的错误页、首次 `Tab` 和滚动位置复测。
- 前轮全站其他页面与性能审计仍有未完成项。

### 下一轮唯一优先假设

下一轮只验证：**直接打开 `/post/:slug#discussion` 且文章接口返回 `503` 时，错误页是否保持 `BODY` 焦点、`scrollY: 0`、无横向溢出，且首次 `Tab` 仍为“跳到正文”。**

完成该实验或达到停止条件后停止，等待下一次调度。
