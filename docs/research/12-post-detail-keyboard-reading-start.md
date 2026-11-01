# 阶段 1 续：文章详情的键盘阅读起点与讨论锚点

日期：2026-11-01（Asia/Shanghai）

## 本轮范围

本轮仍处于阶段 1“现有站点体验审计”，只推进第 11 轮留下的唯一优先假设：文章详情成功加载后活动元素为 `BODY`，这是否影响键盘用户的实际阅读起点；重点检查顶部跳过链接、“参与讨论”锚点和首次 Tab 顺序。

覆盖范围：

- 桌面视口 `1280 × 720`。
- 移动视口 `390 × 844`。
- 移动视口 `390 × 844` 且 `prefers-reduced-motion: reduce`。
- Playwright CLI 驱动的 Headless Chromium `156.0.0.0`，本地 Vite 开发服务器 `http://127.0.0.1:5173/`。
- 拦截文章与评论接口，使用本轮原创标题、正文和空评论夹具；不复制 Lusion 的素材、着色器、模型、音频或文案。
- 相关文件：`frontend/src/views/blog/PostDetail.vue`、`frontend/src/views/blog/PostDetail.test.ts`。

本轮不进入 DDW 结构拆解，不扩展为全站路由焦点策略。

## 证据

### E1：普通加载与锚点基线

基线原始输出：`output/playwright/baseline-audit-20261101/browser-post-keyboard-start-round12.txt`。

- 文章成功加载后，活动元素为 `BODY`，`scrollY` 为 `0`。
- 首次 `Tab` 落在“跳到正文”跳过链接；激活后焦点进入 `MAIN#main-content`。
- 从跳过链接继续 `Tab`，下一站是文章的“← WRITING / ALL NOTES”返回链接，而不是页面顶部导航。
- “参与讨论”链接本身可以获得焦点，但激活后浏览器完成 `#discussion` 滚动，活动元素仍回到 `BODY`；下一次 `Tab` 直接进入页脚。

锚点基线原始输出：`output/playwright/baseline-audit-20261101/browser-post-discussion-anchor-round12.txt`。

- 讨论区从视口顶部约 `1381px` 滚动到约 `92px`。
- 哈希变为 `#discussion`，但活动元素仍为 `BODY`。

直接访问 `#discussion` 的基线原始输出：`output/playwright/baseline-audit-20261101/browser-post-discussion-direct-round12.txt`。

| 场景 | 讨论区顶部 | 活动元素 | 横向溢出 |
| --- | ---: | --- | ---: |
| 桌面 | 92px | `BODY` | 0 |
| 移动 | 92px | `BODY` | 0 |
| 移动 + reduced motion | 92px | `BODY` | 0 |

因此，普通页面进入路径已有稳定的“跳到正文”键盘入口；当前明确缺口是激活“参与讨论”后视觉滚动成功、但键盘焦点没有跟随目标。直接深层链接在异步文章渲染后仍落在 `BODY`，本轮只记录，不在同一实验中修复。

### E2：源码、测试与浏览器实验

产品实现位置：

- `frontend/src/views/blog/PostDetail.vue:136`：增加 `focusDiscussion()`，查找 `#discussion` 并调用 `focus()`。
- `frontend/src/views/blog/PostDetail.vue:246`：为“参与讨论”链接增加点击处理。
- `frontend/src/views/blog/PostDetail.vue:265`：讨论区增加 `tabindex="-1"`，使其可被脚本聚焦。
- `frontend/src/views/blog/PostDetail.vue:422`：讨论区聚焦时使用 `outline: none`，避免整块大型区域出现突兀轮廓。

测试位置：

- `frontend/src/views/blog/PostDetail.test.ts:78-91`：新增“激活参与讨论后焦点进入讨论区”的单元测试，并锁定 `tabindex="-1"`。

本轮可执行实验先后覆盖：

1. 加载普通文章，确认 `BODY` → 首次 `Tab` → 跳过链接 → `MAIN` 的路径。
2. 聚焦“参与讨论”并按 `Enter`，确认浏览器滚动目标是讨论区。
3. 临时将讨论区设为可聚焦，验证聚焦后 `Tab` 与 `Shift+Tab` 的实际落点。
4. 对最终代码复跑桌面、移动和减少动态效果三种场景，并检查焦点轮廓与横向溢出。

实验中的工具备注：补测时 Playwright 包装脚本缺少执行位，直接调用失败；失败输出保存在 `output/playwright/baseline-audit-20261101/browser-post-playwright-wrapper-permission-round12.txt`。随后通过 `bash` 调用同一脚本成功，未改产品代码；三场景最终结果保存在 `output/playwright/baseline-audit-20261101/browser-post-focus-path-styled-three-round12.txt`。

### E3：与第 11 轮的关系

- 第 11 轮记录：`docs/research/11-post-detail-loaded-semantics.md`。其中已确认评论区语义和动态状态，但把文章加载后的 `BODY` 焦点落点保留为未决验证项。
- 本轮没有把普通文章加载后的焦点自动移到标题，因为跳过链接已经提供稳定入口，且改变普通加载落点会扩大产品行为变量。
- 本轮只修复“参与讨论”的显式键盘动作，不改变第 11 轮已完成的评论 region、空状态和错误状态语义。

## 实验

**假设：** 为“参与讨论”增加目标聚焦，可以在不改变普通文章加载后的焦点行为、不改变滚动位置和布局的前提下，让键盘用户在激活锚点后从讨论区继续阅读，而不是被丢到页脚。

**变更范围：**

- `frontend/src/views/blog/PostDetail.vue`
- `frontend/src/views/blog/PostDetail.test.ts`

