# HAPI / Codex 实测记录

日期：2026-11-17（Asia/Shanghai）。当前阶段：云端 HTTPS 与手机跨网测试通过；博客入口已发布并通过线上检查。

## 环境与安装

- 博客基线：分支 `codex/home-portrait-navigation`，HEAD `41b45c5`；保留现有计划文件。
- Mac `arm64`；Codex CLI `0.163.0`；ChatGPT App `26.1111.21308` / build `27194`，其实际内置引擎 `0.169.0-alpha.11.1`；CC Switch `4.0.18`。
- HAPI `0.36.4`，官方 darwin-arm64 发布包 SHA-256：`8390c6c11ef4592007cdb38e154e7ea10fd7845521c3d7bbd8203695773bd588`，与 GitHub release API digest 一致。
- npm 版本核对 `0.36.4`，gitHead `825af9ba1de93b75aed9143d9ca9200ac8b46032`。
- 独立安装：`/Users/guoer/.local/share/hapi/runtime/0.36.4/hapi`；实际 `--version`、`attach --help` 已通过。
- 测试目录：`/Users/guoer/.hapi-poc`；原生测试状态：`/Users/guoer/.codex-hapi-poc`；权限 700，配置和原始日志 600。
- 最小配置使用 `gpt-6-astra`、`custom` provider 和本地 `127.0.0.1:15721/v1` Responses 路由；禁用 HAPI peer tools，工具权限为 workspace-write / on-request。
- 未复制日常 auth、会话库、全量配置。CLI 首次界面要求认证，使用 `codex login --with-api-key` 在测试目录生成 cc-switch 占位认证；没有导入真实账号凭据。

## 检查矩阵

| 项目 | 状态 | 证据 / 限制 |
| --- | --- | --- |
| 本机 Hub + 认证 | 通过 | `127.0.0.1:3006`；首页 HTTP 200；匿名 `/api/sessions` 401；网页通过自身登录进入会话列表 |
| CLI 终端 ↔ 网页 | 通过 | 同一 native thread；终端 A → 网页正确复述；网页 B → 终端正确复述；刷新 / 新浏览器标签后历史仍在，无重复用户消息 |
| cc-switch 真实请求路由 | 通过 | native response_id 与 cc-switch 只读日志逐条精确匹配；gpt-6-astra 和 gpt-6.1-sol 返回 200，is_streaming=1 |
| 桌面聊天 ↔ 网页 | 通过（隔离实例） | 同一真实引擎双向召回 A/B；detach 后桌面继续回答；reattach 复用 HAPI ID，回填离线消息并召回 C |
| 云端 / 域名 / 备份 | 通过 | HTTPS、手机移动网络双向消息、匿名鉴权、备份隔离恢复；详见下方云端记录 |
| 博客管理员入口 | 已发布 / 本地与线上检查通过 | 管理员路由测试、构建、390px 组件布局；无认证绕过 |

## 过程记录

- 已建立的空白 CLI 会话在退出初始化时变为 inactive，未归档；第一次因无测试认证而退出，没有发送模型请求。
- 真实 CLI 测试会话：HAPI `8b5900ad-e1b1-4ee1-801b-d5aa0f80489c` ↔ native `01a1e89c-be38-77e0-bad6-5a3a12846c92`。

## CLI 实测补充

- 终端 A `HAPI-MAC-A-7391`；网页 B `HAPI-WEB-B-4826`。网页和终端均正确读到对方标识，native thread 未变化。
- 网页消息提交初期短暂出现“发送结果未知”；未点击重试，随后原生确认消费，未观察到重复消息。不得因短暂未知状态自动重复发送。
- 本机浏览器刷新及因用户中断后新建标签重连，既有会话和上下文仍在。没有把本机刷新当作公网断网验证。
- 十行、一行一秒命令成功，exit 0，原生记录 duration 9922 ms；HAPI 结果中有完整 10 行。
- 另一次 60 行、一行一秒命令在运行约 20.7 秒时展开详情，只显示 Running，没有 stdout；SSE 未观察到逐行工具输出。该组合目前只验证了运行状态、耗时与完成后工具输出，逐行实时日志不通过。
- 约运行 38 秒时网页点击 Stop，native turn 随后空闲，但命令实际跑到 HAPI-STOP-60，duration 60129 ms，exit 0。Stop 不应被理解为保证杀死已启动命令。此项标为限制 / 未达到完整命令中止目标。
- 网页将测试会话模型切到 `gpt-6.1-sol`，同一 native thread 回复 `MODEL-SWITCH-OK HAPI-WEB-B-4826`，并精确匹配 cc-switch 200 请求记录。随后用 HAPI model API 恢复 `gpt-6-astra`，返回 ok。该测试证明会话模型变更在下一 turn 生效，没有切换全局 provider，不证明配置文件热加载或任意 provider 热切换。
- 请求证据保存在受限本地 `~/.hapi-poc/route-evidence.json`；不包含请求头、API key 或请求正文。

