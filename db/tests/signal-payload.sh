#!/usr/bin/env bash
#
# Can a database at the current schema accept the SIGNAL row an accepted SEC
# filing produces?
#
# THE INCIDENT. Once evidence finally inserted, 39 documents were enriched and
# classified, 8 of them qualified -- and every SIGNAL insert was refused with
# PostgreSQL 23514. `upsertSignal` carried its own inline copy of the temporal
# vocabulary and wrote:
#
#   event_date_precision  'day'              the column admits exact_day | month
#                                            | quarter | season | half_year |
#                                            year | range | relative | unknown
#   event_date_basis      'source_declared'  the column admits stated | inferred
#                                            | unknown
#
# The identical prose bug that had just been fixed for evidence, in a second
# place nobody looked. This asserts the row against every constraint on
# `signals`, armed, on a database built only from the migrations.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DB=radar_signal_payload

pass() { printf '    \033[32mok\033[0m    %s\n' "$1"; }
fail() { printf '\n\033[31mFAILED: %s\033[0m\n' "$1"; exit 1; }
step() { printf '\n\033[1m-- %s\033[0m\n' "$1"; }

q() { PGDATABASE="$DB" psql -tAX -q -c "$1"; }

step "An empty database, migrated and seeded"
psql -d postgres -q -c "drop database if exists $DB;" -c "create database $DB;" >/dev/null
PGDATABASE="$DB" psql -q -v ON_ERROR_STOP=1 -f "$ROOT/db/supabase_compat.sql" >/dev/null
PGDATABASE="$DB" node "$ROOT/db/migrate.mjs" up >/dev/null
PGDATABASE="$DB" node "$ROOT/db/seed.mjs" >/dev/null
pass "schema at $(q "select max(version) from public.schema_migrations;")"

CONSTRAINTS="$(q "select count(*) from pg_constraint c join pg_class t on t.oid = c.conrelid where t.relname = 'signals' and c.contype = 'c';")"
[ "$CONSTRAINTS" -ge 6 ] || fail "only $CONSTRAINTS check constraints on signals; expected the full set"
pass "$CONSTRAINTS check constraints armed on signals"

# THE COHORT RESOLVES. The runner looks organizations up by entity_key, and a
# document whose company is not found is rejected rather than misattributed.
# The hosted run rejected zero documents, so both filers resolved; this proves
# the seed actually carries them.
step "Both SEC filers resolve to an organization"
for key in 'sec:0000077476' 'sec:0000100493'; do
    ORG="$(q "select id from organizations where entity_key = '$key';")"
    [ -n "$ORG" ] || fail "no organization for entity_key $key"
    pass "$key -> $ORG"
done
ORG_ID="$(q "select id from organizations where entity_key = 'sec:0000100493';")"

step "The evidence row an accepted filing leaves behind"
PGDATABASE="$DB" psql -q -v ON_ERROR_STOP=1 <<SQL
insert into source_runs (id, source_id, status, run_status,
                         collection_window_start, collection_window_end, started_at)
values ('bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb', 'sec-edgar', 'running', 'running',
        '2025-09-15T00:00:00Z', '2026-09-15T00:00:00Z', now());

insert into evidence (
    id, source_id, source_run_id, source_document_id, connector_id, connector_version,
    original_url, resolved_url, canonical_url, title,
    published_at, published_precision, published_basis,
    retrieved_at, content_hash, mime_type, byte_size,
    extraction_status, extraction_method, extractor_version, transformation_version,
    evidence_excerpt, body_text, locator, evidence_locator,
    access_mode, data_sensitivity_class, classification_status, review_status,
    first_seen_at, last_seen_at
) values (
    'cccccccc-1111-4111-8111-cccccccccccc',
    'sec-edgar', 'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb',
    '0000999999-26-000035', 'sec-edgar', '1.0.0',
    'https://www.sec.gov/Archives/edgar/data/999999/000099999926000035/exf-20260304.htm',
    'https://www.sec.gov/Archives/edgar/data/999999/000099999926000035/exf-20260304.htm',
    'https://www.sec.gov/Archives/edgar/data/999999/000099999926000035/0000999999-26-000035-index.htm',
    '8-K - Example Foods, Inc.',
    '2026-03-04T16:31:00Z', 'exact_day', 'stated',
    '2026-03-05T06:00:00Z', repeat('d', 64), 'text/html', 4096,
    'success', 'connector_text_extraction', '1.0.0', '1.0.0',
    'will build a new 450,000 square foot processing plant in Bowling Green',
    'Example Foods today announced it will build a new 450,000 square foot processing plant.',
    'https://www.sec.gov/Archives/edgar/data/999999/000099999926000035/exf-20260304.htm',
    jsonb_build_object('documentType', '8-K', 'archiveFolder',
                       'https://www.sec.gov/Archives/edgar/data/999999/000099999926000035'),
    'structured_primary', 'public', 'candidate_signal', 'unreviewed',
    now(), now()
);
SQL
pass "evidence stored"

