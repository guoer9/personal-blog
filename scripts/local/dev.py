#!/usr/bin/env python3
"""Manage the isolated local development template. Never targets a cloud server."""
import argparse
import os
from pathlib import Path
import secrets
import subprocess

ROOT = Path(__file__).resolve().parents[2]
ENV_FILE = ROOT / ".env.local-workspace"
NOTION_CONNECTIONS_FILE = ROOT / ".secrets" / "notion-connections.json"


def ensure_notion_connections_file(root: Path = ROOT) -> Path:
    """Create the local-only Notion credential catalog with private perms."""
    secret_dir = Path(root) / ".secrets"
    secret_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    path = secret_dir / "notion-connections.json"
    if not path.exists():
        descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as output:
            output.write('{"version": 1, "connections": []}\n')
    path.chmod(0o600)
    return path


def init():
    if not ENV_FILE.exists():
        descriptor = os.open(ENV_FILE, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        with os.fdopen(descriptor, "w") as output:
            output.write("# Local development only. Never commit or share this file.\n")
            output.write("LOCAL_DATABASE_PASSWORD=" + secrets.token_hex(24) + "\n")
            output.write("LOCAL_SECRET_KEY=" + secrets.token_hex(32) + "\n")
            output.write("LOCAL_ADMIN_USERNAME=localadmin\n")
            output.write("LOCAL_ADMIN_PASSWORD=" + secrets.token_urlsafe(24) + "\n")
    ENV_FILE.chmod(0o600)
    ensure_notion_connections_file()


def compose(*arguments):
    return subprocess.run(["docker", "compose", "--env-file", str(ENV_FILE), "-f", str(ROOT / "compose.local.yml"), *arguments], cwd=ROOT, check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["init", "start", "status", "stop", "cleanup"])
    args = parser.parse_args()
    init()
    if args.action == "start":
        compose("up", "-d", "--build", "--wait")
        compose("exec", "-T", "api", "alembic", "upgrade", "head")
        compose("exec", "-T", "api", "python", "-m", "app.local_admin")
        print("Local API ready: http://127.0.0.1:8001")
        print("Admin login details are in " + str(ENV_FILE))
        print("Frontend: BLOG_API_PROXY=http://127.0.0.1:8001 npm --prefix frontend run dev -- --host 127.0.0.1")
    elif args.action == "status":
        compose("ps")
    elif args.action == "stop":
        compose("stop")
    elif args.action == "cleanup":
        compose("exec", "-T", "api", "python", "-m", "app.services.library_cleanup")
    else:
        print("Local configuration prepared: " + str(ENV_FILE))


if __name__ == "__main__":
    main()
