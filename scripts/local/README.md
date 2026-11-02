# 本地作品站开发模板

当前只运行在本机。未来目标为 Ubuntu；本模板不连接云服务器，也没有 AI 对话代理。

## 启动

安装 Docker Desktop、Node.js 22、Python 3.13；Python 环境按仓库后端 requirements 安装。本仓库已有 `backend/venv` 可直接使用。

```bash
backend/venv/bin/python scripts/local/dev.py start
npm --prefix frontend ci
BLOG_API_PROXY=http://127.0.0.1:8001 npm --prefix frontend run dev -- --host 127.0.0.1 --port 5173
```

本地 API 为 `http://127.0.0.1:8001`，独立数据库监听 `127.0.0.1:5544`，Docker 项目名 `blog-local`。不会复用或重置原来的 `blog-postgres`/`blog_postgres_data`。

管理入口 `/admin/login`。用户名和随机密码保存在项目根目录 `.env.local-workspace`，权限0600，已被 Git 忽略。启动不会重置已存在的管理员密码。请在本地编辑器查看该文件，不把密码贴到聊天、截图或仓库。

## 内容维护闭环

1. 管理端“私有文件库”：创建文件夹、上传原件。8MiB分片，暂停或刷新后重新选择原文件续传；恢复会核对文件名、大小、类型及首/中/尾抽样 SHA-256。它不是整文件内容哈希，服务端主要核对分片长度和完整性。
2. “作品管理”新建作品，填写标题、英文短链、分类、简介、标签、说明、精选和排序；短链创建后固定。
3. 先把封面与网页播放版本上传到私有库，再从编辑页选择素材并“准备发布”。仅创建独立发布副本，不公开私人目录。
4. 保存草稿 → 预览 → 发布。修改已发布内容时，保存草稿不会覆盖公开版本，需“发布更新”。多页面版本冲突会拒绝覆盖。
5. 下架后公开列表和详情消失，未被其他已发布作品引用的素材返回404；已被访客保存到本地的内容无法撤回。

## Notion 多连接资料库

打开后台 `/admin/notion`，在“添加 Notion 连接”填写**连接名称 + 密钥**即可添加多个工作区。验证成功后自动选择连接，再点“浏览工作空间”查看该密钥有权限的页面和数据库；选择内容、预览、勾选公开确认后导入。公开入口为 `/documents`，来源支持手动同步。

密钥只保存在本机 `.secrets/notion-connections.json`（`0600`），提交后密码框清空。Compose 将 `.secrets` 目录可写挂载，用于后台原子保存新连接；凭据不进入业务数据库或镜像。应用启动不会访问 Notion。

结构化正文保留常用 Notion 格式，托管图片保存稳定快照，HEIC 自动转 JPEG。具体使用方法、接口、权限、格式限制和浏览器验收命令见 [`NOTION.md`](NOTION.md)。

支持封面 JPEG/PNG/WebP（10MiB以内）、H.264/AAC MP4、AAC/M4A和MP3；单个发布副本最多512MiB。MOV原件可以存私有库，但不能直接用作网页播放素材。首版不在表单保存请求中执行视频转码，不具备异步转码队列、字幕编辑、多清晰度或云对象存储。

文件下载在 Chrome/Edge 的安全上下文可流式保存；不支持该能力的浏览器采用有上限的小文件下载，避免将数GB文件整体放进浏览器内存。私人回收站可以恢复，目前不提供永久清空，仍占私有配额。发布副本另计容量，默认10GiB（`WORK_ASSET_QUOTA_BYTES`），包含未引用副本与临时文件；作品管理可清理超过24小时且不被任何草稿或公开版本引用的副本。准备、引用写入和清理共用本地文件锁，容量不足明确拒绝继续复制。

## 首批真实作品导入

`frontend/src/data/initial-works.json` 是显式导入输入，前台运行时不会读取它作为后备。新卡片与修改均通过管理API；应用启动不自动导入。

本机已有导出媒体时：

```bash
backend/venv/bin/python scripts/local/import_works.py
```

默认只保存草稿。需要导入并公开到这个本地实例时，显式加 `--publish`。已发布记录会保留，重复运行不会覆盖后台修改。导入进度在忽略目录 `output/research-profile/`，不记录令牌。

媒体导出：准备与研究盘点结构一致的 JSON manifest，包含 `items[].id/category/sourcePath/format.duration`，再运行：

```bash
backend/venv/bin/python scripts/media/export_works.py --manifest /绝对路径/media-inventory.json
```

输出位于被忽略的 `backend/public-media/works/`。源文件不改写；导出的是720p H.264/AAC播放文件，音乐另有M4A；封面时间点见 `scripts/media/cover-times.json`。`--refresh-covers` 仅重新选取封面，不重新压制已验证的视频。

## 固定构建验收

```bash
npm --prefix frontend test
npm --prefix frontend run build
npm --prefix frontend run check:bundle
BLOG_API_PROXY=http://127.0.0.1:8001 npm --prefix frontend run preview -- --host 127.0.0.1 --port 4182 --strictPort
LOCAL_FRONTEND_URL=http://127.0.0.1:4182 node scripts/local/verify-workflow.mjs
backend/venv/bin/python -m pytest -q
```

浏览器脚本使用本机 Chrome，覆盖分类、播放器、未预载媒体、移动视口、后台草稿/预览/发布更新/下架、真实封面和音频选择/受限预览/Range/下架、暂停刷新续传、下载内容哈希、重命名和回收恢复。每次会留下两份已下架验收草稿和一个合成测试文件夹，以便复核；之前失败尝试也可能留下未发布草稿。证据仅写本地忽略目录。测试时不要重建正在读取的 dist，避免热更新/文件替换干扰测量。

浏览器验收成功后，可运行 `backend/venv/bin/python scripts/local/verify_persistence.py`：只停止并重新启动 `blog-local`，比较公开作品、私有文件元数据及合成测试文件SHA-256。它不会触碰其他项目的容器。

## 数据与停止

`compose.local.yml` 使用独立具名卷保存数据库、私有原件、发布副本和公开文章附件。私有文件只通过认证API下载；发布副本也经过“是否被公开作品引用”检查，没有公开静态挂载。

```bash
backend/venv/bin/python scripts/local/dev.py status
backend/venv/bin/python scripts/local/dev.py cleanup
backend/venv/bin/python scripts/local/dev.py stop
```

cleanup仅清理过期/终止上传分片及已验证的遗留半成品，不清空原件或回收站。stop保留所有数据卷。备份边界是数据库＋私有卷＋发布卷＋公开附件卷；当前未搭建定时备份或实际恢复演练。不要把本地验证当成云服务器部署、容量压测或备份验收。
