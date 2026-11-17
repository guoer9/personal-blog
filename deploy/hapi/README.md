# HAPI Codex 控制台部署

HAPI 固定为 `0.36.4`。Hub 保存 HAPI 投影、认证与消息同步记录；各执行节点保留自身的 Codex 原生状态、项目文件和模型配置。当前已接入 Mac 与云服务器两个 Runner。桌面 attach worker 必须连接已加载的原生会话。Runner 不会自动接管桌面聊天。

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

正式状态使用 `~/.hapi-blog`，Runner 使用原 `CODEX_HOME=~/.codex`，模型请求沿 Mac 本地 cc-switch。不要把 API 凭据放到 Hub、博客前端或发布产物中。Runner 前台模板 `com.guoer.hapi-runner.plist.template` 采用 `runner start-sync`；它服务自身管理的 CLI 会话，与桌面 attach 并存。

2026-11-17 已恢复 `com.guoer.hapi-runner`，显式使用当前 App 自带 CLI `0.169.0-alpha.11.1`，将其目录置于 Runner 专用 PATH 最前，并设置 `HAPI_CODEX_APP_SERVER_BIN`。两处必须一致；只设置后者不会改变 shared runtime 的 PATH 选择。旧 Homebrew CLI `0.163.0` 曾报同步版本探针超时；本轮独立版本探针正常，未复现旧超时，不能将历史原因断言为已定位。恢复后机器在线、API 新建约六秒成功、真实模型回复和上下文续聊均通过。

Mac Runner 的允许目录为 `/Users/guoer/.hapi-blog/workspace` 及当前博客 worktree `/Volumes/2tb/mydata/code/codex_worktree/hapi-codex-blog/personal-blog`。这限制网页浏览和创建目录；不等同 Codex 工具权限沙箱。创建时按所需范围选择权限，本轮验收使用 `Default`。

桌面 worker 使用 `com.guoer.hapi-desktop-attach.plist.template`，须将 `__NATIVE_THREAD_ID__` 替换为经过核对的线程，将 socket 替换为当前 App 的 owner-only Unix endpoint。socket 变化、桌面 App/engine 重启或 macOS 登录后应重新检查并 attach。单一 worker 不可随意同时承载多个桌面线程；每个目标均需先通过 attach preflight 和 `attach --list`。本机目前使用日常当前聊天的 `com.guoer.hapi-current-desktop-attach`，旧隔离测试 worker 已停止。`KeepAlive=false`，App 不可用时需要显式检查并重连，不会自动恢复其他日常聊天。停止桌面 worker 用 `hapi detach <hapi-session-id>`，确保不会中断原生 App。

## 多机器与云端执行

| 网页机器名 | 执行位置 / 配置 | 可创建目录 |
| --- | --- | --- |
| MacBook Air | 本机 bundled CLI；原 `~/.codex`，经本机 cc-switch | `~/.hapi-blog/workspace`、当前博客 worktree |
| 阿里云服务器 | 云端 CLI `0.167.0`；`/root/.hapi-runner/codex-home`，独立直连中转 | `/root/hapi-workspace`、`/srv/personal-blog` |

两台 Runner 使用同一 Hub 与认证 namespace，各自保留不同 machine ID。云端机器 ID 为 `f8cd1183-7498-4378-866c-d01bb5b05dca`。云端 Runner 的 systemd 模板为 `hapi-runner.service.template`，当前 `/etc/systemd/system/hapi-runner.service` 已 enabled/active。以 root 运行是为了使用当前 root 安装的 Codex 和既有服务器工作区；不开放额外公网端口。

用户授权将 cc-switch **当前选中的 Codex provider** 通过 SSH 导入云端。当前为 aiwanwu，中转 `https://www.aiwanwu.cc/v1`、默认 `gpt-6-astra`、`xhigh`；配置摘要与源配置一致。凭据由云端原生 `codex login --with-api-key` 写入独立 home，目录 0700、配置及 auth 0600。原 `/root/.codex` 未覆盖，Mac 的 ChatGPT 登录和 MCP 配置未复制。云端通过服务器自身回环 Mihomo 访问外网，不使用 Mac 的 `127.0.0.1:15721`。

