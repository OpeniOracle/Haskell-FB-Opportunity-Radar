#!/usr/bin/env bash
#
# The operator files for the R2 schema foundation: what an operator actually
# pastes into the Supabase SQL Editor, tested byte for byte.
#
#   db/operator/r2_schema_foundation.operator.sql           apply 0025 - 0030
#   db/operator/r2_schema_foundation.rollback.operator.sql  roll them back
#
# Nobody applies a migration to production through `db/migrate.mjs` from a
# laptop. The operator file is the path that is used, so it is the path that is
# tested: against a database shaped like production (0024, seeded), not an empty
# one.
#
#   1. Applying it produces EXACTLY the schema, ledger and privileges that
#      `db/migrate.mjs up` produces.
#   2. It is one statement, so a failure at the END leaves nothing behind.
#   3. It refuses a repeat, a missing 0024, and rows a new rule would refuse, and
#      each refusal changes nothing.
#   4. The rollback file reverses it exactly, refuses to destroy recorded work,
#      and leaves nothing behind.
#
# Nothing here is run against a Supabase project.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APPLY="$ROOT/db/operator/r2_schema_foundation.operator.sql"
ROLLBACK="$ROOT/db/operator/r2_schema_foundation.rollback.operator.sql"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

pass() { printf '    \033[32mok\033[0m    %s\n' "$1"; }
fail() { printf '\n\033[31mFAILED: %s\033[0m\n' "$1"; exit 1; }
step() { printf '\n\033[1m-- %s\033[0m\n' "$1"; }

q() { PGDATABASE="$1" psql -tAX -q -v ON_ERROR_STOP=1 -c "$2"; }

fresh() {
    psql -d postgres -q -c "drop database if exists $1;" -c "create database $1;" >/dev/null
    PGDATABASE="$1" psql -q -v ON_ERROR_STOP=1 -f "$ROOT/db/supabase_compat.sql" >/dev/null
}

# A database shaped like production: migrated to 0024 and seeded with what
# predates R2 (every seed but 0009, which needs a column R2 adds).
at_0024() {
    fresh "$1"
    PGDATABASE="$1" node "$ROOT/db/migrate.mjs" up --to 0024 >/dev/null
    local sql="begin;" f
    for f in "$ROOT"/db/seed/000[1-8]_*.sql; do sql+=$'\n'"$(cat "$f")"; done
    printf '%s\ncommit;\n' "$sql" | PGDATABASE="$1" psql -q -v ON_ERROR_STOP=1 -f - >/dev/null \
        2> >(grep -v 'transaction in progress' >&2)
}

# Runs a file that must FAIL, mentioning $3. Echoes nothing on success.
refuses() {   # database | file | needle | description
    local out
    if out=$(PGDATABASE="$1" psql -v ON_ERROR_STOP=1 -q -f "$2" 2>&1); then
        fail "$4: the file succeeded, but should have been refused"
    fi
    printf '%s' "$out" | grep -q "$3" || { printf '%s\n' "$out"; fail "$4: refused, but not for the expected reason ($3)"; }
}

dump() {   # database -> normalised schema-only dump (no owners or privileges)
    pg_dump --schema-only --no-owner --no-privileges --exclude-schema=auth --exclude-table=schema_migrations -d "$1" \
        | grep -v '^--' | grep -v '^$' | grep -v '^\\\(un\)\?restrict '
}

# What the browser's roles may do. Dumped separately because pg_dump --no-privileges
# would hide exactly the thing a column-grant mistake is.
privileges() {
    PGDATABASE="$1" psql -tAX -q -c "
        select 'col', grantee, table_name, column_name, privilege_type
          from information_schema.column_privileges
         where grantee in ('anon','authenticated') and table_schema = 'public'
        union all
        select 'tab', grantee, table_name, '', privilege_type
          from information_schema.table_privileges
         where grantee in ('anon','authenticated') and table_schema = 'public'
        order by 1, 2, 3, 4, 5;"
}

ledger() { q "$1" "select string_agg(version || ':' || checksum, ',' order by version) from schema_migrations;"; }

