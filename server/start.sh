#!/bin/sh
set -e
if [ ! -f "./server/courtcall.db" ]; then
  echo "No database found — running setup-db.js..."
  node ./server/setup-db.js
fi
exec node ./server/index.js