step "Every classifier family maps to a code the reference vocabulary holds"
# `signals.signal_family` and `signals.event_type` are FOREIGN KEYS into the
# seeded reference vocabulary (migration 0013). The classifier's own taxonomy
# shares exactly ONE code with it, so seven of eight families and seven of
# eight event types would have been refused with 23503 -- an error the hosted
# run never saw, because PostgreSQL evaluates CHECK constraints first and the
# two prose values failed with 23514 before the foreign key was reached.
for pair in 'facility_capacity:new_facility_announced' \
            'facility_capacity:facility_expansion' \
            'process_systems:process_upgrade' \
            'facility_capacity:production_line_added' \
            'distribution_supply_chain:distribution_centre_project' \
            'corporate_capital:acquisition_completed' \
            'utilities_sustainability:energy_project' \
            'facility_capacity:facility_closure' \
            'facility_capacity:capacity_guidance'; do
    fam="${pair%%:*}"; evt="${pair##*:}"
    [ "$(q "select count(*) from signal_families where code = '$fam';")" = "1" ] \
        || fail "signal_families has no code $fam"
    [ "$(q "select count(*) from signal_event_types e join signal_families f on f.id = e.signal_family_id where e.code = '$evt' and f.code = '$fam';")" = "1" ] \
        || fail "signal_event_types has no $evt under $fam"
done
pass "all nine mapped (family, event_type) pairs exist in the seeded vocabulary"

step "The exact signal row the pipeline now builds"
# The two that mattered are event_date_precision and event_date_basis; the
# family and event type are the two that would have failed next.
PGDATABASE="$DB" psql -q -v ON_ERROR_STOP=1 <<SQL
insert into signals (
    id, organization_id, title, summary, signal_family, event_type,
    event_date, event_date_precision, event_date_basis,
    first_observed_at, last_observed_at,
    confidence, independent_source_count, negative_signal, cluster_key,
    model_metadata
) values (
    'dddddddd-1111-4111-8111-dddddddddddd',
    '$ORG_ID',
    '8-K - Example Foods, Inc.',
    'will build a new 450,000 square foot processing plant in Bowling Green',
    'facility_capacity', 'new_facility_announced',
    '2026-03-04',
    'exact_day',   -- was 'day'
    'stated',      -- was 'source_declared'
    now(), now(),
    'probable', 1, false,
    'example-foods|facility_construction|2026-03-04|plant',
    jsonb_build_object('derivedBy', 'pipeline@1.0.0', 'modelGenerated', false,
                       'reasoning', 'Matched the action against the asset')
);

insert into signal_evidence (signal_id, evidence_id, evidence_role, source_family_key)
values ('dddddddd-1111-4111-8111-dddddddddddd',
        'cccccccc-1111-4111-8111-cccccccccccc', 'primary', 'sec-edgar');
SQL
pass "accepted"

step "Stored as the constraints require"
[ "$(q "select event_date_precision from signals where id = 'dddddddd-1111-4111-8111-dddddddddddd';")" = 'exact_day' ] || fail "precision wrong"
[ "$(q "select event_date_basis from signals where id = 'dddddddd-1111-4111-8111-dddddddddddd';")" = 'stated' ] || fail "basis wrong"
[ "$(q "select confidence from signals where id = 'dddddddd-1111-4111-8111-dddddddddddd';")" = 'probable' ] || fail "confidence wrong"
[ "$(q "select independent_source_count >= 1 from signals where id = 'dddddddd-1111-4111-8111-dddddddddddd';")" = 't' ] || fail "source count below one"
[ "$(q "select last_observed_at >= first_observed_at from signals where id = 'dddddddd-1111-4111-8111-dddddddddddd';")" = 't' ] || fail "observation window inverted"
[ "$(q "select organization_id is not null from signals where id = 'dddddddd-1111-4111-8111-dddddddddddd';")" = 't' ] || fail "no organization"
pass "precision, basis, confidence, source count, window and organization all valid"

