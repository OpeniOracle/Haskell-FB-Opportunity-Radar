#!/usr/bin/env bash
#
# The 2026-10 ingestion-integrity remediation, tested as the artifact an
# operator actually runs -- the committed file, byte for byte.
#
# The file corrects production DATA, so the fixture here is built to the shape
# production was observed to have on 2026-10-14 (read-only queries): one
# mars-newsroom run `running` since 2026-09-14 with no checkpoint, and 53
# mars-newsroom evidence rows holding full page text under
# access_mode = 'structured_primary'. Unrelated rows -- a SEC run, SEC evidence,
# another source -- sit beside them so "touches nothing else" is measured, not
# assumed.
#
# Cases:
#   1. production as observed: applies, and every postcondition holds
#   2. a second application refuses, and the database is byte-identical
#   3. the PR 1 runner got there first: the run is already abandoned and a later
#      Mars run closed itself as partial -- the file still applies, and leaves the
#      health that run derived alone
#   4. five preconditions, each refused with the database byte-identical
#   5. a failure injected after the evidence update rolls EVERYTHING back
#
# Assumes PGHOST/PGPORT/PGUSER are set. Creates and drops its own databases.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

OPERATOR="$ROOT/db/operator/remediation_2026_10_ingestion_integrity.operator.sql"
DB=radar_remediation_2026_10
RUN_ID='2925eada-3f3f-43e9-9279-445b202e6543'
MARKER='remediation-2026-10-ingestion-integrity'

pass() { printf '    \033[32mok\033[0m    %s\n' "$1"; }
fail() { printf '\n\033[31mFAILED: %s\033[0m\n' "$1"; exit 1; }
step() { printf '\n\033[1m-- %s\033[0m\n' "$1"; }

q() { PGDATABASE="$DB" psql -tAX -q -c "$1"; }

# Every row in the public schema, in a stable order. The comparison that proves
# a refused or rolled-back run changed nothing at all.
data_snapshot() {
    PGDATABASE="$DB" pg_dump --data-only --no-owner --no-privileges --schema=public \
        --inserts --rows-per-insert=1 -d "$DB" 2>/dev/null \
        | grep -v '^--' | grep -v '^$' | grep -v '^\\\(un\)\?restrict ' \
        | grep -v '^SET \|^SELECT pg_catalog' | sort > "$1"
}

apply() { PGDATABASE="$DB" psql -q -v ON_ERROR_STOP=1 -f "$OPERATOR"; }

# Expect a refusal whose message contains $1, and nothing changed.
refuses() {
    local why="$1" label="$2"
    data_snapshot "$WORK/before-refusal.sql"
    set +e
    PGDATABASE="$DB" psql -q -v ON_ERROR_STOP=1 -f "$OPERATOR" > "$WORK/refusal.log" 2>&1
    local status=$?
    set -e
    [ "$status" -ne 0 ] || { cat "$WORK/refusal.log"; fail "$label: the file applied when it should have refused"; }
    grep -q 'ABORT:' "$WORK/refusal.log" || { cat "$WORK/refusal.log"; fail "$label: refused, but not by a precondition"; }
    grep -q "$why" "$WORK/refusal.log" || { cat "$WORK/refusal.log"; fail "$label: refused for the wrong reason"; }
    data_snapshot "$WORK/after-refusal.sql"
    diff -u "$WORK/before-refusal.sql" "$WORK/after-refusal.sql" > /dev/null \
        || fail "$label: a refused run changed data"
    pass "$label -- refused, database byte-identical"
}

