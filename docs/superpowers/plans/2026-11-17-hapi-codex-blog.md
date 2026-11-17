# HAPI 验证与博客接入操作计划

> **For agentic workers:** 执行时使用 superpowers:executing-plans，逐项推进并记录结果。勾选框表示尚待执行；执行证据见验收记录；勾选项以实测为准。

**Goal:** 先证明网页能够查看并继续 Mac 上的同一 Codex 会话，再将控制台接入个人博客后台。

**Architecture:** 先本地隔离验证，再采用云端 HAPI Hub + Mac Runner / 桌面 attach worker。Hub 保存同步记录；Mac 执行任务并通过现有 cc-switch 请求中转 API。博客后台打开独立子域名控制台。

**Tech Stack:** HAPI `0.36.4`、Codex CLI / 桌面 app-server、cc-switch、Nginx、Linux systemd、macOS launchd、现有 Vue 3 博客。

**执行状态（2026-11-17）：** 本地 CLI、隔离桌面双向、云端 HTTPS、手机移动网、鉴权与备份恢复通过；博客入口已发布并通过线上检查。逐 token / 逐行输出、Stop 杀子进程未通过；后台新建 CLI 未启用，日常原 App 尚未迁移。

**Spec:** [HAPI 验证与博客接入设计](../specs/2026-11-17-hapi-codex-remote-design.md)

## Global Constraints

- HAPI CLI、Hub、Runner 固定使用 `0.36.4`，不混用主分支和其他版本。
- 本地 CLI 验证使用独立 `HAPI_HOME`、`CODEX_HOME` 和测试工作区；桌面桥接连接 App 实际引擎，不复制原生聊天库。
- CLI 同步与桌面聊天同步分别验收；前者通过不能替代后者通过。
- 保留本机 cc-switch 模型路由；模型 API 凭据不进入博客前端、Git、URL 或公开日志。
- 云端 Hub 监听 `127.0.0.1:3006`；控制台拟使用 `https://codex.guoer9.me`。
- 博客第一版仅增加管理员入口，保留 HAPI 独立登录。
- 服务器约定为 `root@39.96.212.169`、项目目录 `/srv/personal-blog`；部署前核对实际状态。
- 首先验证小额、短时真实请求；长任务在临时工作区执行，不操作日常项目。

## Review Focus

| 条件 | 预期行为 | 验证任务 |
| --- | --- | --- |
| CLI 成功而桌面 App 无兼容端点 | 标记部分可行，阻止按“桌面同步已通过”进入上线 | 任务 3 |
| 刷新、断线时消息送达不确定 | 不重复提交、不丢历史，显示真实执行状态 | 任务 2、4 |
| cc-switch 切换后运行中进程沿用旧配置 | 核对实际路由并记录生效时机，必要时恢复引擎 | 任务 2 |
| SSE token 出现在查询参数、反代缓冲输出 | 无参数日志；增量及时到达；未认证请求被拒绝 | 任务 4 |
| Mac 睡眠、桥接断开或进程退出 | 历史仍可查看，不显示虚假在线，不启动重复引擎 | 任务 3、4、5 |

## 文件与运行目录

以下为本轮实际交付位置；运行状态与限制见验收记录。

| 位置 | 用途 |
| --- | --- |
| `docs/superpowers/acceptance/2026-11-17-hapi-codex.md` | 版本、测试矩阵、脱敏证据、限制与通过结论 |
| `/Users/guoer/.local/share/hapi/runtime/0.36.4/` | Mac 独立 HAPI 安装，不改变系统全局包 |
| `/Users/guoer/.hapi-poc/` | 本地 Hub / Runner 测试状态及临时工作区 |
| `/Users/guoer/.codex-hapi-poc/` | CLI 测试模型配置和原生测试会话 |
| `/Users/guoer/.hapi-blog/` | Mac 正式连接云端的 HAPI 状态 |
| `/opt/hapi/0.36.4/`、`/var/lib/hapi/` | 云端二进制与 Hub 数据，后者仅服务用户可读 |
| `/etc/hapi/hub.env`、`/etc/systemd/system/hapi-hub.service` | 云端环境和守护服务 |
| `deploy/hapi/README.md` | 版本固定、安装、升级、备份和回退手册 |
| `deploy/hapi/hapi-hub.service.template`、`deploy/hapi/hub.env.example` | 无密钥服务模板和配置示例 |
| `deploy/hapi/nginx.conf.template` | 独立子域名、SSE、Socket.IO 与无查询参数日志 |
| `deploy/hapi/com.guoer.hapi-runner.plist.template` | Mac Runner 前台启动命令的 launchd 模板 |
| `frontend/src/config/codex.ts` | 公共控制台 URL 常量 `CODEX_CONSOLE_URL` |
| `frontend/src/views/admin/Codex.vue` | 控制台说明和打开按钮 |
| `frontend/src/layouts/AdminLayout.vue`、`frontend/src/router/index.ts` | 后台菜单及 `/admin/codex` 路由 |
| `frontend/src/router/index.test.ts` | 管理员路由边界验证 |

