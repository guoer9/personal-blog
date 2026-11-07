# 公共内容成功路径复测

## 本轮范围

- 日期：2026-11-01（Asia/Shanghai）。
- 分支：`codex/blog-v1.2`。
- Task：v1.2 Task 3，验证非空归档、搜索、标签和文章详情成功状态；同时验证普通文章入口与 `#discussion` 深链。
- 浏览器：Playwright Chromium；使用 `/Volumes/2tb/opt/anaconda3/bin/python` 运行仓库内的固定夹具脚本。默认 `python3` 指向 Apple Python 3.9.6，未提供 Playwright 模块，因此本轮沿用已安装依赖的 Anaconda Python 3.13.5。
- 前端：Vite 开发服务器 `http://127.0.0.1:5173`。
- 视口：桌面 `1280x720`，移动 `390x844`。
- 动态偏好：`no-preference` 与 `prefers-reduced-motion: reduce`。
- 原始 JSON：`output/playwright/v1.2-20261101/content-paths.json`。
- 截图：`output/playwright/v1.2-20261101/content-*.png`；只记录路径，不把截图作为唯一判据；运行时证据被 `.gitignore` 排除。

## 证据

### E2：路由与请求接口

- `frontend/src/router/index.ts:4-31`：公共成功路径包含 `/writing`、`/tag/:slug`、`/search` 和 `/post/:slug`；带 hash 的路由由全局 `scrollBehavior` 处理。
- `frontend/src/views/blog/Archive.vue:20-34,57-83`：归档请求分页文章，非空时渲染 `ArticleRow` 列表，并显示 `ARCHIVE / NN ENTRIES`。
- `frontend/src/views/blog/Search.vue:39-69,155-204`：搜索请求带 `q`、分页参数和抑制全局 Toast；结果完成后聚焦 `.search-summary`。
- `frontend/src/views/blog/TagPosts.vue:17-32,57-85`：标签页请求 `tag` 参数，非空时渲染文章列表和标签标题。
- `frontend/src/views/blog/PostDetail.vue:39-66,225-325`：成功文章先请求详情，再请求评论；普通入口不主动聚焦，`#discussion` 仅在文章成功加载后聚焦讨论区。
- `frontend/src/components/blog/ArticleRow.vue:17-37`：文章行渲染标题、摘要、日期、阅读数、标签链接和文章入口。

### E1：原创固定夹具

浏览器脚本没有读取数据库，也没有使用现有文章内容；所有响应由本轮脚本生成。

| 字段 | 值 |
| --- | --- |
| 文章数量 | 3 |
| 文章 slug | `deep-link-fixture`、`fixture-pause`、`fixture-return` |
| 文章 ID | `501`、`502`、`503` |
| 创建时间 | `2026-10-28`、`2026-10-12`、`2026-09-30` |
| 阅读数 | `128`、`64`、`19` |
| 标签 | `fixture-lab` / `实验记录`、`fixture-reading` / `阅读路径` |
| 详情正文 | 原创中文/英文占位文字，含标题、段落和二级标题，足以产生可滚动文章页 |
| 评论 | 1 条原创评论，绑定文章 ID `501` |

### E1：公共路径矩阵

每个视口和动态偏好均运行归档、搜索、标签、普通文章、文章 `#discussion` 深链，共 `20` 条结果。

| 路径 | 关键断言 | 结果 |
| --- | --- | --- |
| `/writing` | 3 个文章行、4 个标签链接、`ARCHIVE / 03 ENTRIES`、横向溢出 0 | 4/4 组合通过 |
| `/search?q=fixture` | 3 个文章行、`QUERY / “fixture”`、`3 RESULTS`、`.search-summary` 获得焦点、横向溢出 0 | 4/4 组合通过 |
| `/tag/fixture-lab` | `#fixture-lab` 标题、2 个文章行、横向溢出 0 | 4/4 组合通过 |
| `/post/deep-link-fixture` | 正确 H1、原创正文、2 个标签链接、初始焦点 `BODY`、首次 Tab 为 `跳到正文`、评论请求 1 次、横向溢出 0 | 4/4 组合通过 |
| `/post/deep-link-fixture#discussion` | 正确 H1、原创正文、2 个标签链接、焦点位于 `#discussion`、评论请求 1 次、滚动到讨论区、横向溢出 0 | 4/4 组合通过 |

