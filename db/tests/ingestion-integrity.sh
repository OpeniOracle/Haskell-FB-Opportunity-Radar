#!/usr/bin/env bash
#
# Phase 2 PR 1 changed what the runner and the pipeline WRITE, without a
# migration. This proves, against a real PostgreSQL built only from the
# migrations, that every value they now write is one the constraints admit --
# and that the database properties the code RELIES on actually hold:
#
#   - an abandoned run closes as failed / failure / 'abandoned'
#   - a lease checkpoint is stored verbatim in `source_runs.checkpoint`
#   - the compare-and-set the recovery and the holder use matches a row only
#     while the checkpoint is exactly what was read
#   - `source_runs_single_active_uidx` refuses a second running run
#   - the health values ('degraded', 'action_required') and the new event types
#     are accepted
#   - a reference-only evidence row as the pipeline now builds it is accepted,
#     and the same row WITH a body is refused: the constraint guards the real
#     write path
#
# The application suite drives the same code against a PostgREST double; this
# is the half a double cannot prove.
#
# Assumes PGHOST/PGPORT/PGUSER are set. Creates and drops its own database.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DB=radar_ingestion_integrity

pass() { printf '    \033[32mok\033[0m    %s\n' "$1"; }
fail() { printf '\n\033[31mFAILED: %s\033[0m\n' "$1"; exit 1; }
step() { printf '\n\033[1m-- %s\033[0m\n' "$1"; }

q() { PGDATABASE="$DB" psql -tAX -q -v ON_ERROR_STOP=1 -c "$1"; }
# Refused, and refused BY THE NAMED CONSTRAINT -- a refusal for any other
# reason (a typo, a missing column) would otherwise pass for the right one.
refused() {
    local out
    if out=$(PGDATABASE="$DB" psql -tAX -q -v ON_ERROR_STOP=1 -c "$1" 2>&1); then return 1; fi
    printf '%s' "$out" | grep -q "$2" || { printf '%s\n' "$out"; return 1; }
}

step "A database built only from the migrations, seeded"
psql -d postgres -q -c "drop database if exists $DB;" -c "create database $DB;" >/dev/null
PGDATABASE="$DB" psql -q -v ON_ERROR_STOP=1 -f "$ROOT/db/supabase_compat.sql" >/dev/null
PGDATABASE="$DB" node "$ROOT/db/migrate.mjs" up >/dev/null
PGDATABASE="$DB" node "$ROOT/db/seed.mjs" >/dev/null 2>&1
pass "schema at $(q "select max(version) from public.schema_migrations;")"

# ---------------------------------------------------------------------------
step "The run lifecycle's writes"
LEASE_A='lease|aaaaaaaa-0000-4000-8000-000000000001|2026-10-14T06:00:00.000Z'
LEASE_B='lease|aaaaaaaa-0000-4000-8000-000000000001|2026-10-14T06:00:05.000Z'

q "insert into source_runs (id, source_id, status, run_status, started_at, checkpoint,
                            collection_window_start, collection_window_end)
   values ('00000000-0000-4000-8000-0000000000a1', 'sec-edgar', 'running', 'running',
           '2026-10-14T06:00:00Z', '$LEASE_A', '2026-10-13T00:00:00Z', '2026-10-14T00:00:00Z');"
[ "$(q "select checkpoint from source_runs where id = '00000000-0000-4000-8000-0000000000a1';")" = "$LEASE_A" ] \
    || fail "the lease checkpoint was not stored verbatim"
pass "a lease checkpoint is stored verbatim"

if ! refused "insert into source_runs (source_id, status, run_status, started_at,
                      collection_window_start, collection_window_end)
              values ('sec-edgar', 'running', 'running', now(), '2026-10-12T00:00:00Z', '2026-10-13T00:00:00Z');" \
              source_runs_single_active_uidx; then
    fail "a second running run for one source was accepted"
fi
pass "source_runs_single_active_uidx refuses a second running run"

# The holder renews: matches while the checkpoint is what it last wrote.
[ "$(q "with u as (update source_runs set checkpoint = '$LEASE_B'
         where id = '00000000-0000-4000-8000-0000000000a1' and run_status = 'running'
           and checkpoint = '$LEASE_A' returning 1) select count(*) from u;")" = 1 ] \
    || fail "a renewal against the current checkpoint matched nothing"
# A recovery that read the OLD checkpoint now matches nothing.
[ "$(q "with u as (update source_runs set status = 'failed', run_status = 'failure', error_code = 'abandoned'
         where id = '00000000-0000-4000-8000-0000000000a1' and run_status = 'running'
           and checkpoint = '$LEASE_A' returning 1) select count(*) from u;")" = 0 ] \
    || fail "an abandonment based on a stale read closed a renewed run"
[ "$(q "select run_status from source_runs where id = '00000000-0000-4000-8000-0000000000a1';")" = running ] \
    || fail "the renewed run is no longer running"
pass "compare-and-set: a renewal wins over an abandonment based on a stale read"