## 桌面桥接调查

- 日常 App PID 6380，实际引擎 PID 6666，默认为 stdio，无命名 Unix socket；未更改或重启。
- 测试 daemon 在 `~/.hapi-poc/desktop/codex-home` 单独启动，使用同版本内置引擎，生成 owner-only Unix socket；原生账号文件未复制。
- 已启动独立 App profile `~/.hapi-poc/desktop/app-data`。用户在其中创建 native thread `01a1e8a8-d614-7020-9701-0943e545fefb`，发出桌面标识 `HAPI-DESKTOP-A-6318`，原生记录已有 task_complete。
- App 的可选 daemon 模式在存在启动覆盖项时仍选择 stdio（源逻辑和 PID 29487 的启动日志均确认）。已只重启隔离实例，显式设置 `CODEX_APP_SERVER_WS_URL=ws+unix://localhost/Users/guoer/.hapi-poc/desktop/codex-home/app-server-control/app-server-control.sock:/rpc`。
- 新隔离 App PID 34523，日志确认 local transport=websocket、Transport start success；原先隔离 stdio 引擎已退出，避免同一活跃 thread 双引擎恢复。
- Computer Use 拒绝操控 Codex 自身窗口，因此桌面输入由用户手动完成。此限制是桌面 UI 工具自身的明确限制，不是 HAPI 协议报错。
- 用户加载测试聊天后，attach 得到 HAPI `0fcd734f-47b4-4270-a6e9-6ccb1ba32c51`；网页正确读到原始桌面消息及 A，随后发送 B `HAPI-DESKTOP-WEB-B-9254`，同一 native thread 正确回复 A/B。
- 通过 Ctrl-C 仅断开本次 worker。网页保留历史并显示 offline。用户在桌面继续发送离线 C `HAPI-DESKTOP-OFFLINE-C-7246`，确认 B 正确且桌面能看到网页消息。
- 再次 attach 复用上述 HAPI ID，自动回填离线桌面消息；网页追问 C（提示中未包含 C 值）正确回复。没有启动另一个引擎恢复活跃桌面 thread。
- 短消息提交再次短暂出现“发送结果未知”；未点击重试，随后确认消费，界面只出现一次。
- 断开时网页有通用“发送即可恢复”文案；该版本共享会话文档明确禁止 inactive attached view 使用 Runner resume-on-send。操作手册仍要求先恢复 owner 并显式 attach，不依赖通用文案。
- 目前只证明隔离 App 启动设置下的桥接。日常实例和原有聊天尚未切换；App 升级后需重验兼容性。桌面工具进度另待补测。
- 截图：`/Users/guoer/.hapi-poc/evidence/desktop-bidirectional-reconnect.jpg`（受限本地文件，不进入公开仓库）。

## 澄清交互补充

- CLI 测试会话在 Plan 模式调用原生 `request_user_input`；网页选择 Blue 并提交，原生回复 `QUESTION-OK Blue`。已恢复 Default 协作模式，模型为 `gpt-6-astra`。

## 云端预检查

- SSH 公网直连 `root@39.96.212.169` 成功；Linux x86_64，Nginx active；未发现既有 HAPI 安装或服务。
- 服务器博客 `main` 干净，HEAD `41b45c5a6e9663a976880e371676fb76a5018611`，与本地功能基线一致。
- 主域证书只覆盖 `guoer9.me` / `www.guoer9.me`。预检查时 codex 子域无解析，用户随后确认已添加 A 记录；以云端实际解析和证书结果为准。

## 云端与手机验收