# A database at the current schema, seeded, holding production's shape.
production_shape() {
    psql -d postgres -q -c "drop database if exists $DB;" -c "create database $DB;" >/dev/null
    PGDATABASE="$DB" psql -q -v ON_ERROR_STOP=1 -f "$ROOT/db/supabase_compat.sql" >/dev/null
    PGDATABASE="$DB" node "$ROOT/db/migrate.mjs" up >/dev/null
    PGDATABASE="$DB" node "$ROOT/db/seed.mjs" >/dev/null 2>&1

    PGDATABASE="$DB" psql -q -v ON_ERROR_STOP=1 <<SQL
-- As production read on 2026-10-14: enabled, 'healthy', never succeeded.
update sources set enabled = true, health_status = 'healthy', last_success_at = null,
                   consecutive_failures = 0
 where id = 'mars-newsroom';
update sources set enabled = true, health_status = 'healthy',
                   last_success_at = '2026-10-13T06:00:24.305Z'
 where id = 'sec-edgar';

-- The stalled run, exactly as recorded.
insert into source_runs (id, source_id, status, run_status, started_at, checkpoint,
                         collection_window_start, collection_window_end)
values ('$RUN_ID', 'mars-newsroom', 'running', 'running', '2026-09-14 05:23:06.215+00', null,
        '2025-09-15T00:00:00Z', '2026-09-15T00:00:00Z');

-- An unrelated, completed SEC run.
insert into source_runs (id, source_id, status, run_status, started_at, completed_at,
                         collection_window_start, collection_window_end)
values ('11111111-2222-4333-8444-555555555555', 'sec-edgar', 'success', 'success',
        '2026-10-13T06:00:22Z', '2026-10-13T06:00:24Z',
        '2026-10-12T00:00:00Z', '2026-10-13T00:00:00Z');

-- 53 Mars rows: full page text, the wrong mode, no stored object.
insert into evidence (
    source_id, source_run_id, source_document_id, connector_id, connector_version,
    original_url, resolved_url, canonical_url, title, published_at,
    retrieved_at, content_hash, mime_type, byte_size,
    extraction_status, extraction_method, extractor_version, transformation_version,
    evidence_excerpt, evidence_locator, body_text, locator,
    access_mode, data_sensitivity_class, classification_status, review_status,
    first_seen_at, last_seen_at)
select 'mars-newsroom', '$RUN_ID', 'https://www.mars.com/news-and-stories/page-' || g,
       'mars-newsroom', '1.0.0',
       'https://www.mars.com/news-and-stories/page-' || g,
       'https://www.mars.com/news-and-stories/page-' || g,
       'https://www.mars.com/news-and-stories/page-' || g,
       'News & Stories ' || g, null,
       '2026-09-14T05:23:12Z', md5('page-' || g) || md5('page-' || g), 'text/html', 40000,
       'partial', 'connector_text_extraction', '1.0.0', '1.0.0',
       case when g = 1 then repeat('x', 429) else null end,
       jsonb_build_object('documentType', 'press_release'),
       repeat('Full copyrighted page text. ', 2400),
       'https://www.mars.com/news-and-stories/page-' || g,
       'structured_primary', 'public',
       case when g = 1 then 'supporting_evidence' else 'not_relevant' end, 'unreviewed',
       '2026-09-14T05:23:12Z', '2026-09-14T05:23:12Z'
  from generate_series(1, 53) g;

-- Unrelated SEC evidence that legitimately holds its filing text.
insert into evidence (
    source_id, source_run_id, source_document_id, connector_id, connector_version,
    original_url, resolved_url, canonical_url, title, published_at, published_precision,
    published_basis, retrieved_at, content_hash, mime_type, byte_size,
    extraction_status, extraction_method, extractor_version, transformation_version,
    evidence_excerpt, evidence_locator, body_text, locator,
    access_mode, data_sensitivity_class, classification_status, review_status,
    first_seen_at, last_seen_at)
values ('sec-edgar', '11111111-2222-4333-8444-555555555555', '0000999999-26-000010',
        'sec-edgar', '1.0.0',
        'https://www.sec.gov/Archives/edgar/data/999999/000099999926000010/exf.htm',
        'https://www.sec.gov/Archives/edgar/data/999999/000099999926000010/exf.htm',
        'https://www.sec.gov/Archives/edgar/data/999999/000099999926000010/index.htm',
        '10-Q - Example Foods, Inc.', '2026-10-08T16:31:00Z', 'exact_day', 'stated',
        '2026-10-09T06:00:00Z', repeat('b', 64), 'text/html', 900,
        'success', 'connector_text_extraction', '1.0.0', '1.0.0',
        'excerpt', jsonb_build_object('documentType', '10-Q'),
        'Government filing text, retained under archived_full_text.',
        'https://www.sec.gov/Archives/edgar/data/999999/000099999926000010/exf.htm',
        'structured_primary', 'public', 'not_relevant', 'unreviewed',
        '2026-10-09T06:00:00Z', '2026-10-09T06:00:00Z');

-- A signal derived from Mars evidence, so the excerpt-copy step has a target.
insert into signals (id, organization_id, title, summary, signal_family, event_type,
                     first_observed_at, last_observed_at, confidence,
                     independent_source_count, negative_signal, cluster_key, model_metadata)
select 'dddddddd-2222-4222-8222-dddddddddddd', o.id, 'Our History', repeat('y', 430),
       'facility_capacity', 'facility_expansion', now(), now(), 'possible', 1, false,
       'radar:mars-incorporated|facility_expansion|undated|plant',
       jsonb_build_object('derivedBy', 'pipeline@1.0.0', 'modelGenerated', false)
  from organizations o where o.entity_key = 'radar:mars-incorporated';
insert into signal_evidence (signal_id, evidence_id, evidence_role, source_family_key)
select 'dddddddd-2222-4222-8222-dddddddddddd', e.id, 'primary', 'mars-newsroom'
  from evidence e where e.source_document_id = 'https://www.mars.com/news-and-stories/page-1';
SQL
}

