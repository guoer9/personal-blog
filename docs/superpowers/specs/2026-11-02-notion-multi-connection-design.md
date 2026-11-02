# Notion 多连接、多资料库手动导入设计

日期：2026-11-02
状态：用户已要求开始实施
范围：本地开发与后端 API；不部署云服务器、不使用聊天中暴露的凭据。

## 目标

- 支持任意数量的 Notion internal connections；一个 connection 可以授权多个数据库。数据库来源与 token 不做一一对应假设。
- 管理员明确选择一个已在本地配置的 connection，粘贴数据库链接，先检查并预览，再确认导入。
- 每个已注册数据库只绑定一个当前用于同步的 connection；如多个 connections 均有权限，管理员可重新检查后显式改绑，不做自动 token 探测或凭据轮试。
- 数据库 API 返回的所有 data sources 都逐一检查与分页读取；数据库链接只负责定位 ID，本身不授予访问权限。
- 只有已由管理员确认注册的数据库进入导入范围。确认导入后，其安全活动页面公开；疑似凭据或无法完整转换的页面隔离。来源级读取失败不改变上次成功内容。
- 管理员可手动同步整个已注册来源；不运行启动同步、定时任务或后台 Notion 请求。
- 提供公开资料库列表、详情、分类与搜索 API，与普通博客文章 API 完全隔离；旧 Notion 文章路径保留兼容跳转。

## Notion 连接与链接规则

- 每把 internal connection token 代表一个独立 connection 身份，必须具备 Read content 能力并显式获得目标页面/数据库访问权限。
- connection 授权通过 Notion Developer Portal 的 Content access，或目标页面/数据库的 Connections 菜单完成；访问沿父页面继承到子页面。
- 一个 connection 可以授权多个数据库。多个 connections 也可各自获得同一数据库的访问权限；应用不推断二者关系，而通过管理员选定的 connection 请求验证。
- 只接受 HTTPS Notion 主机链接。将数据库链接解析为数据库 ID 后，服务端只请求固定 `api.notion.com` 主机的 `GET /v1/databases/{database_id}`。
- 对 retrieve database 响应中的每个 `data_sources[].id` 调用 retrieve data source 与 `POST /v1/data_sources/{data_source_id}/query`，按 cursor 完整分页；不假定数据库只有一个 data source。
- 页面链接只能在已注册来源中使用，并校验页面 parent 的 database/data-source ID。
- 使用当前 Notion API 版本 `2026-03-11`。

## 本地凭据配置

- 用户手工维护项目根目录 `.secrets/notion-connections.json`；结构是版本化 `connections` 列表，每项含稳定 `id`、显示名 `label`、token。
- 该文件由本地初始化命令创建，权限为 `0600`，纳入 Git 忽略，并通过 Compose 只读挂载。tracked example 不含真实密钥。
- API 从文件读取凭据，只对管理员返回 id、label、configured；token 不进入数据库、API 响应、浏览器存储、日志或研究记录。
- 文件每次 Notion 管理操作重新读取，编辑后无需把凭据提交给前端或重建镜像。未来云部署再接服务器 Secret Manager；本阶段不实现。
- 用户在聊天中暴露的任何凭据不得使用；真实联调必须等待其撤销旧值并在本地填写新值。

## API 范围

管理员（全部要求管理员认证）：

- `GET /api/v1/admin/notion/connections`：只列出安全元数据。
- `GET /api/v1/admin/notion/sources`：列出已注册数据库及 data source 数量、同步状态。
- `POST /api/v1/admin/notion/sources/inspect`：接收 `{connection_id, url}`；只读检查与预览，不写库。
- `POST /api/v1/admin/notion/sources`：接收 `{connection_id, url}`；重新读取、显式导入/公开。
- `POST /api/v1/admin/notion/sources/{source_id}/sync`：手动全库同步。
- `POST /api/v1/admin/notion/sources/{source_id}/pages/inspect` 与 `/import`：在来源内检查/导入单篇页面链接。
- `GET /api/v1/admin/notion/status`：整体状态；不泄露密钥、页面正文或敏感异常。

公开 API：

- `GET /api/v1/documents?page=&page_size=&category=&q=&source_id=`：只返回 published 文档。
- `GET /api/v1/documents/{slug}`：只返回 published 文档详情。
- 普通文章列表、搜索、标签不合并 Notion 文档。
- `/api/v1/posts/{legacy_slug}` 若已迁移为 Notion 文档则返回兼容跳转。

## 非目标与约束

- 不遍历 workspace、不调用 Notion 搜索、不访问用户提供的任意网络 URL、不使用 Notion MCP、不写 Notion。
- 不新增浏览器端密钥输入或密钥管理表单；管理员只在本地文件中保存 token，API 调试通过认证后的 OpenAPI 页面。
- 不导入未登记的数据库；管理员确认导入前不公开内容。
- 不启用现存 Notion scheduler；本地 Compose 的 Notion 自动同步默认关闭。
- 不修改无关 v1.2 功能，不清理、暂存或提交既有未提交改动。

## 验收

- 多个 connection 配置能安全列出；重复 ID、缺失 token、非法 JSON 均安全失败；任何响应与日志均不含 token。
- 一个 connection 可检查/导入多个数据库；为每个来源选错 connection 时不越权，授权不足时不写数据。
- 数据库含多个 data sources 时逐个读取并正确区分来源；分页完整；任一来源级读取失败时不改变旧发布状态。
- 预览只读；导入显式确认；同步仅管理员手动触发；应用启动与空闲没有 Notion 请求。
- 单页失败隔离、归档下架、幂等更新和 source reassignment 均由测试固定。
- 公开文档 API 只返回已发布内容且与文章 API 隔离；全套后端测试、前端既有测试、迁移与 OpenAPI 校验通过。
- 未配置新密钥时只运行 MockTransport 测试；不声称真实 Notion 已连接。
