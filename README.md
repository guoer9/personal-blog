# GUOER · Field Notes

一个基于 Vue 3 + FastAPI + PostgreSQL 的个人博客与内容管理系统。本次二次开发保留了原有文章、标签、搜索、评论、认证、上传和后台能力，并重新划分公共展示、动效与内容系统之间的边界。

## 你会看到什么

- 原创暖纸色、墨黑、酸橙绿和电蓝视觉系统。
- 首页 Three.js 装饰场景、滚动揭示与原生页面阅读。
- 文章归档、搜索、标签页、文章详情、关于页和 404。
- 完整后台：文章编辑、标签、评论与文件管理；私密入口为 `/admin/login`。
- 公开前台不显示登录、注册或账户入口，`/login` 不再存在。
- WebGL 不可用或开启减少动态效果时，仍然完整可读的静态版本。

`lusion.co-ddw/` 是本地研究资料，已被 Git 忽略。它不参与构建，项目也不复制其中的模型、音频、原始着色器、文案或设计资产。

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

动效实现与验收记录见 [docs/implementation/2026-10-31-lusion-motion.md](docs/implementation/2026-10-31-lusion-motion.md)。

`liquidScene.ts` 当前是原创二十面体顶点形变和线框叠层的轻量场景，不包含参考项目的 ping-pong 纹理模拟，也没有复制参考站页面或引擎代码。

## 技术栈

- 前端：Vue 3、TypeScript、Vue Router、Pinia、Element Plus、Three.js、Vite、Vitest。
- 后端：FastAPI、SQLAlchemy 2.0 异步模式、PostgreSQL、Alembic、JWT。
- 部署：Nginx + Systemd；本地数据库由 Docker Compose 提供。

## 快速开始

### 环境要求

- Python 3.11+
- Node.js 18+
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

## 已验证结果

- v1.2 基线计划见 [2026-11-01-blog-v1.2.md](docs/superpowers/plans/2026-11-01-blog-v1.2.md)；冻结基线见 [16-v1.2-baseline-freeze.md](docs/research/16-v1.2-baseline-freeze.md)，最终验收见 [23-v1.2-release-acceptance.md](docs/research/23-v1.2-release-acceptance.md)。
- 前端单元测试 `13` 个文件、`59` 项通过；类型检查、生产构建和公共入口包体积门禁通过。后端使用仓库虚拟环境测试为 `13` 项通过。
- 最终三次构建均得到公共主 JS `154,485 B`（gzip level 9 `60,288 B`）、全局 CSS `6,226 B`（gzip level 9 `2,253 B`）、`liquidScene` `526,771 B`（Vite gzip `132.18 kB`）。主 JS gzip 比 Task 5 少 `10 B`，原 `+1 B` 风险已消除；必要错误修复的原始体积增加 `12 B` 单独保留。
- 最终本地性能覆盖首页/归档/文章 × 两视口 × 三次，共 `18` 个冷上下文样本；首页 LCP 中位数为桌面 `1,276 ms`、移动 `1,272 ms`，INP candidate 为 `48 ms`、`56 ms`。归档/文章 LCP 中位数也均低于 `2,500 ms`；桌面首页两条超过 `200 ms` 的长任务仍待归因。
- 发布验收覆盖 `10` 条公共路线 × `3` 种动态偏好，共 `30/30` 个场景；横向溢出和非预期错误均为 `0`，公共路线没有加载 Element Plus 资源。后台文章创建/编辑/删除、上传、标签、认证成功/失败、空表单和退出登录均已复测。修复闭环见 [24-v1.2-review-closure.md](docs/research/24-v1.2-review-closure.md)。
- 减少动态效果、WebGL 失败、手动暂停、离屏停帧、合成隐藏事件、路由卸载和键盘焦点路径均已验证；真实后台标签页功耗、Safari/Firefox、真实设备和生产网络仍未验证。
- v1.2 开发验收为 `PASS WITH RESIDUAL RISK`：功能和包体积门禁通过，长任务来源及真实环境仍有限制；不把本地预览结果写成生产承诺。

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
├── deploy/                       # Nginx、Systemd 与部署脚本
├── docs/implementation/          # 本次重建的实现记录
├── docker-compose.yml
└── README.md
```

## 当前部署约定
- 本地 PostgreSQL 由 `docker-compose.yml` 提供，主机端口是 `5433`。
- 生产环境使用 Nginx + Systemd；生产环境变量由服务器上的 `/etc/personal-blog/blog-api.env` 提供。
- `deploy/nginx.conf.template` 和 `deploy/deploy.sh` 不包含具体域名、证书或生产密钥。部署时通过 `DOMAIN` 和 `CERT_EMAIL` 注入当前有效域名。
- 旧域名和旧证书不会作为项目配置保留。更换域名时，需要同步配置 DNS、CORS、前端 API 地址和 Certbot。

生产环境变量至少需要：

```dotenv
DATABASE_URL=postgresql+asyncpg://bloguser:<password>@localhost:5432/blogdb
SECRET_KEY=<openssl rand -hex 32 生成的密钥>
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=30
REFRESH_TOKEN_EXPIRE_DAYS=7
CORS_ORIGINS=["https://your-domain.example","https://www.your-domain.example"]
UPLOAD_DIR=/var/www/blog/backend/uploads
MAX_UPLOAD_SIZE=10485760
ENVIRONMENT=production
```

## 部署
### 服务器要求

- Ubuntu 20.04+ / Debian 11+
- 1GB+ RAM
- 公网 IP 和域名

### 部署步骤

1. 配置域名解析，将域名 A 记录指向服务器 IP

2. 上传代码到服务器
```bash
scp -r personal-blog/ user@your-server:/var/www/blog/
```

3. 修改配置文件
```bash
# 创建服务器管理的后端生产环境配置
sudo install -d -m 750 /etc/personal-blog
sudoedit /etc/personal-blog/blog-api.env

# 设置当前有效域名和证书邮箱后执行部署脚本
DOMAIN=your-domain.example CERT_EMAIL=admin@your-domain.example \
  sudo -E ./deploy.sh
```

4. 运行部署脚本
```bash
cd /var/www/blog/deploy
chmod +x deploy.sh
sudo ./deploy.sh
```

### 手动部署

参考 `deploy/deploy.sh` 脚本中的步骤手动执行。

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
### 创建管理员账号

1. 先通过网页注册一个普通用户
2. 使用 psql 连接数据库，更新用户为管理员：

```sql
UPDATE users SET is_admin = true WHERE username = 'your-username';
```

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
