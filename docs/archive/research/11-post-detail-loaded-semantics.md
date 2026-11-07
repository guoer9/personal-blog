# 阶段 1 续：文章详情成功加载后的语义与评论状态

日期：2026-11-01（Asia/Shanghai）

## 本轮范围

本轮仍处于阶段 1“现有站点体验审计”，只推进第 10 轮留下的唯一优先假设：文章详情在一次成功加载后，标题层级、正文、评论区语义、空评论成功状态和失败状态是否完整、明确且可键盘访问。

覆盖范围：

- 桌面视口 `1280 × 720`。
- 移动视口 `390 × 844`。
- 移动视口 `390 × 844` 且 `prefers-reduced-motion: reduce`。
- Playwright CLI 驱动的 Headless Chromium `156.0.0.0`，本地 Vite 开发服务器 `http://127.0.0.1:5173/`。
- 拦截文章与评论接口，使用本轮原创标题、正文、评论夹具；分别返回空评论、一条评论和评论 `503`。
- 相关文件：`frontend/src/views/blog/PostDetail.vue`、`frontend/src/api/comments.ts`、`frontend/src/views/blog/PostDetail.test.ts`、`frontend/src/api/comments.test.ts`。

本轮不进入 DDW 结构拆解，不复制 Lusion 的素材、着色器、模型、音频或文案。

## 证据

### E1：成功加载后的浏览器基线

基线原始输出：`output/playwright/baseline-audit-20261101/browser-post-semantics-baseline-round11.txt`。

桌面空评论基线：

- 标题层级为文章 `H1` → 正文 `H2` → 正文 `H3` → 评论区 `H2`，层级连续，没有跳级。
- 焦点顺序中存在“跳到正文”“参与讨论 ↓”和评论区重试入口；文章成功加载后，活动元素仍为 `BODY`。
- `.comments-list` 只有 `aria-live="polite"`，没有 region 角色或可访问名称。
- `.comments-empty` 没有 `role="status"` 或独立 `aria-live`；初始空结果只是被外层整块 live region 间接覆盖。
- 横向溢出为 `0`，页面没有 `role="alert"`，文章和评论接口各请求一次。

基线的具体问题是评论容器既缺少区域边界，又把所有评论内容置于一个整块 live region：初始空结果缺少明确状态语义，而已有评论或普通更新可能触发过宽播报。

### E2：源码、红灯、绿灯与重复提示复测

实现位置：

- `frontend/src/views/blog/PostDetail.vue:292`：`.comments-list` 改为 `role="region" aria-labelledby="discussion-title"`，移除列表级 `aria-live`。
- `frontend/src/views/blog/PostDetail.vue:296`：评论失败区增加 `role="alert"`。
- `frontend/src/views/blog/PostDetail.vue:333`：空评论区增加 `role="status" aria-live="polite"`。
- `frontend/src/api/comments.ts:26-30`：评论读取请求传入 `{ suppressErrorToast: true }`，由内联失败提示承担通知。
- `frontend/src/utils/request.ts:36,64-74`：请求拦截器读取该选项；评论失败时不再额外生成全局 toast。

目标测试：

- `frontend/src/views/blog/PostDetail.test.ts:78-123`：锁定命名 region、空状态单一 polite status、失败 alert，以及有评论时不存在多余动态状态或整块 `aria-live`。
- `frontend/src/api/comments.test.ts:17-23`：锁定评论读取请求抑制全局错误 toast。

红灯与绿灯记录：

- 初始语义红灯：`output/playwright/baseline-audit-20261101/post-semantics-red-round11.txt`。两个目标测试均失败，实际 region 和 alert 角色为 `undefined`。
- 初始语义绿灯：`output/playwright/baseline-audit-20261101/post-semantics-green-round11.txt`。目标文件 `2/2` 通过。
- 去重红灯：`output/playwright/baseline-audit-20261101/post-semantics-dedup-red-round11.txt`。API 测试失败，实际请求没有携带 `suppressErrorToast`；产品代码因组合补丁的空 hunk 被整体拒绝，故该红灯有效反映旧调用。
- 去重绿灯：`output/playwright/baseline-audit-20261101/post-semantics-dedup-green-round11.txt`。两个文件、`4/4` 测试通过。

中间浏览器复测暴露了真实回归：`output/playwright/baseline-audit-20261101/browser-post-semantics-current-round11.txt` 中评论失败场景同时存在内联 alert 和全局 toast，`[role="alert"]` 数量为 `2`。完成请求抑制后，最终复测降为 `1`。

### E3：历史证据与本轮关系

- 第 10 轮记录：`docs/archive/research/10-search-history-restoration.md`。其未决项明确要求审计文章成功加载后的标题、正文、评论区语义、焦点和空评论状态。
- 第 7—8 轮已确认搜索页应把动态状态收敛到单一明确区域，并抑制重复 toast；本轮将同一原则应用到评论读取路径，但没有改动全局请求策略，只对评论读取按请求选择抑制。
- 第 3 轮已建立主布局“跳到正文”焦点路径；本轮基线仍能看到该入口，未改动其行为。

## 实验

**假设：** 把评论列表定义为以“讨论区标题”命名的普通 region，只在空结果使用单一 polite status、只在失败时使用 alert，并抑制评论读取的全局重复错误 toast，可以在不改变视觉布局、请求次数或正文层级的前提下，让成功与失败状态更明确，并避免整块评论播报和重复失败播报。

