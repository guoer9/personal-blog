# 统一文章管理与 Notion 评论联动验收

日期：2026-11-03（Asia/Shanghai）。本地项目：`/Volumes/2tb/mydata/code/vllm/personal-blog`。

## 实现结果

后台文章管理通过 `/api/v1/admin/articles` 统一返回手动文章与 Notion 文章，包含作者、标签、真实评论数、阅读量、公开地址、Notion 原文地址和下架操作。旧版 Notion 文章与新版资料库指向同一页面时，管理列表只展示一次。Notion 同步保留文章身份、作者、评论、阅读量，以及管理员手动下架状态。

`posts` 和 `notion_documents` 保留各自正文模型，`comments` 共用一张表。每条评论只能关联 `post_id` 或 `notion_document_id` 中的一个；回复必须属于同一来源的同一篇文章。删除父评论会级联删除回复，下架后公开评论接口返回 404，管理员仍可查看和删除。

公开资料库卡片和详情显示作者、分类、阅读量、评论数及相关链接。详情支持真实评论和回复；任意层级回复可在后台管理。当前两篇真实 Notion 页面没有源分类，显示“暂无标签”。原生 Notion 正文渲染保持沿用。

阅读量原子递增，阅读不改变文章更新时间或排序。旧版文章转为资料库时保留评论 ID、回复关系、作者、阅读量、旧链接和已有标签，重复同步不会再次累计旧阅读量。

## 数据库与运行环境

新增迁移 `comment_targets_v7`，已应用到本地 PostgreSQL，迁移前版本为 `notion_admin_fields_v6`。迁移转换旧评论关联并回填作者、阅读量；降级遇到不能转回旧文章的 Notion 评论会拒绝，避免丢失数据。

真实 PostgreSQL 验收发现旧 `posts`、`comments` 的无时区时间列不能接受带时区默认值，现已将这些模型的默认时间与原列保持一致，使用无时区 UTC 时间；真实创建文章与评论返回 201。

本次 API 使用本机源码进程运行于 `http://127.0.0.1:8001`，前端为 `http://127.0.0.1:5173`，数据库为本地 Docker PostgreSQL `127.0.0.1:5544`。未删除或重置数据卷，未部署到公网。

## 自动与浏览器验收

| 检查 | 结果 |
| --- | --- |
| 后端全量 `backend/venv/bin/python -m pytest -q` | 246 passed，41 skipped；不将跳过项计为通过 |
| 前端全量 `npm --prefix frontend test` | 30 个文件，230 tests passed |
| TypeScript + Vite 构建 | 通过；存在大型 chunk 提示 |
| 构建体积预算 | 通过，入口 JS gzip 61,854 B，CSS gzip 2,253 B |
| `git diff --check` | 通过 |
| 本地真实管理员登录 | 通过 |
| 两种来源统一管理、元信息与链接 | 通过 |
| 浏览器新增 Notion 评论和回复 | 返回 201，评论数真实增加 |
| 后台查看两种来源及嵌套回复 | 通过 |
| 真实 Notion 来源重新同步 | queried=1，published=1，updated=1，failed=0 |
| 同步后的身份、作者、评论、阅读量 | 保留 |
| 阅读量与更新时间 | 阅读量增加，更新时间不变 |
| 桌面 1440×1000 与手机 390×844 | 元信息和评论区正常，无横向溢出 |
| 删除父评论 | 回复同步删除，真实评论数恢复 |
| 统一管理下架临时普通文章 | 公开详情返回 404 |
| 真实 Notion 页面四张图片 | 全部 HTTP 200，Chrome 解码成功，尺寸均大于零 |
| 浏览器运行时错误 | 0 pageerror |

本次浏览器脚本 `scripts/local/verify-article-management.mjs` 对现有真实 Notion 文章添加临时评论，并创建临时普通文章验证管理和下架。结束后已清理本次创建的文章、评论和回复，真实阅读量保留正常增长。同步只读取 Notion 源页面，不修改远端正文。

证据位于 Git 忽略目录 `output/playwright/article-management/`：`report.json`、`media-report.json`，以及统一文章表、评论管理、桌面和手机详情截图。浏览器验收期间曾遇到本机快照图片缺失，真实重新同步后四张图片已恢复，并完成 HTTP 状态及解码复验。

复跑（依赖已运行的本地服务、已导入文章及 `.env.local-workspace` 中现有管理员配置）：

```bash
ARTICLE_ACCEPTANCE_SYNC=1 node scripts/local/verify-article-management.mjs
```

不设置 `ARTICLE_ACCEPTANCE_SYNC=1` 时，脚本不重新访问远端 Notion。此轮真实浏览器下架步骤使用临时普通文章；Notion 下架行为由后端回归覆盖，未为验收下架现有真实文章。

使用方式和接口见 [`scripts/local/NOTION.md`](../../scripts/local/NOTION.md)。
