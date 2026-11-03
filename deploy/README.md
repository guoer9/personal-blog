# 生产部署

生产环境使用同一台云服务器上的 Docker Compose：PostgreSQL、FastAPI 和前端 Nginx 都由 Compose 管理。数据库数据和四类应用文件使用 `deploy/data/` 绑定目录持久化；PostgreSQL 通过服务器生成的自签名证书启用 SSL，API 使用 `ssl=require` 连接。

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

脚本会生成 `deploy/.env.production`、PostgreSQL SSL 证书和 Notion 连接文件。`.env.production`、`deploy/secrets/`、`deploy/data/` 都被 Git 忽略。脚本不会生成或打印管理员密码。

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
