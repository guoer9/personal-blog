#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "The Docker production deployment is now managed by bootstrap-server.sh."
exec "$SCRIPT_DIR/bootstrap-server.sh" "$@"
