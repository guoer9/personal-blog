# GUOER · Field Notes

一个基于 Vue 3 + FastAPI + PostgreSQL 的个人博客与内容管理系统。本次二次开发保留了原有文章、标签、搜索、评论、认证、上传和后台能力，并重新划分公共展示、动效与内容系统之间的边界。

当前版本 **v1.3.0**，已合并至 `main`，后续直接在主分支继续开发。先读 [文档入口](docs/README.md)，上线前按 [上线准备清单](docs/release-readiness.md) 验收；版本记录见 [CHANGELOG.md](CHANGELOG.md)。

## v1.3 更新

- 多工作区 Notion 连接：在后台填写连接名称和密钥，浏览有权限的页面与数据库，预览、确认导入并手动同步。
- 公开资料库：列表、搜索、分类、分页和详情，保留常用 Notion 内容块格式与稳定图片快照。
- 统一文章管理：手写与 Notion 文章共同展示作者、标签、评论数、阅读量、公开链接和原文链接，支持下架。
- 共用评论表：两种文章均支持评论和回复；同步保留统计和评论，管理员可管理下架文章的评论。
- 作品发布与私有文件库：素材上传、续传、草稿、预览、发布更新、下架和回收恢复。
- 登录用户临时传输、搜索改进，以及本地浏览器、可访问性和构建质量检查脚本。

新版本优先使用独立本地环境：API `127.0.0.1:8001`、数据库 `127.0.0.1:5544`，启动和验收步骤见 [scripts/local/README.md](scripts/local/README.md)，Notion 接入见 [scripts/local/NOTION.md](scripts/local/NOTION.md)。本地密钥、数据库、私有媒体与验收截图不随源码发布。

## 你会看到什么

- 原创暖纸色、墨黑、酸橙绿和电蓝视觉系统。
- 首页 Three.js 装饰场景、滚动揭示与原生页面阅读。
- 文章归档、搜索、标签页、文章详情、关于页和 404。
- 完整后台：文章编辑、标签、评论与文件管理；私密入口为 `/admin/login`。
- 公开前台不显示登录、注册或账户入口，`/login` 不再存在。
- WebGL 不可用或开启减少动态效果时，仍然完整可读的静态版本。

`ddw/` 和 `lusion.co-ddw/` 是本地研究资料，已被 Git 忽略。它们不参与构建，项目也不复制其中的模型、音频、原始着色器、文案或设计资产。

## 架构

```text
public UI (Vue views/components)
       ├── portfolio.ts      静态、可编辑的个人展示数据
       ├── immersive/        DOM 动效、画布生命周期与海报后备
       └── graphics/         Three.js 场景 + GLSL + 动效数学
                    │
                    ▼
REST API (FastAPI) → PostgreSQL
       ├── posts / tags / search / comments
       ├── auth / uploads
       └── admin authorization
```

公共博客层和后台内容系统共享同一套 API 与认证，但职责分开：

- `frontend/src/data/` 只保存可替换的个人信息与作品入口，文章正文继续存在数据库。
- `frontend/src/components/immersive/` 管理 DOM 动效、画布生命周期和静态后备。
- `frontend/src/graphics/` 管理 WebGL 渲染与纯数学函数，不依赖参考目录。
- `frontend/src/components/blog/` 放可复用的文章行和页面状态。
- `backend/app/` 继续提供文章、搜索、评论、标签、上传与认证接口。

## 编辑个人信息与项目

打开 [portfolio.ts](frontend/src/data/portfolio.ts)：

- `profile`：名称、角色、介绍、地点、状态和工作原则。
- `projects`：首页项目卡的标题、描述、技术栈与链接。站内路径使用 `href`，外部链接同时设 `external: true`。
- `resources`：归档、关于、搜索等公开入口。
- `navigation`：顶部主导航。

当前只写入已知身份信息：名称 `GUOER`，地点 `Shanghai, CN`。邮箱、GitHub、客户、奖项和真实外链在你提供并确认之前不应编造。

## 动效和降级

首页画布由 `ImmersiveScene.vue` 延迟创建，Three.js 模块只在确实需要 WebGL 时加载。页面按 `idea → writing → projects → signal` 四阶段推进，场景的形体、尺度、旋转和情绪随整页阅读进度变化；浏览器继续负责原生滚动。