- SSH 公网直连 `root@39.96.212.169`；下载与 ACME 访问外网使用服务器 Mihomo `127.0.0.1:7890`；未读取或导出代理订阅 / 模型密钥。
- Linux x86_64 baseline `0.36.4` 包 SHA-256：`b7e8630bbf921ec190bc772b1990b5574d09fcf0f4b05748810b7861c118c9b3`。
- 服务 `/etc/systemd/system/hapi-hub.service` enabled/active，用户 hapi，Hub 只监听 `127.0.0.1:3006`，状态目录 `/var/lib/hapi` 权限 700，认证设置 600。
- 权威 DNS 确认 `codex.guoer9.me → 39.96.212.169`；HTTPS 证书有效至 2027-02-15。Nginx 独立站点通过 `nginx -t`；SSE 不缓冲，Socket.IO 正常升级。
- Certbot 已有 systemd 代理 drop-in 和 nginx reload hook；通过该代理执行此子域的 `renew --dry-run` 成功。每日续签由既有 certbot.timer 管理。
- Mac 正式 home `/Users/guoer/.hapi-blog`，认证文件 owner-only；Mac 与云端 token 摘要一致，HTTPS 登录 200，不在文档记录 token。
- CLI 云端测试：HAPI `50ef3c0e-a130-4295-9ef9-337ed5cec794` ↔ native `01a1e8bd-6938-7172-987f-f33c60542098`。终端 A、网页 B 成功，原生响应与 cc-switch 200 请求精确匹配；终端已退出，云端历史仍在。
- 桌面正式 HTTPS 投影 `40aebb96-7f4b-4d83-b4eb-5e21054a19f4`，仍映射 native `01a1e8a8-d614-7020-9701-0943e545fefb`。先前隧道投影 `d632f3b1-28fa-46a5-9a76-c888111fe192` inactive；Hub URL 变化产生新绑定，不能声称这次沿用同一 HAPI ID。
- 桌面 5 次真实请求均与 cc-switch 日志精确匹配，模型 gpt-6.1-sol / HTTP 200 / is_streaming=1；受限证据 `~/.hapi-poc/desktop-route-evidence.json`。
- 六秒工具命令仅运行一次，exit 0、6040ms、六行完整；网页能看到工具运行状态和最终结果。SSE 观察中 30 行回复仍是完整 message 一次到达，stdout 仅 begin/end：逐 token / 逐行实时未通过。
- 用户手机关闭 Wi-Fi，移动网络 Safari 能登录、看到会话并正常对话，用户确认测试正常。云端同步记录有手机发出的 `helli` 及响应“你好！”。未把此条冒充手机已实际发送 M 提示。
- 最初手机点登录报 “the object can not be found here”；日志曾出现 `/api/auth 401`，重新复制 token 后 Safari 登录成功，用户说明先前应为 token 输错。没有修改上游登录或降低认证；原浏览器兼容性未单独复现，不能认定为兼容性缺陷。
- 匿名与错误 JWT `/api/sessions` 401；匿名 `/api/events` 401；真实 WSS 升级后 `/cli` 返回 Invalid token、`/terminal` 返回 Missing token。
- 使用非秘密 query 探针请求事件流，再读取 access log，探针和 `?token=` 均未出现；日志格式只写 `$uri`。Hub 与 Nginx 凭据日志不得公开。

## 常驻、断线与备份恢复

- Mac 原前台 attach worker Ctrl-C 退出后，云端 active=false，最近 20 条历史仍可读取。随后由 launchd 启动同一 native thread 的 attach，投影 ID 保持 `40aebb96-7f4b-4d83-b4eb-5e21054a19f4`，网页 online。
- 注册 `/Users/guoer/Library/LaunchAgents/com.guoer.hapi-desktop-attach.plist`，单线程、私有 socket；RunAtLoad=true、KeepAlive=false。独立于本次命令终端；App / socket 不可用时需检查并显式重新 attach，不承诺自动接管其他线程。
- Runner 的 workspace-root 限定为 `~/.hapi-blog/workspace`。launchd 启动与机器注册成功，但网页新建 CLI 失败：`spawnSync /opt/homebrew/bin/codex ETIMEDOUT`，子进程退出 1；同一二进制独立 launchd 版本探针正常。未进一步定位超时根因，不把它归咎于 cc-switch。
- Runner 已 bootout，plist 移至 `~/.hapi-blog/com.guoer.hapi-runner.disabled.plist`，首版不启用新建 CLI 功能；失败的临时子进程已退出，未重复提交。
- 云端已启用 `hapi-backup.timer`，每日 04:30 + 随机最多十分钟，保留七份。脚本 flock、停 Hub 一致归档、临时文件成功后提升、恢复此前服务状态。
- 首份 `/srv/backups/hapi/hapi-20261117T093106Z.tar.gz` 46MB、0600；systemd 结果 success。备份时 Hub 重启后桌面 worker自动重连，原生引擎未重启。
- 从首份备份解压到 `/var/lib/hapi-restore-20261117`，SQLite integrity_check=ok，settings 存在。以 hapi 用户在回环 13016 启动隔离 Hub，登录 200，读取三条会话；随后停止隔离 Hub。生产 Hub 仍 active，未覆盖生产数据。
- Mac 睡眠 / 重启、App 退出后的自动恢复及 24 小时稳定性未验证。日常原 App 未更改或重启，旧日常聊天尚未接入。

