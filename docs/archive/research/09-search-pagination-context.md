# 阶段 1 续：非空搜索结果的分页上下文

日期：2026-11-01（Asia/Shanghai）

## 本轮范围

本轮仍处于阶段 1“现有站点体验审计”，只推进第 8 轮留下的唯一优先假设：非空搜索结果切换分页时，状态摘要是否报告当前页，键盘焦点是否保留在结果上下文，以及页面是否最终回到可读位置。

覆盖范围：

- 桌面视口 `1280 × 720`。
- 移动视口 `390 × 844`。
- 移动视口 `390 × 844` 且 `prefers-reduced-motion: reduce`。
- Playwright CLI 驱动的 Chromium，本地 Vite 开发服务器 `http://127.0.0.1:5173/`。
- 通过页面路由拦截 `**/api/v1/posts/search*` 确定性返回 24 条结果、每页 12 条、共 2 页；所有测试标题、摘要和查询词为本轮原创夹具。
- 相关文件：`frontend/src/views/blog/Search.vue`、`frontend/src/views/blog/Search.test.ts`。

本轮不进入 DDW 结构拆解，不复制参考站点的素材、着色器、模型、音频或文案。

## 证据

### E1：修复前的分页上下文缺陷

原始输出：`output/playwright/baseline-audit-20261101/browser-search-pagination-round9.txt`。

桌面复现条件：搜索结果共 24 条。键盘聚焦“下一页”并点击后：

- 分页控件文字变为 `PAGE 2 / 2`，文章列表切换为第 13、14 篇。
- 摘要仍只有 `QUERY / “round9-pagination” 24 RESULTS`，没有当前页信息。
- 活动元素从 `BUTTON` 落到 `BODY`，键盘用户失去当前位置。
- 请求序列为 `[1, 2]`，确认确实执行了第二页请求。

因此基线同时存在两个可验证缺陷：polite 摘要没有报告页变化；翻页完成后没有把焦点恢复到结果状态区。

补充复测还发现滚动竞争：原实现调用平滑回顶后，`focus()` 默认会把摘要滚入视口，桌面最终停在约 `314 px` 而不是顶部。该滚动问题在修复前日志 `browser-search-pagination-scroll-round9.txt` 中稳定复现；桌面采样在 700ms 后为 `339 px`、1200ms 后为 `314 px` 并保持。移动端最终为 `0 px`。

### E2：源码、红灯和绿灯

实现位置：

- `frontend/src/views/blog/Search.vue:19-25`：新增分页焦点意图，并让状态区聚焦时使用 `{ preventScroll: true }`，避免聚焦打断回顶。
- `frontend/src/views/blog/Search.vue:44-52`：请求完成后，按“新搜索”或“分页切换”的意图恢复摘要焦点。
- `frontend/src/views/blog/Search.vue:72-76`：分页切换立即回到顶部，再发起结果请求；状态区渲染完成后聚焦。
- `frontend/src/views/blog/Search.vue:103-106`：多页结果摘要加入 `PAGE {{ currentPage }} / {{ totalPages }}`；单页或失败状态不显示页编号。

测试位置：`frontend/src/views/blog/Search.test.ts:119-167`。新增确定性测试验证：

- 第二次请求为 `{ q: 'paged', page: 2, page_size: 12 }`。
- 摘要包含 `PAGE 2 / 2`。
- 活动元素回到 `.search-summary`。
- 聚焦调用带 `{ preventScroll: true }`。
- 回顶调用为 `{ top: 0, behavior: 'auto' }`。

测试记录：

- 摘要红灯：`output/playwright/baseline-audit-20261101/search-pagination-red-round9.txt`。旧摘要实际为 `QUERY / “paged” 13 RESULTS`，期望页码断言失败。
- 摘要绿灯：`output/playwright/baseline-audit-20261101/search-pagination-green-round9.txt`。目标测试 `5/5` 通过。
- 滚动焦点红灯：`output/playwright/baseline-audit-20261101/search-pagination-scroll-red-round9.txt`。实际 `focus()` 未传 `preventScroll`。
- 滚动修复绿灯：`output/playwright/baseline-audit-20261101/search-pagination-scroll-green-round9.txt`。目标测试 `5/5` 通过。

一次中间构建暴露测试中 `vi.spyOn(wrapper.get(...).element, 'focus')` 的 DOM 类型推断错误；仅在测试内把元素显式收窄为 `HTMLElement`，未改变产品行为。最终生产构建通过。

### E3：历史证据

- 第 8 轮记录：`docs/archive/research/08-search-duplicate-toast.md`，其“尚未复测”明确列出非空结果、分页切换和滚动位置。
- 第 7 轮已确认 `.search-summary` 是唯一常驻 polite 状态区，`.search-results` 为普通 region；本轮分页复测未发现该语义回退。
- 第 6 轮的重试错误态与焦点恢复未在本轮回归；全量测试覆盖其路径。

## 实验

**假设：** 在摘要中加入当前页、在分页结果渲染后聚焦摘要，并用 `preventScroll` 隔离聚焦与回顶，可以让键盘和读屏用户同时获得“第几页、结果已切换、页面已回到结果起点”的上下文；该修复不改变请求结构、单页布局或失败态。

**唯一主要变量：** 非空多页结果的翻页状态表达与焦点/滚动协调。

**成功判据：**

