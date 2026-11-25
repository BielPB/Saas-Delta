#!/usr/bin/env bash
# Recreates the local test database: Supabase shim + every migration, in order.
# Usage: TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres scripts/db-reset-test.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ADMIN_URL="${TEST_DATABASE_ADMIN_URL:-postgres://postgres:postgres@localhost:5432/postgres}"
DB_NAME="${TEST_DATABASE_NAME:-deltaflow_test}"
DB_URL="${ADMIN_URL%/*}/${DB_NAME}"

psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -c "drop database if exists ${DB_NAME} with (force);" -c "create database ${DB_NAME};"
psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$ROOT/tests/db/supabase-shim.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do
  psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$f" > /dev/null
done
echo "ok: ${DB_NAME} ready"