# ---------------------------------------------------------------------------
step "The files are the canonical migrations, inlined and nothing else"
node "$ROOT/db/tools/build-r2-operator-sql.mjs" --check
pass "regenerating produces the committed files byte for byte"
for f in "$APPLY" "$ROLLBACK"; do
    [ "$(grep -c '^do \$operator_r2' "$f")" = 1 ] || fail "$f is not exactly one DO statement"
    if grep -qiE 'execute[[:space:]]*(\$|'"'"')' "$f"; then fail "$f uses dynamic SQL"; fi
    if grep -qiE '^[[:space:]]*(begin|commit|rollback);' "$f"; then fail "$f carries transaction control"; fi
    if LC_ALL=C grep -nP '[\x80-\xFF]' "$f" >/dev/null; then fail "$f contains a non-ASCII byte"; fi
done
pass "each is one DO statement, with no dynamic SQL, no transaction control and only ASCII"
for v in 0025 0026 0027 0028 0029 0030; do
    up="$(ls "$ROOT"/db/migrations/${v}_*.up.sql)"
    sed -n "/^-- >>>>>>>>>>>>>>>>>>>>>> $v CANONICAL PAYLOAD BEGINS/,/^-- >>>>>>>>>>>>>>>>>>>>>>> $v CANONICAL PAYLOAD ENDS/p" "$APPLY" \
        | sed '1,3d' | sed '$d' > "$WORK/payload-$v.sql"
    sed -n '/^begin;$/,/^commit;$/p' "$up" | sed '1d' | sed '$d' > "$WORK/canonical-$v.sql"
    diff -u "$WORK/canonical-$v.sql" "$WORK/payload-$v.sql" >/dev/null || { diff -u "$WORK/canonical-$v.sql" "$WORK/payload-$v.sql"; fail "the $v payload differs from the migration"; }
    down="$(ls "$ROOT"/db/migrations/${v}_*.down.sql)"
    sed -n "/^-- >>>>>>>>>>>>>>>>>>>>>> $v CANONICAL ROLLBACK BEGINS/,/^-- >>>>>>>>>>>>>>>>>>>>>>> $v CANONICAL ROLLBACK ENDS/p" "$ROLLBACK" \
        | sed '1,3d' | sed '$d' > "$WORK/rb-payload-$v.sql"
    sed -n '/^begin;$/,/^commit;$/p' "$down" | sed '1d' | sed '$d' > "$WORK/rb-canonical-$v.sql"
    diff -u "$WORK/rb-canonical-$v.sql" "$WORK/rb-payload-$v.sql" >/dev/null || { diff -u "$WORK/rb-canonical-$v.sql" "$WORK/rb-payload-$v.sql"; fail "the $v rollback payload differs from the down migration"; }
done
pass "all six apply payloads and all six rollback payloads are byte-identical to the canonical files"

# ---------------------------------------------------------------------------
step "1. Applying the operator file equals applying the migrations"
at_0024 radar_op_a
at_0024 radar_op_ref
PGDATABASE=radar_op_ref node "$ROOT/db/migrate.mjs" up >/dev/null
PGDATABASE=radar_op_a psql -v ON_ERROR_STOP=1 -q -f "$APPLY" 2> "$WORK/apply.log" >/dev/null || { cat "$WORK/apply.log"; fail "the operator file failed"; }
grep -q 'R2 schema foundation applied' "$WORK/apply.log" || fail "no completion notice"
diff -u <(dump radar_op_ref) <(dump radar_op_a) >/dev/null || { diff -u <(dump radar_op_ref) <(dump radar_op_a) | head -40; fail "the operator file produced a different schema from migrate.mjs"; }
pass "the schema is identical, dump for dump, to a database migrated by db/migrate.mjs"
[ "$(ledger radar_op_a)" = "$(ledger radar_op_ref)" ] || fail "the ledgers differ"
pass "the ledger is identical, checksums included"
PGDATABASE=radar_op_a node "$ROOT/db/migrate.mjs" verify >/dev/null || fail "db/migrate.mjs verify rejects an operator-applied database"
pass "db/migrate.mjs verify accepts a database migrated by the operator file"
diff -u <(privileges radar_op_ref) <(privileges radar_op_a) >/dev/null || fail "the browser's privileges differ from a migrated database"
pass "the browser roles hold exactly the privileges they hold after a normal migration"
PGDATABASE=radar_op_a node "$ROOT/db/migrate.mjs" status | tail -1 | grep -q '0 pending' || fail "migrations remain pending"
pass "nothing is pending afterwards"

