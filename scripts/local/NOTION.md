# Notion 多工作区资料库

## 在后台添加工作区

1. 启动本地服务和前端，打开 `/admin/notion`，使用本地管理员登录。
2. 在“添加 Notion 连接”填写**连接名称**和该工作区的 **Notion 密钥**，点击“添加连接”。名称可自行取，例如“个人日记”“技术文档”。
3. 后端先验证密钥，成功后保存到本机凭据文件，并自动选择新连接。继续填写可添加其他工作区；重复密钥会拒绝。
4. 在 Notion 中给该连接授予目标页面或数据库的内容读取权限，然后点击“浏览工作空间”。列表显示该密钥实际可访问的页面和数据库，支持标题搜索、分页。
5. 点击目录项“选择”，或直接粘贴内容页面/数据库链接，再点击“检查并预览”。不需要寻找工作区数据库链接；普通独立页面也支持。
6. 核对预览范围、可公开数量和隔离数量，勾选公开确认后点击“确认导入并公开”。之后在已注册来源中点击“同步此来源”更新。
7. 访客在 `/documents` 查看资料库列表，在 `/documents/:slug` 查看正文。普通博客文章继续使用原文章入口。

后台 `/admin/posts` 统一展示手动文章和 Notion 文章的作者、标签、评论数、阅读量，以及公开链接和 Notion 原文链接。可直接下架 Notion 文章；手动下架后重新同步不会自动公开。`/admin/comments` 可管理两种文章的评论和回复，也能查看下架文章的评论。

资料库卡片和详情展示作者、分类、阅读量和真实评论数；没有源分类时显示“暂无标签”。登录用户可在详情页发表评论和回复，匿名访客可阅读评论。两种文章共用评论表，以文章来源和 ID 区分关联；正文仍保留各自的数据模型。

浏览目录只发现内容，不会批量发布整个工作区。选择数据库会读取其全部 data source；选择独立页面只导入该页面。选择已经注册数据库中的单页时，预览和导入范围都是这一页。

密钥用密码框输入，提交后无论成功或失败都会清空；不会保存到浏览器存储、URL 或接口返回值。不要把真实密钥发到聊天或截图。

## 本地凭据与容器

初始化创建权限为 `0600` 的空文件：

```bash
backend/venv/bin/python scripts/local/dev.py init
backend/venv/bin/python scripts/local/dev.py start
BLOG_API_PROXY=http://127.0.0.1:8001 npm --prefix frontend run dev -- --host 127.0.0.1 --port 5173
```

凭据在根目录 `.secrets/notion-connections.json`，仅保存到本机，不写入业务数据库或镜像。后台添加使用文件锁、原子替换和 `0600` 权限。Compose 必须挂载可写目录以支持原子替换：

```text
./.secrets:/run/secrets
```

后端环境为 `NOTION_CONNECTIONS_FILE=/run/secrets/notion-connections.json`。构建上下文是 `backend/`，根目录 `.secrets/` 不在镜像内。缺少文件表示没有连接；文件损坏时拒绝覆盖并返回安全错误。

不用 Compose 时，从 `backend/` 启动并传入绝对路径：

```bash
NOTION_CONNECTIONS_FILE=/绝对路径/personal-blog/.secrets/notion-connections.json venv/bin/python -m uvicorn app.main:app --reload --port 8000
```

手动文件格式仍兼容 [`notion-connections.example.json`](notion-connections.example.json)。后台创建会自动生成 connection ID，无需手填。轮换时先在 Notion 撤销旧密钥，再在本机文件中替换对应连接的 token，保留 ID，恢复 `chmod 600` 后重新预览。不要保留无用的旧密钥副本。

## 接口