# ---------------------------------------------------------------------------
step "The file under test is the committed one, and is one statement"
test -f "$OPERATOR" || fail "the remediation file is missing"
printf '    sha256 of the file itself: %s\n' "$(sha256sum "$OPERATOR" | cut -d' ' -f1)"
[ "$(grep -c '^do \$remediation_2026_10\$' "$OPERATOR")" = 1 ] || fail "not exactly one DO block opening"
[ "$(grep -c '^\$remediation_2026_10\$;' "$OPERATOR")" = 1 ] || fail "not exactly one DO block closing"
pass "exactly one statement, so exactly one transaction"
if grep -qiE 'execute[[:space:]]*(\$|'"'"')' "$OPERATOR"; then fail "the file uses dynamic SQL"; fi
if grep -qiE '^[[:space:]]*(begin|commit|rollback)[[:space:]]*;' "$OPERATOR"; then
    fail "the file carries transaction control, which a DO block cannot honour"
fi
pass "no dynamic SQL, no transaction control"
if grep -rn 'remediation_2026_10' "$ROOT/db/migrate.mjs" "$ROOT/db/seed.mjs" "$ROOT/db/verify.sh" "$ROOT/app/netlify" >/dev/null 2>&1; then
    fail "the remediation is referenced by a path that runs automatically"
fi
pass "no migration, seed, deploy or function path runs it"

# ---------------------------------------------------------------------------
step "1. Production as observed: the file applies"
production_shape
[ "$(q "select count(*) from evidence where source_id='mars-newsroom' and body_text is not null;")" = 53 ] \
    || fail "fixture: expected 53 Mars rows with a body"
data_snapshot "$WORK/before.sql"
q "select id, content_hash, source_document_id from evidence where source_id='mars-newsroom' order by id;" > "$WORK/mars-identity-before.txt"
q "select row_to_json(e)::text from evidence e where source_id <> 'mars-newsroom' order by id;" > "$WORK/other-evidence-before.txt"
q "select row_to_json(s)::text from sources s where id <> 'mars-newsroom' order by id;" > "$WORK/other-sources-before.txt"
apply > "$WORK/apply.log" 2>&1 || { cat "$WORK/apply.log"; fail "the file did not apply to production's shape"; }
grep -q 'Remediation remediation-2026-10-ingestion-integrity applied' "$WORK/apply.log" || fail "no completion notice"
pass "applied"

[ "$(q "select run_status || '/' || status || '/' || error_code from source_runs where id='$RUN_ID';")" = "failure/failed/abandoned" ] \
    || fail "the stalled run was not closed as abandoned"
[ "$(q "select completed_at is not null from source_runs where id='$RUN_ID';")" = t ] || fail "no completion time"
pass "the stalled run is closed: failure / failed / abandoned"

[ "$(q "select count(*) from evidence where source_id='mars-newsroom' and body_text is not null;")" = 0 ] \
    || fail "a Mars row still holds a body"
[ "$(q "select count(*) from evidence where source_id='mars-newsroom' and access_mode <> 'reference_only';")" = 0 ] \
    || fail "a Mars row is not reference_only"
[ "$(q "select count(*) from evidence where source_id='mars-newsroom';")" = 53 ] || fail "Mars rows were added or deleted"
q "select id, content_hash, source_document_id from evidence where source_id='mars-newsroom' order by id;" > "$WORK/mars-identity-after.txt"
diff -u "$WORK/mars-identity-before.txt" "$WORK/mars-identity-after.txt" > /dev/null \
    || fail "the identity of a Mars row changed"
