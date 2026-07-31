#!/bin/sh
set -eu

echo "[backend] prisma migrate deploy..."
npx prisma migrate deploy

echo "[backend] starting Nest on :${PORT:-8000}"
exec node dist/main.js