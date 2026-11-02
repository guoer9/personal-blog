# Notion 多工作区管理、公开资料库与本地验收

日期：2026-11-02。工作目录：`/Volumes/2tb/mydata/code/vllm/personal-blog`，分支：`codex/blog-v1.2`。

## 交付内容

后台 `/admin/notion` 提供“连接名称 + Notion 密钥”表单。服务端通过固定 Notion API 验证连接，凭据以私有文件原子保存，接口只返回安全元数据。成功后刷新并选择新连接；错误、重复密钥、权限不足和写入失败均返回不含密钥的提示。输入框提交后清空。

选择连接后可浏览、搜索和分页查看该密钥能访问的工作区页面及数据库。支持独立页面，用户无需将工作区误认为数据库。目录发现、预览和公开导入分别由用户操作；预览确认前不能导入。切换连接、链接或搜索条件会清除失效预览/目录分页，旧响应不能覆盖新选择。已注册来源支持手动同步和数据库单页导入。

公开 `/documents` 提供卡片、关键词/精确分类筛选、URL 分页、空态/重试；`/documents/:slug` 提供正文、404、响应式布局。旧 Notion 文章链接可转入资料详情。访客页不依赖管理员登录，也不显示后台导航。

正文以原生结构化块呈现常用 Notion 格式，保留文本注解、空段落、列表层级、待办、表格标题标志、块颜色、折叠标题和分栏。Notion 托管图片保存为私有稳定快照；真实页面的 HEIC 图片会转成 JPEG 并去除源照片元数据，下载不转发 Notion Authorization。公开图片需要同时满足页面已公开且仍被正文或封面引用。

## 真实 Notion 浏览器验收

固定生产构建运行于 `http://127.0.0.1:4183`；API 为 `http://127.0.0.1:8001`，数据库为独立 `blog-local` PostgreSQL。Chrome `156.0.8078.74`，桌面 1440×1000、手机 390×844。

选定连接为 `personal-blog`（个人博客），来源为用户提供的工作区根页面 `3f99bf48-96c9-801e-9d6b-d0899bf1f2cd`。本次只将这篇选定页面导入本地公开实例，未批量公开工作区。

最终成功执行时间：2026-11-02 16:29:24 至 16:35:47（Asia/Shanghai）。

| 检查 | 实际结果 |
| --- | --- |
| 匿名访问管理员连接/目录 | 401 |
| 后台登录、选连接、浏览真实工作区 | 成功，发现 24 项，当前无下一页 |
| 真实来源预览 | 独立页面 1 篇，可公开 1、隔离 0 |
| 公开确认门槛 | 未勾选时导入按钮禁用 |
| 实际导入 | published=1、updated=1、failed=0 |
| 实际手动同步 | published=1、updated=1、failed=0 |
| 正文结构 | 75 个段落、4 张图片，DOM 数量与接口快照一致 |
| 图片 | 桌面和手机逐张解码成功，naturalWidth>0；含 2 张 HEIC 转换结果 |
| 匿名访问 | 列表、搜索、卡片进入详情、刷新详情、404 全通过 |
| 键盘 | Enter 搜索、结果标题获得焦点 |
| 布局 | 两种视口均无横向溢出，已人工查看卡片和正文截图 |
| 自动可访问性 | 后台、列表、详情 × 两种视口，共 6 次 axe，0 违规 |
| 浏览器运行时 | 0 pageerror |

复跑：

```bash
LOCAL_FRONTEND_URL=http://127.0.0.1:4183 \
NOTION_ACCEPTANCE_CONNECTION=personal-blog \
NOTION_ACCEPTANCE_URL='https://app.notion.com/p/2026-10-15-3f99bf4896c9801e9d6bd0899bf1f2cd?source=copy_link' \
node scripts/local/verify-notion-workflow.mjs
```

脚本的显式连接和来源参数限定发布范围。报告只保存计数/短链等验收数据，不保存密钥或全文；截图包含本地来源内容，保留在 Git 忽略目录。

## 多连接表单浏览器验收

`verify-notion-connections.mjs` 使用真实 Chrome、实际生产页面和本地管理员登录，拦截连接创建/目录响应，验证连续添加两个连接、创建后自动选择、工作区切换清空旧目录、错误清空密钥，以及密钥不进入浏览器存储、URL 或可见提示。桌面/手机均无横向溢出，0 pageerror。

这是受控连接测试。只有一个真实 token 已配置；没有伪称已连通第二个真实工作区。连接创建后端另有真实服务代码 + httpx.MockTransport 测试，覆盖验证请求、错误清理、重复拒绝、并发原子写入和管理员权限。

