# 阶段 1 续：独立 404 页面跳转正文焦点

日期：2026-11-01（Asia/Shanghai）

## 本轮范围

本轮仍处于阶段 1“现有站点体验审计”，只验证上一轮唯一优先假设：独立 404 页面的“跳到正文”链接能否把键盘焦点送入 `#lost-content`，同时保持错误页视觉、移动布局和 reduced-motion 行为不变。

覆盖范围：

- 桌面视口 `1280 × 720`。
- 移动视口 `390 × 844`。
- Playwright CLI 驱动的 Chromium。
- 正常动效与 `prefers-reduced-motion: reduce`。
- 本地 Vite 开发服务器，`http://127.0.0.1:5173/`。
- 404 测试地址：`/not-a-real-page`。

本轮不进入 DDW 结构拆解，不移植参考站点的素材、着色器、模型、音频或文案。

## 证据

### E1：真实浏览器与本轮复测

原始输出：`output/playwright/baseline-audit-20261101/browser-404-skip-link.txt`。

**上一轮结论补测：** 主布局桌面首次 Tab、Enter 后，hash 为 `#main-content`，活动元素为 `#main-content`，`tabindex="-1"`。上一轮主布局修复未回退。

**404 修复前基线：** 首次 Tab 聚焦 `.skip-link`；Enter 后 hash 变为 `#lost-content`，但活动元素为 `BODY`，目标元素没有 `tabindex`。问题与上一轮主布局基线一致。

**404 修复后桌面复测：** 连续 3 次分别重新加载页面、首次 Tab 聚焦跳转链接、Enter 激活，结果均为：

- 活动元素是 `DIV#lost-content`。
- hash 为 `#lost-content`。
- `#lost-content` 带有 `tabindex="-1"`。
- 横向溢出为 `0`。

**移动端口径：** `390 × 844` 下首次 Tab、Enter 后焦点进入 `#lost-content`，目标宽度约 `354 px`，横向溢出为 `0`。

**移动端 reduced-motion：** 页面 H1 正常渲染，跳转后焦点进入 `#lost-content`，hash 更新，横向溢出为 `0`。

复测边界：

- 404 页面没有 WebGL 场景，因此本轮只确认文字与布局正常，不能据此推断首页 WebGL 的 reduced-motion 行为。
- 鼠标用户通常不会看到隐藏的跳转链接，本轮没有把程序化鼠标点击作为主要成功条件。
- 未在真实移动触控设备、限速网络或生产服务器上复测。
- 未验证 404 页面长地址换行、浏览器快捷键与读屏软件组合。

### E2：源码与自动化测试

实现文件：`frontend/src/views/NotFound.vue`。

变更：

- `#lost-content` 增加 `tabindex="-1"`，允许程序化聚焦但不进入正常 Tab 顺序。
- `.skip-link` 增加点击处理，在浏览器更新 hash 后调用 `#lost-content` 的 `focus()`。
- 未改变错误页结构、排版、颜色或响应式断点。

测试文件：`frontend/src/views/NotFound.test.ts`。

测试覆盖：

- 跳转链接获得焦点。
- 激活后 `#lost-content` 具有 `tabindex="-1"`。
- 活动元素是 `#lost-content`。
- hash 更新为 `#lost-content`。

TDD 与验证记录：

- 修复前目标测试失败，日志：`output/playwright/baseline-audit-20261101/notfound-skip-link-red.txt`；失败点是目标元素没有 `tabindex`。
- 修复后目标测试通过，日志：`output/playwright/baseline-audit-20261101/notfound-skip-link-green.txt`。
- 全量测试：5 个测试文件、26 个测试通过，日志：`output/playwright/baseline-audit-20261101/test-round4.txt`。
- 生产构建通过，日志：`output/playwright/baseline-audit-20261101/build-round4.txt`。

### E3：历史与相关证据

