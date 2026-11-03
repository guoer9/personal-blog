FROM postgres:16-alpine

COPY deploy/postgres/entrypoint.sh /usr/local/bin/postgres-ssl-entrypoint.sh
RUN chmod 0755 /usr/local/bin/postgres-ssl-entrypoint.sh

ENTRYPOINT ["postgres-ssl-entrypoint.sh"]
