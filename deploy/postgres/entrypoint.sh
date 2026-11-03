#!/bin/sh
set -eu

if [ "$(id -u)" -eq 0 ]; then
    install -d -m 0700 -o postgres -g postgres /var/lib/postgresql/ssl
    cp /run/postgres-certs/server.crt /var/lib/postgresql/ssl/server.crt
    cp /run/postgres-certs/server.key /var/lib/postgresql/ssl/server.key
    chown postgres:postgres /var/lib/postgresql/ssl/server.crt /var/lib/postgresql/ssl/server.key
    chmod 0644 /var/lib/postgresql/ssl/server.crt
    chmod 0600 /var/lib/postgresql/ssl/server.key
fi

exec /usr/local/bin/docker-entrypoint.sh "$@"