step "An opportunity derives from it"
PGDATABASE="$DB" psql -q -v ON_ERROR_STOP=1 <<SQL
insert into opportunities (
    id, organization_id, opportunity_key, title, executive_summary,
    capability_alignment, stage, status, confidence, why_it_matters,
    derived_by, derived_at, last_material_change_at
) values (
    'eeeeeeee-1111-4111-8111-eeeeeeeeeeee', '$ORG_ID',
    'example-foods|facility_construction|2026-03-04|plant',
    'Facility Construction - plant',
    'will build a new 450,000 square foot processing plant in Bowling Green',
    '{}', 'emerging', 'new', 'probable',
    'Matched the action against the asset, corroborated by an amount and a place.',
    'pipeline@1.0.0', now(), now()
);

insert into opportunity_signals (opportunity_id, signal_id, signal_role)
values ('eeeeeeee-1111-4111-8111-eeeeeeeeeeee',
        'dddddddd-1111-4111-8111-dddddddddddd', 'trigger');
SQL
pass "opportunity accepted, unscored"

step "Deduplication still holds"
# signals_organization_cluster_uidx (0021): one cluster per organization.
if PGDATABASE="$DB" psql -q -v ON_ERROR_STOP=1 -c "
insert into signals (organization_id, title, summary, signal_family, event_type,
                     first_observed_at, last_observed_at, confidence,
                     independent_source_count, cluster_key)
values ('$ORG_ID', 'duplicate', 'duplicate', 'facility_construction', 'new_plant_announced',
        now(), now(), 'probable', 1,
        'example-foods|facility_construction|2026-03-04|plant');" >/dev/null 2>&1; then
    fail "a second signal with the same cluster key was accepted"
fi
pass "a second signal for the same cluster key is refused"

# opportunities_organization_key_uidx (0021).
if PGDATABASE="$DB" psql -q -v ON_ERROR_STOP=1 -c "
insert into opportunities (organization_id, opportunity_key, title, executive_summary,
                           capability_alignment, stage, status, confidence)
values ('$ORG_ID', 'example-foods|facility_construction|2026-03-04|plant',
        'duplicate', 'duplicate', '{}', 'emerging', 'new', 'probable');" >/dev/null 2>&1; then
    fail "a second opportunity with the same key was accepted"
fi
pass "a second opportunity for the same key is refused"

step "An unmapped family is still refused by the foreign key"
if PGDATABASE="$DB" psql -q -v ON_ERROR_STOP=1 \
    -c "update signals set signal_family = 'facility_construction'
         where id = 'dddddddd-1111-4111-8111-dddddddddddd';" >/dev/null 2>&1; then
    fail "a classifier family that is not in the vocabulary was accepted"
fi
pass "the classifier's own taxonomy is still refused by signals_signal_family_fk"

step "The old values are still refused, so nothing was weakened"
for bad in "event_date_precision = 'day'" "event_date_basis = 'source_declared'"; do
    if PGDATABASE="$DB" psql -q -v ON_ERROR_STOP=1 \
        -c "update signals set $bad where id = 'dddddddd-1111-4111-8111-dddddddddddd';" >/dev/null 2>&1; then
        fail "$bad was accepted; the constraint has been weakened"
    fi
done
# And an inferred basis with no note is still refused.
if PGDATABASE="$DB" psql -q -v ON_ERROR_STOP=1 \
    -c "update signals set event_date_basis = 'inferred', event_date_inference_note = null
         where id = 'dddddddd-1111-4111-8111-dddddddddddd';" >/dev/null 2>&1; then
    fail "an inferred basis with no note was accepted"
fi
pass "'day', 'source_declared' and a noteless inference are all still refused"

psql -d postgres -q -c "drop database if exists $DB;" >/dev/null
printf '\n\033[32mSEC signal payload: accepted by an empty database at the current schema.\033[0m\n'
