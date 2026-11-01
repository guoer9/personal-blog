# 阶段 1 续：搜索第 2 页进入文章后的历史恢复

日期：2026-11-01（Asia/Shanghai）

## 本轮范围

本轮仍处于阶段 1“现有站点体验审计”，只推进第 9 轮留下的唯一优先假设：从搜索结果第 2 页进入文章，再使用浏览器后退时，关键词、页码、结果、焦点和滚动位置能否恢复到同一个上下文。

覆盖范围：

- 桌面视口 `1280 × 720`。
- 移动视口 `390 × 844`。
- 移动视口 `390 × 844` 且 `prefers-reduced-motion: reduce`。
- Playwright CLI 驱动的 Chromium，本地 Vite 开发服务器 `http://127.0.0.1:5173/`。
- 拦截搜索、文章详情和评论接口，确定性返回 24 条搜索记录、每页 12 条、共 2 页；标题、摘要、正文与查询词均为本轮原创测试夹具。
- 相关文件：`frontend/src/views/blog/Search.vue`、`frontend/src/views/blog/Search.test.ts`。

本轮不进入 DDW 结构拆解，不复制 Lusion 的素材、着色器、模型、音频或文案。

## 证据

### E1：修复前的历史恢复缺陷

基线原始输出：`output/playwright/baseline-audit-20261101/browser-search-back-baseline-round10.txt`。

稳定复现流程：第 1 页翻到第 2 页 → 聚焦第 13 篇原创夹具文章 → 打开详情 → 浏览器后退。

基线结果：

- 后退 URL 为 `/search?q=round10-back`，`page=2` 不在 URL 中。
- 摘要变为 `PAGE 1 / 2`，文章列表恢复为第 1、2 篇。
- 焦点落到 `.search-summary`，没有回到原来的第 13 篇文章链接。
- `scrollY = 448`，恰好仍是离开第 2 页前的坐标，但内容已经错误切回第 1 页；滚动位置与内容错配。
- 请求序列为 `[search page 1, search page 2, post 13, search page 1]`，证明后退时确实重新请求了第 1 页。
- 横向溢出为 `0`。

根因由源码确认：`currentPage` 只保存在组件内存；翻页没有更新 URL；挂载时 `loadResults()` 默认请求第 1 页。浏览器能恢复滚动坐标，但无法恢复对应的页面状态。

### E2：源码、红灯和绿灯

实现位置：

- `frontend/src/views/blog/Search.vue:14-30`：从 URL 的 `page` 查询参数解析初始页码；非法值回退到第 1 页。
- `frontend/src/views/blog/Search.vue:99-109`：翻页时把页码写入路由；第 1 页省略 `page`，第 2 页使用 `page=2`。
- `frontend/src/views/blog/Search.vue:121-139`：监听关键词和页码变化，分别处理新搜索和分页请求。
- `frontend/src/views/blog/Search.vue:142-151`：在文章列表内捕获进入 `/post/:slug` 的点击，把目标链接写入当前历史项的 `searchReturnFocus`。
- `frontend/src/views/blog/Search.vue:33-52`：第 2 页结果渲染后查找原文章链接，以 `preventScroll: true` 恢复焦点，并一次性移除历史提示，避免之后误聚焦。
- `frontend/src/views/blog/Search.vue:173`：文章列表增加模板引用，供焦点恢复定位。

测试位置：`frontend/src/views/blog/Search.test.ts`。新增确定性测试验证：

- 翻页后当前路由 `query.page` 为 `2`，原第 9 轮摘要、焦点与回顶断言仍保留。
- 直接进入 `/search?q=paged&page=2` 时请求参数为 `{ q: 'paged', page: 2, page_size: 12 }`，摘要为 `PAGE 2 / 2`。
- 提交不同关键词时清除旧页码，目标路由只为 `{ q: 'second' }`。
- 历史提示 `searchReturnFocus: '/post/second-page'` 存在时，焦点落到对应文章链接，且提示消费后被清除。

测试记录：

- 红灯：`output/playwright/baseline-audit-20261101/search-history-red-round10.txt`。三个失败分别显示：URL 没有 `page`、URL 已带 `page=2` 时仍请求第 1 页、焦点仍落到摘要。目标测试 `3` 失败、`4` 通过。
- 绿灯：`output/playwright/baseline-audit-20261101/search-history-green-round10.txt`。首轮实现后目标测试 `7/7` 通过。
- 边界绿灯：`output/playwright/baseline-audit-20261101/search-history-edge-green-round10.txt`。加入“新关键词清除旧页码”测试后 `8/8` 通过。

生产构建第一次暴露两个仅类型问题：未使用的元素变量，以及展开路由查询后给 `page` 赋值时被推断为只含 `q`。删除无用变量并显式使用 `LocationQueryRaw` 后构建通过，未改变产品行为。

### E3：历史证据

- 第 9 轮记录：`docs/research/09-search-pagination-context.md`。其未决项明确要求验证第 2 页进入文章后的后退恢复。
- 第 9 轮已确认页码摘要、翻页焦点和回顶策略；本轮没有改动这三项的产品逻辑，单元测试继续覆盖。
- 第 8 轮确认搜索错误只使用内联提示，不重复全局 toast；本轮三场景复测中 `role="alert"` 数量均为 `0`，未发现回归。

## 实验

**假设：** 把当前搜索页写入 URL，并在从搜索页文章链接离开时将目标链接记录到当前历史项，可以让浏览器后退时重新请求同一页，同时在结果渲染后把焦点放回原文章；使用 `preventScroll` 可以保留浏览器已恢复的滚动坐标，避免焦点操作改变位置。

