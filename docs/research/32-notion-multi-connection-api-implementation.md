# Notion 多连接资料库 API 实现记录

日期：2026-11-02

这次实现把 Notion 从单一日记同步入口扩展为可显式管理的多 connection、多 database 和多 data source 资料库。Notion 仍然是只读来源，公开资料进入独立的 `notion_documents` 表，不混入普通博客文章。

## 已落地的行为

- 本地凭据位于根目录 `.secrets/notion-connections.json`，由 `NOTION_CONNECTIONS_FILE` 指向；文件初始化为 `0600`，Compose 只读挂载到 `/run/secrets/notion-connections.json`。
- connection 列表只返回 `id`、`label`、`configured`。token 使用 `SecretStr` 保存于进程内，不进入数据库、API 响应、异常消息或日志。
- 每个数据库必须由管理员选择 connection，并通过链接检查。检查接口只读；导入接口会重新验证 connection 和数据库链接后再注册来源。
- 数据库的所有 `data_sources` 都会被读取并分页查询。页面保存来源的 `data_source_id`，来源结构或分页查询失败时保留上次成功的公开快照；单页读取或转换失败则隔离该页，其他页面继续导入。
- 应用 lifespan 不再启动 Notion scheduler，只保留临时传输清理任务。新资料库同步只通过管理员手动接口触发。
- 公开 API 只返回 `published` 文档；普通博客文章仍走原有 `/api/v1/posts`，旧 Notion slug 会 307 跳转到 `/api/v1/documents/{slug}`。
- `/api/v1/admin/notion/status` 返回多连接资料库状态。早期单库客户端通过 `/api/v1/admin/notion/legacy/status` 和 `/api/v1/admin/notion/sync` 保持兼容；前端旧页面的状态请求已相应调整。
- 已修复同批重名页面的 slug 冲突（包括长标题截断边界），并补上通用单页预览的 connection 绑定校验。

## 管理与公开接口

当前 OpenAPI 路由检查输出为：

```text
/api/v1/admin/notion/connections              GET
/api/v1/admin/notion/sources                  GET,POST
/api/v1/admin/notion/sources/inspect          POST
/api/v1/admin/notion/sources/{source_id}/sync POST
/api/v1/admin/notion/sources/{source_id}/pages/inspect POST
/api/v1/admin/notion/sources/{source_id}/pages/import POST
/api/v1/admin/notion/status                   GET
/api/v1/admin/notion/legacy/status            GET (deprecated)
/api/v1/admin/notion/sync                     POST
/api/v1/documents                             GET
/api/v1/documents/{slug}                      GET
```

所有管理员路由都需要管理员 bearer token。`sources/inspect` 不提交数据库写入；`sources`、`sync` 和单页 `import` 在服务成功后显式提交，保存失败会回滚并返回安全错误。

## 验证证据

在仓库根目录执行：

```text
backend/venv/bin/python -m pytest -q
```

独立审阅修复后结果：`183 passed, 41 skipped`。跳过项均要求独立 PostgreSQL 测试库（`LIBRARY_TEST_POSTGRES_URL`）；本轮未连接该测试库。另有一个既有的 Argon2 deprecation warning。审阅前按实现线分组执行的结果为：

```text
backend/venv/bin/pytest backend/tests/test_notion_library.py backend/tests/test_notion_sync.py -q
```

结果：`48 passed, 1 skipped`。

```text
backend/venv/bin/pytest backend/tests/test_notion_library_api.py backend/tests/test_notion_sync.py -q
```

结果：`30 passed, 1 skipped`，包含一个既有的 Argon2 deprecation warning。

```text
backend/venv/bin/pytest backend/tests/test_documents_api.py backend/tests/test_posts.py -q
```

结果：`6 passed`，包含一个既有的 Argon2 deprecation warning。

其余检查结果：

- `backend/venv/bin/python -m compileall -q backend/app backend/tests`：通过。
- 在 `backend/` 目录执行 `venv/bin/python -m alembic heads`：只有 `notion_multi_conn_v3 (head)`。
- 在 `backend/` 目录执行 `venv/bin/python -m alembic history`：确认 `notion_multi_conn_v3 -> notion_library_v2 -> notion_v1_sync -> works_v1_publication -> library_v1_private_storage` 单链路。
- `git diff --check`：通过。
- `.secrets/notion-connections.json` 和 `.env.local-workspace`：均被 `.gitignore` 忽略。
- token 形式扫描：测试文件和示例文件之外没有发现 token-like 值。
- 未执行真实 Notion 请求；服务测试使用 `httpx.MockTransport`。
- 独立审阅者复查确认先前三个 P1/P2 代码问题均已解决，补跑资料库服务和 API 测试为 `27 passed`；文档中的 Alembic 工作目录也已更正。

## 前端验证与当前边界

初次验证时当前 shell 的 `PATH` 中没有 `node`、`npm` 或 `npx`；进一步定位到已安装的 nvm Node.js `v22.20.0` 后，通过命令级 `PATH` 执行验证，无需安装或修改全局环境：

```bash
PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$PATH" npm --prefix frontend test
PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$PATH" npm --prefix frontend run build
PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$PATH" npm --prefix frontend run check:bundle
```

前端测试为 `24` 个文件、`139` 项通过；`vue-tsc -b && vite build` 通过，包体积门禁通过。主入口 JS 为 `158,221 B`，gzip level 9 为 `61,663 B`；全局 CSS 为 `6,226 B`，gzip 为 `2,253 B`。构建仍提示部分延迟加载资源超过 `500 kB`（包括场景和文章编辑器），这不是新的运行时错误，后续性能检查应区分公共入口和后台资源。

前端仍有旧的单库 `NotionSync.vue` 页面，尚未接入 connection/source 管理或公开资料库页面。本轮没有执行真实 Notion 导入、浏览器端资料库验收或 PostgreSQL 迁移实库验证；旧文章兼容目前验证的是 API 层 307，浏览器阅读页迁移还需要随资料库前端一起验收。

## 下一步假设

下一步优先新增管理员多连接来源页面和公开资料库列表/详情页面，沿用现有请求封装与路由测试模式；随后在独立 PostgreSQL 测试库上补跑跳过项和迁移验证。真实 Notion 导入仍需在本地轮换 token、填写忽略文件后显式执行 Swagger/API 操作。
