# 本地审计与云端观测工具接入

## 范围与方案

- 日期：2026-11-01（Asia/Shanghai）；沿用 `codex/blog-v1.2`。
- 用户授权安装 Lighthouse、axe-core、BrowserStack 和 Sentry；本轮新增要求读取近期生产错误。
- 本地审计依赖仅用于开发；Sentry Vue SDK 按配置懒加载，未启用时不发送事件。BrowserStack 通过 Playwright 和 Local 隧道访问本地站点。
- 配置样例不包含密钥。实际配置放在 Git 忽略的 `frontend/.env.local`；BrowserStack Access Key 和 Sentry Auth Token 不使用 `VITE_` 前缀。
- 不创建研究目标或 token budget，不执行部署，不复制参考站素材。

## 执行步骤与验证门禁

1. 安装并锁定开发依赖：Lighthouse、chrome-launcher、axe-core 的 Playwright 集成、Playwright、BrowserStack Local；安装 Sentry Vue SDK。
2. 提供 Lighthouse HTML/JSON 报告命令和桌面/移动公共页面 axe 扫描命令；实际执行并保存原始报告，不将已存在的页面问题当作安装失败或自动忽略。
3. 提供 BrowserStack 本地隧道与远程冒烟测试命令；缺少凭证时在联网前明确退出，保留不启动云端会话的配置检查模式。
4. 先测试 Sentry 默认关闭、缺少 DSN、不阻塞应用和配置正确时初始化的行为，再实现 SDK 接入。
5. 类型检查、单元测试、生产构建、包体积检查和本地页面复测；只有云端实测后才记录“云端已验证”。

## 官方证据

- 本轮通过 Context7 查询 Sentry 官方文档、BrowserStack 官方文档、Lighthouse 官方仓库；axe 集成方式核对 Playwright 官方 accessibility-testing 文档。
- 当前 Node `22.20.0`；npm 返回 Lighthouse `13.6.0` 的引擎要求为 Node `>=22.19`，与本机兼容。
- Sentry 插件已安装，查询技能要求 `SENTRY_AUTH_TOKEN`；本轮开始时环境和项目已知配置文件中没有发现 Sentry/BrowserStack 配置项。可调用工具清单中尚未出现两项服务的云端查询工具；插件目录检索也没有返回匹配项。这不等于用户未在其他入口完成连接。
- 随后 BrowserStack 官方工具出现在本会话，已成功调用其自动化接入工具；工具返回配置步骤，不提供本机访问密钥。采用其官方文档支持的 `chromium.connect` + BrowserStack Local 方式，未额外引入测试框架或执行含密钥参数的 setup 命令。
- Sentry `11.10.0` 类型定义已用 `dataCollection` 替换旧文档的 `sendDefaultPii`。首次类型检查准确检出不匹配；按已安装 SDK 的类型修正配置，并增加真实 SDK 本地传输验证。没有把过时的通用文档片段直接当作版本事实。
- `frontend/node_modules/node_modules` 是指向同一依赖目录的自引用链接，使 npm 错报全部依赖缺失；仅删除该链接后，`npm ls --depth=0` 正常，现有依赖完整。

## 复测结果

### 安装、配置与构建

| 工具 | 锁定版本 | 实际状态 |
| --- | --- | --- |
| Lighthouse | `13.6.0` | Node API 可运行，桌面和移动报告均已生成 |
| chrome-launcher | `1.2.2` | 使用已安装的 Google Chrome，无需重复下载浏览器 |
| @axe-core/playwright / axe-core | `4.14.0` | 5 条公共路线 × 2 个视口，全部完成扫描 |
| Playwright | `1.64.1` | 本机 Chrome `156.0.8078.74` 正常运行 |
| BrowserStack Local | `1.5.16` | 已安装；配置检查和缺少凭证时提前退出已验证，云端会话未运行 |
| @sentry/vue | `11.10.0` | 已接入可选初始化，真实 SDK 本地拦截测试通过；云端收件尚未验证 |

- 前端 `14` 个测试文件、`63` 项测试通过，包含新增的 4 个 Sentry 行为测试。先观察到初始化和容错两例失败，再实现；修正 SDK 11 配置前也观察到预期的断言失败。
- 类型检查和生产构建通过；最终公共主 JS `155,318 B`，gzip level 9 `60,656 B`，全局 CSS gzip `2,253 B`，现有包体积门禁通过。相对上一轮最终主 JS gzip `60,288 B` 增加 `368 B`，没有冒称零增长。
- Sentry 默认关闭；真实浏览器确认其核心 SDK chunk 请求为 `0`，envelope 请求为 `0`。在单独的临时构建中启用虚拟 DSN，SDK 成功捕获 `quality-sentry-local-smoke`；上报请求完全在本地拦截，未发送至 Sentry。
- 临时启用测试验证环境 `quality-smoke`、release `quality@local` 正确，并确认测试用 Cookie 值、URL 查询值和自动用户信息不进入事件。临时预览已关闭，标准 `frontend/dist` 保留默认关闭配置。
- 另加真实浏览器反例：挂起 SDK 核心 chunk 时，旧版 await 初始化使首页 `h1` 在 1000 ms 内不可见，观察到预期失败；最终入口改为非阻塞启动 SDK。代价是 SDK 准备好之前的极早期错误可能无法采集，不把可选监测的下载作为页面渲染门禁。
- 本地前端开发端口 `5173`、生产预览端口 `4173` 和后端 `8000` 已恢复；生产预览的真实文章 API 返回 `200`。
- 已有依赖版本未被升级。npm audit 返回 `22` 项告警（`9 moderate / 13 high`），涉及既有依赖及 Lighthouse 的部分开发依赖；原始报告单独保留。未执行 `audit fix --force` 或将这些告警算作已修复。

