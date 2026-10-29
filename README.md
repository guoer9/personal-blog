# 个人博客系统

一个基于 Vue 3 + FastAPI 的前后端分离个人博客系统。

## 功能特性

- **用户系统**：注册、登录、JWT 认证
- **博客功能**：文章发布、Markdown 编辑器、标签分类
- **评论系统**：支持嵌套回复
- **文件管理**：图片/文件上传下载
- **搜索功能**：文章全文搜索
- **管理后台**：文章、评论、文件、标签管理

## 技术栈

### 前端
- Vue 3 + Composition API
- TypeScript
- Vue Router 4
- Pinia
- Element Plus
- md-editor-v3
- Vite

### 后端
- FastAPI
- SQLAlchemy 2.0 (异步)
- PostgreSQL
- Alembic (数据库迁移)
- python-jose (JWT)
- passlib (密码加密)

## 快速开始

### 环境要求

- Python 3.11+
- Node.js 18+
- PostgreSQL 14+

### 后端设置

```bash
# 进入后端目录
cd backend

# 创建虚拟环境
python -m venv venv
source venv/bin/activate  # Linux/Mac
# venv\Scripts\activate   # Windows

# 安装依赖
pip install -r requirements.txt

# 配置环境变量
cp .env.example .env
# 编辑 .env 文件，设置数据库连接等

# 创建数据库
createdb blogdb

# 运行数据库迁移
alembic upgrade head

# 启动开发服务器
uvicorn app.main:app --reload
```

### 前端设置

```bash
# 进入前端目录
cd frontend

# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

### 访问应用

- 前端: http://localhost:5173
- 后端 API: http://localhost:8000
- API 文档: http://localhost:8000/docs

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

## 验证

```bash
# 前端构建
cd frontend && npm run build

# 后端编译
cd ../backend && python -m compileall -q app

# 完整基线检查（过期部署标记、前端构建、后端编译和测试）
cd .. && ./scripts/check-repository-baseline.sh
```

## 项目结构

```
personal-blog/
├── frontend/                    # 前端项目
│   ├── src/
│   │   ├── api/                # API 请求
│   │   ├── components/         # 组件
│   │   ├── layouts/            # 布局
│   │   ├── router/             # 路由
│   │   ├── stores/             # 状态管理
│   │   ├── utils/              # 工具函数
│   │   └── views/              # 页面
│   └── ...
│
├── backend/                     # 后端项目
│   ├── app/
│   │   ├── api/                # API 路由
│   │   ├── core/               # 核心配置
│   │   ├── crud/               # 数据库操作
│   │   ├── db/                 # 数据库配置
│   │   ├── models/             # 数据模型
│   │   └── schemas/            # Pydantic 模式
│   ├── alembic/                # 数据库迁移
│   └── ...
│
├── deploy/                      # 部署配置
│   ├── nginx.conf.template     # Nginx 配置模板
│   ├── blog-api.service        # Systemd 服务
│   └── deploy.sh               # 部署脚本
│
└── README.md
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
