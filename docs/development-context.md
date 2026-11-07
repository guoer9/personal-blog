# 开发上下文

更新日期：2026-11-07

这是后续持续开发的短版上下文。历史研究中的测试数字、分支名和本地地址以当时记录为准；要判断当前状态，重新运行仓库命令。

## 系统结构

```text
Vue 3 / Vite
  ├── 公共页面、后台页面、路由和认证状态
  ├── DOM 动效与 Three.js 场景
  └── API 请求封装
          │
          ▼
FastAPI / SQLAlchemy async / Alembic
  ├── public posts + Notion documents
  ├── works + published assets
  ├── private library
  ├── authenticated temporary transfers
  └── auth, comments, tags
          │
          ▼
PostgreSQL + four application storage volumes
```

本地开发使用独立的 `blog-local` Docker 环境，API 默认 `127.0.0.1:8001`，数据库默认 `127.0.0.1:5544`。生产环境使用 `deploy/compose.production.yml`，数据库、API 和前端容器由 Compose 管理，宿主机 Nginx 负责域名入口。

## 必须保持的不变量

- 公共 API 只返回已发布、未隔离、未人工下架的内容；草稿和私有文件只能通过管理员接口访问。
- 手写文章和 Notion 文章共享公开索引，但保留各自的正文来源、详情路由和身份映射。
- 作品草稿、公开快照、私有原件和公开发布副本分开保存；保存草稿不会覆盖线上公开版本。
- 临时传输只允许已登录用户创建上传、续传、完成、取消和输入取件码；完成文件通过短效票据下载，取件码不进入日志。
- Notion 读取只由管理员显式触发；凭据写入忽略目录，不进入数据库、接口响应、URL 或日志。
- 页面内容必须由 DOM 提供，WebGL 只能提供视觉层。WebGL 失败、减少动态效果、暂停、离屏和低质量设备都要保留可读页面和可用操作。
- 数据库迁移必须有唯一 head；生产更新前备份数据库和四类应用数据，不能把本地通过当成恢复通过。

## 代码定位

- 路由与页面：`frontend/src/router/`、`frontend/src/views/`、`frontend/src/layouts/`
- 视觉运行时：`frontend/src/components/immersive/`、`frontend/src/graphics/runtime/`、`frontend/src/graphics/scenes/`
- API 路由：`backend/app/api/v1/`
- 业务服务：`backend/app/services/`
- 数据模型和迁移：`backend/app/models/`、`backend/alembic/versions/`
- 本地流程：`scripts/local/`
- 生产流程：`deploy/`

## 当前接续点

1. 完成登录用户临时传输的端到端验收：未登录创建、续传、取件和下载全部拒绝；登录后发送、取件码查找、下载、Range 和过期清理全部通过。
2. 在独立 PostgreSQL 测试库补跑当前测试套件中被跳过的数据库相关用例，并验证从现有迁移版本升级后既有文章、评论、作品和文件元数据不丢失。
3. 做一次真实备份恢复演练，覆盖数据库、私有文件库、公开媒体、作品发布副本和临时传输目录，记录恢复顺序与校验结果。
4. 上线前补齐 HTTPS、生产域名、健康检查、错误监控和回滚证据；详细清单见 [上线准备清单](release-readiness.md)。
5. 对首页球体和公共页面完成真实 iOS Safari、Android Chrome 与慢网测试。Chromium 触屏模拟不能替代实体设备。
6. 公开资料量增加后，将文档列表和统一文章索引的筛选、分页和排序尽量下推到数据库，避免读取全部 published 行到 Python 内存。

## 记录新工作的规则

新工作只在以下情况增加文档：

- 跨模块功能：先写一份短计划，列出文件、接口和验证命令。
- 发现线上风险：在 `docs/release-readiness.md` 增加状态、证据和责任动作。
- 完成重要验收：在 `docs/research/` 增加一份结果记录，写清日期、环境、命令、限制和未决项。

不要复制旧研究的完整背景。新记录只链接到旧证据，并写当前结论和下一步。