- 页面离开或画布离屏时停止动画。
- 标签页隐藏时暂停渲染。
- `prefers-reduced-motion: reduce` 直接呈现静态海报，不加载 Three.js。
- WebGL 初始化失败会捕获异常并保留同一张静态海报。
- 设备像素比最高为 `1.75`，指针数值经过边界限制和与帧率无关的阻尼。
- 场景可以手动暂停和恢复，选择保存在 `localStorage['field-notes:motion-paused']`。
- 项目卡使用有阻尼的倾斜、光场和回归动效；触控设备与减少动态模式关闭倾斜。
- 磁性链接保留正常键盘与触控点击，精细指针才参与位移动效。

动效实现与验收记录见 [docs/implementation/2026-10-31-lusion-motion.md](docs/implementation/2026-10-31-lusion-motion.md)。后续开发上下文和文档状态见 [docs/README.md](docs/README.md)。

`liquidScene.ts` 当前是原创二十面体顶点形变和线框叠层的轻量场景，不包含参考项目的 ping-pong 纹理模拟，也没有复制参考站页面或引擎代码。

## 技术栈

- 前端：Vue 3、TypeScript、Vue Router、Pinia、Element Plus、Three.js、Vite、Vitest。
- 后端：FastAPI、SQLAlchemy 2.0 异步模式、PostgreSQL、Alembic、JWT。
- 部署：Nginx + Systemd；本地数据库由 Docker Compose 提供。

## 快速开始

### 环境要求

- Python 3.11+
- Node.js 22.19+（含本地质量工具）
- PostgreSQL 14+，或使用仓库内的 Docker Compose

### 启动数据库

```bash
docker compose up -d postgres
```

本地数据库映射到主机端口 `5433`。

### 启动后端

```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# 编辑 backend/.env；本地示例已使用 docker-compose 的数据库配置
alembic upgrade head
uvicorn app.main:app --reload --port 8000
```

### 启动前端

另开终端：

```bash
cd frontend
npm install
npm run dev
```

访问：

- 前端：<http://localhost:5173>
- 后端 API：<http://localhost:8000>
- API 文档：<http://localhost:8000/docs>

## 常用命令

```bash
# 前端单元测试
npm --prefix frontend run test

# 前端类型检查与生产构建
npm --prefix frontend run build

# 公共入口包体积门禁
npm --prefix frontend run check:bundle

# 后端编译与测试
python3 -m compileall -q backend/app
python3 -m pytest -q

# 完整基线检查（标记检查、构建、后端编译和测试）
./scripts/check-repository-baseline.sh

# 查看未提交差异
git diff --check
```

## 最近一次本地基线

- 最近一轮本地 Notion、统一文章、评论和公开索引验收记录见 [34](docs/research/34-notion-workspace-ui-acceptance.md)、[35](docs/research/35-unified-article-comments-acceptance.md) 和 [36](docs/research/36-public-article-index-acceptance.md)。这些记录保留当时环境和限制，不能替代发布前重跑。
- 当前应重新执行 [上线准备清单](docs/release-readiness.md) 中的命令；历史测试数字已经移入 [归档](docs/archive/README.md)。
- 更新已有实例前必须备份数据库和文件目录，再使用目标实例环境执行 `alembic upgrade head`。

旧版 v1.2 计划、研究和验收记录见 [历史归档](docs/archive/README.md)。归档内容只用于追溯，不作为当前发布结论。

## 项目结构