[ "$(q "select evidence_locator->'accessModeRemediated'->>'from' from evidence where source_id='mars-newsroom' limit 1;")" = structured_primary ] \
    || fail "the row does not record what it was remediated from"
[ "$(q "select length(evidence_excerpt) from evidence where source_document_id='https://www.mars.com/news-and-stories/page-1';")" = 429 ] \
    || fail "an excerpt inside the bound was altered"
pass "53 rows: no body, reference_only, identity and hash unchanged, the change recorded on each row"

# The database's own guard now holds them: a body cannot be put back.
if q "update evidence set body_text = 'x' where source_id='mars-newsroom';" >/dev/null 2>&1; then
    fail "evidence_reference_only_has_no_body did not refuse a body on a remediated row"
fi
pass "evidence_reference_only_has_no_body now guards the corrected rows"

[ "$(q "select health_status || '/' || consecutive_failures from sources where id='mars-newsroom';")" = "action_required/1" ] \
    || fail "Mars health is not action_required/1: $(q "select health_status || '/' || consecutive_failures from sources where id='mars-newsroom';")"
[ "$(q "select last_success_at is null from sources where id='mars-newsroom';")" = t ] || fail "last_success_at was invented"
[ "$(q "select count(*) from source_health_events where source_id='mars-newsroom' and event_type='operator_remediation' and prior_status='healthy' and new_status='action_required';")" = 1 ] \
    || fail "no health event records the correction"
pass "Mars health: healthy -> action_required, one event, last_success_at still null"

[ "$(q "select count(*) from audit_events where request_id='$MARKER';")" = 1 ] || fail "no audit record"
[ "$(q "select jsonb_array_length(before_state->'evidenceIds') from audit_events where request_id='$MARKER';")" = 53 ] \
    || fail "the audit record does not list the 53 rows"
if q "select before_state::text || after_state::text from audit_events where request_id='$MARKER';" | grep -q 'Full copyrighted page text'; then
    fail "the audit record carries page text"
fi
pass "one audit record listing the 53 rows and their hashes, carrying no page text"

q "select row_to_json(e)::text from evidence e where source_id <> 'mars-newsroom' order by id;" > "$WORK/other-evidence-after.txt"
q "select row_to_json(s)::text from sources s where id <> 'mars-newsroom' order by id;" > "$WORK/other-sources-after.txt"
diff -u "$WORK/other-evidence-before.txt" "$WORK/other-evidence-after.txt" > /dev/null || fail "unrelated evidence changed"
diff -u "$WORK/other-sources-before.txt" "$WORK/other-sources-after.txt" > /dev/null || fail "another source changed"
[ "$(q "select body_text from evidence where source_id='sec-edgar';")" = 'Government filing text, retained under archived_full_text.' ] \
    || fail "the SEC body was touched"
pass "unrelated evidence and sources byte-identical; the SEC body is untouched"

# ---------------------------------------------------------------------------
step "2. A second application refuses, and changes nothing"
refuses 'already recorded in audit_events' "second application"

# ---------------------------------------------------------------------------
step "3. The PR 1 runner recovered the run first; a later Mars run closed itself, partial"
production_shape
PGDATABASE="$DB" psql -q -v ON_ERROR_STOP=1 <<SQL
update source_runs set status = 'failed', run_status = 'failure', error_code = 'abandoned',
       completed_at = '2026-10-15T06:00:01Z',
       error_summary = 'Run abandoned: no heartbeat since 2026-09-14T05:23:06.215Z'
 where id = '$RUN_ID';
insert into source_runs (source_id, status, run_status, started_at, completed_at,
                         collection_window_start, collection_window_end, checkpoint)
values ('mars-newsroom', 'partial_success', 'partial_success', '2026-10-15T06:00:02Z',
        '2026-10-15T06:00:21Z', '2026-10-14T00:00:00Z', '2026-10-15T00:00:00Z',
        'lease|00000000-0000-4000-8000-000000000000|2026-10-15T06:00:20.000Z');
-- A budget-limited run: partial, degraded, and -- because it did not check
-- everything it discovered -- last_success_at stays NULL.
update sources set health_status = 'degraded', consecutive_failures = 1,
                   last_success_at = null
 where id = 'mars-newsroom';