# ---------------------------------------------------------------------------
step "2. A repeat refuses and changes nothing"
BEFORE="$(dump radar_op_a | md5sum)|$(ledger radar_op_a)"
refuses radar_op_a "$APPLY" "is already recorded" "a repeat application"
[ "$(dump radar_op_a | md5sum)|$(ledger radar_op_a)" = "$BEFORE" ] || fail "the refused repeat changed something"
pass "refused, database byte-identical"

# ---------------------------------------------------------------------------
step "3. Refusals that change nothing"
at_0024 radar_op_b
BEFORE="$(dump radar_op_b | md5sum)|$(ledger radar_op_b)"
q radar_op_b "update sources set access_mode = 'archived_full_text', license_mode = 'unknown' where id = 'mars-newsroom';" >/dev/null
refuses radar_op_b "$APPLY" "archive.*without a declared open or licensed posture" "a source that archives without a licence"
[ "$(q radar_op_b "select count(*) from schema_migrations where version >= '0025';")" = 0 ] || fail "a ledger row was written"
[ "$(q radar_op_b "select count(*) from information_schema.columns where table_name='sources' and column_name='rights_class';")" = 0 ] \
    || fail "a column was added"
pass "an archiving source with an unknown licence: refused with an explanation, nothing committed"
q radar_op_b "update sources set access_mode = 'reference_only' where id = 'mars-newsroom';" >/dev/null

ORG="$(q radar_op_b "insert into organizations (canonical_name, organization_role) values ('Example Zeta Foods', 'manufacturer_brand') returning id;")"
FAC="$(q radar_op_b "insert into facilities (organization_id, canonical_name) values ('$ORG', 'Example plant') returning id;")"
q radar_op_b "insert into facility_identifiers (facility_id, identifier_system, identifier_value) values ('$FAC', 'FSIS', '123');" >/dev/null
refuses radar_op_b "$APPLY" "outside the 0028 vocabulary" "a facility identifier outside the vocabulary"
[ "$(q radar_op_b "select count(*) from schema_migrations where version >= '0025';")" = 0 ] || fail "a ledger row was written"
pass "an identifier outside the vocabulary: refused with an explanation, nothing committed"
q radar_op_b "delete from facility_identifiers;" >/dev/null

ROW_0024="$(q radar_op_b "select name || '|' || checksum from schema_migrations where version = '0024';")"
q radar_op_b "delete from schema_migrations where version = '0024';" >/dev/null
refuses radar_op_b "$APPLY" "migration 0024 is not present" "a database without 0024"
q radar_op_b "insert into schema_migrations (version, name, checksum, stamped)
              values ('0024', '${ROW_0024%%|*}', '${ROW_0024##*|}', false);" >/dev/null
pass "a database without 0024: refused"

# ---------------------------------------------------------------------------
step "4. One statement: a failure at the END leaves nothing behind"
at_0024 radar_op_c
# A table of the name 0030 creates, so 0025 - 0029 have already run inside the
# statement when 0030 fails. If the file were several transactions, they would
# have committed.
q radar_op_c "create table evidence_text_fingerprints (id int);" >/dev/null
BEFORE="$(dump radar_op_c | md5sum)|$(ledger radar_op_c)"
refuses radar_op_c "$APPLY" 'relation "evidence_text_fingerprints" already exists' "a failure in the last migration"
[ "$(dump radar_op_c | md5sum)|$(ledger radar_op_c)" = "$BEFORE" ] || fail "a failure at the end left part of R2 committed"
[ "$(q radar_op_c "select count(*) from information_schema.columns where table_name='opportunities' and column_name='review_state';")" = 0 ] \
    || fail "0025 survived a failure in 0030"
pass "0025 - 0029 had run when 0030 failed: nothing committed, schema and ledger byte-identical"

