#!/usr/bin/env bash
set -Eeuo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/srv/personal-blog}"
BACKUP_DIR="${BACKUP_DIR:-/srv/backups/personal-blog}"
ENV_FILE="$DEPLOY_DIR/deploy/.env.production"
COMPOSE_FILE="$DEPLOY_DIR/deploy/compose.production.yml"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TARGET="$BACKUP_DIR/$STAMP"

if [ "$(id -u)" -ne 0 ]; then
    echo "Run this script as root." >&2
    exit 1
fi
if [ ! -f "$ENV_FILE" ]; then
    echo "Production environment file is missing." >&2
    exit 1
fi

umask 077
install -d -m 0700 "$TARGET"
cd "$DEPLOY_DIR"

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T database \
    sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner' \
    > "$TARGET/database.dump"

tar -C "$DEPLOY_DIR/deploy/data" -czf "$TARGET/application-data.tar.gz" \
    private-library public-media uploads visitor-transfers

find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -mtime +14 -exec rm -rf -- {} +
echo "Backup created: $TARGET"