跨全部 20 条结果的共同值：`horizontalOverflow = 0`，`consoleErrors = []`，评论请求数均为 1；普通文章初始焦点均为 `BODY`，深链文章讨论区焦点均为 true。

### E1：请求证据

- 归档：`GET /api/v1/posts?page=1&page_size=12`。
- 搜索：`GET /api/v1/posts/search?q=fixture&page=1&page_size=12`。
- 标签：`GET /api/v1/posts?tag=fixture-lab&page=1&page_size=12`。
- 普通/深链文章：`GET /api/v1/posts/deep-link-fixture`，随后 `GET /api/v1/comments/post/501`。
- 每个场景均只对目标 API 返回固定原创夹具；未对其他资源做内容替换。

## 实验

**假设：** 使用原创、非空、可滚动的固定内容，可以在不接触真实数据库和参考站点素材的前提下，验证公共内容路径的 DOM 结构、请求顺序、焦点管理、深链滚动和移动布局。

**变更：**

- 新增被忽略的 `output/playwright/v1.2-20261101/content-paths.py`，覆盖 5 条公共路径、2 个视口和 2 种动态偏好。
- 固定三篇原创文章、两个标签和一条原创评论；不复制 Lusion 的素材、着色器、模型、音频或文案，也不写入数据库。
- 证据脚本的普通/减少动态效果截图使用不同文件名，避免同一视口的两次运行互相覆盖。

**成功判据：** 所有夹具断言通过；列表和正文内容非空；搜索结果正确聚焦；普通详情页保持 `BODY` 初始焦点；详情深链聚焦 `#discussion`；评论仅请求一次；桌面和移动无横向溢出；无非预期 console error。

## 复测结果

- 浏览器脚本：20/20 结果通过，原始数据写入 `output/playwright/v1.2-20261101/content-paths.json`。
- 归档、搜索、标签成功路径均在桌面和移动视口通过；减少动态效果没有改变内容可见性或布局断言。
- 普通文章入口在全部组合中初始焦点为 `BODY`，第一次 Tab 目标为 `跳到正文`。
- `#discussion` 深链在全部组合中聚焦讨论区并产生滚动；桌面 `scrollY` 为 `1460`，移动 `scrollY` 为 `1642`。这些数值来自当前固定夹具和开发服务器，不作为跨浏览器或生产环境的通用像素承诺。
- 生产源码未修改；本轮只增加被忽略的证据脚本和本研究记录。

## 未验证项

- 夹具验证不等于真实后端数据库、真实认证状态或真实网络错误覆盖；本轮没有读取或修改数据库。
- 尚未在生产预览构建、Firefox、Safari 或真实 API 上复测。
- 未覆盖分页第二页、空结果、搜索失败、标签失败、评论失败、登录后评论表单和文章封面图片加载。
- 截图已生成但本轮不以图片查看作为验证方式；DOM、请求、焦点、滚动和溢出断言才是本轮门禁依据。

## 下一步假设

**唯一优先验证点：** 在生产预览构建、冷缓存和固定网络条件下，复测首页/归档/文章的首屏性能指标与传输体积，建立 Task 4 的三次采样基线；不在性能基线前引入拆包或 DDW 视觉改动。

## 本轮结论

### 完成项

- 完成非空归档、搜索、标签、普通文章和 `#discussion` 深链的 20 条浏览器成功路径复测。
- 证实请求参数、内容渲染、焦点管理、讨论区深链和桌面/移动无横向溢出。
- 记录原创夹具字段、请求 URL、原始 JSON、截图路径和源码定位。
- 未复制 Lusion 的素材、着色器、模型、音频或文案。

### 未决项

- 真实数据库和生产预览尚未覆盖。
- 分页、空态、失败态、认证评论和资源加载仍待后续门禁。

### 下一轮唯一优先假设

只在生产预览和冷缓存条件下，测量首页/归档/文章的首屏性能与传输基线，并记录三次采样的原始输出。
