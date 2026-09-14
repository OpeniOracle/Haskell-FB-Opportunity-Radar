#!/usr/bin/env bash
#
# The operator file for migration 0021, tested as the artifact an operator
# actually runs -- byte for byte, not a reconstruction of it.
#
# WHAT THIS IS FOR. The normal path (db/migrate.mjs) opens one session and
# wraps the migration itself. The operator file exists for the Supabase SQL
# Editor, which does NOT keep one session across the statements of a script,
# so a script that looks atomic there can commit half of itself. The whole
# point of the file is that it is ONE statement; the whole point of this script
# is to prove that claim rather than assert it.
#
# Assumes PGHOST/PGPORT/PGUSER are set and the server is reachable. Creates and
# drops its own database.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

OPERATOR="$ROOT/db/operator/0021_live_source_ingestion.operator.sql"
DB=radar_operator_0021

SUM_0021='fd15cdc30a526e9575fe9c0644d8055e4346290ea8d7596048f78b9e7afc53b7'
SUM_0020='55514d77a1e92019598127d733df47f1895eb6166c5ddf003df10a1ebb968832'

pass() { printf '    \033[32mok\033[0m    %s\n' "$1"; }
fail() { printf '\n\033[31mFAILED: %s\033[0m\n' "$1"; exit 1; }
step() { printf '\n\033[1m-- %s\033[0m\n' "$1"; }

q() { PGDATABASE="$DB" psql -tAX -q -c "$1"; }

# The hosted pre-0021 state: 0001..0018 then 0020. 0019 does not exist -- it is
# what became 0021 -- so filename order here IS the hosted application order.
pre0021() {
    psql -d postgres -q -c "drop database if exists $DB;" -c "create database $DB;" >/dev/null
    PGDATABASE="$DB" psql -q -v ON_ERROR_STOP=1 -f "$ROOT/db/supabase_compat.sql" >/dev/null
    PGDATABASE="$DB" node "$ROOT/db/migrate.mjs" up --to 0020 >/dev/null
}

# Schema plus the ledger. Both matter: a partial application could leave the
# schema right and the ledger wrong, or the reverse, and this catches either.
snapshot() {
    PGDATABASE="$DB" pg_dump --schema-only --no-owner --no-privileges \
        --exclude-schema=auth -d "$DB" \
        | grep -v '^--' | grep -v '^$' | grep -v '^\\\(un\)\?restrict ' > "$1"
    q "select version || ' ' || checksum || ' ' || stamped from public.schema_migrations order by version;" >> "$1"
}

# ---------------------------------------------------------------------------
step "The file under test is the committed one"
test -f "$OPERATOR" || fail "operator file is missing"
node "$ROOT/db/tools/build-operator-sql.mjs" --check
printf '    sha256 of the file itself: %s\n' "$(sha256sum "$OPERATOR" | cut -d' ' -f1)"
# COMPLETENESS, PROVED POSITIVELY.
#
# Grepping for the word "paste" was the first version of this check and it was
# useless in both directions: it matched the file's own prose saying there is
# nothing to paste, and it would have missed a placeholder worded any other
# way. What actually matters is that the payload IS the migration, so extract
# it and diff it.
sed -n '/CANONICAL PAYLOAD BEGINS/,/CANONICAL PAYLOAD ENDS/p' "$OPERATOR" \
  | sed '1,3d' | sed '$d' > "$WORK/payload.sql"
sed -n '/^begin;$/,/^commit;$/p' "$ROOT/db/migrations/0021_live_source_ingestion.up.sql" \
  | sed '1d' | sed '$d' > "$WORK/canonical-body.sql"
if ! diff -u "$WORK/canonical-body.sql" "$WORK/payload.sql" > "$WORK/payload.diff"; then
    cat "$WORK/payload.diff"
    fail "the embedded payload is not byte-identical to the canonical migration body"
fi
pass "payload is byte-identical to the canonical migration ($(wc -l < "$WORK/payload.sql") lines)"

if grep -qiE 'execute[[:space:]]*(\$|'"'"')' "$OPERATOR"; then
    fail "the operator file uses dynamic SQL"
