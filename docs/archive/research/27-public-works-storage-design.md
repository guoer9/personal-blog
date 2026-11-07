# 公开作品站与私有文件库：设计及执行范围

## 本轮范围

2026-11-01，沿用 `codex/blog-v1.2`。用户将优先级调整为公开作品站和私有文件管理；私人 AI 页面及 Codex 接入暂停。按最新指示仅做本地实现与可重复验证，云服务器开发暂停。

## 证据

- E2（实现前观察）：`frontend/src/data/portfolio.ts` 曾为三张示意项目；首页已有项目卡片、原生导航和原创 Three.js 场景。最终已移除示意数组并切到作品API，见29、30号记录。
- E1（前一会话留存的脚本结果）：`output/research-profile/github-public-repos.json` 与各 README 核实 guoer9 的 money-agent、27-B-、personal-blog、math_M2025；仅核实公开文档和仓库结构，未运行这些项目。
- E1（前一会话 ffprobe 结果）：`output/research-profile/media-inventory.json`，四个 MOV 合计 2,823,284,058 字节；第一集 447.04 秒、第二集 1028 秒、我也想辍学 194.416667 秒、凌晨的雨 63 秒。后三个含 PCM 音频，不宜直接作为网页播放文件。
- E2：现有 `/uploads` 为公开附件目录，单文件 10MiB；不支持 MOV，不能承载私人文件库。保留既有文章附件兼容性，新增完全独立的私有路径。
- E2：DDW `lusion.co-ddw/decompiled-source/reconstructed-app/src/engine/ .js` 的 ProjectItem/List（33875/34114 起）、VideoOverlay（33138 起）、AudioItem（30827 起）、FooterSection（37293 起）说明数据驱动索引、点击加载播放、退出暂停、社交入口可独立于 WebGL 使用。本轮仅迁移这些机制，原创实现；未重新运行参考站交互。

## 方案与裁决

1. **采用现有 Vue/FastAPI/PostgreSQL，私有文件落独立数据目录**。云端可挂独立数据盘；无需增加另一套管理产品，先实现完整可用流程。S3、CDN 和异步转码服务保留扩展位置，不宣称已接通云对象存储。
2. 将全部文件塞入公开 uploads 会泄露原件且不能续传，放弃。
3. 首版引入独立网盘/CMS 和对象存储集群增加身份同步与维护成本，延后。以后容量和多机需求明确后再迁移存储驱动。

Ruling: 沿用用户已多次授权的继续开发范围，在现有分支推进，不再次索要相同批准。新增设计取舍明确记录于此；没有创建研究目标或设置 token budget。

## 公开作品站

- `/works` 是统一作品索引，URL 分类为全部、代码、影像、音乐；`/works/:slug` 是可分享的作品详情。
- 真实项目链接到 guoer9 对应公开仓库，描述依据 README，不编造效果、奖项、使用量。
- 四个用户媒体各有封面、时长、类型和详情。生成独立的 720p H.264/AAC MP4、音乐 AAC 播放版本及 JPEG 封面；原 MOV 不移动、不改写、不进入 Git。最终采用29号记录的作品发布API：独立副本通过 `/api/v1/work-assets/<id>` 在引用校验后提供，不挂载早期设想的 `/media/works/`。
- 原生 video/audio 控件、`preload="none"`、无自动播放；切换作品、离开页面或标签隐藏时停止播放。播放失败有重试和可用外站入口。不做未核实字幕或歌词。
- Bilibili 和 GitHub 为真实外链；抖音先提供昵称及账号复制，不链接 `/user/self`，不冒称二维码已验证。QQ/微信由用户授权展示，可复制且有失败提示。
- 首页保留当前视觉结构，示意项目替换为实际精选；增加影像与音乐入口。关于页和页脚接通社交信息。

## 私有文件库契约

管理员专用 `/admin/library`，现有认证复用。所有 `/api/v1/library` 路由要求管理员；私人数据目录不得位于 uploads/public-media 中，不挂静态路由。对象以随机 ID 存储，用户文件名仅作元数据；下载强制 attachment 和 nosniff。

API 约定（前后端并行实现时以此为准）：

- `GET /library/entries?parent_id=<uuid>&trash=false` → `{items: LibraryEntry[]}`，root 省略 parent_id；trash 列出回收站。
- `GET /library/status` → `{used_bytes, quota_bytes, max_file_bytes, chunk_size}`，used_bytes 包含回收站。
- `POST /library/folders` `{name,parent_id:null|string}` → LibraryEntry。
- `PATCH /library/entries/{id}` `{name?:string,parent_id?:null|string}` → LibraryEntry；拒绝移动文件夹到自己的后代。
- `DELETE /library/entries/{id}` → 204，软删除；`POST /library/entries/{id}/restore` → LibraryEntry。
- `GET /library/entries/{id}/download` → 认证附件下载，不能通过公开 URL 访问。
- `POST /library/uploads` `{name,size,mime_type,parent_id:null|string}` → UploadSession。
- `GET /library/uploads/{id}` → UploadSession；`PUT /library/uploads/{id}/parts/{index}` → 204（二进制，index 从 0 开始）。
- `POST /library/uploads/{id}/complete` → LibraryEntry，只有分片齐全、长度匹配才入库；重复完成幂等。
- `DELETE /library/uploads/{id}` → 204，取消并清理分片。

`LibraryEntry = {id:string,name:string,kind:'file'|'folder',parent_id:string|null,size:number,mime_type:string|null,created_at:string,deleted_at:string|null}`。
`UploadSession = {id:string,chunk_size:number,received_parts:number[],expires_at:string}`。

前端单次一个上传，8MiB 分片，暂停会终止当前请求；重新选择同一文件后核对指纹再续传。浏览器仅保存会话 ID 和文件指纹，不保存登录凭证副本或本地绝对路径。目录支持创建、打开、面包屑、重命名、移动、回收站及恢复。首版不实现永久清空和外链分享。

默认单文件 8GiB、总配额 50GiB；配置允许调整。上传临时文件与完成文件同盘，原子入库；失败不得出现可下载的半成品。上传会话有过期时间与清理入口。配额、并发完成、路径穿越、未登录访问是必须验证的边界。

## 本地模板与验收（按用户最新指示更新）

用户最新明确暂停云服务器开发；计划购买 Ubuntu、4核4GB、3M 带宽服务器。本轮仅准备本地 Docker 开发模板和独立数据目录验证，不编写或修改生产部署配置，不连接远程服务器。现有 Nginx/Systemd 基线保持，`blog_postgres_data` 不触碰。公共媒体与私人文件本地隔离；备份/迁移边界仅记录，待用户实际服务器准备后再实现云部署。

验收：前后端测试、类型与生产构建、公开包体积门禁；Playwright 检查作品分类/详情、键盘与移动视口、无媒体预下载、原生播放；后端验证认证、分片续传/校验、目录和回收站、隔离持久化。未实际部署的云能力单独列出。

## 下一步假设

唯一优先假设：在不加载原片且不增加公共 UI 库的条件下，原创作品索引与独立私有文件库足以连接“创作展示”和“素材管理”，并可通过本地端到端流程验证。
