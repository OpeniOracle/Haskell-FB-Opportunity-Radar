#!/usr/bin/env bash
#
# The R2 schema foundation lands on a database that ALREADY HOLDS DATA.
#
# A migration that is correct on an empty database and wrong on a populated one
# is the common failure, and production is populated. So this builds a database
# exactly as production is -- migrated to 0024 and seeded -- fills it with rows
# that PREDATE R2, applies R2, and asks the questions that matter:
#
#   1. Did any existing row change? (The pre-existing columns of every touched
#      table must be BYTE-IDENTICAL before and after.)
#   2. Do the new columns say nothing? (Defaults only: unreviewed, unknown,
#      not_assessed, unclassified, NULL.)
#   3. Do the write paths the application already uses still work?
#   4. Does the reviewed seed classify the pilot sources without touching an
#      access mode, and without overriding a decision an operator made?
#   5. Does rolling back restore EXACTLY the database that was there?
#   6. Does rolling back REFUSE, changing nothing, when it would destroy work?
#   7. When existing rows would violate a new rule, does the migration refuse
#      atomically, naming the rule, and apply cleanly once the row is fixed?
#
# Nothing here is run against a Supabase project.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DB=radar_r2_existing

pass() { printf '    \033[32mok\033[0m    %s\n' "$1"; }
fail() { printf '\n\033[31mFAILED: %s\033[0m\n' "$1"; exit 1; }
step() { printf '\n\033[1m-- %s\033[0m\n' "$1"; }

q() { PGDATABASE="$DB" psql -tAX -q -v ON_ERROR_STOP=1 -c "$1"; }
migrate() { PGDATABASE="$DB" node "$ROOT/db/migrate.mjs" "$@"; }
seed() { PGDATABASE="$DB" node "$ROOT/db/seed.mjs" "$@" >/dev/null; }

# Applies the named seed files and NOTHING ELSE, in one transaction. `db/seed.mjs`
# cannot be asked for "everything before 0009", and it verifies the whole cohort
# after every run; a database at 0024 needs the seeds that predate R2, exactly as
# production has them, without the one that needs a column R2 adds.
seed_files() {
    local sql="begin;" v f
    for v in "$@"; do
        for f in "$ROOT"/db/seed/${v}_*.sql; do sql+=$'\n'"$(cat "$f")"; done
    done
    # Some seeds carry their own begin/commit, which psql warns about when they are
    # nested. The warning is noise; a real failure still stops the script.
    printf '%s\ncommit;\n' "$sql" | PGDATABASE="$DB" psql -q -v ON_ERROR_STOP=1 -f - >/dev/null \
        2> >(grep -v 'transaction in progress' >&2)
}

# Runs SQL that must FAIL, and requires the failure to mention $2.
refuses() {
    local out
    if out=$(PGDATABASE="$DB" psql -tAX -q -v ON_ERROR_STOP=1 -c "$1" 2>&1); then
        fail "$3: the statement succeeded, but should have been refused"
    fi
    printf '%s' "$out" | grep -q "$2" || { printf '%s\n' "$out"; fail "$3: refused, but not for the expected reason ($2)"; }
}

# Runs a migrate command that must FAIL, mentioning $1; prints nothing on success.
migrate_refuses() {
    local needle="$1"; shift
    local out
    if out=$(PGDATABASE="$DB" node "$ROOT/db/migrate.mjs" "$@" 2>&1); then
        fail "migrate $*: succeeded, but should have been refused"
    fi
    printf '%s' "$out" | grep -q "$needle" || { printf '%s\n' "$out"; fail "migrate $*: refused, but not for the expected reason ($needle)"; }
}

fresh() {
    psql -d postgres -q -c "drop database if exists $DB;" -c "create database $DB;" >/dev/null
    PGDATABASE="$DB" psql -q -v ON_ERROR_STOP=1 -f "$ROOT/db/supabase_compat.sql" >/dev/null
}

