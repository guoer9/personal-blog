# Sentry 与 BrowserStack 云端验证

## 范围

- 日期：2026-11-01，约 16:42–16:50（Asia/Shanghai）；沿用 `codex/blog-v1.2`。
- 承接 `25-quality-tooling-setup.md` 的云端未决项。用户提供 DSN 和 BrowserStack 本地 runner 凭证后，本轮仅配置本地环境、执行真实云端验证并清理临时触发器。
- 实际值只写入被 Git 忽略、权限为 `0600` 的 `frontend/.env.local`，不将 Token、Access Key 或完整 DSN 写入本记录。未部署、推送或创建研究目标。

## 证据、实验与结果

### Sentry

1. 使用本地已有查询 Token 实际 GET 查询组织项目列表，HTTP `200`。按用户提供 DSN 的 project ID 精确匹配到 Vue 项目 `personal-blog`，自动补齐本地 `SENTRY_PROJECT`。
2. 本地启用 SDK，并指定 `development` 环境。Vite 检测到配置变化后自动重启；在 `http://127.0.0.1:5173/` 的隔离 Playwright CLI 会话中确认 SDK 已初始化，原应用已有 Vue error handler。
3. 通过页面已加载的同一 Vue 和 Sentry 模块，在原应用上下文中临时挂载测试组件。按钮方法抛出带独特标记的 `Sentry Test Error`；只点击一次，不修改正式页面源码。
4. 未拦截上报请求。SDK `flush` 返回 `true`，测试错误上报响应为 HTTP `200`；随后使用 Sentry 技能自带的只读 API helper 查询 exact event 和 issue，均可读到真实云端记录。

| 字段 | 云端核对结果 |
| --- | --- |
| Project | `personal-blog`，`javascript-vue` |
| Environment | `development` |
| Issue | `PERSONAL-BLOG-1` / `7822974888` |
| Event ID | `66a33284e52f41b8bc38d1f5a5b8e6f5` |
| 测试标记 | `Sentry Test Error [blog-v1.2-2026-11-01T08-46-07-864Z]` |
| 收件时间 | `2026-11-01T08:46:27.830335Z`（北京时间 16:46:27） |
| Issue 计数 | `1`；测试后保留 `unresolved`，未通过 API 修改 issue 状态 |
| Release | 未配置，云端为空 |

本次错误确实由 Vue 组件按钮触发，但 SDK 记录的 mechanism 是 `auto.browser.browserapierrors.addEventListener`，不是 Vue 专属 mechanism。不将这次浏览器异常收件扩大为 Vue 组件上下文完整性验收。实验中先按旧接口检查 `client.isEnabled()`，发现当前 SDK 没有该公开方法；核对安装版本的类型后改用公开的 `sdk.isEnabled()`。该探针错误仅在自动化求值期间发生，没有作为正式页面改动。

随后实际查询 `personal-blog` 的 `production` 环境、最近 `24h` issues，返回 `[]`（查询时间 `2026-11-01T08:47:09Z`）。当前验证对象是本地开发站，尚未部署生产监测，因此只能说明该查询无结果，不能推断生产零故障。

### BrowserStack

1. `npm run browserstack:check` 返回 `missing: []`、退出码 `0`；此命令不创建远程会话。
2. `npm run test:browserstack` 启动 BrowserStack Local 并创建一个真实 Playwright 云端会话，完整执行首页 `h1`、真实文章 API HTTP `200` / `items` 数组、文章导航跳转及目标页 `h1` 检查。`pageErrors: []`，runner 退出码 `0`。
3. 再实际 GET 查询云端 build/session，并通过已连接的 BrowserStack 插件 `listSessions` 交叉确认状态 `passed`。

| 字段 | 云端核对结果 |
| --- | --- |
| Build | `local-smoke-2026-11-01` |
| Build ID | `2172921633c23adf38a27f045352d81babc55a4a` |
| Session ID | `2409aba28c1580c66750ab9c6c5351ca6dc2940e` |
| 实际平台 | `OS X` / `Sequoia` |
| 实际浏览器 | `playwright-chromium`，Playwright 返回 `153.0.8010.12` |
| 云端状态 | `passed`，会话持续 `14` 秒 |
| 本地目标 | `http://127.0.0.1:4173`，已有生产预览构建 |

当前 runner 请求默认 `Windows` / `11`，云端实际回报 macOS Sequoia；本轮未确定这一差异的原因，也未修改运行矩阵。不将这条通过记录计为 Windows、Safari、Firefox、iPhone 或 Android 验证。会话结束后 runner 关闭浏览器并停止 Local 隧道。

## 清理与复测

- 卸载临时 Vue 组件、移除测试按钮节点和探针监听器，确认原应用仍挂载且首页标题可见。
- 本轮没有把测试按钮写入源文件，没有重建 `frontend/dist`；5173 的开发环境已启用 Sentry，4173 仍运行上一轮默认关闭监测的构建，两者不能混为同一个监测配置。
- 16:49:39 重新加载开发站复测：测试按钮数 `0`、首页标题可见、真实文章 API HTTP `200` 且包含 `items` 数组、`pageErrors: []`，随后关闭本轮专用 Playwright 浏览器。
- 16:50 检查：5173、4173、8000 服务仍监听；未发现 BrowserStack Local 遗留进程；`.env.local` 仍被 Git 忽略且权限为 `0600`。扫描当前 16 个待提交文件，未发现本地四项凭证/DSN 的实际值；`git diff --check` 通过。本轮未改产品源码，不重复运行已在第 25 轮通过的全套构建和单元测试。

## 原始证据

- `output/quality/sentry-cloud-browser.json`：测试标记、event ID、响应状态和 flush 结果。
- `output/quality/sentry-cloud-event.json`、`sentry-cloud-issue.json`：只读 API 核对摘要，不包含 raw stack、用户信息或凭证。
- `output/quality/sentry-production-issues.json`：明确记录 project、环境、24h 窗口和空结果。
- `output/quality/sentry-cloud-cleanup.json`：临时组件移除、原应用挂载与首页标题检查。
- `output/quality/cloud-final-recheck.json`、`output/playwright/sentry-cloud-final-recheck.js`：清理后重新加载页面与真实接口的复测结果和可重复脚本。
- `output/quality/browserstack-2026-11-01T08-43-25-369Z/summary.json`、`cloud-verification.json`：runner 和云端查询摘要。

## 完成项、未决项与下一步假设

- 已完成：BrowserStack 本地配置与真实远程冒烟测试；Sentry 开发环境真实收件、exact event/issue 查询；目标 production 环境实际查询；临时测试组件清理。
- 未决：BrowserStack 请求平台与实际平台差异；真实移动设备和其他浏览器；Sentry 生产构建环境、release/source maps、生产收件及 Vue 上下文专项验证。第 25 轮记录的 axe 违规和依赖告警仍待处理。
- 下一轮唯一优先假设：先核对 BrowserStack 对当前 Playwright 浏览器类型的能力参数，并将请求平台与实际平台纳入一致性检查，才能让跨平台通过记录具有可解释性。本轮不自行扩大云端测试矩阵。