SQL
q "select row_to_json(r)::text from source_runs r where id = '$RUN_ID';" > "$WORK/run-before.txt"
apply > "$WORK/apply-b.log" 2>&1 || { cat "$WORK/apply-b.log"; fail "the file did not apply after the runner's recovery"; }
q "select row_to_json(r)::text from source_runs r where id = '$RUN_ID';" > "$WORK/run-after.txt"
diff -u "$WORK/run-before.txt" "$WORK/run-after.txt" > /dev/null || fail "an already-abandoned run was rewritten"
[ "$(q "select health_status || '/' || consecutive_failures from sources where id='mars-newsroom';")" = "degraded/1" ] \
    || fail "health derived by a run that closed itself was overridden"
[ "$(q "select last_success_at is null from sources where id='mars-newsroom';")" = t ] \
    || fail "last_success_at was set by the remediation"
[ "$(q "select count(*) from evidence where source_id='mars-newsroom' and body_text is not null;")" = 0 ] \
    || fail "bodies remain"
[ "$(q "select (after_state->'stalledRun'->>'closedHere') from audit_events where request_id='$MARKER';")" = false ] \
    || fail "the audit record claims this file closed the run"
pass "applies after the runner: the abandoned run and the derived health are left as they were"

# ---------------------------------------------------------------------------
step "4. Preconditions refuse, and change nothing"
production_shape
# A 54th body-bearing row: a copy of an existing one under a new identity.
q "insert into evidence
   select (jsonb_populate_record(null::evidence,
             to_jsonb(e) || jsonb_build_object('id', gen_random_uuid(),
                                               'source_document_id', 'page-54',
                                               'content_hash', repeat('c', 64),
                                               'original_url', 'https://www.mars.com/p54'))).*
     from evidence e where e.source_document_id = 'https://www.mars.com/news-and-stories/page-2';" >/dev/null
refuses 'expected exactly 53' "a 54th row the file was not written for"

production_shape
q "update evidence set raw_storage_uri = 'evidence/mars/page-2.html'
    where source_document_id = 'https://www.mars.com/news-and-stories/page-2';" >/dev/null
refuses 'reference a Storage object' "a row that references a Storage object"

production_shape
q "update sources set access_mode = 'archived_full_text' where id = 'mars-newsroom';" >/dev/null
refuses 'is not access_mode reference_only' "a registry that does not say reference_only"

production_shape
q "update source_runs set status = 'success', run_status = 'success', completed_at = now() where id = '$RUN_ID';" >/dev/null
refuses 'neither still running nor closed as abandoned' "a run in a state the file was not written for"

production_shape
q "delete from evidence where source_run_id = '$RUN_ID';" >/dev/null
q "delete from source_runs where id = '$RUN_ID';" >/dev/null
refuses 'is not present' "a database without the stalled run"

# ---------------------------------------------------------------------------
step "5. A failure after the evidence update rolls everything back"
production_shape
# Refuse the audit insert -- the LAST write -- so the run close, the 53-row
# update and the health change have all executed before the failure.
q "alter table audit_events add constraint injected_failure check (request_id is distinct from '$MARKER');" >/dev/null
data_snapshot "$WORK/before-injected.sql"
set +e
apply > "$WORK/injected.log" 2>&1
status=$?
set -e
[ "$status" -ne 0 ] || fail "the injected failure did not fail the file"
grep -q 'injected_failure' "$WORK/injected.log" || { cat "$WORK/injected.log"; fail "failed for a different reason"; }
data_snapshot "$WORK/after-injected.sql"
diff -u "$WORK/before-injected.sql" "$WORK/after-injected.sql" > /dev/null \
    || fail "a late failure left part of the remediation committed"
[ "$(q "select run_status from source_runs where id='$RUN_ID';")" = running ] || fail "the run close survived the rollback"
[ "$(q "select count(*) from evidence where source_id='mars-newsroom' and body_text is not null;")" = 53 ] \
    || fail "the evidence update survived the rollback"
pass "late failure: nothing committed, database byte-identical"

psql -d postgres -q -c "drop database if exists $DB;" >/dev/null
printf '\n\033[32mRemediation 2026-10: all cases passed.\033[0m\n'
