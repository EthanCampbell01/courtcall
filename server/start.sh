#!/bin/sh
set -e
DB_FILE="${DB_PATH:-$(dirname "$0")/courtcall.db}"
if [ ! -f "$DB_FILE" ]; then
  echo "No database found — running setup-db.js..."
  node "$(dirname "$0")/setup-db.js"
fi
exec node "$(dirname "$0")/index.js"
