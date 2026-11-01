# 阶段 1 续：文章加载失败时的讨论区深层链接边界

日期：2026-11-01（Asia/Shanghai）

## 本轮范围

本轮仍处于阶段 1“现有站点体验审计”，只推进第 13 轮留下的唯一优先假设：直接打开 `/post/:slug#discussion` 且文章接口返回 `503` 时，错误页是否保留、焦点是否维持 `BODY`、`scrollY` 是否为 `0`、是否存在横向溢出，以及首次 `Tab` 是否仍为“跳到正文”。

覆盖范围：

- 桌面视口 `1280 × 720`。
- 移动视口 `390 × 844`。
- 移动视口 `390 × 844` 且 `prefers-reduced-motion: reduce`。
- 另在三种场景分别增加文章接口 `1200ms` 延迟，共六种组合。
- Playwright CLI 驱动的 Headless Chromium `156.0.0.0`，本地 Vite 开发服务器 `http://127.0.0.1:5173/`。
- 拦截文章接口并固定返回 `503`；使用本轮原创路径与 `unavailable` 服务端错误夹具，不复制 Lusion 的素材、着色器、模型、音频或文案。
- 相关文件：`frontend/src/views/blog/PostDetail.vue`、`frontend/src/views/blog/PostDetail.test.ts`、`frontend/src/layouts/MainLayout.vue`、`frontend/src/router/index.ts`。

本轮不进入 DDW 结构拆解，不修改成功加载的深层链接行为，也不扩展为全站错误处理策略。

## 证据

### E1：503 深链的六场景浏览器基线

原始输出：`output/playwright/baseline-audit-20261101/browser-post-discussion-failure-baseline-round14.txt`。

每种场景先导航至 `about:blank`，再打开 `/post/round14-failure#discussion`，等待错误页出现，并额外等待至少 `300ms`；延迟场景等待 `1200ms` 响应后再稳定 `900ms`。

| 场景 | 响应延迟 | 错误页 | 活动元素 | `scrollY` | hash | 讨论区节点 | 横向溢出 | 首次 Tab |
| --- | ---: | --- | --- | ---: | --- | --- | ---: | --- |
| 桌面 | 0ms | `503 / INTERRUPTED` | `BODY` | 0 | `#discussion` | 不存在 | 0 | `A.skip-link`“跳到正文” |
| 移动 | 0ms | `503 / INTERRUPTED` | `BODY` | 0 | `#discussion` | 不存在 | 0 | `A.skip-link`“跳到正文” |
| 移动 + reduced motion | 0ms | `503 / INTERRUPTED` | `BODY` | 0 | `#discussion` | 不存在 | 0 | `A.skip-link`“跳到正文” |
| 桌面 | 1200ms | `503 / INTERRUPTED` | `BODY` | 0 | `#discussion` | 不存在 | 0 | `A.skip-link`“跳到正文” |
| 移动 | 1200ms | `503 / INTERRUPTED` | `BODY` | 0 | `#discussion` | 不存在 | 0 | `A.skip-link`“跳到正文” |
| 移动 + reduced motion | 1200ms | `503 / INTERRUPTED` | `BODY` | 0 | `#discussion` | 不存在 | 0 | `A.skip-link`“跳到正文” |

错误页均显示“文章暂时无法加载。”、“重新加载 ↗”、“浏览全部文章”和“返回首页”。主内容顶部在桌面约 `77px`、移动约 `67px`。完整的六场景数据与 Playwright 执行代码保存在上述原始输出中。

页面标题保持 `GUOER · Field Notes`，没有被失败请求覆盖为文章标题。URL 的 `#discussion` 保留，但页面没有尝试聚焦不存在的目标。

### E2：源码与单元测试

源码事实：

- `frontend/src/views/blog/PostDetail.vue:39-67`：`fetchPost()` 只在 `loaded` 为真、请求序号仍当前且 `route.hash === '#discussion'` 时聚焦讨论区；`503` 分支不会设置 `loaded`，因此在时序上也排除了失败路径。
- `frontend/src/views/blog/PostDetail.vue:212-224`：`notFound || loadError` 与成功文章模板分支互斥；失败页只渲染错误标题、说明和三个恢复动作。
- `frontend/src/views/blog/PostDetail.vue:219`：`loadError` 时提供“重新加载”按钮，通过再次调用 `fetchPost()` 恢复。
- `frontend/src/layouts/MainLayout.vue:12-14`：全站先渲染“跳到正文”链接，目标为可聚焦的 `MAIN#main-content`。
- `frontend/src/router/index.ts:6-10`：路由仍会尝试滚动到 `#discussion`，但异步失败后目标不存在；本轮不改变全局路由行为。

