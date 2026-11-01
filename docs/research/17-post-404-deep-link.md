# 文章 404 深链门禁复测

## 本轮范围

- 日期：2026-11-01（Asia/Shanghai）。
- 分支：`codex/blog-v1.2`。
- Task：v1.2 Task 2，只验证文章详情在 `404` API 响应下直接打开 `/post/:slug#discussion` 的错误状态、焦点、滚动、通知、键盘入口和布局。
- 浏览器：Playwright Chromium，使用本机已安装的 `/Volumes/2tb/opt/anaconda3/bin/python` 运行时；前端使用 Vite 开发服务器 `http://127.0.0.1:5173`。
- 视口：桌面 `1280x720`，移动 `390x844`。
- 动态偏好：`no-preference` 与 `prefers-reduced-motion: reduce`。
- API 夹具：仅对 `GET /api/v1/posts/round404-deep-link` 返回 `404` 和 `{"detail":"not found"}`；延迟分别为 `0 ms`、`1200 ms`。
- 原始 JSON：`output/playwright/v1.2-20261101/post-404-deep-link.json`。
- 截图：`output/playwright/v1.2-20261101/post-404-*.png`；运行时证据被 `.gitignore` 排除，不纳入提交。

## 证据

### E2：组件错误映射与深链保护

- `frontend/src/views/blog/PostDetail.vue:39-61`：请求开始时清理旧文章和错误状态；`error.response.status === 404` 映射到 `notFound`，其他错误映射到 `loadError`。
- `frontend/src/views/blog/PostDetail.vue:63-66`：只有文章成功加载后才会对 `#discussion` 执行深链聚焦；404 分支不会进入该路径。
- `frontend/src/views/blog/PostDetail.vue:147-155`：深链聚焦函数在找不到 `#discussion` 时直接返回，不会制造虚假焦点。
- `frontend/src/views/blog/PostDetail.vue:212-222`：404 分支渲染 `404 / MISSING`、`这篇文章不在档案里。`、返回文章列表和首页入口；讨论区位于成功文章分支之后。

### E2：组件回归测试

- `frontend/src/views/blog/PostDetail.test.ts:176-185` 新增 404 深链测试：模拟 404，断言错误文案存在、`#discussion` 不存在、焦点停留在 `document.body`。
- 目标测试命令：`npm --prefix frontend run test -- --run src/views/blog/PostDetail.test.ts`。
- 结果：1 个测试文件、8 项测试通过。

### E1：8 场景浏览器矩阵

| 视口 | 动态偏好 | API 延迟 | 标题 | 初始焦点 | 首次 Tab | `scrollY` | 横向溢出 | Toast | `#discussion` | API 请求数 | 非预期 console error |
| --- | --- | ---: | --- | --- | --- | ---: | ---: | ---: | --- | ---: | --- |
| 1280x720 | normal | 0 ms | `GUOER · Field Notes` | `BODY` | `跳到正文` | 0 | 0 | 0 | false | 1 | 0 |
| 1280x720 | normal | 1200 ms | `GUOER · Field Notes` | `BODY` | `跳到正文` | 0 | 0 | 0 | false | 1 | 0 |
| 1280x720 | reduce | 0 ms | `GUOER · Field Notes` | `BODY` | `跳到正文` | 0 | 0 | 0 | false | 1 | 0 |
| 1280x720 | reduce | 1200 ms | `GUOER · Field Notes` | `BODY` | `跳到正文` | 0 | 0 | 0 | false | 1 | 0 |
| 390x844 | normal | 0 ms | `GUOER · Field Notes` | `BODY` | `跳到正文` | 0 | 0 | 0 | false | 1 | 0 |
| 390x844 | normal | 1200 ms | `GUOER · Field Notes` | `BODY` | `跳到正文` | 0 | 0 | 0 | false | 1 | 0 |
| 390x844 | reduce | 0 ms | `GUOER · Field Notes` | `BODY` | `跳到正文` | 0 | 0 | 0 | false | 1 | 0 |
| 390x844 | reduce | 1200 ms | `GUOER · Field Notes` | `BODY` | `跳到正文` | 0 | 0 | 0 | false | 1 | 0 |

