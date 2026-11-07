# 文档入口

更新日期：2026-11-07

后续开发先读这几份文件：

1. [根 README](../README.md)：项目范围、启动命令和部署入口。
2. [开发上下文](development-context.md)：模块边界、数据不变量、当前接续点。
3. [上线准备清单](release-readiness.md)：上线前必须补证据或完成的门禁。
4. [本地开发与内容维护](../scripts/local/README.md)：独立本地环境、作品、文件库和 Notion 操作。
5. [生产部署](../deploy/README.md)：服务器初始化、更新、备份和反向代理。

## 当前产品边界

| 功能 | 主要入口 | 代码位置 |
| --- | --- | --- |
| 公共博客、搜索、标签、评论 | `/writing`、`/search`、`/post/:slug`、`/documents/:slug` | `frontend/src/views/blog/`、`backend/app/api/v1/` |
| 作品发布与播放 | `/works`、`/works/:slug`、`/admin/works` | `frontend/src/views/blog/`、`frontend/src/views/admin/WorkEdit.vue`、`backend/app/services/works.py` |
| 私有文件库 | `/admin/library` | `frontend/src/views/admin/Library.vue`、`backend/app/services/library.py` |
| 登录用户临时传输 | `/transfer` | `frontend/src/views/blog/Transfer.vue`、`backend/app/api/v1/transfers.py`、`backend/app/services/transfers.py` |
| Notion 资料库 | `/admin/notion`、`/documents` | `frontend/src/views/admin/NotionSync.vue`、`frontend/src/views/blog/Documents.vue`、`backend/app/services/notion/` |
| 沉浸式视觉与球体交互 | 首页及公共布局 | `frontend/src/components/immersive/`、`frontend/src/graphics/` |

## 文档状态

- 当前开发规范只放在根 README、本文、`development-context.md`、`release-readiness.md`、`scripts/local/` 和 `deploy/` 中。
- `docs/research/31-36` 保留最近一轮功能设计和本地验收证据；它们记录的是当时的事实，不能替代当前命令的重新执行。
- 已完成的逐轮研究、v1.2 计划、旧设计稿和旧验收记录已移到 [`archive/`](archive/README.md)。保留它们是为了追溯决策，不把它们当成当前待办。
- `docs/implementation/` 保留仍能解释当前动效架构的实现记录。

## 接续工作流

每次开始工作时先执行：

```bash
git status --short --branch
git log -5 --oneline
```

然后按改动范围读取对应模块和测试。新功能或跨模块修复需要在 `docs/superpowers/` 下写计划；计划完成后只保留实现结论、验证命令和未决风险，历史计划放入 `docs/archive/superpowers/`。提交前至少运行与改动相关的测试、`npm --prefix frontend run build`（前端变更）或 `backend/venv/bin/python -m pytest -q`（后端变更），并执行 `git diff --check`。

不要把本地数据库、密钥、浏览器截图、`ddw/` 研究资料或其他未相关的工作区改动混入功能提交。