测试事实：

- `frontend/src/views/blog/PostDetail.test.ts:166-174`：文章返回 `503` 时，断言 `#discussion` 不存在且活动元素为 `document.body`。
- 该测试直接覆盖了“失败时不尝试聚焦不存在讨论区”的单元级行为；本轮浏览器复测补足了滚动、首次 Tab、布局和延迟场景。

### E3：第 13 轮结论复测状态

- 第 13 轮记录：`docs/research/13-post-detail-discussion-deep-link.md`。
- 第 13 轮成功深层链接、普通入口和显式点击锚点的结论均已由六场景及回归实验复测，本轮无需重跑。
- 本轮没有修改产品源码或测试源码，因此第 13 轮成功深链行为没有被本轮实验变更。
- 浏览器控制台仍出现 Vue Router 的 `Couldn't find element using selector "#discussion"` 警告；它对应失败页面确实没有讨论区，本轮不将其当作焦点回归。

### E4：键盘后续路径与视觉检查

键盘后续路径原始输出：`output/playwright/baseline-audit-20261101/browser-post-discussion-failure-keyboard-round14.txt`。

- 三种基础场景首次 `Tab` 均进入 `A.skip-link`“跳到正文”。
- 激活跳过链接后，活动元素为 `MAIN#main-content`，`scrollY` 保持 `0`，横向溢出为 `0`。
- 页面只有唯一的 `H1`：“文章暂时无法加载。”。
- 桌面后续焦点顺序为：跳过链接 → 品牌链接 → 文章 → 项目 → 关于。
- 移动后续焦点顺序为：跳过链接 → 品牌链接 → 搜索按钮 → 菜单按钮 → “重新加载”。
- 移动错误页的导航控件使恢复按钮晚于菜单按钮出现；这是主布局既有的移动键盘路径，不是本轮深链引入的问题。

视觉原始输出：`output/playwright/baseline-audit-20261101/post-discussion-failure-screenshots-round14.txt`。

- 桌面截图：`output/playwright/baseline-audit-20261101/post-discussion-failure-503-desktop-round14.png`。
- 移动截图：`output/playwright/baseline-audit-20261101/post-discussion-failure-503-mobile-round14.png`。
- 两张完整页面截图均能看到错误标题、三个恢复动作、页脚和站点框架；没有横向裁切、内容重叠或缺页。

### E5：同一错误页的附加重试观察

原始输出：`output/playwright/baseline-audit-20261101/browser-post-discussion-failure-retry-round14.txt`。

- 桌面、移动和 reduced-motion 三场景各触发一次“重新加载”。
- 每次初始加载失败后再次点击“重新加载”，文章接口请求数从 `1` 增至 `2`。
- 第二次仍返回 `503` 后，错误页继续可见，讨论区仍不存在，`scrollY` 保持 `0`，hash 保持 `#discussion`，横向溢出保持 `0`。
- 重试完成后的活动元素为 `BODY`，而不是停留在已被替换的“重新加载”按钮上。

此观察只覆盖“重试继续失败”。重试期间是否会把焦点临时丢在已卸载节点、成功恢复后的焦点与滚动位置，均未作为本轮门禁验证项。

## 实验

**假设：** 文章 `503` 时，成功深链的聚焦逻辑应因缺少有效文章和讨论区而自然跳过；错误页保持 `BODY` 起点，首次 `Tab` 仍可通过全站跳过链接进入主内容，且不引入滚动或布局回归。

**变更范围：** 本轮不修改产品代码与测试代码，只运行浏览器与自动化验证。

**变量：**

- 响应结果固定为 `503`。
- 响应延迟：`0ms` 与 `1200ms`。
- 视口与动态偏好：桌面、移动、移动 + reduced motion。
- 交互路径：直接深链进入、首次 Tab、激活跳过链接、重试继续失败。

**成功判据：**

- 六场景均渲染 `503 / INTERRUPTED` 错误页。
- 活动元素均为 `BODY`，`scrollY` 为 `0`，讨论区不存在。
- 首次 `Tab` 为“跳到正文”；激活后焦点进入 `MAIN#main-content`。
- 横向溢出为 `0`，页面有唯一 `H1`，无可见裁切或重叠。
- 目标测试、全量测试、生产构建和 `git diff --check` 通过。

**停止条件：** 出现错误页丢失、自动聚焦不存在目标、错误滚动、横向溢出、跳过链接失效、内容裁切、测试或构建失败时停止并记录；不扩展为全站错误通知策略或重试成功后的恢复策略。