# The pre-R2 columns of each touched table, as one hash. `-` removes a key from a
# jsonb object, so the SAME function reads the table before R2 (where the new
# keys do not exist, and removing a missing key is a no-op) and after it.
NEW_COLS="array['review_state','project_lifecycle','commercial_qualification','rights_class','event_date_role']"
snapshot() {
    q "select md5(string_agg(t, '|' order by t)) from (
         select (to_jsonb(o) - $NEW_COLS)::text as t from opportunities o
         union all select (to_jsonb(s) - $NEW_COLS)::text from sources s
         union all select (to_jsonb(g) - $NEW_COLS)::text from signals g
         union all select to_jsonb(f)::text from facility_identifiers f
         union all select to_jsonb(e)::text from evidence e
         union all select to_jsonb(h)::text from opportunity_status_history h
       ) x;"
}

counts() {
    q "select (select count(*) from opportunities) || ',' || (select count(*) from sources) || ',' ||
              (select count(*) from signals) || ',' || (select count(*) from facility_identifiers) || ',' ||
              (select count(*) from evidence) || ',' || (select count(*) from opportunity_status_history);"
}

# ---------------------------------------------------------------------------
step "A database at 0024 and seeded, as production is, holding rows that predate R2"
fresh
migrate up --to 0024 >/dev/null
seed_files 0001 0002 0003 0004 0005 0006 0007 0008
[ "$(q "select max(version) from schema_migrations;")" = 0024 ] || fail "not at 0024"

q "insert into source_runs (id, source_id, status, run_status)
   values ('00000000-0000-4000-8000-0000000000b1', 'sec-edgar', 'success', 'success');"
q "insert into evidence (id, source_id, source_run_id, original_url, resolved_url, title,
                         retrieved_at, content_hash, mime_type, extraction_status, access_mode)
   values ('00000000-0000-4000-8000-0000000000e1', 'sec-edgar', '00000000-0000-4000-8000-0000000000b1',
           'https://example.invalid/a', 'https://example.invalid/a', 'Existing filing',
           now(), repeat('a', 64), 'text/html', 'success', 'archived_full_text'),
          ('00000000-0000-4000-8000-0000000000e2', 'mars-newsroom', '00000000-0000-4000-8000-0000000000b1',
           'https://example.invalid/b', 'https://example.invalid/b', 'Existing release',
           now(), repeat('b', 64), 'text/html', 'success', 'reference_only');"
ORG="$(q "select id from organizations order by canonical_name limit 1;")"
q "insert into opportunities (id, organization_id, title, stage, status, confidence, capability_alignment,
                              opportunity_key, derived_by, derived_at, project_maturity)
   values ('00000000-0000-4000-8000-0000000000c1', '$ORG', 'Existing new',     'emerging',   'new',      'possible', '{}', 'k-1', 'connector:sec-edgar', now(), 7),
          ('00000000-0000-4000-8000-0000000000c2', '$ORG', 'Existing watched', 'developing', 'watching', 'probable', '{}', 'k-2', 'connector:sec-edgar', now(), 11),
          ('00000000-0000-4000-8000-0000000000c3', '$ORG', 'Existing pursued', 'developing', 'pursue',   'probable', '{}', null,  null, null, 14),
          ('00000000-0000-4000-8000-0000000000c4', '$ORG', 'Existing expired', 'emerging',   'expired',  'possible', '{}', 'k-4', 'connector:sec-edgar', now(), 3);"
q "insert into opportunity_status_history (opportunity_id, from_status, to_status, actor_type, actor_id)
   values ('00000000-0000-4000-8000-0000000000c3', 'new', 'pursue', 'user', 'tester');"
q "insert into signals (id, organization_id, title, summary, signal_family, event_type, event_date,
                        event_date_precision, event_date_basis, first_observed_at, last_observed_at, confidence)
   values ('00000000-0000-4000-8000-0000000000d1', '$ORG', 'Existing dated', 's', 'facility_capacity',
           'new_facility_announced', '2026-03-02', 'exact_day', 'stated', now(), now(), 'possible'),
          ('00000000-0000-4000-8000-0000000000d2', '$ORG', 'Existing undated', 's', 'facility_capacity',
           'facility_expansion', null, null, null, now(), now(), 'possible');"
