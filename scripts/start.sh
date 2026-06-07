#!/bin/sh
set -e

echo "[start] Running database migrations..."
npx prisma migrate deploy

echo "[start] Starting Monika server..."
exec node dist/index.js