# ---------------------------------------------------------------------------
step "5. The rollback file reverses it exactly"
PGDATABASE=radar_op_a psql -v ON_ERROR_STOP=1 -q -f "$ROLLBACK" 2> "$WORK/rollback.log" >/dev/null || { cat "$WORK/rollback.log"; fail "the rollback file failed"; }
grep -q 'R2 schema foundation rolled back' "$WORK/rollback.log" || fail "no completion notice"
at_0024 radar_op_ref0
diff -u <(dump radar_op_ref0) <(dump radar_op_a) >/dev/null || { diff -u <(dump radar_op_ref0) <(dump radar_op_a) | head -40; fail "rolling back did not restore the 0024 schema"; }
pass "the schema is identical, dump for dump, to a database that was never at R2"
[ "$(ledger radar_op_a)" = "$(ledger radar_op_ref0)" ] || fail "the ledger is not what it was"
pass "the ledger ends at 0024 with its original checksums"
diff -u <(privileges radar_op_ref0) <(privileges radar_op_a) >/dev/null || fail "the browser's privileges were not restored"
pass "the browser roles hold exactly the privileges they held before R2"
PGDATABASE=radar_op_a node "$ROOT/db/migrate.mjs" verify >/dev/null || fail "verify rejects the rolled-back database"
PGDATABASE=radar_op_a psql -v ON_ERROR_STOP=1 -q -f "$APPLY" >/dev/null 2>&1 || fail "R2 would not re-apply after a rollback"
pass "and R2 re-applies cleanly afterwards"

# ---------------------------------------------------------------------------
step "6. The rollback file refuses to destroy recorded work, and changes nothing"
ORG="$(q radar_op_a "insert into organizations (canonical_name, organization_role) values ('Example Eta Foods', 'manufacturer_brand') returning id;")"
OPP="$(q radar_op_a "insert into opportunities (organization_id, title, stage, confidence, capability_alignment) values ('$ORG', 'Case', 'emerging', 'possible', '{}') returning id;")"
refuse_case() {   # description | setup | needle | cleanup
    q radar_op_a "$2" >/dev/null
    local before; before="$(dump radar_op_a | md5sum)|$(ledger radar_op_a)"
    refuses radar_op_a "$ROLLBACK" "$3" "$1"
    [ "$(dump radar_op_a | md5sum)|$(ledger radar_op_a)" = "$before" ] || fail "$1: the refused rollback changed something"
    pass "$1: refused, schema and ledger byte-identical"
    q radar_op_a "$4" >/dev/null
}
refuse_case "an accepted review" "update opportunities set review_state = 'accepted' where id = '$OPP';" \
    "opportunity row(s) carry a review state" "update opportunities set review_state = 'unreviewed' where id = '$OPP';"
refuse_case "a source rights class" "update sources set rights_class = 'federal_public_record' where id = 'sec-edgar';" \
    "source(s) carry a rights class" "update sources set rights_class = 'unclassified' where id = 'sec-edgar';"
refuse_case "work still in the queue" \
    "insert into source_runs (id, source_id, status) values ('00000000-0000-4000-8000-0000000000b9', 'sec-edgar', 'success'); insert into ingestion_tasks (source_run_id, task_key) values ('00000000-0000-4000-8000-0000000000b9', 'doc-1');" \
    "ingestion task(s) are pending or running" \
    "delete from ingestion_tasks;"
q radar_op_a "delete from opportunities where id = '$OPP';" >/dev/null

# A migration later than 0030 means R2 is not the top of the ledger.
q radar_op_a "insert into schema_migrations (version, name, checksum, stamped) values ('0031', 'later', 'x', false);" >/dev/null
refuses radar_op_a "$ROLLBACK" "later than 0030 is recorded" "a later migration on top"
q radar_op_a "delete from schema_migrations where version = '0031';" >/dev/null
pass "a migration recorded after 0030: refused"

# And a rollback with nothing to roll back.
PGDATABASE=radar_op_a psql -v ON_ERROR_STOP=1 -q -f "$ROLLBACK" >/dev/null 2>&1
refuses radar_op_a "$ROLLBACK" "are not all recorded" "a second rollback"
pass "a second rollback: refused, there is no R2 to roll back"

for d in radar_op_a radar_op_b radar_op_c radar_op_ref radar_op_ref0; do psql -d postgres -q -c "drop database if exists $d;" >/dev/null; done
printf '\n\033[32mOperator files for R2: all cases passed.\033[0m\n'
