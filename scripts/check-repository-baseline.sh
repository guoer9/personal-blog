#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "[1/4] Checking tracked files for expired deployment markers..."
expired_domain="$(printf '%s%s%s' 'cgwdn' '.' 'icu')"
certificate_path="$(printf '%s%s' 'letsencrypt' '/live')"
secure_password_marker="$(printf '%s%s' 'your-secure' '-password')"
super_secret_marker="$(printf '%s%s' 'super' '-secret-key')"
database_password_marker="$(printf '%s%s' 'blogpass' 'word')"
forbidden_pattern="${expired_domain}|${certificate_path}|${secure_password_marker}|${super_secret_marker}|${database_password_marker}"

if matches="$(git grep -n -i -E "$forbidden_pattern" -- .)"; then
    printf '%s\n' "$matches"
    echo "Repository baseline check failed: forbidden deployment marker found." >&2
    exit 1
fi

echo "[2/4] Building frontend..."
npm --prefix frontend run build

echo "[3/4] Compiling backend..."
if [[ -x "backend/venv/bin/python" ]]; then
    PYTHON_BIN="backend/venv/bin/python"
else
    PYTHON_BIN="python3"
fi
"$PYTHON_BIN" -m compileall -q backend/app

echo "[4/4] Running backend tests..."
"$PYTHON_BIN" -m pytest -q

echo "Repository baseline check passed."