**实验结果：** 假设通过。六场景和三种基础键盘场景均满足判据；本轮无需新增修复。

工具备注：附加重试实验首版使用页面内不存在的请求计数等待条件，导致脚本等待超时；该次执行被中断，未计入通过结果。改用固定 `1200ms` 等待并从路由处理器计数后，三场景复跑成功。这是测试脚本问题，不是产品行为失败。

## 复测结果

| 检查项 | 桌面 | 移动 | 移动 + reduced | 结论 |
| --- | --- | --- | --- | --- |
| `503` 错误页 | 通过 | 通过 | 通过 | 六场景均保留 |
| 活动元素 `BODY` | 通过 | 通过 | 通过 | 无失败聚焦 |
| `scrollY: 0` | 通过 | 通过 | 通过 | 无错误滚动 |
| 首次 Tab 跳过链接 | 通过 | 通过 | 通过 | 键盘入口稳定 |
| 跳过链接后 `MAIN` | 通过 | 通过 | 通过 | 主内容可达 |
| 横向溢出 `0` | 通过 | 通过 | 通过 | 无布局回归 |
| 唯一 `H1` | 通过 | 通过 | 通过 | 错误页语义清晰 |
| 重试继续失败 | 通过 | 通过 | 通过 | 请求 2 次、错误页稳定 |

延迟 `1200ms` 的桌面、移动和 reduced-motion 场景均与 `0ms` 基线一致。

验证记录：

- 目标测试：`output/playwright/baseline-audit-20261101/post-discussion-failure-green-round14.txt`，`7/7` 通过。
- 全量测试：`output/playwright/baseline-audit-20261101/test-round14.txt`，`9` 个测试文件、`44` 个测试通过。
- 生产构建：`output/playwright/baseline-audit-20261101/build-round14.txt`，类型检查与 Vite 构建通过。`PostDetail` 懒加载块保持 `11.45 kB`（gzip `4.76 kB`），本轮没有产品代码变更。
- 差异检查：`output/playwright/baseline-audit-20261101/diff-check-round14.txt`，写文档后重新执行并更新。

**结论：** 在本轮 Headless Chromium、确定性 `503` 响应、三种视口/动态偏好、`0ms`/`1200ms` 延迟和一次继续失败重试的范围内，文章失败深链保留了错误页，维持 `BODY` 起点与顶部位置，首次 Tab 仍进入全站跳过链接，且没有布局回归。该结论不覆盖真实读屏播报、请求中断、重试成功后的恢复或全站统一错误策略。

## 下一步假设

**下一轮唯一优先假设：** 文章详情接口返回 `503` 时，页面内已有“文章暂时无法加载”错误状态，而全局请求拦截器还可能同时弹出 toast；两者可能重复传达同一失败。下一轮只验证该文章读取失败是否出现重复通知，并据此决定是否让 `getPost()` 抑制全局 toast，保留错误页内的单一恢复入口。

阻塞条件：只验证文章详情读取失败的重复通知，不扩展到评论、搜索或所有 API 请求；若未出现重复通知，则记录为无需修改并停止。

## 本轮结论

### 完成项

- 复测六种“文章 `503` + `#discussion`”组合，确认错误页、`BODY` 焦点、顶部滚动和首次 Tab。
- 验证跳过链接激活后进入 `MAIN#main-content`，且页面只有一个 `H1`。
- 验证重试继续失败时请求数、错误页、焦点和布局保持稳定。
- 保存桌面与移动完整页面截图并检查无裁切或内容重叠。
- 完成目标测试、全量测试、生产构建和差异检查。
- 未修改产品代码，未复制参考站点素材、着色器、模型、音频或文案。

### 未决项

- 未使用真实 VoiceOver、Safari、Firefox 或其他读屏软件验证播报顺序、次数和延迟。
- 仅验证 `0ms` 与 `1200ms` 响应；未验证请求中断、极慢响应和快速切换文章。
- 重试成功后的焦点、滚动位置和讨论区深链恢复尚未验证。
- 移动端错误页恢复按钮位于站点菜单控件之后；这是既有键盘顺序，本轮未判定是否需要调整。
- 全局 toast 与页面内 `503` 错误状态是否重复通知尚未验证。
- 前轮全站其他页面与性能审计仍有未完成项。

### 下一轮唯一优先假设

下一轮只验证：**文章详情接口返回 `503` 时，页面内错误状态与全局请求 toast 是否重复传达同一失败；若有重复，应让 `getPost()` 使用既有的静默错误选项，保留页面内单一恢复入口。**

完成该实验或达到停止条件后停止，等待下一次调度。