FAC="$(q "insert into facilities (organization_id, canonical_name) values ('$ORG', 'Existing plant') returning id;")"
q "insert into facility_identifiers (facility_id, identifier_system, identifier_value)
   values ('$FAC', 'frs_registry_id', '110000000001'), ('$FAC', 'fsis_establishment_number', 'M0001');"
pass "4 opportunities, 2 signals, 2 sources' evidence, 2 identifiers, 1 history row: all older than R2"

BEFORE_SNAP="$(snapshot)"
BEFORE_COUNTS="$(counts)"
BEFORE_LEDGER="$(q "select count(*) from schema_migrations;")"
SEC_MODE="$(q "select access_mode || '/' || license_mode from sources where id='sec-edgar';")"
MARS_MODE="$(q "select access_mode || '/' || license_mode from sources where id='mars-newsroom';")"

# ---------------------------------------------------------------------------
step "1. R2 applies, and no existing row changes"
migrate up >/dev/null
[ "$(q "select max(version) from schema_migrations;")" = 0030 ] || fail "R2 did not reach 0030"
[ "$(counts)" = "$BEFORE_COUNTS" ] || fail "a row count changed: $BEFORE_COUNTS -> $(counts)"
pass "no row was added or removed: $BEFORE_COUNTS"
[ "$(snapshot)" = "$BEFORE_SNAP" ] || fail "an existing column of an existing row changed"
pass "every pre-existing column of every pre-existing row is byte-identical"
[ "$(q "select access_mode || '/' || license_mode from sources where id='sec-edgar';")" = "$SEC_MODE" ] \
    && [ "$(q "select access_mode || '/' || license_mode from sources where id='mars-newsroom';")" = "$MARS_MODE" ] \
    || fail "an access mode or licence changed"
pass "no access mode or licence was touched ($SEC_MODE, $MARS_MODE)"

# ---------------------------------------------------------------------------
step "2. The new columns assert nothing about rows that predate them"
[ "$(q "select count(*) from opportunities where review_state='unreviewed' and project_lifecycle='unknown' and commercial_qualification='not_assessed';")" = 4 ] \
    || fail "an existing opportunity reads as something other than unreviewed, unknown and not assessed"
pass "all 4 opportunities: unreviewed, unknown, not_assessed"
[ "$(q "select count(*) from opportunities where status in ('pursue','watching') and review_state='unreviewed';")" = 2 ] \
    || fail "existing statuses were reinterpreted"
pass "existing statuses and stages are as they were (a pursued row is still pursued, and still unreviewed)"
[ "$(q "select count(*) from sources where rights_class <> 'unclassified';")" = 0 ] || fail "a source was classified by the migration"
pass "every source is unclassified until the reviewed seed says otherwise"
[ "$(q "select count(*) from signals where event_date_role is not null;")" = 0 ] || fail "a signal was given a role"
pass "no signal was given a date role: NULL means not recorded"
[ "$(q "select count(*) from ingestion_tasks;")" = 0 ] && [ "$(q "select count(*) from evidence_text_fingerprints;")" = 0 ] \
    || fail "R2 wrote a row"
pass "the work queue and the fingerprint table are empty: R2 enqueues and remembers nothing"

