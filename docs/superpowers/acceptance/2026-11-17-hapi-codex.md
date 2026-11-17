# HAPI / Codex 实测记录

日期：2026-11-17（Asia/Shanghai）。当前阶段：云端 HTTPS 与手机跨网测试通过；原日常 App 的当前聊天已接入；Mac 与云服务器两个 Runner 在线，新建聊天与真实回复通过。操作同步边界见末尾补充。

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
| 桌面聊天 ↔ 网页 | 通过（隔离实例及当前日常聊天） | 隔离实例验证 A/B/C；日常原 profile 共享引擎，D/E 经云端接口双向验证，见末尾记录 |
| 云端 / 域名 / 备份 | 通过 | HTTPS、手机移动网络双向消息、匿名鉴权、备份隔离恢复；详见下方云端记录 |
| 博客管理员入口 | 已发布 / 本地与线上检查通过 | 管理员路由测试、构建、390px 组件布局；无认证绕过 |
| 多机器与后台新建 | 通过 | Mac API 新建和续聊通过；网页实际选择云服务器、创建、刷新和模型切换后续聊通过 |
| 永久删除同步 | 不支持 | 临时测试 Hub 删除后 404，但原生线程与 rollout 文件仍存在；不能宣称跨端永久删除 |

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
- 此阶段只证明隔离 App 启动设置下的桥接。日常实例和原有聊天当时尚未切换；App 升级后需重验兼容性。桌面工具进度另待补测。
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
- 当时 Runner 已 bootout，plist 移至 `~/.hapi-blog/com.guoer.hapi-runner.disabled.plist`，首版不启用新建 CLI 功能；失败的临时子进程已退出，未重复提交。21:37 后恢复并通过验收，详见末尾。
- 云端已启用 `hapi-backup.timer`，每日 04:30 + 随机最多十分钟，保留七份。脚本 flock、停 Hub 一致归档、临时文件成功后提升、恢复此前服务状态。
- 首份 `/srv/backups/hapi/hapi-20261117T093106Z.tar.gz` 46MB、0600；systemd 结果 success。备份时 Hub 重启后桌面 worker自动重连，原生引擎未重启。
- 从首份备份解压到 `/var/lib/hapi-restore-20261117`，SQLite integrity_check=ok，settings 存在。以 hapi 用户在回环 13016 启动隔离 Hub，登录 200，读取三条会话；随后停止隔离 Hub。生产 Hub 仍 active，未覆盖生产数据。
- Mac 睡眠 / 重启、App 退出后的自动恢复及 24 小时稳定性未验证。该阶段日常原 App 未更改或重启，旧日常聊天尚未接入；后续接入见末尾记录。

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
- 发布当时仍待后续：日常原 App 接入、后台新建 CLI 超时修复、逐 token / 逐行输出、完整 shell 中止、睡眠 / 重启 / App 退出恢复、24 小时稳定性。日常接入及新建可用性随后通过，旧超时根因仍未复现；其余限制仍保留。

## 日常窗口接入交接与实测

- 用户已明确授权接入当前日常窗口。目标 native thread `01a1e875-cc7e-7070-997f-612b0415cbbc`；原 App PID 6380、stdio engine PID 6666。
- 检查安装包只读副本与 CLI help：stdio 不能热 attach；日常实例没有可用共享 socket。旧 daemon package 为 0.163.0，切换时需使用当前 App 自带 0.169.0-alpha.11.1；不能直接沿用旧 package。
- `~/.hapi-blog/current-desktop/connect.py` 和两个受限 LaunchAgent 已准备，原账号目录与 profile 原地使用；配置和认证文件仅保存本地摘要用于首次切换前后核对，没有复制原凭据或覆盖配置。
- 一次性切换等待用户手动退出 App，检查原 PID 及启动身份，原引擎未退出则保持等待；不会主动退出或杀死当前任务。重开后仅发现已由桌面加载的指定 thread，不 cold resume。
- 新 HAPI attach 成功后才停止旧隔离 worker；准备时尚未发生重开，因此该阶段日常窗口仍未接入，账号、MCP、双向上下文和真实路由待新实例验收。
- 本机验证：脚本语法、两个 plist 语法、owner-only 文件权限、diff --check 通过；真实原进程存活时调用启动入口，确认被阻止且未调用 daemon / open、未改状态。另以模拟命令验证版本不一致时拒绝开 App、版本一致时传入原 profile 和明确 socket。模拟结果不作为真实连接验收。
- 一次性 handoff 服务已注册，状态 `waiting_for_manual_quit`；原 PID 6380 / 6666 仍在运行，未自动退出或重启。后续须用户在本条回复结束后手动 Cmd+Q，待原 profile 自动重开，再回当前聊天继续验证。
- 第一次手动重开：旧 PID 已退出，daemon 成功更新为 0.169.0-alpha.11.1；但普通 App PID 12087 在切换结束前先启动，仍派生 stdio PID 12370，脚本按保护条件停止，未另开实例。当前 thread 尚未进入 daemon 的 loaded list，未 attach，不能判为接入成功。
- 重新核对：auth.json 摘要保持原样；config.toml 摘要在重开期间有变化，当前模型 gpt-6-astra、custom provider、本机 cc-switch URL 和 MCP 项仍保留。未将配置摘要变化解释为凭据丢失或脚本改写。
- 已将下一次 handoff 改为复用已核验版本的现有 daemon，去掉首次安装等待；guard 更新为 PID 12087 / 12370，并重新注册等待。仍需用户手动退出后等待自动打开，避免普通 App 抢先以 stdio 启动。

