# 生产部署

生产环境使用同一台云服务器上的 Docker Compose：PostgreSQL、FastAPI 和前端 Nginx 都由 Compose 管理。数据库数据和四类应用文件使用 `deploy/data/` 绑定目录持久化；PostgreSQL 通过服务器生成的自签名证书启用 SSL，API 使用 `ssl=require` 连接。

前端镜像默认使用 `https://registry.npmmirror.com` 安装 npm 依赖；如服务器网络环境适合其他源，可在 `deploy/.env.production` 设置 `NPM_REGISTRY` 后重新构建。

服务器首次部署前，确认阿里云安全组已放行 TCP `8080`。当前入口是：

```text
http://39.96.212.169:8080
```

在服务器上执行：

```bash
mkdir -p /srv
git clone --branch main --single-branch https://github.com/guoer9/personal-blog.git /srv/personal-blog
cd /srv/personal-blog
chmod +x deploy/*.sh
./deploy/bootstrap-server.sh
```

脚本会生成 `deploy/.env.production`、PostgreSQL SSL 证书和 Notion 连接文件，并将 PostgreSQL 数据目录设为容器数据库用户可访问。`.env.production`、`deploy/secrets/`、`deploy/data/` 都被 Git 忽略。脚本不会生成或打印管理员密码。

管理员密码只在服务器上填写：

```bash
sudoedit /srv/personal-blog/deploy/.env.production
chmod 600 /srv/personal-blog/deploy/.env.production
cd /srv/personal-blog
docker compose --env-file deploy/.env.production \
  -f deploy/compose.production.yml run --rm --no-deps api \
  python -m app.production_admin
```

首次创建后，将 `ADMIN_UPDATE_PASSWORD=false` 保持不变。只有明确要轮换密码时才临时设置为 `true`，执行一次初始化命令后再改回 `false`。

部署检查：

```bash
cd /srv/personal-blog
docker compose --env-file deploy/.env.production \
  -f deploy/compose.production.yml ps
curl --fail http://127.0.0.1:8080/health
systemctl status personal-blog.service personal-blog-backup.timer
```

日常更新只拉取 `main`，执行迁移并重建：

```bash
/srv/personal-blog/deploy/update-server.sh
```

## 服务器 Mihomo 代理

操作目标是 `root@39.96.212.169`，项目目录为 `/srv/personal-blog`。SSH 使用公网直连；服务器上的 Mihomo HTTP 代理为 `http://127.0.0.1:7890`。每次远程操作前，应说明 SSH 目标、SSH 是否经代理，以及本次 Git、镜像拉取和构建依赖各自使用的网络路径。不要在日志中输出订阅地址、密钥或环境文件内容。

Git、宿主机 curl 等外网访问不通时，在服务器当前会话中显式设置代理，再执行部署或更新脚本：

```bash
export http_proxy=http://127.0.0.1:7890
export https_proxy=http://127.0.0.1:7890
export HTTP_PROXY="$http_proxy"
export HTTPS_PROXY="$https_proxy"
export no_proxy=localhost,127.0.0.1,::1,database,api,web
export NO_PROXY="$no_proxy"
cd /srv/personal-blog
git ls-remote origin refs/heads/main
./deploy/update-server.sh
```

Docker 构建不会自动继承 SSH 会话的代理。需要 apt、pip、npm 下载经 Mihomo 时，在服务器 `deploy/.env.production` 中设置：

```dotenv
BUILD_NETWORK=host
BUILD_PROXY_URL=http://127.0.0.1:7890
```

这两项使 Linux 服务器的构建步骤通过宿主机网络访问仅监听回环地址的代理；代理作为 Docker 预定义构建参数传入，不写入应用运行环境。npm 仍使用 `registry.npmmirror.com`。停用构建代理时，将 `BUILD_NETWORK` 改回 `default` 并清空 `BUILD_PROXY_URL`。

基础镜像拉取由 Docker daemon 独立处理，上述构建参数不控制镜像拉取。本服务器已配置镜像加速源；若镜像拉取也失败，应另查 daemon 代理配置，不能仅凭 `export` 就认定镜像拉取已走代理。不要将 `7890` 开放到公网。

每日备份由 `personal-blog-backup.timer` 执行，保存数据库自定义格式导出和四个应用数据目录到 `/srv/backups/personal-blog/`，保留 14 天。备份不包含 Notion 密钥；Notion 连接可以在后台重新添加。

## 域名反向代理

域名解析确认指向 `39.96.212.169` 后，将宿主机 Nginx 配置到 Docker 前端：

```bash
install -d -m 755 /var/www/certbot
sed 's/__DOMAIN__/guoer9.me/g' \
  /srv/personal-blog/deploy/host-nginx.conf.template \
  > /etc/nginx/sites-available/personal-blog
ln -sf /etc/nginx/sites-available/personal-blog /etc/nginx/sites-enabled/personal-blog
nginx -t && systemctl reload nginx
```

这一步先提供 HTTP 反向代理。HTTPS 证书需要在 DNS、生效的 80 端口和证书邮箱确认后再运行 Certbot；不要让宿主机默认站点继续抢占域名。