fi
pass "no dynamic SQL: nothing is re-quoted or reassembled"

# There must be exactly one statement in the file: one DO block.
dostmts=$(grep -c '^do \$operator_0021\$' "$OPERATOR")
endstmts=$(grep -c '^\$operator_0021\$;' "$OPERATOR")
if [ "$dostmts" != "1" ] || [ "$endstmts" != "1" ]; then
    fail "the file is not exactly one DO block"
fi
pass "exactly one statement, so exactly one transaction"

# ---------------------------------------------------------------------------
step "1. Successful application from the exact pre-0021 schema"
pre0021
q "select version from public.schema_migrations order by version;" > "$WORK/before.txt"
grep -qx '0018' "$WORK/before.txt" || fail "0018 is not present before the test"
grep -qx '0020' "$WORK/before.txt" || fail "0020 is not present before the test"
if grep -qx '0021' "$WORK/before.txt"; then fail "0021 is already present before the test"; fi
PGDATABASE="$DB" psql -q -v ON_ERROR_STOP=1 -f "$OPERATOR"
pass "applied"

# ---------------------------------------------------------------------------
step "6. The expected objects and the ledger checksum exist after success"
for obj in source_document_cache evidence_current_document_uidx \
           evidence_document_lookup_idx evidence_last_seen_idx \
           signals_organization_cluster_uidx opportunities_organization_key_uidx \
           source_runs_single_active_uidx; do
    [ "$(q "select to_regclass('public.$obj') is not null;")" = "t" ] \
        || fail "$obj was not created"
done
pass "all seven objects exist"

[ "$(q "select count(*) from information_schema.columns where table_schema='public' and table_name='evidence' and column_name in ('source_document_id','document_revision','connector_id','connector_version','first_seen_at','last_seen_at','classification_status','review_status','superseded_at');")" = "9" ] \
    || fail "the evidence columns are not all present"
pass "nine evidence columns"

[ "$(q "select count(*) from information_schema.columns where table_schema='public' and table_name='opportunities' and column_name in ('haskell_fit','project_maturity','potential_scope','timing_momentum','raw_score','confidence_multiplier','final_score','why_it_matters') and is_nullable='NO';")" = "0" ] \
    || fail "a scoring column is still NOT NULL"
pass "an unscored opportunity is expressible"

[ "$(q "select checksum from public.schema_migrations where version='0021';")" = "$SUM_0021" ] \
    || fail "the recorded 0021 checksum is not $SUM_0021"
[ "$(q "select stamped from public.schema_migrations where version='0021';")" = "f" ] \
    || fail "0021 was recorded as stamped; it was executed, not stamped"
pass "ledger row records $SUM_0021, stamped = false"

# The strongest parity statement available: the repository's own verifier,
# which recomputes the checksum from db/migrations/, agrees with what the
# OPERATOR file wrote. If the two files ever diverge, this fails.
PGDATABASE="$DB" node "$ROOT/db/migrate.mjs" verify
pass "db/migrate.mjs verify accepts a database migrated by the operator file"

# ---------------------------------------------------------------------------
step "7. Migration 0020 and the Microsoft identity guard are intact"
[ "$(q "select checksum from public.schema_migrations where version='0020';")" = "$SUM_0020" ] \
    || fail "the 0020 ledger row changed"
[ "$(q "select to_regproc('public.auth_guard_microsoft_identity') is not null;")" = "t" ] \
    || fail "auth_guard_microsoft_identity is gone"
[ "$(q "select count(*) from pg_trigger where tgname like '%microsoft%' or tgname like '%identity%';")" -ge "1" ] \
    || fail "the 0020 trigger is gone"
pass "0020 checksum unchanged, guard function and trigger present"

snapshot "$WORK/after-success.txt"

# ---------------------------------------------------------------------------
step "2. Repeated application refuses, and changes nothing"
set +e
PGDATABASE="$DB" psql -q -v ON_ERROR_STOP=1 -f "$OPERATOR" > "$WORK/again.log" 2>&1
rc=$?
set -e
[ "$rc" -ne 0 ] || fail "a second application succeeded; it must refuse"
grep -q 'ABORT: migration 0021 is already recorded' "$WORK/again.log" \
    || { cat "$WORK/again.log"; fail "refused, but not with the already-recorded ABORT"; }
