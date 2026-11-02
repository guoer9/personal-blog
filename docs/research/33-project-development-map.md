# 项目开发地图与接续点

日期：2026-11-02。基于当前 `codex/blog-v1.2` 工作树及代码读取、自动化测试和独立审阅。当前存在大量尚未提交的功能改动，本轮没有暂存、提交、推送、部署或清理这些改动。

## 当前产品范围

项目已经从个人博客扩展成个人内容站，包含五条主要功能线：

| 功能线 | 前端入口 | 后端与数据 | 当前接续点 |
| --- | --- | --- | --- |
| 博客 | `/writing`、`/search`、`/tag/:slug`、`/post/:slug` | `posts`、`tags`、`comments`，后台文章 CRUD | 保持草稿与公开查询隔离，保留搜索和阅读焦点回归 |
| 作品 | `/works`、`/works/:slug`、`/admin/works` | `works` 的 draft/published JSON 快照，`work_assets` 发布副本 | 继续围绕保存草稿、预览、发布更新、下架的闭环开发 |
| 私有文件库 | `/admin/library` | `library_entries`、`library_uploads`，独立私有目录 | 分片上传、恢复、下载、回收站；数据库与原件需要一起备份 |
| 访客传输 | `/transfer` | 独立磁盘元数据、分片、管理令牌摘要与短效下载票据 | 默认单文件 10 GiB、完成后保留 6 小时，启动和周期任务清理 |
| Notion 资料库 | 目前只有旧 `/admin/notion` 页面 | `notion_sources`、`notion_documents`、独立导入状态 | 多连接后端与公开 API 已实现，新管理员界面及公开列表/详情尚未接通 |

## 代码如何协作

前端入口是 `frontend/src/main.ts` 和 `frontend/src/router/index.ts`。公开页通过 `MainLayout.vue` 展示，后台通过 `AdminLayout.vue` 展示；认证由 Pinia user store 和统一请求封装处理。公共页面采用懒加载，Element Plus 主要服务后台；Three.js 场景在 `graphics/`，动效组件在 `components/immersive/`，与文章内容 API 分开。

后端入口是 `backend/app/main.py`。路由主要在 `app/api/v1/`，旧博客查询在 `crud/`，文件库、作品、传输和 Notion 导入逻辑在 `services/`。数据库使用 SQLAlchemy 异步会话与 Alembic；生产目标为 PostgreSQL，当前默认测试主要使用 SQLite 内存库。

作品发布采用草稿与公开快照分离：保存草稿不覆盖公开内容，显式发布才更新公开快照；作品版本号用于拒绝过期编辑。公开媒体通过引用检查后读取独立发布副本，不直接暴露私有原件目录。

访客传输没有复用私有文件库。它使用独立存储目录、配额、上传令牌和取件流程，应用 lifespan 启动其清理任务。Notion 则只在显式管理员操作时发起请求，应用启动不读取 Notion 内容。

## 本轮完成与发现

完成了 Notion 多连接服务、管理员导入接口、公开文档 API 的文档和验收收尾。独立审阅进一步发现并修复了同批重名页面的 slug 冲突、整体状态读取旧服务、通用单页预览未检查来源 connection 绑定三个问题；新增回归用例包含长标题截断后的碰撞。

`GET /api/v1/admin/notion/status` 现在读取多连接资料库状态；旧页面通过 `/legacy/status` 读取单库状态，并继续使用兼容的 `/sync`。这是一段待迁移的兼容逻辑，不应作为新管理界面的接口模型。

新资料库的整库导入会公开该来源内可完整、安全转换的页面，不沿用旧单库同步的“发布到博客”复选框。数据库来源必须先检查，再显式导入；数据库查询或分页失败保持旧快照，单页内容异常则隔离该页。

## 验收基线

| 检查 | 本轮结果 | 范围限制 |
| --- | --- | --- |
| 后端全套 pytest | 183 通过，41 跳过 | 跳过项需要独立 PostgreSQL 测试库 |
| 前端 Vitest | 24 个文件、139 项通过 | 组件与单元测试，不等同真实浏览器验收 |
| TypeScript 与 Vite 构建 | 通过 | 有超过 500 kB 的分块提示 |
| 公共入口包体积门禁 | 通过 | 主 JS gzip 61,663 B，CSS gzip 2,253 B |
| Alembic | 唯一 head：`notion_multi_conn_v3` | 验证图结构及 SQLite 增量迁移用例，未升级用户数据库 |
| Python 编译、OpenAPI、差异空白检查 | 通过 | 未调用真实 Notion API |

本机已安装 nvm Node `v22.20.0`，但当前 shell 默认 PATH 不包含它。运行前端命令时临时加上 `$HOME/.nvm/versions/node/v22.20.0/bin` 即可，无需安装新运行时。后端可直接使用 `backend/venv/bin/python`。

## 后续开发顺序

1. 将 `/admin/notion` 迁移成多连接来源管理：connection 选择、数据库链接预览、明确的公开确认、来源列表、逐来源同步及单页导入。浏览器不输入或保存 Notion token。
2. 实现公开资料库列表和详情路由，接入分页、搜索、分类、Markdown 渲染和加载/错误状态；同时完成旧 `/post/:slug` 到文档页的浏览器兼容行为。现有兼容跳转只在 API 层验证。
3. 在独立 PostgreSQL 测试库上补跑 41 个跳过项，实际验证升级链与既有行的保留，再做本地浏览器流程验收。
4. 数据规模扩大后，将文档列表当前的“读取全部 published 行后在 Python 中筛选和分页”改为数据库侧查询；目前该实现会随公开正文总量增加而增长内存和请求成本。
5. 更新根 README 的历史验收数字和启动指引，并补上数据库、原件、发布副本及传输目录的备份/恢复演练。历史研究文档保留当时事实，新记录承载当前结论。

本地操作入口见 `scripts/local/README.md`，Notion 操作细节见 `scripts/local/NOTION.md`，本轮 API 和验证记录见 `32-notion-multi-connection-api-implementation.md`。