导入是当前配置的快照；此后本机 cc-switch 切换 provider、轮换 key 或修改模型，不会自动更新云端。当前仅导入所选 provider，未迁移其他供应商、全量 MCP、插件或历史。受限本机脚本 `~/.hapi-blog/runner-repair/import-cloud.py` 可再次执行导入；须先检查是否已有需保留的云端配置。运行中会话不承诺配置热加载。当前 Hub 日备份只覆盖 `/var/lib/hapi`；云端 Runner 的原生历史和凭据位于另一目录，恢复 Hub 不等于恢复它们。

网页使用：刷新 `https://codex.guoer9.me` → 新建会话 → 选择机器 → 选择该机器的有效目录 → Codex → 创建。需要 Mac 离线时继续执行，应新建在“阿里云服务器”上的聊天；已有 Mac 聊天不会自动迁移过去。

## 操作同步边界

| 操作 | 当前行为 |
| --- | --- |
| 同一聊天的消息和上下文 | 已连接同一 native thread 的网页与 owner 共享；新建机器不会复制另一台的上下文 |
| 选择机器 / 新建聊天 | 两台 Runner 已通过创建和真实回复；新聊天属于所选机器的独立执行引擎 |
| 模型与推理设置 | 会话级设置可写回执行引擎；云端切换模型后续聊通过，不等同全局 provider 同步 |
| 网页重命名、置顶、排序 | HAPI 视图元数据；不能保证同步到官方 App 对应管理状态 |
| 结束 / 归档 Runner 会话 | 结束该执行并归档原生线程；不永久清除原生历史 |
| 结束桌面 attached 视图 | 只断开 worker，不归档原生聊天或停止桌面引擎；原生归档则能结束桥接 |
| 网页删除 | 删除 Hub 记录；临时聊天实测 Hub 404、原生 DB 行和 rollout 文件仍在 |
| 项目文件、MCP、插件、全局中转配置 | 按机器独立；没有自动跨机器同步 |

如需全部客户端统一操作，下一阶段应保持每条 native thread 的单一 owner，通过节点代理将支持的操作转发给该 owner，并回传确认事件；不得 rsync 活跃 SQLite 或让两个引擎同时恢复同一线程。重命名、归档、恢复与永久删除需定义各自的原生语义、离线策略和失败提示，并在临时聊天中分别验收。当前 HAPI 的 attached 桥接和删除语义未覆盖这些要求；此项尚未实现。跨机器上下文迁移与项目文件同步是另外的流程。

## 认证、恢复与安全

- 博客管理员登录与 HAPI 登录独立。控制台直接访问仍需 HAPI 认证。
- SSE 的认证可能位于查询字符串，因此 access log 不得记录查询参数。不要开启 Nginx debug/error 回显请求 URL，不记录 Authorization。
- Hub 重启不会停止 Mac 原生会话；浏览器收到的“结果未知”消息不要盲目重试。
- `backup.sh` 停止 Hub 后归档完整 `/var/lib/hapi`，使用 flock 防止并发，只保留最近七份每日压缩备份，并恢复此前运行的服务状态。备份由 `hapi-backup.service.template` / `.timer.template` 执行，归档权限为 root-only。
- 恢复前停止 Hub。解压单份备份至隔离目录，验证 SQLite integrity_check、settings.json 存在及文件权限，再切换数据目录；只用隔离端口和测试登录验证。确认可读后才替换生产数据目录并重启。恢复失败时保留现有目录，将隔离副本移走，不覆盖原数据。
- 轮换 Web token：先在计划维护时停止 Hub，保留完整状态备份；备份旧 settings 到 root-only 临时位置，更新 `cliApiToken`，按需重新执行 HAPI 初始化，再启动并验证旧 token 401、新 token 成功。既有 JWT / Passkey 会话的失效行为未验收，不能将此操作等同所有设备立即退出。将新凭据逐台配置到 Mac；所有副本就绪后再销毁受限临时凭据文件。
- 回退时先 detach 桌面 worker，再停止 Mac Runner 和云端 HAPI 服务。先备份而不是删除 `/var/lib/hapi`；移除独立 Nginx site 后 `nginx -t` 再 reload。博客入口由目标 Git 提交管理，回退前确认服务器实际发布分支；只更新 `main` 的脚本不会包含其他分支改动。