- 首页摘要显示 `PAGE 1 / 2`，第二页显示 `PAGE 2 / 2`。
- 翻到第二页后显示第 13、14 篇，请求参数包含 `page: 2`。
- 活动元素为 `.search-summary`，且 Chromium 无障碍树中的状态文本包含当前页。
- 翻页后滚动最终为 `0 px`；桌面、移动和 reduced-motion 均满足。
- 返回第一页后摘要为 `PAGE 1 / 2`，焦点仍为 `.search-summary`，请求序列为 `[1, 2, 1]`。
- 横向溢出为 `0`，页面 `role="alert"` 数量为 `0`。
- 目标测试、全量测试、生产构建和 `git diff --check` 通过。

**停止条件：** 摘要未更新、焦点丢失、第三页请求错误、滚动无法稳定回顶、横向溢出、构建失败或需要重做路由状态模型时停止，并记录证据；不扩展为全站分页或路由状态重构。

## 复测结果

主复测原始输出：

- `output/playwright/baseline-audit-20261101/browser-search-pagination-current-round9.txt`
- `output/playwright/baseline-audit-20261101/browser-search-pagination-position-round9.txt`

滚动采样按点击后的毫秒点记录；最终位置在 `1500 ms` 与 `3000 ms` 均复测。

| 场景 | 首页摘要 | 第二页摘要 | 第二页文章 | 翻页后焦点 | 返回首页摘要 | 请求序列 | 横向溢出 | 页面 alert |
| --- | --- | --- | --- | --- | --- | --- | ---: | ---: |
| 桌面 `1280 × 720` | `24 RESULTS PAGE 1 / 2` | `24 RESULTS PAGE 2 / 2` | 第 13、14 篇 | `.search-summary` | `PAGE 1 / 2` | `[1, 2, 1]` | 0 | 0 |
| 移动 `390 × 844` | `24 RESULTS PAGE 1 / 2` | `24 RESULTS PAGE 2 / 2` | 第 13、14 篇 | `.search-summary` | `PAGE 1 / 2` | `[1, 2, 1]` | 0 | 0 |
| 移动 + reduced motion | `24 RESULTS PAGE 1 / 2` | `24 RESULTS PAGE 2 / 2` | 第 13、14 篇 | `.search-summary` | `PAGE 1 / 2` | `[1, 2, 1]` | 0 | 0 |

桌面滚动采样：点击前 `2734 px`；点击后 `0 ms: 756`、`100 ms: 643`、`300 ms: 52`、`700 ms: 0`、`1200/1600/2200/3000 ms: 0`。移动和 reduced-motion：`0 ms` 起即为 `0`，之后保持。最终摘要顶边桌面约 `652 px`、移动约 `547 px`，位于粘性头部下方，焦点保持在摘要。

Chromium 无障碍树摘要为：

```text
status: QUERY / “round9-pagination” 24 RESULTS PAGE 2 / 2
```

**结论：** 在本轮 Chromium 自动化与确定性夹具范围内，分页摘要、焦点和滚动上下文已收敛；回归测试锁定了页码、请求参数、焦点选项与回顶策略。因为未使用真实后端、真实读屏软件或真实触控设备，本结论不能外推为所有环境和助读技术的播报保证。

**验证记录：**

- 全量测试：`output/playwright/baseline-audit-20261101/test-round9.txt`，`7` 个测试文件、`33` 个测试通过。
- 生产构建：`output/playwright/baseline-audit-20261101/build-round9.txt`，类型检查与 Vite 构建通过；主 JS `1,067.83 kB`（gzip `353.16 kB`）、`liquidScene` `526.43 kB`（gzip `131.99 kB`）、`PostEdit` `673.50 kB`（gzip `225.30 kB`）。现有分块体积警告未变化，本轮不处理。
- 差异检查：`output/playwright/baseline-audit-20261101/diff-check-round9.txt`，通过。

## 下一步假设

**下一轮唯一优先假设：** 从第 2 页进入文章后使用浏览器后退返回搜索页时，关键词、当前页、结果、焦点和滚动位置是否恢复；若当前页未进入 URL 因而重置到第 1 页，应把分页状态纳入可恢复的导航状态，而不是只保存在组件内存。

阻塞条件：先确认本轮分页状态、焦点和滚动逻辑稳定；下一轮只验证一次“第 2 页 → 文章 → 后退”的恢复，不扩大为全站路由状态重构。

## 本轮结论

### 完成项

- 复现非空结果翻页后摘要无页码、焦点落到 `BODY` 的基线缺陷。
- 增加多页摘要的当前页表达与翻页焦点恢复。
- 复测并修复聚焦与回顶竞争，覆盖桌面、移动和 reduced-motion。
- 用确定性测试覆盖请求参数、页码、焦点选项和滚动策略。
- 完成全量测试、生产构建和差异检查。
- 未进入 DDW 结构拆解，未复制参考站点资源。

### 未决项

- 未使用真实后端验证分页总数、并发请求和慢响应。
- 未在真实 VoiceOver、Safari 或其他读屏软件中验证状态更新播报。
- 未验证从分页结果进入文章后浏览器后退的恢复行为。
- 分页状态仍只在组件内保存，尚未进入 URL。
- 构建分块体积警告仍存在，属于后续性能审计。

### 下一轮唯一优先假设

下一轮只验证：**从第 2 页进入文章并后退时，搜索关键词、页码、结果、焦点和滚动位置是否恢复；若不恢复，最小改动是否应把页码纳入 URL/导航状态。**

完成该实验或达到停止条件后停止，等待下一次调度。