# ---------------------------------------------------------------------------
step "3. Rolling back restores EXACTLY the database that was there"
# Nothing has been written since R2 applied, so every new column still holds its
# default and the rollback has nothing to refuse. What it must do is leave the
# pre-existing data as it found it -- compared by hash, not by eye.
migrate down --to 0024 >/dev/null
[ "$(q "select max(version) from schema_migrations;")" = 0024 ] || fail "rollback did not stop at 0024"
[ "$(q "select count(*) from schema_migrations;")" = "$BEFORE_LEDGER" ] || fail "the ledger is not as it was"
[ "$(counts)" = "$BEFORE_COUNTS" ] || fail "a row count changed across the round trip"
[ "$(snapshot)" = "$BEFORE_SNAP" ] || fail "the round trip changed an existing row"
[ "$(q "select count(*) from information_schema.columns where table_name='opportunities' and column_name in ('review_state','project_lifecycle','commercial_qualification');")" = 0 ] \
    || fail "an opportunity column survived the rollback"
[ "$(q "select count(*) from information_schema.tables where table_name in ('ingestion_tasks','evidence_text_fingerprints');")" = 0 ] \
    || fail "an R2 table survived the rollback"
pass "0024 -> R2 -> 0024: the ledger, the row counts and a hash of every existing row are identical"
migrate up >/dev/null
pass "and R2 re-applies cleanly afterwards"

# ---------------------------------------------------------------------------
step "4. The writes the application already makes still succeed"
q "update opportunities set updated_at = now(), last_material_change_at = now(), derived_at = now()
    where id = '00000000-0000-4000-8000-0000000000c1';" >/dev/null
pass "the pipeline's refresh of an existing opportunity"
q "insert into opportunities (organization_id, title, stage, status, confidence, capability_alignment,
                              opportunity_key, derived_by, derived_at, last_material_change_at)
   values ('$ORG', 'Derived after R2', 'emerging', 'new', 'possible', '{}', 'k-5', 'connector:sec-edgar', now(), now());" >/dev/null
[ "$(q "select review_state || '/' || commercial_qualification from opportunities where opportunity_key='k-5';")" = "unreviewed/not_assessed" ] \
    || fail "a derived opportunity was created as something other than unreviewed and not assessed"
pass "a new derived opportunity, written as the pipeline writes it, is unreviewed and not assessed"
q "update sources set health_status = 'degraded', consecutive_failures = 1, updated_at = now() where id = 'sec-edgar';" >/dev/null
q "update sources set last_success_at = now(), health_status = 'healthy', consecutive_failures = 0 where id = 'mars-newsroom';" >/dev/null
pass "the runner's health writes on an unclassified source"
q "update signals set independent_source_count = 2, last_observed_at = now() where id = '00000000-0000-4000-8000-0000000000d1';" >/dev/null
pass "the pipeline's refresh of an existing signal"
q "insert into facility_identifiers (facility_id, identifier_system, identifier_value) values ('$FAC', 'npdes_permit_id', 'TX0000001');" >/dev/null
pass "a facility identifier in the new vocabulary"

# What the browser reads, as the browser's role, on rows that predate R2.
as_browser() { PGDATABASE="$DB" psql -tAX -q -v ON_ERROR_STOP=1 -c "set role authenticated; $1" 2>&1; }
as_browser "select id, title, stage, status, confidence, why_it_matters, last_material_change_at, review_state, project_lifecycle, commercial_qualification from opportunities;" >/dev/null \
    || fail "the browser cannot read opportunities"
as_browser "select id, name, enabled, health_status, last_success_at, expected_cadence_hours, rights_class from sources;" >/dev/null \
    || fail "the browser cannot read sources"
as_browser "select id, title, event_date, event_date_role from signals;" >/dev/null || fail "the browser cannot read signals"
pass "the browser reads the old columns and the new ones, as itself"

# ---------------------------------------------------------------------------
step "5. The reviewed seed classifies the pilot sources, and only the unclassified ones"
seed 0009
[ "$(q "select string_agg(id || '=' || rights_class, ',' order by id) from sources;")" = \
  "fsis-mpi=federal_public_record,mars-newsroom=corporate_first_party,sec-edgar=federal_public_record" ] \
    || fail "the seed classified the pilot sources wrongly: $(q "select string_agg(id || '=' || rights_class, ',' order by id) from sources;")"