**成功判据：**

- 普通文章加载后仍以 `BODY` 为活动元素，首次 `Tab` 仍为“跳到正文”。
- 跳过链接激活后仍进入 `MAIN#main-content`。
- 激活“参与讨论”后活动元素为 `SECTION#discussion`。
- 讨论区顶部在三种场景下保持约 `92px`，横向溢出为 `0`。
- 讨论区聚焦不显示整块轮廓。
- 目标测试、全量测试、生产构建和 `git diff --check` 通过。

**停止条件：** 出现普通加载起点改变、跳过链接失效、锚点滚动偏移、显著轮廓、横向溢出、测试或构建失败时停止并记录；不扩展到评论区只读内容的结构改造或全站焦点管理。

## 复测结果

最终代码三场景原始输出：`output/playwright/baseline-audit-20261101/browser-post-focus-path-styled-three-round12.txt`。

| 场景 | 加载后活动元素 | 首次 Tab | 跳过链接后 | 讨论锚点后 | 讨论区顶部 | outline | 横向溢出 |
| --- | --- | --- | --- | --- | ---: | --- | ---: |
| 桌面 `1280 × 720` | `BODY` | `A.skip-link`“跳到正文” | `MAIN#main-content` | `SECTION#discussion` | 92px | `none` | 0 |
| 移动 `390 × 844` | `BODY` | `A.skip-link`“跳到正文” | `MAIN#main-content` | `SECTION#discussion` | 92px | `none` | 0 |
| 移动 + reduced motion | `BODY` | `A.skip-link`“跳到正文” | `MAIN#main-content` | `SECTION#discussion` | 92px | `none` | 0 |

补充的最终焦点路径输出：

- `output/playwright/baseline-audit-20261101/browser-post-focus-path-final-round12.txt`：修复后三场景都能聚焦讨论区；桌面滚动 `1289px`，移动与 reduced motion 滚动 `1448px`。
- `output/playwright/baseline-audit-20261101/browser-post-focus-path-styled-final-round12.txt`：桌面最终代码复测，讨论区顶部 `92px`、`outline: none`、横向溢出 `0`。
- `output/playwright/baseline-audit-20261101/browser-post-focus-forward-back-round12.txt`：讨论区聚焦后下一次 `Tab` 到页脚，反向 `Shift+Tab` 回到“继续浏览全部文章”；当前公开评论区只读且为空，所以讨论区内部没有下一可聚焦内容。

验证记录：

- 目标测试：`output/playwright/baseline-audit-20261101/post-discussion-focus-green-round12.txt`，`4/4` 通过。
- 全量测试：`output/playwright/baseline-audit-20261101/test-round12.txt`，`9` 个测试文件、`41` 个测试通过。
- 生产构建：`output/playwright/baseline-audit-20261101/build-round12.txt`，类型检查与 Vite 构建通过。`PostDetail` 懒加载块为 `11.18 kB`（gzip `4.69 kB`）；第 11 轮为 `11.08 kB`（gzip `4.67 kB`），约增加 `0.10 kB`（gzip `0.02 kB`），原有分块警告未变化。
- 差异检查：`output/playwright/baseline-audit-20261101/diff-check-round12.txt`，写文档后重新执行并更新。

**结论：** 在本轮 Chromium 自动化、确定性夹具和三种视口/动态偏好场景范围内，普通文章仍保留“加载落 `BODY`、首次 Tab 跳过链接”的行为；“参与讨论”的显式键盘动作现在会把焦点带到讨论区，滚动位置和横向布局没有回归。该结论不保证真实读屏软件的播报顺序，也不等同于已解决直接 hash 深层链接的加载后焦点问题。

## 下一步假设

**下一轮唯一优先假设：** 直接打开 `/post/:slug#discussion` 时，文章异步加载完成后是否应把焦点移到讨论区；普通文章进入仍应保持 `BODY`，首次 Tab 仍为“跳到正文”。

阻塞条件：下一轮只验证讨论区深层链接的加载后聚焦，不扩展到全站路由焦点策略。若当前直接 hash 路径在加载完成后仍为 `BODY`，再判断是否需要最小时序处理，并分别检查桌面、移动、减少动态效果和文章接口延迟场景。

## 本轮结论

### 完成项

- 复测普通文章加载后的 `BODY` 落点、首次 Tab 跳过链接和跳过链接后的阅读顺序。
- 复现“参与讨论”滚动成功但焦点丢失到 `BODY` 的缺口。
- 以最小改动让讨论锚点获得焦点，并避免大型讨论区出现突兀轮廓。
- 通过桌面、移动和 reduced-motion 三种场景的最终代码复测。
- 新增目标测试，并完成全量测试、生产构建和差异检查。

### 未决项

- 直接打开 `/post/:slug#discussion` 时，异步文章加载完成后活动元素仍为 `BODY`；本轮未处理深层链接时序。
- 未使用真实 VoiceOver、Safari、Firefox 或其他读屏软件验证实际播报顺序、次数和延迟。
- 未验证慢接口下讨论区尚未渲染时的 hash 聚焦时序。
- 公开评论区当前只读且为空，讨论区获得焦点后下一次 Tab 会离开讨论区；这是内容结构边界，不是本轮引入的焦点陷阱。
- 前轮全站其他页面与性能审计仍有未完成项。

### 下一轮唯一优先假设

下一轮只验证：**直接打开 `/post/:slug#discussion`，在异步文章加载完成后是否应把焦点移到讨论区；普通文章进入仍保持 `BODY`、首次 Tab 为跳过链接。**

完成该实验或达到停止条件后停止，等待下一次调度。