## 任务 1：固定基线并准备隔离验证

**交付物：** 可复现的版本记录与独立测试环境。

- [x] 重新记录 `git status --short --branch`、`codex --version`、App / cc-switch 版本和 Mac 架构；只读取模型路由必要字段。
- [x] 核对 GitHub Release、npm 的 `0.36.4`，记录实际可执行文件和包校验信息。若改用另一版本，三端同步修改并重新核对接口。
- [x] 将 HAPI 安装到上表独立目录；运行 `hapi --version` 和 `hapi attach --help`，确认安装产物与文档一致。
- [x] 创建隔离目录，权限设为当前用户可读；在临时 `CODEX_HOME` 写入现有模型路由所必需的最小配置，只连接本地 cc-switch。不复制日常会话库、账号登录文件或整个配置目录。
- [x] 为测试设置 `HAPI_DISABLE_PEER_TOOLS=1`；记录独立 CLI 实际使用的 Codex 路径。测试中不扩大原有工具权限。
- [x] 新建验收文档，记录所有执行均限定在临时工作区。

示例启动环境（执行时使用绝对路径；不把实际 token 写进命令记录）：

```bash
export HAPI_HOME=/Users/guoer/.hapi-poc
export CODEX_HOME=/Users/guoer/.codex-hapi-poc
export HAPI_DISABLE_PEER_TOOLS=1
```

**验收：** 版本一致，测试配置可解析，本机日常聊天、cc-switch 当前 provider 和博客文件均未被测试初始化覆盖。

## 任务 2：验证 CLI、网页与 cc-switch 链路

**输入：** 任务 1 的隔离环境。

**交付物：** CLI 共享会话与模型路由实测记录。

- [x] 在回环地址运行 `hapi hub --no-relay`，通过 HAPI 自己的登录访问本地网页。首次启动可能打印访问 token，原始输出应写入权限 600 的本地文件，工具输出和报告只读取脱敏摘要；认证 token 仅保存在受限配置与登录界面。
- [x] 在临时工作区运行 `hapi codex`，记录 native thread ID 与 HAPI session ID；网页选择该会话。
- [x] 发送测试标识 A，要求记住；在网页追问该标识，再从终端追问网页输入的标识 B。核对同一 thread、每条消息恰好出现一次。
- [x] 用短文本响应验证流式输出；运行在临时目录每隔一秒追加一行、共十行的测试命令，核对输出和运行状态，区分“工具结束后展示”与“逐行增量展示”。
- [x] 刷新网页、临时断开网页连接并重新连接，检查历史、活动 turn、完成状态和有无重复执行。另做一次 Stop，确认只中断测试 turn。
- [x] 通过正常权限流程触发一个低风险审批或澄清请求，检查网页能完成实际支持的交互；不能触发时标记未验证，不人为扩大权限。
- [x] 在 cc-switch 本机界面核对该次请求的时间、模型、路由和结果；如果 CLI 能回复但无法证明经过 cc-switch，不判定配置兼容通过。
- [x] 使用现有可用模型或 provider 做一次可回退切换，核对下一次请求实际使用的配置。区分同一本地路由的上游切换、配置文件切换和会话模型设置；必要时关闭测试引擎后恢复，不承诺热加载。
- [x] 恢复测试前的 provider / 模型选择；记录切换的生效条件和任何协议不兼容。

**验收：** 上述消息、状态、重连和真实路由通过；记录流式工具输出的实际能力。如果仅聊天文本实时、命令输出延后展示，明确写出限制。

**失败处理：** 依次检查本地路由是否监听、Responses 协议、实际使用的可执行文件与 `CODEX_HOME`、HAPI 版本和运行日志。只重启本次测试组件。

## 任务 3：验证现有桌面聊天双向桥接

**输入：** 已通过的本地 Hub；本机官方 App。

**交付物：** 桌面桥接通过，或具体不可行证据。

- [x] 只读发现当前桌面 App 的 app-server、实际版本、`CODEX_HOME`、Unix socket 路径和权限；不依据固定安装路径或目录名猜测。
- [x] 若无兼容端点，先确定当前版本支持的暴露方式与所需最小调整；涉及当前 App 重启时安排空闲窗口。未文档化启动方式先在隔离 profile 试验，并记录回退。
- [x] 在桌面 App 新建并加载一个专用测试聊天；不接管本次计划聊天或其他运行中的工作。
- [x] 通过 HAPI 发布版本的 attach 列表确认该测试 thread；记录对应关系，只 attach 该 thread。
- [x] 桌面输入 A → 网页追问；网页输入 B → 桌面追问；核对上下文、进度、工具结果、消息次数和 native thread ID。
- [x] 使用本机真实中转 API 完成短请求；模拟模型测试只能作为端点检查，不能作为此项验收。
- [x] `hapi detach <hapi-session-id>` 后，验证 App 继续响应；重新 attach，核对断开期间历史及身份关系。
- [x] 测试桥接连接丢失时的状态；确认恢复需要重新 attach 时明确提示，不启动另一个引擎恢复同一活跃聊天。