pass "sec-edgar and fsis-mpi are federal public records; mars-newsroom is corporate first-party"
[ "$(q "select access_mode || '/' || license_mode from sources where id='sec-edgar';")" = "$SEC_MODE" ] \
    && [ "$(q "select access_mode || '/' || license_mode from sources where id='mars-newsroom';")" = "$MARS_MODE" ] \
    || fail "the seed changed an access mode"
pass "classifying a source changed no access mode and no licence"
SNAP_A="$(q "select md5(string_agg(to_jsonb(s)::text, '|' order by id)) from sources s;")"
seed 0009
[ "$(q "select md5(string_agg(to_jsonb(s)::text, '|' order by id)) from sources s;")" = "$SNAP_A" ] || fail "re-running the seed changed something"
pass "re-running the seed changes nothing"
q "update sources set rights_class = 'discovery_or_republication' where id = 'mars-newsroom';" >/dev/null
seed 0009
[ "$(q "select rights_class from sources where id='mars-newsroom';")" = discovery_or_republication ] \
    || fail "the seed overrode a classification an operator made"
pass "the seed never overrides a class that has been set"
q "update sources set rights_class = 'unclassified';" >/dev/null

# ---------------------------------------------------------------------------
step "6. Rolling back REFUSES, and changes nothing, when it would destroy recorded work"
# The harness rolls back one migration at a time, each in its own transaction, so
# a refusal at 0025 would be reached only after 0030..0026 had already been
# reverted. Each case therefore first rolls back to the migration under test --
# which leaves it applied -- records the work there, and asks for the ONE
# rollback that must refuse.
LEDGER_FULL="$(q "select string_agg(version, ',' order by version) from schema_migrations;")"

check_refusal() {   # description | migration under test | setup | needle | cleanup
    local v="$2" prev; prev="$(printf '%04d' $((10#$2 - 1)))"
    migrate down --to "$v" >/dev/null
    q "$3" >/dev/null
    local before; before="$(snapshot)|$(q "select string_agg(version, ',' order by version) from schema_migrations;")"
    migrate_refuses "$4" down --to "$prev"
    [ "$(snapshot)|$(q "select string_agg(version, ',' order by version) from schema_migrations;")" = "$before" ] \
        || fail "$1: the refused rollback changed something"
    [ "$(q "select max(version) from schema_migrations;")" = "$v" ] || fail "$1: the ledger moved"
    pass "$1: refused at $v, database byte-identical"
    q "$5" >/dev/null
    migrate up >/dev/null
}

check_refusal "an accepted review" 0025 \
    "update opportunities set review_state = 'accepted' where id = '00000000-0000-4000-8000-0000000000c2';" \
    "opportunity row(s) carry a review state" \
    "update opportunities set review_state = 'unreviewed' where id = '00000000-0000-4000-8000-0000000000c2';"
check_refusal "a recorded project lifecycle" 0025 \
    "update opportunities set project_lifecycle = 'under_construction' where id = '00000000-0000-4000-8000-0000000000c2';" \
    "opportunity row(s) carry a review state" \
    "update opportunities set project_lifecycle = 'unknown' where id = '00000000-0000-4000-8000-0000000000c2';"
check_refusal "a recorded commercial qualification" 0025 \
    "update opportunities set review_state = 'accepted', commercial_qualification = 'no_open_work' where id = '00000000-0000-4000-8000-0000000000c4';" \
    "opportunity row(s) carry a review state" \
    "update opportunities set review_state = 'unreviewed', commercial_qualification = 'not_assessed' where id = '00000000-0000-4000-8000-0000000000c4';"
check_refusal "a source rights class" 0026 \
    "update sources set rights_class = 'federal_public_record' where id = 'sec-edgar';" \
    "source(s) carry a rights class" \
    "update sources set rights_class = 'unclassified' where id = 'sec-edgar';"
check_refusal "an event date role" 0027 \
    "update signals set event_date_role = 'announcement' where id = '00000000-0000-4000-8000-0000000000d1';" \
    "signal(s) carry an event date role" \
    "update signals set event_date_role = null where id = '00000000-0000-4000-8000-0000000000d1';"