预期的 API `404` 会被 Chromium 记录为一条资源错误；脚本将该已知夹具噪声单独保留在 `consoleErrors`，并只把 `unexpectedConsoleErrors` 作为失败判据，8 场景均为空。

## 实验

**假设：** 文章 API 返回 404 时，即使 URL 带有 `#discussion` 且响应延迟达到 1200 ms，页面也应稳定停在文章缺失状态，不尝试滚动或聚焦不存在的讨论区，不产生错误 Toast，并保持桌面、移动和减少动态效果路径可用。

**变更：**

- 新增 `frontend/src/views/blog/PostDetail.test.ts:176-185` 的组件回归测试。
- 使用被忽略的 `output/playwright/v1.2-20261101/post-404-deep-link.py` 运行 2 个视口 × 2 种动态偏好 × 2 种 API 延迟的固定夹具矩阵。
- 复测脚本首次运行暴露了脚本测量顺序问题：首次 Tab 后读取焦点会把跳过链接误当成初始焦点；随后改为分别记录初始焦点和首次 Tab 目标。第二次运行又确认预期 API 404 的 Chromium console 噪声，改为保留原始错误并单独断言非预期错误为空。应用代码未因这两项脚本问题修改。

**成功判据：** 每个场景都显示 404 文案；初始焦点为 `BODY`；首次 Tab 为 `跳到正文`；`scrollY` 和横向溢出为 0；无 Toast；无 `#discussion`；只发出一次目标 API 请求；无非预期 console error。

## 复测结果

- 目标组件测试：8/8 通过。
- 浏览器矩阵：8/8 通过。
- 桌面和移动截图均显示文章缺失页，布局未出现横向溢出；首次 Tab 后跳过链接获得可见焦点框。
- 404 状态没有触发 `focusDiscussionDeepLink()`，也没有渲染讨论区；该结论同时由源码路径（E2）、组件断言（E2）和浏览器行为（E1）支持。
- 本轮没有修改 `PostDetail.vue`，因此该门禁验证的是现有实现，而不是新增错误页逻辑。

## 未验证项

- 本轮使用 Vite 开发服务器和 Chromium；尚未在生产预览构建、Firefox、Safari 或真实后端 404 响应上复测。
- 未覆盖网络断开/503、文章成功加载后 `#discussion` 的滚动位置，也未扩展完整键盘遍历；这些路径已有前置记录或后续任务门禁，不在本 Task 范围内。
- 截图属于本地运行时证据，不纳入 Git；重新运行脚本会覆盖同名 JSON 和 PNG。

## 下一步假设

**唯一优先验证点：** 文章成功加载并直接打开 `/post/:slug#discussion` 时，真实内容页应在固定 API 夹具下只请求一次文章和一次评论，聚焦 `#discussion`，并在桌面、移动、减少动态效果和延迟响应下保持无横向溢出；先完成该成功路径复测，再进入性能/拆包任务。

## 本轮结论

### 完成项

- 完成 404 文章深链的组件回归测试和 8 场景浏览器复测。
- 证实 404 错误页保持 `BODY` 初始焦点、`scrollY: 0`、无横向溢出、无 Toast、无讨论区，首次 Tab 仍为 `跳到正文`。
- 记录源码位置、测试输出、原始 JSON 和桌面/移动截图路径。
- 未复制 Lusion 的素材、着色器、模型、音频或文案。

### 未决项

- 成功文章深链和生产预览环境尚未在本轮验证。
- 本轮未改变应用代码；后续若成功路径暴露问题，再按单变量实验处理。

### 下一轮唯一优先假设

只验证成功文章 `#discussion` 深链在 8 组合矩阵下的请求次数、讨论区焦点、滚动和布局稳定性。