## 已知限制

本次对话与桌面真实请求可经 cc-switch；原日常 App 的当前聊天此前通过共享 WebSocket 接入并完成双向验收。22:45 最终检查发现旧视图已冻结，当前 App 普通重开后使用 stdio，恢复步骤见下方。其他聊天仍需逐条显式 attach。Stop 不保证终止已开始的 shell 子进程。桌面工具状态与最终结果可见，但本次观察中命令 stdout 在完成后一次性展示，聊天文本也未能验证逐 token 流式。Mac 睡眠或离线期间无法在该节点执行，云端独立聊天仍可执行。


## 本机当前操作

- 日常会话旧视图为 `5f1c09e0-73cd-453f-8c18-3cbe183968e0`，标题“查找适合博客集成的开源 Codex 对话框架”。22:45 状态为 inactive / history-changed，历史保留；不能向它继续发送。Mac 与云端 Runner 新建聊天不受影响。
- 登录 token 仅存于 `~/.hapi-blog/settings.json` 的 `cliApiToken`；复制时粘贴完整值，不将 token 发到聊天或放入链接。
- 检查 worker：`launchctl print gui/$(id -u)/com.guoer.hapi-current-desktop-attach`。
- 停止 worker：`launchctl bootout gui/$(id -u)/com.guoer.hapi-current-desktop-attach`。这只断开投影，云端历史保留。
- App 经专用启动器打开、目标聊天已由共享引擎加载时，可用 `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.guoer.hapi-current-desktop-attach.plist` 启动；注册仍在但进程已退出时先检查 socket，再 `launchctl kickstart gui/$(id -u)/com.guoer.hapi-current-desktop-attach`。stdio 实例不能通过 kickstart 热接入。
- 旧 `com.guoer.hapi-desktop-attach` plist 仅用于隔离实例，当前已停止，避免误启旧测试投影。

### 日常窗口接入（2026-11-17，已验证）

目标为当前聊天 `01a1e875-cc7e-7070-997f-612b0415cbbc`，使用原 `~/.codex` 和 `~/Library/Application Support/Codex`，不复制或替换账号、MCP、模型或 cc-switch 配置。原 App 的 stdio 连接不能热 attach，已由用户手动退出并通过专用启动流程重开。

本机受限目录 `~/.hapi-blog/current-desktop` 已准备 `connect.py`、状态文件、日志及 `打开当前Codex并同步.command`。一次性服务 `com.guoer.hapi-current-desktop-handoff` 等待原 App / 引擎退出，最长一小时；退出前不会更新 daemon 或打开 App。首次切换固定为当前 App 自带 CLI 版本，已准备好的 daemon 则直接复用，并以明确的 Unix WebSocket endpoint 重开原 profile。入口只设置单进程环境，不修改全局 launchctl 环境；不修改 App 安装包。

线程 worker 为 `com.guoer.hapi-current-desktop-attach`，仅在原桌面加载目标聊天后 attach；最长等待二十分钟，不使用 cold resume 或 Runner 代替。新连接打印真实 HAPI ID 后才停止旧隔离 worker，旧历史保留。两个服务都采用 `KeepAlive=false`，不承诺退出后永久自动恢复。重新登录时，一次性切换服务若已执行或超过期限，不会再次打开 App。

