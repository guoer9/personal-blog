#!/bin/bash
# 个人博客部署脚本
# 使用方法: ./deploy.sh

set -e

echo "=========================================="
echo "       个人博客部署脚本"
echo "=========================================="

# 配置变量
DEPLOY_DIR="/var/www/blog"
DOMAIN="${DOMAIN:?Set DOMAIN to the active public domain before deploying}"
CERT_EMAIL="${CERT_EMAIL:?Set CERT_EMAIL before deploying}"

# 检查是否以 root 运行
if [ "$EUID" -ne 0 ]; then
    echo "请以 root 用户运行此脚本"
    exit 1
fi

echo ""
echo "[1/8] 安装系统依赖..."
apt update
apt install -y python3.11 python3.11-venv python3-pip nodejs npm nginx postgresql postgresql-contrib certbot python3-certbot-nginx

echo ""
echo "[2/8] 配置 PostgreSQL..."
sudo -u postgres psql -c "CREATE USER bloguser;" 2>/dev/null || true
sudo -u postgres psql -c "CREATE DATABASE blogdb OWNER bloguser;" 2>/dev/null || true
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE blogdb TO bloguser;" 2>/dev/null || true

echo ""
echo "[3/8] 创建部署目录..."
mkdir -p $DEPLOY_DIR
cd $DEPLOY_DIR

echo ""
echo "[4/8] 部署后端..."
cd $DEPLOY_DIR/backend

# 创建虚拟环境
python3.11 -m venv venv
source venv/bin/activate

# 安装依赖
pip install --upgrade pip
pip install -r requirements.txt

if [ ! -f /etc/personal-blog/blog-api.env ]; then
    echo "缺少 /etc/personal-blog/blog-api.env，请先写入生产数据库、JWT 密钥和 CORS 配置"
    exit 1
fi

# 运行数据库迁移
alembic upgrade head

# 创建上传目录
mkdir -p uploads
chown -R www-data:www-data uploads

deactivate

echo ""
echo "[5/8] 部署前端..."
cd $DEPLOY_DIR/frontend

# 安装依赖并构建
npm install
npm run build

echo ""
echo "[6/8] 配置 Nginx..."
sed \
    -e "s/__DOMAIN__/$DOMAIN/g" \
    -e "s#__CERT_EMAIL__#$CERT_EMAIL#g" \
    "$DEPLOY_DIR/deploy/nginx.conf.template" > /etc/nginx/sites-available/blog
ln -sf /etc/nginx/sites-available/blog /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

# 测试 Nginx 配置
nginx -t

echo ""
echo "[7/8] 配置 Systemd 服务..."
cp $DEPLOY_DIR/deploy/blog-api.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable blog-api

echo ""
echo "[8/8] 获取 SSL 证书..."
# 先启动 Nginx（HTTP 模式用于验证）
systemctl restart nginx

# 获取证书
certbot --nginx -d $DOMAIN -d www.$DOMAIN --non-interactive --agree-tos --email "$CERT_EMAIL"

# 启动服务
systemctl start blog-api
systemctl restart nginx

echo ""
echo "=========================================="
echo "        部署完成！"
echo "=========================================="
echo ""
echo "访问地址: https://$DOMAIN"
echo ""
echo "常用命令:"
echo "  查看后端日志: journalctl -u blog-api -f"
echo "  重启后端: systemctl restart blog-api"
echo "  重启 Nginx: systemctl restart nginx"
echo ""