**唯一主要变量：** 搜索分页状态的导航可恢复性，以及从文章后退时的焦点恢复。

**成功判据：**

- 翻到第 2 页后 URL 包含 `page=2`。
- 后退 URL 保留 `q=round10-back&page=2`。
- 后退后摘要为 `24 RESULTS PAGE 2 / 2`，首两个标题仍为第 13、14 篇。
- 活动元素为第 13 篇文章链接，历史中的一次性焦点提示已被消费。
- 最终滚动坐标对应第 2 页内容，且桌面离开前后均为 `448 px`。
- 后退请求为第 2 页，不得错误请求第 1 页。
- 横向溢出为 `0`，页面无新增 `role="alert"`。
- 目标测试、全量测试、生产构建和 `git diff --check` 通过。

**停止条件：** 页码未进入 URL、后退仍请求第 1 页、焦点无法稳定恢复、滚动导致内容错配、新增重复请求、横向溢出或构建失败。达到任一条件即记录证据，不扩展为全站导航状态重构。

## 复测结果

三场景主复测原始输出：`output/playwright/baseline-audit-20261101/browser-search-history-current-round10.txt`。

| 场景 | 第二页 URL | 后退摘要 | 后退首两个标题 | 后退焦点 | 离开/后退滚动 | 请求序列 | 横向溢出 |
| --- | --- | --- | --- | --- | --- | --- | ---: |
| 桌面 `1280 × 720` | `?q=round10-back&page=2` | `24 RESULTS PAGE 2 / 2` | 第 13、14 篇 | `/post/round10-post-13` | `448 / 448 px` | `[1, 2, post 13, 2]` | 0 |
| 移动 `390 × 844` | `?q=round10-back&page=2` | `24 RESULTS PAGE 2 / 2` | 第 13、14 篇 | `/post/round10-post-13` | `0 / 0 px` | `[1, 2, post 13, 2]` | 0 |
| 移动 + reduced motion | `?q=round10-back&page=2` | `24 RESULTS PAGE 2 / 2` | 第 13、14 篇 | `/post/round10-post-13` | `0 / 0 px` | `[1, 2, post 13, 2]` | 0 |

移动端第 13 篇标题已完整位于首屏，`scrollIntoViewIfNeeded()` 不需要移动页面，因此离开和后退坐标均为 `0 px`；该场景验证的是内容与焦点一致性，不用于推断长列表的滚动恢复。桌面在离开前主动聚焦并滚到第 13 篇附近，前后坐标一致，内容也一致。

最终单场景核查输出：`output/playwright/baseline-audit-20261101/browser-search-history-final-round10.txt`。翻页请求序列为 `[1, 2]`，路由为 `/search?q=round10-back&page=2`，摘要为 `24 RESULTS PAGE 2 / 2`，活动元素为 `.search-summary`；确认页码进入 URL 后没有引入重复的第 1 页请求或重复第 2 页请求。

**结论：** 在本轮 Chromium 自动化与确定性夹具范围内，第 2 页 → 文章 → 后退的关键词、页码、结果、焦点和滚动位置已恢复到同一上下文。由于未使用真实后端、真实读屏软件或真实触控设备，本结论不能外推为所有环境、慢网络和助读技术的播报保证。

**验证记录：**

- 全量测试：`output/playwright/baseline-audit-20261101/test-round10.txt`，`7` 个测试文件、`36` 个测试通过。
- 生产构建：`output/playwright/baseline-audit-20261101/build-round10.txt`，类型检查与 Vite 构建通过。`Search` 懒加载块为 `5.35 kB`（gzip `2.67 kB`）；现有主包和大型编辑器的分块体积警告未变化，本轮不处理。
- 差异检查：`output/playwright/baseline-audit-20261101/diff-check-round10.txt`，通过。

## 下一步假设

**下一轮唯一优先假设：** 文章详情页在一次成功加载后，标题、正文与评论区之间的标题层级、可聚焦状态和成功状态提示是否完整；优先验证文章标题与正文是否能被键盘用户快速定位，以及评论接口成功返回空列表时是否给出明确、非误导的状态。

阻塞条件：下一轮只审计一次文章详情成功加载路径，不扩大为全站状态管理重构，也不进入 DDW 结构拆解。

## 本轮结论

### 完成项

- 复现并记录第 2 页进入文章后退回第 1 页的内容/滚动错配。
- 把搜索页码纳入 URL，保持第 1 页 URL 简洁并按 URL 加载目标页。
- 从搜索页文章链接离开时记录一次性返回目标，后退完成后恢复原文章焦点。
- 新关键词会清除旧页码；第 9 轮摘要、焦点与回顶行为未回归。
- 覆盖桌面、移动和 reduced-motion 三场景复测。
- 完成全量测试、生产构建和差异检查。
- 未进入 DDW 结构拆解，未复制参考站点资源。

### 未决项

- 未使用真实后端验证慢响应、并发请求、数据在页面停留期间变化后的返回行为。
- 未在真实 VoiceOver、Safari、Firefox 或其他读屏软件中验证历史恢复与焦点播报。
- 移动端本次内容较短，未覆盖长列表、渐进加载或动态高度变化下的滚动恢复。
- 键盘触发的文章链接离开仅通过链接点击捕获覆盖；若未来加入程序化打开文章或非链接控件，需要单独验证。
- 构建分块体积警告仍存在，属于后续性能审计。

### 下一轮唯一优先假设

下一轮只验证：**文章详情成功加载后，标题、正文、评论区的语义层级、焦点落点与空评论成功状态是否完整、明确且可键盘访问。**

完成该实验或达到停止条件后停止，等待下一次调度。
