# HAPI Codex 控制台部署

HAPI 固定为 `0.36.4`。云端只保存 HAPI 投影、认证与消息同步记录；Mac 保留 Codex 原生状态、项目文件和 cc-switch 凭据。桌面 attach worker 必须连接已加载的原生会话。Runner 不会自动接管桌面聊天。

## 云端服务

目标机为 `root@39.96.212.169`，SSH 公网直连。HAPI 发布包下载使用服务器 Mihomo `http://127.0.0.1:7890`；SSH 命令本身不经过代理。Nginx 安装/重载和 Certbot 申请分别记录 DNS、端口、ACME 与证书结果。服务器博客构建代理约定见 [`../README.md`](../README.md)。

二进制 `/opt/hapi/0.36.4/hapi`，状态 `/var/lib/hapi`（`hapi:hapi`, 0700），配置 `/etc/hapi/hub.env`（root:root, 0600），监听 `127.0.0.1:3006`。服务配置见 `hapi-hub.service.template` 和 `hub.env.example`。Web 登录 token 由 HAPI 生成并存于状态目录的 `settings.json`；仅经安全本地方式配置到 Mac 的正式 HAPI home。

Nginx 子域 `codex.guoer9.me` 单独使用 HTTPS。日志格式只写 `$uri`，不使用含 query 的 `$request` 或 `$request_uri`。错误日志关闭，避免上游错误行回显带 token 的事件流 URL。HTTP 站点只保留 ACME challenge 并将其他请求重定向到 HTTPS。Hub 端口不开放公网。

当前云端 certbot.service 已有 HTTP(S)_PROXY=127.0.0.1:7890 的 systemd drop-in，且 deploy hook 会重载 Nginx；2026-11-17 子域续签演练通过。手动演练需显式使用相同代理：

```sh
HTTPS_PROXY=http://127.0.0.1:7890 HTTP_PROXY=http://127.0.0.1:7890 NO_PROXY=localhost,127.0.0.1,::1 certbot renew --cert-name codex.guoer9.me --dry-run
nginx -t && systemctl reload nginx
```

## Mac 节点

正式状态使用 `~/.hapi-blog`。Codex `CODEX_HOME` 按受限范围配置，模型请求沿 Mac 本地 cc-switch。不要把 cc-switch/API 凭据放到 Hub、博客前端或发布产物中。Runner 前台模板 `com.guoer.hapi-runner.plist.template` 采用 `runner start-sync`；它只服务自身管理的 CLI 会话。本机实际新建 CLI 遇到 `spawnSync /opt/homebrew/bin/codex ETIMEDOUT`，已停止 Runner 并保留 disabled plist，首版只启用桌面 attach worker；不要将模板存在视作 Runner 已可用。

桌面 worker 使用 `com.guoer.hapi-desktop-attach.plist.template`，须将 `__NATIVE_THREAD_ID__` 替换为经过核对的线程，将 socket 替换为当前 App 的 owner-only Unix endpoint。socket 变化、桌面 App/engine 重启或 macOS 登录后应重新检查并 attach。单一 worker 不可随意同时承载多个桌面线程；每个目标均需先通过 attach preflight 和 `attach --list`。本机已将该专用测试 thread 注册为 launchd；`KeepAlive=false`，App 不可用时需要显式检查并重连，不会自动恢复其他日常聊天。停止桌面 worker 用 `hapi detach <hapi-session-id>`，确保不会中断原生 App。

## 认证、恢复与安全

- 博客管理员登录与 HAPI 登录独立。控制台直接访问仍需 HAPI 认证。
- SSE 的认证可能位于查询字符串，因此 access log 不得记录查询参数。不要开启 Nginx debug/error 回显请求 URL，不记录 Authorization。
- Hub 重启不会停止 Mac 原生会话；浏览器收到的“结果未知”消息不要盲目重试。
- `backup.sh` 停止 Hub 后归档完整 `/var/lib/hapi`，使用 flock 防止并发，只保留最近七份每日压缩备份，并恢复此前运行的服务状态。备份由 `hapi-backup.service.template` / `.timer.template` 执行，归档权限为 root-only。
- 恢复前停止 Hub。解压单份备份至隔离目录，验证 SQLite integrity_check、settings.json 存在及文件权限，再切换数据目录；只用隔离端口和测试登录验证。确认可读后才替换生产数据目录并重启。恢复失败时保留现有目录，将隔离副本移走，不覆盖原数据。
- 轮换 Web token：先在计划维护时停止 Hub，保留完整状态备份；备份旧 settings 到 root-only 临时位置，更新 `cliApiToken`，按需重新执行 HAPI 初始化，再启动并验证旧 token 401、新 token 成功。既有 JWT / Passkey 会话的失效行为未验收，不能将此操作等同所有设备立即退出。将新凭据逐台配置到 Mac；所有副本就绪后再销毁受限临时凭据文件。
- 回退时先 detach 桌面 worker，再停止 Mac Runner 和云端 HAPI 服务。先备份而不是删除 `/var/lib/hapi`；移除独立 Nginx site 后 `nginx -t` 再 reload。博客入口由目标 Git 提交管理，回退前确认服务器实际发布分支；只更新 `main` 的脚本不会包含其他分支改动。

## 已知限制

本次对话与桌面真实请求可经 cc-switch；App 启动环境的兼容 WebSocket 设置需要空闲窗口配置。隔离 App 测试已通过，不代表原日常 App 自动启用。Stop 不保证终止已开始的 shell 子进程。桌面工具状态与最终结果可见，但本次观察中命令 stdout 在完成后一次性展示，聊天文本也未能验证逐 token 流式。Mac 睡眠或离线期间无法执行。


## 本机当前操作

- 打开已连接桌面测试会话：访问控制台，选择 `2026-11-17/hapi-desktop-a-6318`。云端旧隧道投影离线属预期，使用正式 HTTPS 投影。
- 登录 token 仅存于 `~/.hapi-blog/settings.json` 的 `cliApiToken`；复制时粘贴完整值，不将 token 发到聊天或放入链接。
- 检查 worker：`launchctl print gui/$(id -u)/com.guoer.hapi-desktop-attach`。
- 停止 worker：`launchctl bootout gui/$(id -u)/com.guoer.hapi-desktop-attach`。这只断开投影，云端历史保留。
- 桌面 App 与专用线程已加载时，可用 `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.guoer.hapi-desktop-attach.plist` 启动；注册仍在但进程已退出时先检查 socket，再 `launchctl kickstart gui/$(id -u)/com.guoer.hapi-desktop-attach`。
- 此次隔离 App 的 WebSocket 环境只对其生效；当前日常 App 正在工作，尚未切换，需在空闲窗口按相同已验证方式接入。