## 博客入口验收

- 新 managed worktree `/Volumes/2tb/mydata/code/codex_worktree/hapi-codex-blog/personal-blog`，分支 `codex/hapi-codex-blog`；原工作区保留。
- 新增管理员菜单和 `/admin/codex`，普通外链打开 `https://codex.guoer9.me`，不带凭据、`noopener noreferrer`。
- 文案说明 Mac 执行、离线历史与 HAPI 独立访问令牌登录。博客登录不等于 HAPI 登录，退出博客不承诺注销 HAPI。
- 路由验证覆盖匿名跳登录、非管理员回首页、管理员可进入、元数据及无凭据 URL；最新检查结果另记发布记录。
- 临时 standalone fixture 直接渲染产品组件，未修改登录或路由认证；390×844 视口 documentWidth=390、链接正常，无水平溢出。fixture 已删除。截图 `~/.hapi-poc/evidence/blog-codex-mobile.jpg` 不进入仓库。
- 本轮新增测试在实现后运行，未观察 RED，不声称完成 TDD RED/GREEN。

- 最新验证：路由 14 项与 Element Plus 安装 2 项全部通过（16/16）。首次扩展检查发现新增图标未加入既有测试 mock，已补齐；生产构建通过，两个 plist 与 backup.sh 语法通过，diff --check 通过。
- launchd 重连后网页发出不含 M 值的追问，native 同一 thread 正确回复 `HAPI-MOBILE-M-8529`；不是另一个引擎恢复。


## 发布记录

- 产品提交 `4104a05`（feat: add private HAPI Codex console entry and deployment guide），经独立只读复核未发现 P0 / P1 / P2 发布阻碍；reviewer 补充模拟备份失败路径。
- Mac 直连 GitHub push 曾 TLS 失败；随后借助 SSH 的回环 17890 → 服务器回环 7890 临时代理，原子推送功能分支与 main。无 force push，无全局网络设置修改；临时隧道在交付时关闭。
- 生产 `/srv/personal-blog` main 从 `41b45c5` fast-forward 到产品提交。只构建并重建 Compose 的 web；api 与 database 容器保持原运行实例。
- 服务端 Node 22 生产 Docker 构建 exit 0；新镜像 manifest `sha256:eff0eed9af84e0f7355df020168da647f9bde418616e94388819ea60b39389f0`，web healthy；HAPI Hub 和备份 timer enabled/active，Hub 回环 3006。
- 发布前前端镜像保留为 `personal-blog-web:hapi-before-20261117`，原镜像 ID 只存于服务器 `/etc/hapi/blog-web-image-before-20261117`。
- HTTPS smoke：`/`、`/documents`、`/admin/codex` 的 SPA shell、新入口 JS chunk、公开文章列表 API、其中一篇真实文章详情 API 与页面均 200。实际生产 chunk 包含正确控制台 URL 与“访问令牌”说明，无 cliApiToken 或 Bearer 凭据。
- 真实浏览器匿名访问 `/admin/codex` 跳转 `/admin/login?redirect=/admin/codex`；没有读取生产管理员密码，也未声称完成真实管理员登录的 UI 验收。管理员 / 非管理员边界由路由测试验证。
- 本地 Hub、原 CLI 测试会话、事件采集、旧 SSH 转发、开发服务器已停止；正式云端 Hub、隔离桌面 App / 引擎与 launchd attach 保留。正式 HTTPS 控制台与博客入口标签作为交付保留。
- 仍待后续：日常原 App 接入、后台新建 CLI 超时修复、逐 token / 逐行输出、完整 shell 中止、睡眠 / 重启 / App 退出恢复、24 小时稳定性。第一版未将这些项目判为通过。
