#!/bin/sh
if [ ! -f "${DB_PATH:-/app/server/courtcall.db}" ]; then
  echo "No database found — running setup-db.js..."
  node /app/server/setup-db.js
fi
exec node /app/server/index.js