check_refusal "work still in the queue" 0029 \
    "insert into ingestion_tasks (source_run_id, task_key) values ('00000000-0000-4000-8000-0000000000b1', 'doc-1');" \
    "ingestion task(s) are pending or running" \
    "delete from ingestion_tasks;"
[ "$(q "select string_agg(version, ',' order by version) from schema_migrations;")" = "$LEDGER_FULL" ] || fail "the ledger changed"
pass "after every refusal and clean-up the ledger is exactly where it started"

# A FINISHED task is history, not work in flight: it does not block a rollback.
migrate down --to 0029 >/dev/null
q "insert into ingestion_tasks (source_run_id, task_key, status, completed_at)
   values ('00000000-0000-4000-8000-0000000000b1', 'doc-done', 'success', now());" >/dev/null
migrate down --to 0028 >/dev/null
[ "$(q "select count(*) from information_schema.tables where table_name='ingestion_tasks';")" = 0 ] || fail "a finished task blocked the rollback"
pass "a finished task is history: it does not block a rollback"
migrate up >/dev/null

# ---------------------------------------------------------------------------
step "7a. Existing rows that would violate a new rule: the migration refuses atomically"
fresh
migrate up --to 0024 >/dev/null
seed_files 0002 0006
# The state the unapplied R1 remediation exists to correct is NOT this one (that
# concerns evidence rows). This is a REGISTRY that archives a corporate source
# without having declared a licence, which 0026 makes unrepresentable.
q "update sources set access_mode = 'archived_full_text', license_mode = 'unknown' where id = 'mars-newsroom';" >/dev/null
migrate up --to 0025 >/dev/null
SNAP="$(q "select md5(string_agg(to_jsonb(s)::text, '|' order by id)) from sources s;")"
migrate_refuses "sources_archive_requires_established_rights" up --to 0026
[ "$(q "select max(version) from schema_migrations;")" = 0025 ] || fail "0026 left a ledger row behind"
[ "$(q "select count(*) from information_schema.columns where table_name='sources' and column_name='rights_class';")" = 0 ] \
    || fail "0026 left its column behind"
[ "$(q "select md5(string_agg(to_jsonb(s)::text, '|' order by id)) from sources s;")" = "$SNAP" ] || fail "0026 changed a source on its way to refusing"
pass "0026 refuses, naming sources_archive_requires_established_rights: no column, no ledger row, no change"
q "update sources set access_mode = 'reference_only' where id = 'mars-newsroom';" >/dev/null
migrate up --to 0026 >/dev/null
pass "once the registry says reference_only, 0026 applies"

step "7b. A facility identifier outside the vocabulary: 0028 refuses atomically"
ORG="$(q "insert into organizations (canonical_name, organization_role) values ('Example Epsilon Foods', 'manufacturer_brand') returning id;")"
migrate up --to 0027 >/dev/null
FAC="$(q "insert into facilities (organization_id, canonical_name) values ('$ORG', 'Existing plant') returning id;")"
q "insert into facility_identifiers (facility_id, identifier_system, identifier_value) values ('$FAC', 'FSIS', '123');" >/dev/null
migrate_refuses "facility_identifiers_system_check" up --to 0028
[ "$(q "select max(version) from schema_migrations;")" = 0027 ] || fail "0028 left a ledger row behind"
pass "0028 refuses, naming facility_identifiers_system_check: nothing committed"
q "update facility_identifiers set identifier_system = 'fsis_establishment_number' where identifier_system = 'FSIS';" >/dev/null
migrate up >/dev/null
[ "$(q "select max(version) from schema_migrations;")" = 0030 ] || fail "R2 did not complete after the fix"
pass "once the row is corrected, R2 completes"

psql -d postgres -q -c "drop database if exists $DB;" >/dev/null
printf '\n\033[32mR2 on existing data: every case passed.\033[0m\n'
