# 阶段 1 续：搜索失败态 live region 语义

日期：2026-11-01（Asia/Shanghai）

## 本轮范围

本轮仍处于阶段 1“现有站点体验审计”，只验证第 6 轮留下的唯一优先假设：搜索失败时，结果容器上的 `role="status"` 与其中错误区的 `role="alert"` 是否形成嵌套 live region，并可能造成重复播报或播报顺序不清。

覆盖范围：

- 桌面视口 `1280 × 720`。
- 移动视口 `390 × 844`。
- Playwright CLI 驱动的 Chromium。
- 正常动效与 `prefers-reduced-motion: reduce`。
- 本地 Vite 开发服务器，`http://127.0.0.1:5173/`。
- 页面级网络拦截：失败态返回 `503`；重试恢复阶段第 1 次返回 `503`，第 2 次返回结构完整的成功空结果。
- 相关文件：`frontend/src/views/blog/Search.vue`、`frontend/src/views/blog/Search.test.ts`。

本轮不进入 DDW 结构拆解，不复制参考站点的素材、着色器、模型、音频或文案。

## 证据

### E1：本轮浏览器与无障碍树测量

原始输出：`output/playwright/baseline-audit-20261101/browser-search-a11y-round7.txt`。

**修复前结构（E1）：**

- `.search-results` 同时承担 `role="status"`、`aria-live="polite"`、`tabindex="-1"` 和 `aria-label="搜索结果"`。
- 失败错误区位于该结果容器内部，并具有 `role="alert"`。
- Chromium 无障碍树同时出现 polite `status` 与嵌套 assertive `alert`；显式焦点落在外层 `SECTION.search-results`。
- 由此只能确认结构上存在 live region 嵌套和双语义节点，不能据此断言真实读屏软件一定重复播报。

**修复后桌面失败态（E1）：**

- 活动元素为 `DIV.search-summary`。
- `.search-results` 已不再具有 `role` 或 `aria-live`，仅保留 `aria-label="搜索结果"`，因此以普通 `region` 暴露。
- `.search-summary` 是唯一常驻状态区，具有 `role="status"`、`aria-live="polite"` 和 `tabindex="-1"`。
- `.inline-error` 保留 `role="alert"`，但与摘要状态区并列，不再嵌套。
- 摘要显示 `QUERY / “round7-failure” SEARCH UNAVAILABLE`。
- 横向溢出为 `0`；摘要宽度为 `1216 px`。

修复后的无障碍树：

```text
region "搜索结果"
  status: QUERY / “round7-failure” SEARCH UNAVAILABLE
  alert:
    heading "搜索暂时不可用" [level=2]
    paragraph: 网络或服务异常，请稍后重试。
    button "重试 ↗"
```

结果区内已不存在 `status` 包裹 `alert` 的结构。

**失败后重试恢复（E1）：**

- 重试前焦点在“重试 ↗”按钮，错误区可见。
- 重试后错误区消失，摘要变为 `QUERY / “round7-failure” 0 RESULTS`。
- 焦点回到 `DIV.search-summary`。
- 页面级拦截记录的请求计数为 `2`，确认重试确实发起了第二次请求。
- 横向溢出为 `0`。

**移动端与减少动态效果（E1）：**

- `390 × 844`：摘要宽度为 `354 px`，横向溢出为 `0`；焦点、状态和错误语义正确。
- `390 × 844` 且 `prefers-reduced-motion: reduce`：上述结果不回退。
- 未在真实触控设备、Safari 或真实读屏软件下复测。

**仍存在的旁路通知（E1）：**

- 修复后的无障碍树中，搜索结果区域之外仍出现一个全局 `alert` 节点，来自请求链路上的全局错误提示路径，疑似 Element Plus “服务器错误” toast。
- 因此本轮只消除了页面内部的 live region 嵌套；页面内错误与全局 toast 是否重复传达同一失败，仍未被验证。

### E2：源码与自动化测试

实现变更：`frontend/src/views/blog/Search.vue:97-109`。

- 结果区改为普通 `region`，只提供 `aria-label="搜索结果"`。
- `.search-summary` 成为唯一常驻状态区，承担 `role="status"`、`aria-live="polite"` 和焦点目标。
- `.inline-error` 保持独立的 `role="alert"`，与摘要区并列。
- 摘要状态区聚焦时隐藏轮廓，避免把普通状态提示误呈现为可操作控件。
- 重试、失败摘要、分页和移动端布局逻辑保持不变。

测试变更：`frontend/src/views/blog/Search.test.ts:42-46`、`:52-69`、`:73-95`、`:99-116`。

- 断言结果区不再承担 `role="status"`。
- 断言摘要区承担 `role="status"` 与 `tabindex="-1"`。
- 覆盖页内提交、页头进入、失败态和失败后重试恢复四条路径。

验证记录：