```text
personal-blog/
├── frontend/
│   ├── public/favicon.svg
│   ├── src/
│   │   ├── api/                  # API 请求
│   │   ├── components/
│   │   │   ├── blog/             # 公共文章条目与状态
│   │   │   ├── immersive/        # 动效组件、WebGL 生命周期与后备
│   │   │   └── navigation/
│   │   ├── data/portfolio.ts     # 个人信息、项目与资源
│   │   ├── graphics/             # Three.js、GLSL 与纯数学函数
│   │   ├── layouts/              # 公共与后台布局
│   │   ├── router/               # 路由、标题和滚动恢复
│   │   ├── stores/               # 认证状态
│   │   ├── views/blog/           # 首页、归档、搜索、标签、文章、关于、404
│   │   └── views/admin/          # 后台页面
│   └── vite.config.ts
├── backend/
│   ├── app/
│   │   ├── api/                  # API 路由
│   │   ├── core/                 # 配置与安全
│   │   ├── crud/                 # 数据库操作
│   │   ├── db/                   # 数据库配置
│   │   ├── models/               # 数据模型
│   │   └── schemas/              # Pydantic 模式
│   └── alembic/                  # 数据库迁移
├── deploy/                       # Docker Compose、Nginx、Systemd 与部署脚本
├── docs/                         # 当前开发上下文、上线门禁与历史归档
├── docker-compose.yml
└── README.md
```

## 当前部署约定
- 本地 PostgreSQL 由 `docker-compose.yml` 提供，主机端口是 `5433`。
- 生产环境使用 Docker Compose，PostgreSQL、FastAPI 和前端 Nginx 运行在同一台服务器；宿主机 Nginx 只负责后续域名反向代理。
- 生产环境变量由服务器上的 `deploy/.env.production` 提供；数据库数据、私有资料、公开媒体、上传文件和临时传输目录保存在 `deploy/data/`。
- PostgreSQL 通过服务器生成的证书启用 SSL，API 使用 `ssl=require` 连接；Notion 凭据保存在服务器 `deploy/secrets/notion-connections.json`，不会进入 Git 或数据库。
- 当前部署方案、管理员初始化、更新、备份与域名反代步骤见 [`deploy/README.md`](deploy/README.md)。

生产环境变量至少需要：

```dotenv
POSTGRES_USER=blog
POSTGRES_DB=personal_blog
POSTGRES_PASSWORD=<服务器生成的随机密码>
SECRET_KEY=<openssl rand -hex 32 生成的密钥>
CORS_ORIGINS=["http://39.96.212.169:8080","https://guoer9.me","https://www.guoer9.me"]
ENVIRONMENT=production
```

## 部署
### 服务器要求

- Ubuntu 20.04+ / Debian 11+
- 1GB+ RAM
- 公网 IP 和域名

### 部署步骤

1. 配置域名解析，将域名 A 记录指向服务器 IP。当前 Docker 入口先使用 `http://39.96.212.169:8080`。

2. 在服务器部署 Docker Compose
```bash
mkdir -p /srv
git clone --branch main --single-branch https://github.com/guoer9/personal-blog.git /srv/personal-blog
cd /srv/personal-blog
chmod +x deploy/*.sh
./deploy/bootstrap-server.sh
```

3. 填写服务器管理员密码并初始化
```bash
sudoedit /srv/personal-blog/deploy/.env.production
cd /srv/personal-blog
docker compose --env-file deploy/.env.production \
  -f deploy/compose.production.yml run --rm --no-deps api \
  python -m app.production_admin
```

4. 通过 [`deploy/README.md`](deploy/README.md) 的域名反代步骤接入 `guoer9.me`；HTTPS 证书在 DNS 和 80 端口确认后单独配置。

## 环境变量
### 后端 (.env)

| 变量 | 说明 | 示例 |
|------|------|------|
| DATABASE_URL | 数据库连接 | postgresql+asyncpg://user:pass@localhost/db |
| SECRET_KEY | JWT 密钥 | 使用 `openssl rand -hex 32` 生成 |
| CORS_ORIGINS | 允许的跨域来源 | ["http://localhost:5173"] |
| UPLOAD_DIR | 文件上传目录 | uploads |
| MAX_UPLOAD_SIZE | 最大上传大小 | 10485760 (10MB) |

## 常见问题
### 初始化管理员账号

生产环境使用 `deploy/README.md` 中的 `app.production_admin` 命令，通过服务器环境文件创建或更新管理员。自助注册默认关闭；不要再通过网页注册后手工改数据库权限。独立本地环境的管理员初始化见 [scripts/local/README.md](scripts/local/README.md)。

### 数据库迁移

```bash
# 生成迁移
alembic revision --autogenerate -m "description"

# 应用迁移
alembic upgrade head

# 回滚
alembic downgrade -1
```

## License
MIT