命令形状以已核对版本为准，以下占位符必须替换为只读发现的真实值：

```bash
hapi attach --socket <实际兼容的本地socket> --list
hapi attach <已加载的测试native-thread-id> --socket <实际兼容的本地socket>
hapi detach <该桥接的hapi-session-id>
```

**准入：** 桌面双向消息、真实 API、上下文和安全 detach 均通过后，进入任务 4。只有 CLI 通过时，结论为“CLI 可行，桌面目标未通过”；先报告阻碍，用户选择接受 CLI 路线后才修改后续目标。

## 任务 4：部署云端 Hub，验证公网与恢复

**输入：** 任务 2、3 通过；已核实的服务器、域名和 TLS。

**交付物：** `codex.guoer9.me` 的独立控制台及云端持久化证据。

- [x] 远程操作前说明 SSH 目标 `root@39.96.212.169`、SSH 公网直连，以及此次 Git / 下载 / 构建各自的代理路径，遵守 `deploy/README.md`。首先只读核对 Nginx、端口、DNS、证书和已有服务。
- [x] 创建独立服务用户 `hapi`、版本目录 `/opt/hapi/0.36.4/` 和状态目录 `/var/lib/hapi/`；按服务器架构选择发布二进制并校验。不调整博客数据库结构或复用博客数据库凭据。
- [x] 编写无密钥模板。实际 `/etc/hapi/hub.env` 限制读取权限，设置 `HAPI_HOME=/var/lib/hapi`、`HAPI_LISTEN_HOST=127.0.0.1`、`HAPI_LISTEN_PORT=3006`、`HAPI_PUBLIC_URL=https://codex.guoer9.me`；允许来源限定为实际控制台来源。
- [x] 创建独立 systemd 服务，执行 `hapi hub --no-relay`；HAPI 登录 token 保留在受限文件，通过私密登录流程配置 Mac，不能写入仓库或博客构建变量。
- [x] 为控制台建立独立 Nginx 站点与有效 HTTPS。正确转发 Socket.IO 的 Upgrade / Connection；关闭 SSE 缓冲和缓存，读写超时设为 3600 秒。访问日志使用 `$uri`，不记录 `$request`、`$request_uri`、查询参数或 Authorization；核对认证事件流 URL 的 token 不进入日志。
- [x] 将无查询参数日志格式放在合法的 Nginx `http` 上下文；执行 `nginx -t` 通过后再 reload。Hub 3006 端口保持回环监听，不直接公网开放。
- [x] 在 Mac 的正式 `HAPI_HOME=/Users/guoer/.hapi-blog` 设置云端 `HAPI_API_URL` 并完成认证；暂用测试工作区。不要迁移本地 PoC 数据库或原封不动复用本地 Hub 的身份记录。
- [x] 重做新 CLI 测试会话和新桌面测试聊天的双向验证；保持桌面 attach worker 位于 Mac。Mac 原生 socket 不对云端或浏览器暴露。
- [x] 用手机移动网络或另一外部网络验证控制台、流式输出和回传消息。仅在本机浏览器打开公网地址不能作为跨网验证通过。
- [x] 无认证调用 `/api/sessions`，预期 401；无认证 Socket.IO 会话操作应被拒绝。检查用户退出、浏览器刷新、错误 token 均不能访问会话内容。
- [x] 临时断开 Mac worker：云端仍可查看已同步历史，界面真实显示离线；恢复连接后不重发不确定是否已接受的消息。重启 Hub 后再次核对历史持久化。

**验收：** 公网双向交互、历史持久化、真实在线状态、日志脱敏和认证全部通过。DNS / 证书未就绪时可通过 SSH 端口转发完成云端进程验证，但公网验收仍标记待完成。

## 任务 5：设置常驻、备份与回退

执行结果：桌面 attach 已注册 launchd；备份、隔离恢复通过。首版曾因后台新建超时停用 Runner；2026-11-17 21:37 后恢复 Mac Runner，并新增云服务器 Runner，两台机器创建与真实回复通过。旧超时原因未复现。睡眠 / 系统重启 / App 退出后的恢复及 24 小时稳定性未测。未完成项不作为已通过。

**交付物：** 可长期使用的生命周期配置与一次恢复记录。

