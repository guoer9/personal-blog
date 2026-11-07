# 上线准备清单

更新时间：2026-11-07

状态含义：`BLOCKED` 表示上线前不能跳过；`OPEN` 表示必须补证据或明确接受风险；`PASS` 只在当前环境重新执行命令后使用。

## 当前门禁

| 门禁 | 状态 | 证据或动作 |
| --- | --- | --- |
| 生产域名 HTTPS、HTTP 跳转和证书自动续期 | BLOCKED | 当前仓库模板仍是 HTTP 入口；完成 DNS、证书、80/443 反代和外部 HTTPS 检查。 |
| 生产迁移与回滚 | BLOCKED | 在生产数据副本执行 `alembic upgrade head`；保留升级前备份和失败回滚步骤。 |
| 数据库与应用文件恢复 | BLOCKED | 运行 `deploy/backup-server.sh` 后在隔离目录恢复数据库、私有文件库、公开媒体、发布副本和传输目录，校验记录与文件哈希。 |
| PostgreSQL 专项测试 | BLOCKED | 用独立测试库补跑当前被跳过的用例；SQLite 通过不能替代 PostgreSQL 证据。 |
| 登录用户临时传输 | BLOCKED | 未登录请求 `GET /config`、`POST /uploads`、`POST /lookup` 和下载必须拒绝；登录用户完成发送、取件码查找、Range 下载、刷新续传、过期和清理。 |
| 生产配置与密钥 | BLOCKED | `SECRET_KEY`、数据库密码、管理员密码和 Notion 凭据只在服务器配置；确认权限为 `0600`，不出现在日志、镜像和浏览器。 |
| 健康检查 | OPEN | 当前 `/health` 主要是进程存活检查；上线前增加或单独验证数据库连接、迁移版本和关键存储目录可写性。 |
| 错误监控与告警 | OPEN | Sentry 代码是可选的；必须选定 production 项目，发送一次可识别测试事件并确认告警链路，再移除测试触发器。 |
| 真实设备与网络 | OPEN | 至少验收 iOS Safari、Android Chrome、桌面 Safari/Firefox、慢网和断网恢复；浏览器触屏模拟不算实体设备通过。 |
| 反向代理安全策略 | OPEN | 外部验证安全响应头、上传超时、请求体上限、Range 行为、缓存策略、CORS 和公网不暴露数据库/API 管理端口。 |

## 发布前命令

在当前干净提交上执行，命令输出和环境版本写入发布记录：

```bash
git status --short --branch
git diff --check
PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$PATH" npm --prefix frontend test
PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$PATH" npm --prefix frontend run build
PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$PATH" npm --prefix frontend run check:bundle
backend/venv/bin/python -m compileall -q backend/app
backend/venv/bin/python -m pytest -q
./scripts/check-repository-baseline.sh
```

前端变更还要启动固定生产预览，运行对应的 `scripts/local/verify-*.mjs`；部署变更要运行 `docker compose config --quiet`，再在目标服务器执行迁移、健康检查和回滚演练。不要把历史文档里记录的测试数量直接复制到新的发布结论。

## 建议发布顺序

1. 冻结提交，确认 `git status` 只有预期的发布文件。
2. 备份生产数据库和四类应用数据，保存备份路径、大小、权限和校验值。
3. 在隔离副本执行迁移和恢复，确认应用能读取文章、评论、作品媒体和 Notion 公开快照。
4. 先部署 API 与数据库迁移，再部署前端；通过容器健康检查和 `/health`。
5. 从公网做匿名公共页面、登录、管理员、传输、文章评论和下载验收。
6. 观察错误监控、磁盘空间、数据库连接、上传失败率和传输清理任务，再决定是否扩大访问范围。

## 不能由本地验收推出的结论

- 本地 Docker 的容量和速度不能证明云服务器的容量、带宽或并发能力。
- SQLite 测试不能证明 PostgreSQL 迁移、锁、索引和时区行为。
- 本地 Chrome 不能证明 iPhone Safari、Android 文件选择器或真实触摸手势。
- 前端构建成功不能证明 HTTPS、域名反代、证书续期、备份恢复和告警有效。
