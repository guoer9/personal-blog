# 阶段 1 续：搜索面板焦点恢复实验

日期：2026-11-01（Asia/Shanghai）

## 本轮范围

本轮仍处于阶段 1“现有站点体验审计”，只处理上一轮唯一优先假设：搜索面板按 Escape 关闭后，焦点应返回触发它的搜索按钮，而不是留在隐藏输入框或落到页面根节点。

本轮不进入 DDW 结构拆解，不移植参考站点的素材、着色器、模型、音频或文案。

## 证据

### E1：真实浏览器与本轮复测

测量环境：

- Playwright CLI 驱动的 Chromium。
- 本地 Vite 开发服务器，`http://127.0.0.1:5173/`。
- 桌面视口 `1280 × 720`，移动视口 `390 × 844`。
- 正常动效与 `prefers-reduced-motion: reduce` 两组偏好。
- 时间：2026-11-01（Asia/Shanghai）。
- 原始输出：`output/playwright/baseline-audit-20261101/browser-focus-regression.txt`。

桌面正常动效连续 3 次操作结果一致：

1. 点击搜索按钮后，`aria-expanded="true"`，活动元素是 `#header-search-input`。
2. 按 Escape 后，`aria-expanded="false"`，搜索输入框不可见，活动元素是 `.search-toggle`。
3. 再次打开后输入框重新获得焦点，确认焦点恢复没有破坏后续开合。

提交搜索后进入 `/search?q=test`，搜索面板关闭、输入框不可见，页面标题正常渲染为 `Find yourthread.`。提交后焦点位于 `BODY`，不属于本轮修复范围，记录为后续审计观察项。

移动端：

- 搜索打开后输入框获得焦点；Escape 关闭后焦点返回 `.search-toggle`。
- 移动菜单打开时可见；Escape 关闭后焦点仍在 `.menu-toggle`，菜单不可见。
- 页面横向溢出为 `0` 像素。

减少动态效果：

- 首页 H1 正常渲染。
- canvas 不可见，场景状态为 `static`。
- 搜索面板 Escape 关闭后焦点仍返回 `.search-toggle`。

### E2：源码与自动化测试

实现位于 `frontend/src/components/navigation/SiteHeader.vue`：

- 为搜索按钮增加模板引用 `searchToggle`。
- Escape 处理先读取搜索面板是否原本打开。
- 关闭面板后，仅在搜索面板原本打开时调用 `searchToggle.value?.focus()`。
- 移动菜单原有的关闭逻辑保留；无关的 Escape 操作不会强制抢焦点。

回归测试位于 `frontend/src/components/navigation/SiteHeader.test.ts`，覆盖搜索按钮打开、输入框聚焦、Escape 关闭、`aria-expanded` 更新和焦点回到触发按钮。

TDD 记录：

- 修复前目标测试失败，日志：`output/playwright/baseline-audit-20261101/site-header-red.txt`。组件测试环境中的活动元素仍可能是隐藏输入框；真实浏览器基线中该路径曾落到 `BODY`。两者的共同事实是焦点没有返回触发按钮。
- 修复后目标测试通过，日志：`output/playwright/baseline-audit-20261101/site-header-green.txt`。
- 全量测试：3 个测试文件、24 个测试通过。
- 构建通过，日志：`output/playwright/baseline-audit-20261101/build-round2.txt`。

### E3：历史证据

上一轮真实浏览器基线连续 3 次确认搜索 Escape 关闭后焦点落到 `BODY`，下一次 Tab 进入“阅读文章”而非搜索按钮。该历史结论只用于说明修复前状态，本轮结论以 E1 和 E2 为准。

## 实验

**假设：** 在搜索面板确实打开时，于 Escape 处理中显式聚焦搜索触发按钮，可以恢复键盘焦点，同时不改变面板开合、移动菜单、减少动态效果和构建体积。

**变更范围：**

- `frontend/src/components/navigation/SiteHeader.vue`：最小焦点恢复逻辑。
- `frontend/src/components/navigation/SiteHeader.test.ts`：新增交互回归测试。
- `frontend/package.json`、`frontend/package-lock.json`：加入测试所需的直接开发依赖 `@vue/test-utils` 和 `happy-dom`。

**成功判据：**

- 桌面连续 3 次 Escape 后焦点均为搜索按钮。
- 移动端搜索与菜单的 Escape 行为均保持正确，横向溢出仍为 0。
- reduced-motion 下页面、场景和焦点行为不回退。
- 测试和构建通过。

**停止条件：** 任一真实浏览器路径失败、出现布局溢出或构建体积明显异常时停止并记录，不扩大修复范围。

## 复测结果

- 桌面搜索 Escape 焦点恢复：3/3 通过。
- 桌面再次打开搜索并提交：通过，进入 `/search?q=test`，面板关闭。
- 移动搜索 Escape：通过。
- 移动菜单 Escape 与横向溢出：通过，溢出为 `0`。
- reduced-motion 首页、静态场景和搜索焦点：通过。
- 自动化测试：24/24 通过。
- 生产构建：通过。
- 构建体积未出现可见回归：主 JS `1,067.83 kB`（gzip `353.13 kB`），`liquidScene` `526.43 kB`（gzip `131.99 kB`），`PostEdit` `673.50 kB`（gzip `225.31 kB`）。

复测边界：

- 使用本地开发服务器和 Chromium，不是生产服务器、冷缓存、限速网络或真实移动设备。
- 只验证键盘 Escape 路径；没有验证搜索提交后、浏览器前进后退后或路由切换后的完整焦点管理。
- 依赖安装出现 19 项审计告警，本轮未执行 `npm audit fix`，避免扩大修改范围。

## 下一步假设

**下一轮唯一优先假设：** 修复“跳到正文”链接只更新 hash、不把焦点移到主内容区的问题，是阶段 1 下一项低风险且可直接复测的键盘可访问性改进。

下一轮应只验证：为跳转目标建立可聚焦的正文容器，并在激活跳转链接后让主内容获得焦点，同时确认普通鼠标滚动、路由切换和移动端布局不受影响。若该假设不能在不改变页面视觉结构的前提下成立，则只记录失败原因并停止，不扩展为其他焦点改造。

## 本轮结论

### 完成项

- 完成搜索面板 Escape 焦点恢复的最小实现和 TDD 回归测试。
- 用真实 Chromium 完成桌面 3 次复测、移动端、菜单和 reduced-motion 验证。
- 完成全量测试、生产构建和包体积对照。
- 新增本阶段记录；未进入 DDW 结构拆解。

### 未决项

- “跳到正文”链接的焦点仍未恢复到主内容区。
- 搜索提交后焦点当前落在 `BODY`，尚未定义应当聚焦的位置。
- 公共内容数据为空，真实文章、标签成功列表和非空搜索结果仍未覆盖。
- 性能仍缺少生产环境、冷缓存、限速网络、Chrome trace 和真实移动设备证据。

### 下一轮唯一优先假设

下一轮只验证：**“跳到正文”链接在更新 hash 后，能否通过可聚焦的主内容容器稳定获得焦点，并且不引入视觉变化或布局回归。**

完成该实验或达到停止条件后停止，等待下一次调度。
