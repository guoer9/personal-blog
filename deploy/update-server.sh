#!/usr/bin/env bash
set -Eeuo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/srv/personal-blog}"
ENV_FILE="$DEPLOY_DIR/deploy/.env.production"
COMPOSE_FILE="$DEPLOY_DIR/deploy/compose.production.yml"

if [ "$(id -u)" -ne 0 ]; then
    echo "Run this script as root." >&2
    exit 1
fi
if [ ! -d "$DEPLOY_DIR/.git" ] || [ ! -f "$ENV_FILE" ]; then
    echo "Production checkout or environment file is missing." >&2
    exit 1
fi
if [ -n "$(git -C "$DEPLOY_DIR" status --porcelain)" ]; then
    echo "Refusing to update a dirty checkout: $DEPLOY_DIR" >&2
    exit 1
fi

git -C "$DEPLOY_DIR" fetch origin main
git -C "$DEPLOY_DIR" checkout main
git -C "$DEPLOY_DIR" pull --ff-only origin main

cd "$DEPLOY_DIR"
compose() {
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

compose config --quiet
compose build
compose run --rm --no-deps api alembic upgrade head
compose up -d
compose ps