- [x] 为 Mac Runner 编写 launchd 模板，使用前台 `hapi runner start-sync --workspace-root <实际允许目录>`；`hapi runner start` 会自行转后台，不直接作为 launchd 前台任务。
- [x] 明确 Runner 负责新建/恢复其管理的 CLI 会话，桌面 attach worker 需要单独显式启动；Runner 常驻不等于现有桌面聊天自动桥接。桌面 App 重启后的恢复按任务 3 已验证的方式执行。
- [x] 启动常驻前确认 cc-switch 可用且 PATH / 环境与验证一致；不会在 Runner 后台进程中自动继承交互终端临时导出变量。Mac 实际使用 bundled CLI；云端独立导入所选中转配置，见验收记录。
- [ ] 验证关浏览器、关闭创建 CLI 的主终端、Runner 重启、桌面 App 退出和 Mac 睡眠，各自记录真实行为；不将“Web-created 会话无需主终端”外推到所有会话。
- [ ] 制定 Mac 供电与睡眠策略；只在用户期望的工作窗口运行，避免默认永久更改系统睡眠设置。
- [x] 云端先停止 Hub 再备份完整 `/var/lib/hapi`，或使用已验证的一致性备份方法；备份包含 HAPI 认证状态，应限制访问。保留最近 7 份每日备份，先完成一次隔离恢复并核对测试历史和登录。
- [x] 将 cloud service、Mac 服务、域名代理、Hub 数据备份和版本回退步骤写入 `deploy/hapi/README.md`。

**回退顺序：** 先 detach 桌面 worker，确认 App 不受影响；停止专属 Runner / Hub 服务；移除本次 launchd / systemd 注册和独立 Nginx 站点并检查配置；恢复确实被改过的 App 启动设置与 provider；保留受限备份，不自动删除会话目录，不使用全局 `pkill`。

## 任务 6：接入博客后台

**输入：** 云端控制台、手机跨网与桌面断线恢复已通过；任务 5 的睡眠 / App 退出 / 24 小时稳定性仍待后续观察。第一版曾只指向桌面桥接；后续已恢复 Mac 新建并增加云端 Runner，入口说明随之更新。

**交付物：** 管理员可进入控制台，公共博客正常。

- [x] 创建 `frontend/src/config/codex.ts`，导出公共常量 `CODEX_CONSOLE_URL = 'https://codex.guoer9.me'`；地址必须与实际部署一致，不能包含登录 token。
- [x] 创建 `frontend/src/views/admin/Codex.vue`：说明执行节点在 Mac、离线行为及需要独立登录；用普通链接打开控制台。第一版不伪造在线状态、不嵌入 iframe。
- [x] 在管理员子路由中增加 `path: 'codex'`、`name: 'AdminCodex'`，继承 `requiresAuth` / `requiresAdmin`；在 `AdminLayout.vue` 添加“Codex 控制台”。
- [x] 在现有路由测试中加入 `/admin/codex` 的元数据断言；验证未登录及非管理员不能进入该页，管理员可进入；链接地址正确且不携带凭据。无需为静态说明文字另写镜像测试。
- [x] 本地运行针对性测试和生产构建，检查手机下入口可用、公共导航没有意外增加管理项。记录 HAPI 独立认证，博客退出不会被宣称自动注销 HAPI。
- [x] 核对发布分支与实际包含入口改动的目标提交，再按博客现有部署流程发布前端改动；只拉取 `main` 的更新脚本不会自动发布其他分支。发布后检查首页、文章、后台及 HAPI 入口；失败时回退本次入口提交，独立 Hub 可保留。

验证命令（仅执行与实际改动相关的检查）：

```bash
npm --prefix frontend run test -- src/router/index.test.ts
npm --prefix frontend run build
git diff --check
```


## 完成定义与预计工作量

全部勾选项的证据写入验收文档，分别标注“通过 / 失败 / 未验证”。需要保留真实的版本、thread 对应关系、请求路由、离线表现、恢复方式及限制。

| 阶段 | 预计有效操作时间 | 影响时间的主要条件 |
| --- | --- | --- |
| 本地 CLI 与 cc-switch | 30–60 分钟 | 模型协议、实际路由与工具输出能力 |
| 现有桌面桥接 | 1–3 小时 | 兼容端点、App 版本和真实模型行为；可能无法通过 |
| 云端 Hub、认证、跨网与恢复 | 1–2 小时 | 服务器状态、DNS 和证书 |
| 常驻与备份恢复 | 30–90 分钟 | macOS 生命周期、独立恢复环境 |
| 博客后台入口与回归 | 30–60 分钟 | 前端构建和现有发布流程 |

以上是估算，不含 DNS 等待、过夜观察或额外协议修复。先完成任务 1–3 再决定云端接入；正式接入前至少经过一次跨网使用与一次断线恢复。持续使用 24 小时后的复核作为稳定性记录，不将短时演示称为长期稳定。