**唯一主要变量：** 文章成功加载后评论区的动态状态语义与通知归属。

**变更范围：**

- `frontend/src/views/blog/PostDetail.vue`
- `frontend/src/api/comments.ts`
- `frontend/src/views/blog/PostDetail.test.ts`
- `frontend/src/api/comments.test.ts`

**成功判据：**

- 评论区是名为 `discussion-title` 的 region，列表本身不再有 `aria-live`。
- 空评论场景只有一个 polite status；有评论场景没有空状态或列表级 live region。
- 评论失败场景只有一个内联 alert，没有重复 toast。
- 标题层级保持 `H1/H2/H3/H2`。
- 桌面、移动和 reduced-motion 无横向溢出；文章和评论接口各请求一次。
- 目标测试、全量测试、生产构建和 `git diff --check` 通过。

**停止条件：** 出现重复 alert、空状态丢失、标题层级回退、评论区不可识别、横向溢出、请求次数增加或构建失败时停止并记录；不扩展为评论提交、删除流程或全站通知策略重构。

## 复测结果

最终浏览器原始输出：`output/playwright/baseline-audit-20261101/browser-post-semantics-final-round11.txt`。

| 场景 | 评论区 | 空/失败状态 | alert | status | toast | 横向溢出 | 请求 |
| --- | --- | --- | ---: | ---: | ---: | ---: | --- |
| 桌面空评论 | region + `discussion-title`，无列表 `aria-live` | 空评论 status + polite | 0 | 1 | 0 | 0 | 文章 1、评论 1 |
| 移动空评论 | 同上 | 同上 | 0 | 1 | 0 | 0 | 文章 1、评论 1 |
| 移动 + reduced motion | 同上 | 同上 | 0 | 1 | 0 | 0 | 文章 1、评论 1 |
| 桌面有评论 | region + `discussion-title`，无列表 `aria-live` | 无空状态；评论正文可见 | 0 | 0 | 0 | 0 | 文章 1、评论 1 |
| 桌面评论失败 | region + `discussion-title` | 内联 alert | 1 | 0 | 0 | 0 | 文章 1、评论 1 |

五场景标题层级均保持 `H1/H2/H3/H2`。成功加载后的活动元素仍为 `BODY`；本轮没有自动聚焦文章标题，也没有改变滚动或返回导航行为。该焦点落点保留为未决验证项，不据此直接修改产品行为。

**验证记录：**

- 全量测试：`output/playwright/baseline-audit-20261101/test-round11.txt`，`9` 个测试文件、`40` 个测试通过。
- 生产构建：`output/playwright/baseline-audit-20261101/build-round11.txt`，类型检查与 Vite 构建通过。`PostDetail` 懒加载块为 `11.08 kB`（gzip `4.67 kB`）；既有主包与大型编辑器分块警告未变化，本轮不处理。
- 差异检查：`output/playwright/baseline-audit-20261101/diff-check-round11.txt`，通过。

**结论：** 在本轮 Chromium 自动化与确定性夹具范围内，空评论、已有评论和评论失败三条路径已具备互斥、可命名的动态语义；评论失败不再重复触发内联 alert 与全局 toast，标题层级和请求次数没有回归。由于未使用真实读屏软件、真实后端慢响应或其他浏览器，本结论不能外推为实际播报顺序、延迟和所有助读技术的保证。

## 下一步假设

**下一轮唯一优先假设：** 文章详情成功加载后活动元素仍为 `BODY`；键盘用户从外部进入时是否需要把焦点移到文章标题，应先验证顶部跳过链接、“参与讨论”锚点与首次 Tab 顺序的实际阅读起点，再判断现有焦点落点是否构成可修复缺口。

阻塞条件：下一轮只审计文章成功加载后的键盘进入路径和锚点行为，不扩展为全站路由焦点策略；若首屏跳过链接已提供稳定、可理解的阅读入口，则记录为无需修改并停止。

## 本轮结论

### 完成项

- 复现并记录文章成功加载后评论区缺少命名边界、空状态语义和失败状态语义。
- 将评论列表收敛为命名 region，把动态播报限定在空结果或失败分支。
- 复测发现并修复评论失败的内联 alert 与全局 toast 重复通知。
- 覆盖桌面、移动、reduced-motion、空评论、已有评论和评论失败五类场景。
- 完成目标测试、全量测试、生产构建和差异检查。
- 未进入 DDW 结构拆解，未复制参考站点资源。

### 未决项

- 未使用真实 VoiceOver、Safari、Firefox 或其他读屏软件验证实际播报次数、顺序和延迟。
- 未验证评论慢响应、并发加载、请求中途切换文章，以及评论动态插入后的播报。
- 文章成功加载后的活动元素仍为 `BODY`；标题聚焦、返回导航和滚动落点尚未形成产品决定。
- 现有主包与大型编辑器分块体积警告仍存在，属于后续性能审计。
- 搜索结果、归档和关于页仍有阶段 1 的页面级桌面/移动证据缺口。

### 下一轮唯一优先假设

下一轮只验证：**文章详情成功加载后仍落在 `BODY` 是否影响键盘用户的实际阅读起点；需检查顶部跳过链接、“参与讨论”锚点与首次 Tab 顺序，再决定是否需要标题聚焦。**

完成该实验或达到停止条件后停止，等待下一次调度。