### 真实页面审计

| 检查 | 结果 | 结论边界 |
| --- | --- | --- |
| axe 桌面 `1440×900@1`、移动 `390×844@2`，reduced motion | 10 个场景均生成报告；共有 2 类违规，按页面/视口计 12 条 | 扫描正常完成，命令因真实违规返回 `1`，不属于全部通过 |
| 首页标识 `.brand` | `label-content-name-mismatch`；可见 `G/ GUOER`，标签仅为“返回首页” | 既有问题，定位于 `src/components/navigation/SiteHeader.vue`；待专门修复与复测 |
| 关于页 `.sidebar-index a.active` | 小字对比度 `4.09:1`，低于 `4.5:1` | 前景 `#3767ff`、背景 `#f4f1ea`；定位于 `src/views/blog/About.vue`；待专门修复与复测 |
| Lighthouse 桌面首页 | Performance `85`、Accessibility `100`、Best Practices `100`、SEO `91` | 单次本地生产预览采样；不代表线上或多样本性能验收 |
| Lighthouse 移动首页 | Performance `83`、Accessibility `100`、Best Practices `100`、SEO `91` | 单次默认移动模拟；不等于真实手机测量 |

Lighthouse 的首页可访问性满分与 axe 发现的问题并不等价：两者运行规则集、页面范围及评分方式不同，不以任一分数覆盖具体违规或人工检查项。本轮保留原有页面设计，未通过忽略规则把扫描改成绿色。

上述 Lighthouse 数据采于安装阶段、最后一次启动顺序修正之前，作为工具可运行的初始样本保留；未将它们标作最终提交的性能验收。启动顺序修正后另行完成生产构建、包体积、单元测试和 SDK 浏览器复测。

### 云端状态

- 用户随后填入了 Sentry Auth Token。本轮实际 GET 查询该组织的项目列表，返回 HTTP `200`，当前 Token 可见项目为 `[]`。已将用户给出的组织 slug 写入本地私密配置；没有记录 onboarding run code。
- 尚未选定 Sentry 项目、填入项目 DSN 或收到真实云端事件。未执行项目 issues 查询，因此不能汇总“Top 生产错误”，也不能把项目列表为空写成生产零故障。
- 已向用户说明创建 Vue 项目、确认 project slug、查找 Client Keys (DSN) 的步骤。查询 Token 和 SDK DSN 分别用于读取和上报，不可互换。
- BrowserStack 插件工具可调用；本地访问密钥仍未配置，未启动计费或试用云端测试会话。

### 原始证据与复现

- `output/quality/axe-2026-11-01T07-47-47-540Z/`：10 个完整扫描结果及 summary。
- `output/quality/lighthouse-desktop-2026-11-01T07-48-40-643Z/`：桌面 HTML/JSON。
- `output/quality/lighthouse-mobile-2026-11-01T07-49-21-440Z/`：移动 HTML/JSON。
- `output/quality/sentry-local-smoke.json`、`sentry-smoke.mjs`、`sentry-smoke-build.log`：真实 SDK 的本地拦截验证与临时构建记录。
- `output/quality/npm-audit.json`：依赖告警原始输出；不是一次安全修复。
- 持久化操作说明见 `frontend/README.md`；配置样例见 `frontend/.env.example`，真实值只保存在 Git 忽略的 `frontend/.env.local`。

## 未决项与下一步

2026-11-01 后续进展：真实 DSN 与 BrowserStack runner 凭证已就绪；Sentry 开发环境收件及 BrowserStack 单会话冒烟测试已在云端验证。具体证据、实际平台差异和结论边界见 `26-cloud-tooling-verification.md`。下列内容保留为本记录当时的门禁状态。

- 本地安装和执行入口已完成；云端验证尚未完成。
- 下一步唯一优先项：创建/选定实际 Sentry Vue 项目并配置其 slug、DSN，然后在 development 环境确认一条真实测试事件，再查询目标 production 环境。当前项目列表为空，不能以本地模拟通过代替云端闭环。
- BrowserStack 密钥配置后，运行 `browserstack:check` 和 `test:browserstack`；真实移动设备、Safari/Firefox 和跨设备视觉验证仍待独立安排。
- 已记录的两类 axe 违规及 npm 依赖告警仍未修复，不将本地工具安装完成扩大为产品验收通过。