- 检查 `python3 ~/.hapi-blog/current-desktop/connect.py --status`，当前 phase 为 `attached`；Hub 同时报告 active，native ID 与当前聊天一致。`waiting_for_loaded_chat` 不表示接入完成。
- 日后通过本机 `打开当前Codex并同步.command` 打开，可保留本次明确的 WebSocket 启动环境；直接点原 App 图标并不保证沿用该环境。启动器要求日常窗口已退出，避免同 profile 双实例。
- 撤销等待：`launchctl bootout gui/$(id -u)/com.guoer.hapi-current-desktop-handoff`。只停止当前投影：`launchctl bootout gui/$(id -u)/com.guoer.hapi-current-desktop-attach`；不会停止原生引擎。
- 若 worker 已退出，先确认日常 App 经专用启动器打开且目标聊天已加载，再执行 `launchctl kickstart gui/$(id -u)/com.guoer.hapi-current-desktop-attach`。首次接入曾因 metadata flush 失败退出，显式重连后复用同一投影并成功；未修改 HAPI 上游二进制，不承诺自动重试所有故障。
- 日常实例实测：auth.json 摘要与切换前一致；引擎报告原 CODEX_HOME、ChatGPT 认证及原 MCP 配置。桌面标识 D 经 Hub 历史读取，网页测试消息通过显式 Steer 送入当前活跃 turn，原聊天正确复述 D 并记住网页 E。普通发送可先进入原生队列，当前 turn 未结束时不要因此重复发送。
- 当前聊天的 native response ID 与本机 cc-switch 请求记录精确匹配，gpt-6.1-sol / HTTP 200 / streaming；全局配置仍为 custom / gpt-6-astra / 本机 15721。全局配置与单会话模型是两个层级，本轮未切换 provider。

### 普通重开后的恢复（22:45 检查结果）

旧 worker 在网络恢复后的历史核对中关闭，Hub 为 `history-changed`；该状态的具体历史差异尚未定位，不将其归因于某次用户操作。当前 App PID 31642 的启动日志于 22:42:22 明确记录 `hostId=local transport=stdio`，其 engine 无共享 listen endpoint；原 daemon 仍运行，但 `hapi attach --list` 无目标。不能为了重新接入而让另一引擎 cold-resume 当前活跃聊天。

恢复入口已准备：待当前工作结束，手动退出 App，然后双击 `~/.hapi-blog/current-desktop/打开当前Codex并同步.command`，再打开此聊天。启动器会使用已核验的现有 daemon 和明确 WebSocket 环境；worker 仅等待原 owner 加载聊天。`state.json` 已设置 `new_view_requested=true`，下一次成功 attach 使用 `--new-view` 建立新投影并保存新 HAPI ID；旧投影和 checkpoint 保留，不合并历史。未自动关闭 App 或重启引擎。该次恢复尚需用户操作及后续验收，不能称为已恢复在线。

## 本轮博客发布与快速回退

入口产品提交为 `4104a05`，已推送 main 并在 `/srv/personal-blog` 构建发布。仅重建 web，未执行数据库迁移。前端上一版保留为 `personal-blog-web:hapi-before-20261117`。紧急回退入口时，可将该标签重新标记为 `personal-blog-web:latest`，在生产目录使用现有 `.env.production` 与 Compose 文件执行 `up -d --no-deps web`，然后验证 health 与页面。Git 源码也需通过正常 revert / review 与部署镜像重新对齐，避免下一次更新又发布被回退的变更。独立 HAPI Hub 与状态数据不随前端入口回退删除。

增量提交 `dc63613` 已发布多机器入口说明，运行镜像 `sha256:cc1be3827513d67c3c1443317350ea905c8dbc65e37a3ffe4f321a4aaf7b2bbb`，前端 healthy。部署前镜像另保留为 `personal-blog-web:hapi-before-multimachine-20261117`。线上 `Codex-CBeGtsyI.js` 包含两台机器说明，HTTP 200；该轮仍只重建前端。