### 日常实例验收结果

- 用户完成自动重开。原日常 App PID 16465，原 profile `~/Library/Application Support/Codex`，CODEX_HOME `~/.codex`；共享 daemon PID 12104，版本 0.169.0-alpha.11.1。App 日志确认 hostId=local / transport=websocket / 初始化成功；未启动第二个 stdio 引擎恢复当前 thread。
- `hapi attach --list` 确认当前 native thread 已由桌面加载；首轮 attach 报 `Cannot persist attached runtime metadata`，Hub 已保存正确 native identity，worker 自行退出。显式 kickstart 后成功复用 HAPI `5f1c09e0-73cd-453f-8c18-3cbe183968e0`，state=attached、Hub active=true；没有修改上游 HAPI 0.36.4 二进制。
- 仅在新连接成功后 bootout 旧隔离 worker，旧历史保留，原日常引擎持续运行。当前受限状态文件、日志和证据均在 `~/.hapi-blog/current-desktop`。
- 直接向同一个 Unix endpoint 进行只读 JSON-RPC：引擎报告 `~/.codex`、ChatGPT 认证、原 custom provider / gpt-6-astra 配置及已启用桌面插件。auth.json 摘要与首次切换前一致，未复制凭据。MCP status 共 19 项，codex_apps 367 工具，chrome-devtools / firecrawl-local / git / github-mcp-server / js-reverse / node_repl / penpot / playwright 等返回工具；部分原第三方 MCP 仍显示 notLoggedIn 或无工具，不能声称全部第三方授权通过。
- 桌面 commentary 发出 D=`HAPI-CURRENT-D-6842`，Hub 消息 seq 1453 读到同一 native turn 的 agent message，验证桌面 → 云端。
- 云端 `/api/sessions/:id/messages` 仅发送一条明确标注自动测试的网页消息，提示中不含 D 的值，网页新标识 E=`HAPI-CURRENT-WEB-E-9573`。首次进入原生队列，未重复发送；随后对该消息显式 Steer 返回 invoked，原聊天收到真实 user message，并正确复述 D、记住 E，验证网页 → 原日常聊天。不是新引擎或从历史另起会话。
- 原日常 native response ID 与 cc-switch `proxy_request_logs.request_id` 精确匹配，最近 12 条均记录 gpt-6.1-sol / HTTP 200 / is_streaming=1；受限证据 `current-desktop/route-evidence.json`。只读 MCP 证据 `verification.json`，未包含账号邮箱或 token。
- 本次日常会话通过云端 API 验收，未将其描述为再次完成 iPhone UI 验收。逐 token / 逐行输出、完整 shell 中止、睡眠 / 重启恢复、24 小时稳定性仍未验收；其他日常聊天需逐条显式接入。

## 机器列表、新建聊天与云端 API 导入（21:37 后）

