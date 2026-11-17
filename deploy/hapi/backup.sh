#!/usr/bin/env bash
set -euo pipefail
umask 077
exec 9>/run/lock/hapi-backup.lock
flock -n 9 || exit 0
backup_root=/srv/backups/hapi
install -d -m 700 "$backup_root"
restart_hub=0
if systemctl is-active --quiet hapi-hub; then restart_hub=1; fi
archive=
restore_hub() {
    if [ -n "$archive" ]; then rm -f "$archive.tmp"; fi
    if [ "$restart_hub" -eq 1 ]; then systemctl start hapi-hub; fi
}
trap restore_hub EXIT
systemctl stop hapi-hub
archive="$backup_root/hapi-$(date -u +%Y%m%dT%H%M%SZ).tar.gz"
tar -C /var/lib -czf "$archive.tmp" hapi
mv "$archive.tmp" "$archive"
archive=
if [ "$restart_hub" -eq 1 ]; then systemctl start hapi-hub; fi
restart_hub=0
python3 - "$backup_root" <<'PY'
from pathlib import Path
import sys
archives = sorted(Path(sys.argv[1]).glob('hapi-*.tar.gz'), reverse=True)
for old in archives[7:]:
    old.unlink()
PY