## 常用格式补充浏览器验收

`verify-notion-formatting.mjs` 在匿名生产页面拦截公开 API 为受控结构化内容，用于检验真实选定页面未覆盖的格式。桌面/手机共 28 项检查通过：富文本注解/转义、块颜色和递归继承、空段落、标题子内容、键盘展开/收起折叠标题、嵌套列表、勾选待办、长代码横向滚动、表头语义、响应式分栏、本地图像/封面及安全链接。0 pageerror、0 非预期 API 或外站请求。

补充验收首次发现详情 Markdown 通用 CSS 覆盖原生块样式、链接对比度不足和代码滚动区缺少显式焦点。已将 Markdown 样式限制到旧内容容器，并为原生代码滚动区加入焦点及可访问名称；回归测试与生产浏览器复验通过。最终 4 次 axe 扫描共 0 违规。axe 的 3 组自动对比度不确定项已人工复核：导航小字 `#595954` / `#f4f1ea` 为 6.24:1，代码 `#37352f` / `#efede8` 为 10.48:1；导航下划线未覆盖文本，代码溢出限制在可聚焦区域内。不将零违规表述为覆盖全部可访问性情况。

证据：同目录 `formatting-report.json`、`formatting-fixture.json`、`formatting-list-{desktop,mobile}.png` 和 `formatting-detail-{desktop,mobile}.png`。内容完全为受控样例，不是第二次真实 Notion 导入。

## 自动检查与复核

| 检查 | 结果 |
| --- | --- |
| 后端完整套件（独立 PostgreSQL 测试数据库） | 274 passed、1 skipped |
| 被跳过的清理 CLI 用例单独以隔离 SQLite 执行 | 1 passed；无 PostgreSQL 环境的参数项跳过 |
| 前端完整套件 | 29 文件、226 tests passed |
| TypeScript + Vite 生产构建 | 通过；保留既有大型懒加载 chunk 提示 |
| 主入口压缩体积 | JS gzip 61,818 B，CSS gzip 2,253 B，均低于预算 |
| Alembic | `notion_native_blocks_v5 (head)` |
| OpenAPI | 连接创建接口可见；token 为 writeOnly/password |
| 文件与凭据 | `git diff --check` 通过；密钥、环境和验收输出均被忽略 |

独立复核指出并已修复：独立页读取失败覆盖旧快照、数据库单页预览与导入范围不一致、搜索更改混用分页游标、标题子块丢失、富文本链接中的疑似凭据绕过扫描、取消 HEIC 转换后重建临时文件。关键行为均先复现失败再通过回归测试；最后两项经过针对性复核，未发现遗留问题。

## 过程问题与范围限制

早期真实运行发现 Notion 对“将页面当数据库读取”返回特定 400，而非 404；现仅针对该错误做页面回退。原图片转换器不接受真实 HEIC，现已加入转换与回归测试。新增表单取代了旧的“只能手填文件”和“凭据只读挂载”约束，相关测试与使用文档已更新。

Docker 镜像源曾返回 401，本轮基于已有本地 API 镜像刷新代码并安装新增图片依赖，未更改全局镜像配置。容器 Notion 出站请求也出现过超时，后续恢复。一次浏览器运行被开发热更新打断，最终改用固定生产构建完整通过。早期失败不计为通过。

支持常用格式不等于复制全部 Notion UI：数据库自定义视图、卡片尺寸、字体设置、任意外站媒体、SVG、所有公式/附件/音视频块尚未完整支持。无法完整转换的块会拒绝或隔离；不承诺任意页面像素级一致。工作区目录仅包含该连接实际可访问的内容。当前业务接口读取 Notion，未对源页面执行编辑；测试和开发均未部署到公网。

使用说明：[`scripts/local/NOTION.md`](../../scripts/local/NOTION.md)。开发过程保留原有未提交改动，没有 staging、commit、push 或部署。

## 本地证据

- `output/playwright/notion-acceptance-20261102/report.json`：真实流程最终成功报告。
- `output/playwright/notion-acceptance-20261102/connections-report.json`：受控双连接浏览器报告。
- 同目录 `admin-directory-desktop.png`、`admin-source-preview.png`、`admin-notion-mobile.png`：管理流程截图。
- 同目录 `connection-form-1440.png`、`connection-form-390.png`：连接表单截图。
- 同目录 `documents-1440.png`、`documents-390.png`、`document-1440.png`、`document-390.png`：公开页截图。
- `.superpowers/sdd/2026-11-02-notion-ui-acceptance/`：开发账本及最终自动检查日志。