# The abandonment against the current checkpoint: the vocabulary is accepted.
[ "$(q "with u as (update source_runs set status = 'failed', run_status = 'failure', error_code = 'abandoned',
                completed_at = now(), error_summary = 'Run abandoned: no heartbeat'
         where id = '00000000-0000-4000-8000-0000000000a1' and run_status = 'running'
           and checkpoint = '$LEASE_B' returning 1) select count(*) from u;")" = 1 ] \
    || fail "the abandonment was refused"
pass "an abandoned run closes as failed / failure / abandoned"

# A holder whose run was taken: its close matches nothing.
[ "$(q "with u as (update source_runs set status = 'success', run_status = 'success'
         where id = '00000000-0000-4000-8000-0000000000a1' and run_status = 'running'
           and checkpoint = '$LEASE_B' returning 1) select count(*) from u;")" = 0 ] \
    || fail "a holder overwrote the recorded abandonment"
pass "a holder that lost its run cannot overwrite the abandonment"

# A legacy run with no checkpoint is matched by `checkpoint is null`.
q "insert into source_runs (id, source_id, status, run_status, started_at,
                            collection_window_start, collection_window_end)
   values ('00000000-0000-4000-8000-0000000000a2', 'mars-newsroom', 'running', 'running',
           '2026-09-14 05:23:06.215+00', '2025-09-15T00:00:00Z', '2026-09-15T00:00:00Z');"
[ "$(q "with u as (update source_runs set status = 'failed', run_status = 'failure', error_code = 'abandoned'
         where id = '00000000-0000-4000-8000-0000000000a2' and run_status = 'running'
           and checkpoint is null returning 1) select count(*) from u;")" = 1 ] \
    || fail "a pre-lease run could not be abandoned"
pass "a run opened before leases existed is recoverable"

for status in degraded action_required source_unavailable; do
    q "update sources set health_status = '$status' where id = 'mars-newsroom';"
done
pass "health values degraded, action_required and source_unavailable are accepted"

for event in run_abandoned skipped_overlap blocked_egress deferred_time_budget failure; do
    q "insert into source_health_events (source_id, prior_status, new_status, event_type, summary)
       values ('mars-newsroom', 'healthy', 'degraded', '$event', 'contract');"
done
pass "event types run_abandoned, skipped_overlap, blocked_egress, deferred_time_budget are accepted"

# ---------------------------------------------------------------------------
step "The evidence row as the pipeline now builds it"
evidence_row() { # $1 access_mode, $2 body sql, $3 locator sql, $4 doc id
    echo "insert into evidence (
        source_id, source_run_id, source_document_id, connector_id, connector_version,
        original_url, resolved_url, canonical_url, title, published_at, published_precision,
        published_basis, retrieved_at, content_hash, mime_type, byte_size,
        extraction_status, extraction_method, extractor_version, transformation_version,
        evidence_excerpt, evidence_locator, body_text, locator,
        access_mode, data_sensitivity_class, classification_status, review_status,
        first_seen_at, last_seen_at)
      values ('mars-newsroom', '00000000-0000-4000-8000-0000000000a2', '$4', 'mars-newsroom', '1.0.0',
        'https://www.mars.com/$4', 'https://www.mars.com/$4', 'https://www.mars.com/$4',
        'Example announcement', '2026-10-13T14:00:00Z', 'exact_day', 'stated',
        '2026-10-14T06:00:00Z', md5('$4') || md5('$4'), 'text/html', 5466,
        'success', 'connector_text_extraction', '1.0.0', '1.0.0',
        left(repeat('bounded excerpt ', 40), 500), '{\"documentType\": \"press_release\"}'::jsonb,
        $2, $3, '$1', 'public', 'candidate_signal', 'unreviewed',
        '2026-10-14T06:00:00Z', '2026-10-14T06:00:00Z');"
}

q "$(evidence_row reference_only null "'https://www.mars.com/ok'" ok)" \
    || fail "a reference-only row with no body was refused"
pass "reference_only with no body, a locator and a 500-character excerpt is accepted"

if ! refused "$(evidence_row reference_only "'the full page'" "'https://www.mars.com/body'" body)" \
     evidence_reference_only_has_no_body; then
    fail "a reference-only row WITH a body was accepted"
fi
pass "reference_only WITH a body is refused (evidence_reference_only_has_no_body)"

q "$(evidence_row metadata_only null null meta)" || fail "a metadata-only row with no locator was refused"
if ! refused "$(evidence_row metadata_only null "'https://www.mars.com/m2'" meta2)" \
     evidence_metadata_only_has_no_locator; then
    fail "a metadata-only row WITH a locator was accepted"
fi
pass "metadata_only with no locator is accepted; with one it is refused"

q "$(evidence_row archived_full_text "'Government filing text.'" "'https://www.sec.gov/x'" gov)" \
    || fail "an archived_full_text row with its body was refused"
pass "archived_full_text with a body and no archive object is accepted"

psql -d postgres -q -c "drop database if exists $DB;" >/dev/null
printf '\n\033[32mIngestion integrity contract: all cases passed.\033[0m\n'