pass "refused: $(grep -o 'ABORT:.*' "$WORK/again.log" | head -1)"

snapshot "$WORK/after-refusal.txt"
diff -u "$WORK/after-success.txt" "$WORK/after-refusal.txt" > "$WORK/refusal.diff" \
    || { cat "$WORK/refusal.diff"; fail "the refused run changed the database"; }
pass "schema and ledger byte-identical after the refusal"

[ "$(q "select count(*) from public.schema_migrations where version='0021';")" = "1" ] \
    || fail "0021 is recorded more than once"
pass "0021 recorded exactly once"

# ---------------------------------------------------------------------------
# Failures are INJECTED INTO THE COMMITTED FILE, mechanically, at three depths.
# `perform 1/0` is a genuine runtime error rather than a raise, so this tests
# the transaction rather than the error-reporting path.
inject_after() {
    awk -v pat="$2" '
        { print }
        !done && index($0, pat) { print "    perform 1/0;"; done=1 }
    ' "$OPERATOR" > "$1"
    grep -q 'perform 1/0;' "$1" || fail "injection point not found: $2"
}

failure_leaves_nothing() {
    local label="$1" file="$2"
    pre0021
    snapshot "$WORK/before-$label.txt"
    set +e
    PGDATABASE="$DB" psql -q -v ON_ERROR_STOP=1 -f "$file" > "$WORK/$label.log" 2>&1
    local rc=$?
    set -e
    [ "$rc" -ne 0 ] || fail "$label: the injected failure did not fail the run"
    grep -qi 'division by zero' "$WORK/$label.log" \
        || { cat "$WORK/$label.log"; fail "$label: failed for the wrong reason"; }

    [ "$(q "select count(*) from public.schema_migrations where version='0021';")" = "0" ] \
        || fail "$label: a ledger row survived a failed run"
    [ "$(q "select to_regclass('public.source_document_cache') is null;")" = "t" ] \
        || fail "$label: source_document_cache survived a failed run"
    [ "$(q "select count(*) from information_schema.columns where table_schema='public' and table_name='evidence' and column_name='source_document_id';")" = "0" ] \
        || fail "$label: an evidence column survived a failed run"
    [ "$(q "select checksum from public.schema_migrations where version='0020';")" = "$SUM_0020" ] \
        || fail "$label: 0020 was disturbed"
    [ "$(q "select to_regproc('public.auth_guard_microsoft_identity') is not null;")" = "t" ] \
        || fail "$label: the Microsoft guard was disturbed"

    snapshot "$WORK/after-$label.txt"
    diff -u "$WORK/before-$label.txt" "$WORK/after-$label.txt" > "$WORK/$label.diff" \
        || { cat "$WORK/$label.diff"; fail "$label: the database is not byte-identical to before"; }
    pass "$label: nothing committed, database byte-identical, 0020 untouched"
}

step "3. Deliberate failure near the BEGINNING leaves no partial migration"
inject_after "$WORK/fail-begin.sql" "add column superseded_at         timestamptz;"
failure_leaves_nothing "begin" "$WORK/fail-begin.sql"

step "4. Deliberate failure in the MIDDLE leaves no partial migration"
inject_after "$WORK/fail-middle.sql" "where cluster_key is not null;"
failure_leaves_nothing "middle" "$WORK/fail-middle.sql"

step "5. Deliberate failure at the END leaves no ledger row either"
# After the ledger INSERT on purpose: the objects AND the row both exist in the
# transaction at this point, and both must disappear.
inject_after "$WORK/fail-end.sql" "values ('0021', 'live_source_ingestion',"
failure_leaves_nothing "end" "$WORK/fail-end.sql"

psql -d postgres -q -c "drop database if exists $DB;" >/dev/null
printf '\n\033[32mOperator file 0021: all seven cases passed.\033[0m\n'