- 红灯：`output/playwright/baseline-audit-20261101/search-a11y-red-round7.txt`。旧选择器仍指向结果容器，4 个测试均失败，证明测试确实锁定了新结构。
- 绿灯：`output/playwright/baseline-audit-20261101/search-a11y-green-round7.txt`。目标测试 4/4 通过。
- 全量测试：`output/playwright/baseline-audit-20261101/test-round7.txt`。6 个测试文件、30 个测试通过。
- 生产构建：`output/playwright/baseline-audit-20261101/build-round7.txt`。构建通过；主 JS `1,067.83 kB`（gzip `353.13 kB`），`liquidScene` `526.43 kB`（gzip `131.99 kB`），`PostEdit` `673.50 kB`（gzip `225.32 kB`）。
- 差异检查：`output/playwright/baseline-audit-20261101/diff-check-round7.txt`。`git diff --check` 通过。

### E3：历史证据

- 第 6 轮记录：`docs/research/06-search-error-focus.md`。
- 第 6 轮已确认失败摘要、错误标题、重试和焦点恢复；其未决项是本轮所验证的嵌套 live region 风险。
- 本轮抽查时，第 5—6 轮建立的搜索提交与重试焦点行为未回退。

## 实验

**假设：** 把结果容器降为普通 region，把 polite 状态限定到摘要，并让 assertive 错误区与其并列，可以消除页面内部 live region 嵌套，同时保留失败摘要、错误标题、重试动作和恢复后的焦点落点。

**唯一主要变量：** 页面内部 live region 的归属与嵌套关系。视觉布局、请求逻辑、错误文案和重试行为均不作为本轮变量扩展。

**变更范围：**

- `frontend/src/views/blog/Search.vue`：状态区归属、错误区并列关系和焦点目标。
- `frontend/src/views/blog/Search.test.ts`：锁定新语义结构的回归测试。

**成功判据：**

- 结果容器不再具有 `role` 或 `aria-live`。
- 摘要具有 `role="status"`、`aria-live="polite"` 和 `tabindex="-1"`。
- 错误区具有独立 `role="alert"`，无障碍树中不再位于 status 内部。
- 失败、重试恢复、移动端和 reduced-motion 均保持正确焦点与摘要。
- 横向溢出为 `0`。
- 全量测试、生产构建和 `git diff --check` 通过。

**停止条件：** 出现 live region 仍嵌套、焦点落点回退、错误标题不可见、重试无法恢复、横向溢出、reduced-motion 内容回退或构建失败时停止并记录；不扩展为全站 toast 改造或读屏策略重构。

## 复测结果

- 页面内部 `status` 包含 `alert`：修复后已消除。
- 桌面失败态语义、焦点和摘要：通过。
- 失败后重试成功与焦点恢复：通过，请求计数为 `2`。
- 移动端 `390 × 844`：通过，无横向溢出。
- `prefers-reduced-motion: reduce`：通过，无回退。
- 目标测试：4/4 通过。
- 全量测试：6 个测试文件、30 个测试通过。
- 生产构建：通过。
- `git diff --check`：通过。

**结论边界：** 本轮证据是 Chromium 无障碍树与自动化测量，不是读屏软件的实际播报记录。可以确认页面内部 live region 嵌套已消除，不能确认实际播报次数、顺序或是否仍有语义重复。

## 下一步假设

**下一轮唯一优先假设：** 搜索请求失败时，页面内的 `role="alert"` 与全局请求拦截器产生的 Element Plus “服务器错误” toast 可能同时触发 assertive 播报；下一轮只验证这两个通知是否会重复传达同一失败，并决定搜索请求是否应抑制全局 toast。

阻塞条件：若无法稳定捕获 toast 的出现、消失和无障碍树生命周期，则先记录可复现的 DOM/截图证据与工具缺口，不直接修改全局请求策略。

## 本轮结论

### 完成项

- 复现并记录搜索失败态页面内部 live region 嵌套。
- 将状态语义收敛到摘要状态区，使错误区成为并列的独立 alert。
- 保持失败摘要、错误标题、重试动作和恢复聚焦行为。
- 覆盖桌面、移动端、reduced-motion 和重试恢复。
- 完成目标测试、全量测试、生产构建和差异检查。
- 未进入 DDW 结构拆解，未复制参考站点资源。

### 未决项

- 未在真实 VoiceOver、Safari 或其他读屏软件中验证实际播报次数和顺序。
- 未验证页面内 `alert` 与全局错误 toast 是否重复播报同一失败。
- 未使用真实后端验证失败响应、慢请求、超时和重试恢复。
- 未验证非空搜索结果、分页和恢复后的滚动位置。
- 搜索页、404 页面和主布局的焦点逻辑仍未共享化。

### 下一轮唯一优先假设

下一轮只验证：**搜索失败时页面内 `alert` 与全局 Element Plus “服务器错误” toast 是否会重复传达同一失败，并据此决定是否对搜索请求抑制全局 toast。**

完成该实验或达到停止条件后停止，等待下一次调度。