- 用户反馈网页无法选择机器及新建聊天。失败基线：认证后的 `GET /api/machines` 返回空数组，`com.guoer.hapi-runner` 未注册；当前桌面 attach 仍 running。机器列表只展示在线 Runner，桌面 attach 本身不提供新建能力。
- 旧 Homebrew CLI 与 App bundled CLI 在同一受限环境下的独立 `--version` 均在一秒内成功，未复现历史 `spawnSync ... ETIMEDOUT`。恢复配置显式将 bundled CLI 目录置于 Runner PATH 最前，并设置 `HAPI_CODEX_APP_SERVER_BIN`，避免 HAPI 两条 executable 解析路径选到不同版本。未修改 HAPI 二进制，不宣称已证明旧版本自身就是超时原因。
- Mac Runner 使用原 `~/.codex`，保留 ChatGPT 认证、MCP 及 cc-switch；launchd `com.guoer.hapi-runner` 恢复 running。机器 `d8411b5c-95a2-43c3-8891-cc3bf1301488` 在线，网页名为“MacBook Air”，agent availability 报 Codex available。
- Mac 两个 workspace roots 为 `~/.hapi-blog/workspace` 及当前博客 worktree。它们限制 browse/spawn 目录，不代表 Codex 的工具沙箱。测试创建显式使用 `permissionMode=default`，没有使用网页 stock Yolo 默认值。
- Mac 新建：`POST /api/machines/:id/spawn` 返回 success，耗时 5.99 秒；HAPI `ab71937b-e0e9-478a-8fe1-64056779e5e9` ↔ native `01a1e9ba-ded4-7742-8807-eac81f59026e`。第一次提示记住 F，回复 `HAPI-RUNNER-NEW-F-6137`；新认证连接中发送不含 F 值的追问，仍正确回复 F。
- Mac native response ID 与 cc-switch `proxy_request_logs.request_id` 的 response 段精确匹配，gpt-6-astra / HTTP 200 / streaming=1。证据 `~/.hapi-blog/runner-repair/mac-route-evidence.json`，不包含密钥。
- 云服务器已有 `/usr/local/bin/codex`，版本 `0.167.0`，但原 `/root/.codex` 没有持久化配置与登录，独立 `codex login status` 返回 Not logged in。没有据此断言桌面远程连接失效。
- 用户明确授权把本地 cc-switch 相同中转配置导入云端。只读读取当前 Codex provider `aiwanwu 福利`，通过 SSH stdin 导入 HTTPS 中转、默认模型、推理设置及该 provider 的 API key；不输出 key，不复制 ChatGPT OAuth 或原会话库。
- 云端独立 home `/root/.hapi-runner/codex-home`：原生 `codex login --with-api-key` 成功，配置内容 SHA-256 与源 provider config 一致。目录 0700，配置和 auth 0600。原 `/root/.codex` 未覆盖；未导入全量供应商、MCP 或 Mac 文件路径。
- 云端 `/etc/systemd/system/hapi-runner.service` enabled/active，Hub 为服务器回环 3006；模型网络使用服务器自己的 Mihomo 回环 7890，不依赖 Mac cc-switch 监听端口。`KillMode=process` 已通过 unit 验证及 daemon-reload；没有为此重启活跃会话，也未将未执行的 Runner 重启恢复测试判为通过。
- 云端机器 `f8cd1183-7498-4378-866c-d01bb5b05dca`，网页名“阿里云服务器”，允许 `/root/hapi-workspace`、`/srv/personal-blog`。两台机器同时出现在 API 和真实浏览器的新建表单中。
- 云端 API 临时会话 `7f956584-6aab-4421-92f3-cfdeb78073b8` 回复 `HAPI-CLOUD-RELAY-G-4821`。随后仅用此临时会话验证归档 / 删除：archive ok、active=false、delete ok、查询 Hub 返回 404；云端只读 SQLite 仍有 native `01a1e9c1-dc67-75a1-8cfe-bf5239beda34`，archived=1，rollout 文件仍存在。
- 真实浏览器选择“阿里云服务器”、目录 `/root/hapi-workspace`、Codex、Default 权限，点击创建后进入 HAPI `61641e73-328e-4b3c-a225-d69e1e3e5d4c`，native `01a1e9c3-31d0-7591-9c1e-55979fcfe1c0`。输入 H 后模型正确回复 `HAPI-CLOUD-WEB-H-4092`；完整刷新页面，切换模型至 gpt-6.1-sol，再发送不含 H 值的追问，仍回复 H。随后恢复该测试会话模型为 gpt-6-astra；全局默认未改。
- 保留两条新建验收聊天，HAPI 显示名为“Mac 新建聊天验收”“云端新建聊天验收”。删除测试只操作本轮临时云端聊天。原日常聊天、App 和共享 daemon 没有停止或重启。
- 同步边界以 pinned 0.36.4 源码及临时实测为准：Hub delete 不调用原生永久删除；网页重命名/置顶属于 HAPI 元数据；attached End session 只 detach，原生 archive 才反向结束桥接。云端 API 导入是配置快照，不是 cc-switch 的自动实时同步。
- 全部操作同步尚未实现。需以每条 native thread 的单一 owner 为准，增加管理操作到原生 API 的适配、确认事件和离线失败处理；跨机器文件 / 配置 / 上下文迁移另行设计，不能复制活跃 SQLite 或双引擎恢复同一活跃聊天。
- 本轮入口说明更新：16/16 路由与 Element Plus 测试通过，`vue-tsc -b && vite build` exit 0，Mac plist 和导入脚本语法、systemd unit 验证及 `git diff --check` 通过。构建保留原有大 chunk 提示。最终检查两机 active、原日常 attached、Mac auth 摘要与基线一致，Git diff 不含所用 API key 或 HAPI token。
