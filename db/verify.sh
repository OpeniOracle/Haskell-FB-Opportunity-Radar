#!/usr/bin/env bash
#
# The full migration contract, in one script, so CI and a laptop run the same
# thing. Assumes PGHOST/PGPORT/PGUSER (and PGPASSWORD where needed) are set and
# that the server is reachable; it creates and drops its own databases.
#
#   1. empty  -> forward -> rollback, and the database is empty again
#   2. v0.1.0 -> forward -> rollback to baseline, and the schema matches the
#      v0.1.0 reference DUMP FOR DUMP
#   3. schema-contract tests, positive and negative
#   4. checksum verification, including a deliberate tamper that must FAIL
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

step() { printf '\n\033[1m== %s\033[0m\n' "$1"; }
fail() { printf '\n\033[31mFAILED: %s\033[0m\n' "$1"; exit 1; }

# Every test database gets the Supabase compatibility shim before any migration
# runs, because 0015 grants to roles a bare PostgreSQL container does not have.
# The shim is never applied to a Supabase project.
recreate() {
    psql -d postgres -q -c "drop database if exists $1;" -c "create database $1;" >/dev/null
    PGDATABASE="$1" psql -q -v ON_ERROR_STOP=1 -f "$ROOT/db/supabase_compat.sql" >/dev/null
}

step "PostgreSQL target"
psql -d postgres -tAc 'select version();'
psql -d postgres -tAc "select 'pgcrypto available: ' || count(*)::text
                       from pg_available_extensions where name = 'pgcrypto';"

# --------------------------------------------------------------------------
step "1. Empty database: forward, then full rollback"
recreate radar_empty
export PGDATABASE=radar_empty
node "$ROOT/db/migrate.mjs" up
node "$ROOT/db/migrate.mjs" verify
node "$ROOT/db/migrate.mjs" down

remaining=$(psql -tAc "select count(*) from information_schema.tables
                       where table_schema = 'public'
                         and table_name <> 'schema_migrations';")
[ "$remaining" = "0" ] || fail "rollback left $remaining table(s) behind"
echo "rollback left nothing behind"

# --------------------------------------------------------------------------
step "2. v0.1.0 baseline: forward, then rollback TO the baseline"
# radar_ref is the comparison target and must be exactly what
# schemas/database.sql produces, so it gets no shim and no migrations.
psql -d postgres -q -c "drop database if exists radar_ref;" -c "create database radar_ref;" >/dev/null
recreate radar_v01
PGDATABASE=radar_ref psql -q -v ON_ERROR_STOP=1 -f "$ROOT/schemas/database.sql"
PGDATABASE=radar_v01 psql -q -v ON_ERROR_STOP=1 -f "$ROOT/schemas/database.sql"

export PGDATABASE=radar_v01
node "$ROOT/db/migrate.mjs" up --from-baseline
node "$ROOT/db/migrate.mjs" status
node "$ROOT/db/migrate.mjs" down --to 0001

# `\restrict` carries a per-dump nonce, so it is stripped before comparison.
# --no-privileges drops the shim's GRANTs; --exclude-schema drops its auth
# schema. What remains is the schema the migrations are responsible for.
dump() {
    pg_dump --schema-only --no-owner --no-privileges \
            --exclude-schema=auth \
            --exclude-table=schema_migrations -d "$1" \
        | grep -v '^--' | grep -v '^$' | grep -v '^\\\(un\)\?restrict '
}
dump radar_ref  > "$WORK/ref.sql"
dump radar_v01  > "$WORK/after.sql"
if ! diff -u "$WORK/ref.sql" "$WORK/after.sql" > "$WORK/schema.diff"; then
    cat "$WORK/schema.diff"
    fail "rollback to the baseline did not reproduce the v0.1.0 schema"
fi
echo "schema after rollback is identical to the v0.1.0 reference"

# --------------------------------------------------------------------------
step "3. Schema-contract tests"
recreate radar_tests
export PGDATABASE=radar_tests
node "$ROOT/db/migrate.mjs" up > /dev/null
node "$ROOT/db/test.mjs"

# --------------------------------------------------------------------------
step "3b. Seeds apply, are idempotent, and respect the D14-L gate"
# Applied twice on purpose. A seed that fails the second time is not a seed, it
# is a one-shot script, and the difference only shows up on the day someone
# needs to re-apply a correction.
node "$ROOT/db/seed.mjs" > /dev/null
node "$ROOT/db/seed.mjs"

# --------------------------------------------------------------------------
step "4. Checksum drift must FAIL the build"
node "$ROOT/db/migrate.mjs" verify

tampered="$ROOT/db/migrations/0002_reference_vocabulary.up.sql"
cp "$tampered" "$WORK/original.sql"
restore() { cp "$WORK/original.sql" "$tampered"; }
trap 'restore; rm -rf "$WORK"' EXIT

printf '\nalter table sectors add column tampered_column text;\n' >> "$tampered"
if node "$ROOT/db/migrate.mjs" verify > "$WORK/tamper.log" 2>&1; then
    cat "$WORK/tamper.log"
    fail "an edited applied migration was NOT detected"
fi
grep -q 'CHECKSUM DRIFT' "$WORK/tamper.log" || {
    cat "$WORK/tamper.log"
    fail "verify failed, but not because of checksum drift"
}
echo "edited migration detected:"
sed 's/^/    /' "$WORK/tamper.log"
restore
node "$ROOT/db/migrate.mjs" verify

printf '\n\033[32mAll migration checks passed.\033[0m\n'