- 上一轮记录：`docs/archive/research/03-skip-link-focus.md`。
- 主布局跳转正文已在本轮补测，仍为 `#main-content` 焦点正常。
- 构建体积与上一轮基本一致：主 JS `1,067.83 kB`（gzip `353.12 kB`），`liquidScene` `526.43 kB`（gzip `131.99 kB`），`PostEdit` `673.50 kB`（gzip `225.31 kB`）。
- `frontend/src/views/NotFound.vue` 仍是独立错误布局，未复用主布局的跳转逻辑。

## 实验

**假设：** 为独立 404 页面的 `#lost-content` 增加 `tabindex="-1"`，并在跳转链接激活后显式聚焦，可以恢复键盘焦点，同时不改变错误页视觉与响应式布局。

**变更范围：**

- `frontend/src/views/NotFound.vue`：目标可聚焦，跳转链接恢复焦点。
- `frontend/src/views/NotFound.test.ts`：新增目标回归测试。

**成功判据：**

- 桌面连续 3 次激活跳转链接后，`#lost-content` 成为活动元素。
- hash 保持为 `#lost-content`。
- 移动端焦点正确，横向溢出为 `0`。
- reduced-motion 和基础内容渲染不回退。
- 全量测试和构建通过。
- 构建体积没有明显变化。

**停止条件：** 出现错误页布局变化、焦点无法恢复、移动溢出、reduced-motion 内容回退或构建失败时停止并记录；不扩展为全站焦点管理或搜索提交策略。

## 复测结果

- 上一轮主布局跳转正文：补测通过，未回退。
- 404 修复前 Firefox/Chromium 基线：hash 更新但活动元素为 `BODY`。
- 404 桌面焦点：3/3 通过。
- 404 移动端焦点：通过，目标宽度约 `354 px`，横向溢出 `0`。
- 404 reduced-motion：内容正常，焦点通过。
- 自动化测试：5 个测试文件、26 个测试通过。
- 生产构建：通过。
- 构建体积：没有可见变化。

未决项：

- 搜索提交后焦点仍落在 `BODY`；尚未定义应聚焦的位置。
- 主布局与 404 页面目前各自维护一份跳转焦点逻辑；本轮不抽取共享组件，以免扩大变更。
- 长页面跳转后的滚动落点、固定头部遮挡、真实触控设备和生产环境仍待验证。
- 404 页面较长地址的换行、读屏软件组合与浏览器快捷键路径尚未覆盖。
- 公共内容数据为空，文章成功页、真实标签列表和非空搜索结果仍缺少证据。

## 下一步假设

**下一轮唯一优先假设：** 搜索提交进入 `/search?q=...` 后焦点落到 `BODY`，可能让键盘用户失去页面上下文；应在搜索结果页确认稳定复现，并验证把焦点移到搜索页主标题或结果状态区能否修复，同时不打断输入与路由。

下一轮只验证这一项；若搜索结果页已有可接受的自然焦点位置，则记录为无需修改并停止，不扩展到全站路由焦点策略。

## 本轮结论

### 完成项

- 补测上一轮主布局“跳到正文”焦点结论，确认未回退。
- 完成 404 页面跳转正文的失败基线、最小修复和回归测试。
- 完成桌面连续 3 次、移动端、reduced-motion、横向溢出、全量测试和生产构建复测。
- 写入本阶段记录；未进入 DDW 结构拆解。

### 未决项

- 搜索提交后的焦点位置尚未定义。
- 主布局与 404 页面的跳转焦点逻辑尚未共享化。
- 长页面滚动、固定头部遮挡、真实触控设备、生产环境与读屏软件组合仍待验证。
- 公共数据为空，多个成功内容路径仍缺少浏览器证据。

### 下一轮唯一优先假设

下一轮只验证：**搜索提交进入 `/search?q=...` 后，是否应把焦点从 `BODY` 移到搜索结果页的可识别状态区域，并在桌面、移动端和 reduced-motion 下保持路由与输入行为不变。**

完成该实验或达到停止条件后停止，等待下一次调度。