管理员接口需要管理员登录令牌；Swagger 位于本地 API 的 `/docs`。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `POST` | `/api/v1/admin/notion/connections` | `{ "label": "连接名称", "token": "本机填写" }`，验证并添加，返回安全元数据 |
| `GET` | `/api/v1/admin/notion/connections` | 连接名称、ID、是否已配置，不含密钥 |
| `GET` | `/api/v1/admin/notion/connections/{id}/workspace` | 选定工作区目录，支持 `q`、`cursor` |
| `GET` | `/api/v1/admin/notion/sources` | 已注册数据库或独立页面 |
| `GET` | `/api/v1/admin/notion/status` | 本地状态和最近计数 |
| `POST` | `/api/v1/admin/notion/sources/inspect` | `{ "connection_id": "选定ID", "url": "内容链接" }`，预览、不发布 |
| `POST` | `/api/v1/admin/notion/sources` | 确认导入所选范围并公开可转换内容 |
| `POST` | `/api/v1/admin/notion/sources/{id}/sync` | 手动同步已注册来源 |
| `POST` | `/api/v1/admin/notion/sources/{id}/pages/inspect` | 预览已注册数据库中的单页 |
| `POST` | `/api/v1/admin/notion/sources/{id}/pages/import` | 导入数据库中的所选单页 |
| `GET` | `/api/v1/admin/articles` | 两种来源的统一文章管理列表和真实统计 |
| `POST` | `/api/v1/admin/articles/{kind}/{id}/unpublish` | 下架手动或 Notion 文章，`kind` 为 `post` 或 `notion` |
| `GET` | `/api/v1/admin/articles/{kind}/{id}/comments` | 管理员查看目标文章评论，包含下架文章 |
| `GET` | `/api/v1/documents` | 匿名资料库列表、分类和搜索 |
| `GET` | `/api/v1/documents/{slug}` | 匿名正文和结构化 Notion 内容 |
| `GET` | `/api/v1/documents/media/{page_id}/{asset}` | 仅返回已公开正文/封面引用的图片 |
| `GET` | `/api/v1/comments/notion/{document_id}` | 公开 Notion 文章的评论和回复 |
| `POST` | `/api/v1/comments` | 登录后发表评论；`post_id` 与 `notion_document_id` 必须且只能填一个 |

旧单库接口 `/admin/notion/legacy/status` 和 `/admin/notion/sync` 仅作兼容。应用启动不自动访问 Notion，也不启动 Notion 定时同步。

## 格式与图片

正文保留结构化内容块，支持富文本、空段落、三级标题、嵌套列表、待办、引用、提示块、折叠、代码、表格、分栏、图片和安全链接。旧数据仍可用安全 Markdown 显示。卡片展示标题、摘要、分类、更新时间，以及来源存在的图标和封面。

Notion 托管图片会复制为私有稳定快照，不依赖会过期的签名 URL。JPEG/PNG/GIF/WebP 直接保存；HEIC 转成 JPEG 并去除源照片元数据。下载不携带 Notion Authorization，限制每张 10 MiB、每页 50 MiB，HEIC 限制 4000 万像素。图片只有被已公开页面引用才允许匿名读取；预览缓存、隔离、下架或未引用文件均返回 404。

目前不支持任意外站图片、SVG、附件/音视频播放器、公式等所有 Notion 块；遇到无法完整转换的内容会明确拒绝或隔离，不静默跳过。独立页读取失败保留上次成功快照。数据库中个别页失败会隔离该页。Notion 数据库的自定义视图布局、卡片尺寸、字体选项等尚未复制，因此不承诺任意页面像素级一致。

## 浏览器验收

```bash
# 真实导入会将显式选定内容发布到本地实例，请选择已授权的来源。
NOTION_ACCEPTANCE_CONNECTION=选定连接ID NOTION_ACCEPTANCE_URL='已授权内容链接' node scripts/local/verify-notion-workflow.mjs
# 使用受控连接响应验证多连接表单；不保存第二个真实密钥或调用远端。
node scripts/local/verify-notion-connections.mjs
# 匿名受控内容检验常用 Notion 格式，真实 Chrome / 桌面与手机。
node scripts/local/verify-notion-formatting.mjs
# 已导入真实 Notion 文章的统一管理、评论、回复、下架及桌面/手机验收。
# 设为 1 时还会读取远端来源并重新同步到本地，不修改 Notion 源页面。
ARTICLE_ACCEPTANCE_SYNC=1 node scripts/local/verify-article-management.mjs
```

证据在本地忽略目录 `output/playwright/notion-acceptance-20261102/`。真实流程包含登录、工作区目录、预览确认、导入、同步、匿名搜索和详情、桌面/手机、键盘、图片解码和 axe 检查。受控流程覆盖添加两连接、错误清空、自动选择和目录隔离。真实第二工作区仍需对应有效密钥才能验收。

统一文章验收证据位于 `output/playwright/article-management/`。脚本使用现有本地管理员和已导入文章，创建临时普通文章及评论，结束后仅清理本次创建的数据；文章阅读会真实增加阅读量。实现与验收记录见 [`35-unified-article-comments-acceptance.md`](../../docs/research/35-unified-article-comments-acceptance.md)。
