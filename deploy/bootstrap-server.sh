#!/usr/bin/env bash
set -Eeuo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/srv/personal-blog}"
REPO_URL="${REPO_URL:-https://github.com/guoer9/personal-blog.git}"
BRANCH="${BRANCH:-main}"
ENV_FILE="$DEPLOY_DIR/deploy/.env.production"
COMPOSE_FILE="$DEPLOY_DIR/deploy/compose.production.yml"

if [ "$(id -u)" -ne 0 ]; then
    echo "Run this script as root." >&2
    exit 1
fi

for command_name in git openssl docker; do
    if ! command -v "$command_name" >/dev/null 2>&1; then
        echo "Missing required command: $command_name" >&2
        exit 1
    fi
done

if ! docker compose version >/dev/null 2>&1; then
    echo "Docker Compose plugin is required." >&2
    exit 1
fi

install -d -m 0755 "$(dirname "$DEPLOY_DIR")"

if [ -e "$DEPLOY_DIR" ] && [ ! -d "$DEPLOY_DIR/.git" ]; then
    echo "Refusing to reuse a non-git directory: $DEPLOY_DIR" >&2
    exit 1
fi

if [ ! -d "$DEPLOY_DIR/.git" ]; then
    git clone --branch "$BRANCH" --single-branch "$REPO_URL" "$DEPLOY_DIR"
else
    if [ -n "$(git -C "$DEPLOY_DIR" status --porcelain)" ]; then
        echo "Refusing to update a dirty checkout: $DEPLOY_DIR" >&2
        exit 1
    fi
    git -C "$DEPLOY_DIR" fetch origin "$BRANCH"
    git -C "$DEPLOY_DIR" checkout "$BRANCH"
    git -C "$DEPLOY_DIR" pull --ff-only origin "$BRANCH"
fi

install -d -m 0750 -o 10001 -g 10001 "$DEPLOY_DIR/deploy/secrets"
install -d -m 0700 "$DEPLOY_DIR/deploy/secrets/postgres"
install -d -m 0700 "$DEPLOY_DIR/deploy/data/postgres"
for data_dir in private-library public-media uploads visitor-transfers; do
    install -d -m 0750 -o 10001 -g 10001 "$DEPLOY_DIR/deploy/data/$data_dir"
done

if [ ! -f "$DEPLOY_DIR/deploy/secrets/postgres/server.key" ] || [ ! -f "$DEPLOY_DIR/deploy/secrets/postgres/server.crt" ]; then
    openssl req -x509 -nodes -newkey rsa:2048 -sha256 -days 3650 \
        -keyout "$DEPLOY_DIR/deploy/secrets/postgres/server.key" \
        -out "$DEPLOY_DIR/deploy/secrets/postgres/server.crt" \
        -subj "/CN=database" \
        -addext "subjectAltName=DNS:database" >/dev/null 2>&1
fi
chmod 0600 "$DEPLOY_DIR/deploy/secrets/postgres/server.key"
chmod 0644 "$DEPLOY_DIR/deploy/secrets/postgres/server.crt"

NOTION_FILE="$DEPLOY_DIR/deploy/secrets/notion-connections.json"
if [ -e "$NOTION_FILE" ] && [ -L "$NOTION_FILE" ]; then
    echo "Refusing a symlinked Notion connection file." >&2
    exit 1
fi
if [ ! -e "$NOTION_FILE" ]; then
    printf '%s\n' '{"version": 1, "connections": []}' > "$NOTION_FILE"
fi
chmod 0600 "$NOTION_FILE"
chown 10001:10001 "$NOTION_FILE"

if [ ! -f "$ENV_FILE" ]; then
    umask 077
    postgres_password="$(openssl rand -hex 32)"
    secret_key="$(openssl rand -hex 32)"
    cat > "$ENV_FILE" <<EOF
POSTGRES_USER=blog
POSTGRES_DB=personal_blog
POSTGRES_PASSWORD=$postgres_password
SECRET_KEY=$secret_key
ADMIN_USERNAME=guoer9
ADMIN_EMAIL=admin@guoer9.me
ADMIN_PASSWORD=
ADMIN_UPDATE_PASSWORD=false
CORS_ORIGINS=["http://39.96.212.169:8080","https://guoer9.me","https://www.guoer9.me"]
NOTION_SYNC_ENABLED=false
WEB_BIND_ADDRESS=0.0.0.0
WEB_PORT=8080
EOF
fi
chmod 0600 "$ENV_FILE"

required_keys=(POSTGRES_USER POSTGRES_DB POSTGRES_PASSWORD SECRET_KEY CORS_ORIGINS)
for key in "${required_keys[@]}"; do
    if ! grep -Eq "^${key}=.+$" "$ENV_FILE"; then
        echo "Missing value in $ENV_FILE: $key" >&2
        exit 1
    fi
done

cd "$DEPLOY_DIR"
compose() {
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

compose config --quiet
compose build
compose up -d database

database_id="$(compose ps -q database)"
for attempt in $(seq 1 36); do
    health="$(docker inspect -f '{{.State.Health.Status}}' "$database_id" 2>/dev/null || true)"
    if [ "$health" = "healthy" ]; then
        break
    fi
    if [ "$health" = "unhealthy" ]; then
        echo "PostgreSQL container became unhealthy." >&2
        compose logs --tail=80 database >&2 || true
        exit 1
    fi
    sleep 5
    if [ "$attempt" -eq 36 ]; then
        echo "Timed out waiting for PostgreSQL." >&2
        compose logs --tail=80 database >&2 || true
        exit 1
    fi
done

compose run --rm --no-deps api alembic upgrade head
compose up -d

api_id="$(compose ps -q api)"
web_id="$(compose ps -q web)"
for service_id in "$api_id" "$web_id"; do
    for attempt in $(seq 1 36); do
        health="$(docker inspect -f '{{.State.Health.Status}}' "$service_id" 2>/dev/null || true)"
        if [ "$health" = "healthy" ]; then
            break
        fi
        if [ "$health" = "unhealthy" ]; then
            echo "A production container became unhealthy." >&2
            compose ps >&2 || true
            exit 1
        fi
        sleep 5
        if [ "$attempt" -eq 36 ]; then
            echo "Timed out waiting for a production container." >&2
            compose ps >&2 || true
            exit 1
        fi
    done
done

if grep -Eq '^ADMIN_PASSWORD=.{20,}$' "$ENV_FILE"; then
    compose run --rm --no-deps api python -m app.production_admin
else
    echo "Containers are running. Fill ADMIN_PASSWORD in deploy/.env.production, then run the production administrator command from deploy/README.md."
fi

install -m 0644 "$DEPLOY_DIR/deploy/personal-blog.service" /etc/systemd/system/personal-blog.service
install -m 0644 "$DEPLOY_DIR/deploy/personal-blog-backup.service" /etc/systemd/system/personal-blog-backup.service
install -m 0644 "$DEPLOY_DIR/deploy/personal-blog-backup.timer" /etc/systemd/system/personal-blog-backup.timer
systemctl daemon-reload
systemctl enable personal-blog.service personal-blog-backup.timer
systemctl start personal-blog.service
systemctl start personal-blog-backup.timer

echo "Production containers are running on port 8080."
