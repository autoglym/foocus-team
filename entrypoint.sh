#!/bin/sh
set -e

# Apply pending database migrations (uses DIRECT_URL, the Supabase session pooler).
echo "Running database migrations..."
timeout 120 npx prisma migrate deploy || {
  echo "Migration failed or timed out, checking status..."
  npx prisma migrate status
  exit 1
}

echo "Starting server..."
exec node dist/index.js
