#!/bin/sh
# Apply database migrations on every start (idempotent), then run the API.
# A failed migration stops the container instead of serving a half-migrated DB.
set -e
if [ "${SKIP_MIGRATIONS:-0}" != "1" ]; then
  node src/db/migrate.js
fi
exec "$@"
