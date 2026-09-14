#!/usr/bin/env bash
#
# Can a database at the current schema actually accept the row the SEC
# connector builds?
#
# THE INCIDENT THIS EXISTS FOR. The first live backfill discovered 39 filings,
# fetched all 39, and stored none. Every insert was refused with PostgreSQL
# 23514 -- a check-constraint violation -- because two columns carried the
# CONNECTOR's vocabulary instead of the COLUMN's:
#
#   published_precision   'minute'          the column has no sub-day member
#   published_basis       'source_declared' the column admits stated|inferred|unknown
#
# `app/src/test/evidencePayload.test.ts` asserts the mapping against the
# vocabularies parsed out of the migration. This asserts the stronger thing:
# that PostgreSQL itself accepts the resulting row, with every constraint on
# `evidence` armed, on an empty database built only from the migrations.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DB=radar_evidence_payload

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

# Every check constraint on evidence must be present and armed, or accepting
# the row below would prove nothing.
CONSTRAINTS="$(q "select count(*) from pg_constraint c join pg_class t on t.oid = c.conrelid where t.relname = 'evidence' and c.contype = 'c';")"
[ "$CONSTRAINTS" -ge 15 ] || fail "only $CONSTRAINTS check constraints on evidence; expected the full set"
pass "$CONSTRAINTS check constraints armed on evidence"

step "The exact row the SEC connector now builds"
# Values copied from the payload in app/src/test/evidencePayload.test.ts. The
# two that mattered are published_precision and published_basis.
PGDATABASE="$DB" psql -q -v ON_ERROR_STOP=1 <<'SQL'
insert into source_runs (id, source_id, status, run_status,
                         collection_window_start, collection_window_end, started_at)
values ('e31b56a7-1079-4bcf-b94e-89c7862e401f', 'sec-edgar', 'running', 'running',
        '2025-09-15T00:00:00Z', '2026-09-15T00:00:00Z', now());

insert into evidence (
    source_id, source_run_id, source_document_id, connector_id, connector_version,
    original_url, resolved_url, canonical_url, title,
    published_at, published_precision, published_basis,
    retrieved_at, content_hash, mime_type, byte_size,
    extraction_status, extraction_method, extractor_version, transformation_version,
    evidence_excerpt, evidence_locator,
    access_mode, data_sensitivity_class,
    classification_status, review_status,
    first_seen_at, last_seen_at
) values (
    'sec-edgar', 'e31b56a7-1079-4bcf-b94e-89c7862e401f',
    '0000100493-26-000010', 'sec-edgar', '1.0.0',
    'https://www.sec.gov/Archives/edgar/data/100493/000010049326000010/tsn-20260304.htm',
    'https://www.sec.gov/Archives/edgar/data/100493/000010049326000010/tsn-20260304.htm',
    'https://www.sec.gov/Archives/edgar/data/100493/000010049326000010/0000100493-26-000010-index.htm',
    '8-K - Tyson Foods, Inc. - Results of Operations',
    '2026-03-04T16:31:00Z',
    'exact_day',   -- was 'minute'
    'stated',      -- was 'source_declared'
    '2026-03-05T06:00:00Z',
    repeat('a', 64), 'text/html', 47,
    'success', 'connector_text_extraction', '1.0.0', '1.0.0',
    'Tyson Foods announced a new processing plant',
    jsonb_build_object('documentType', '8-K',
                       'publishedPrecisionObserved', 'minute',
                       'accessionNumber', '0000100493-26-000010'),
    'structured_primary', 'public',
    'candidate_signal', 'unreviewed',
    now(), now()
);
SQL
pass "accepted"

step "It is stored the way the pipeline depends on"
[ "$(q "select published_precision from evidence where source_document_id = '0000100493-26-000010';")" = 'exact_day' ] || fail "published_precision wrong"
[ "$(q "select published_basis from evidence where source_document_id = '0000100493-26-000010';")" = 'stated' ] || fail "published_basis wrong"
[ "$(q "select evidence_locator->>'publishedPrecisionObserved' from evidence where source_document_id = '0000100493-26-000010';")" = 'minute' ] || fail "the source-stated precision was lost"
[ "$(q "select published_at at time zone 'UTC' from evidence where source_document_id = '0000100493-26-000010';")" = '2026-03-04 16:31:00' ] || fail "the instant was lost"
pass "day exact, basis stated, the minute kept in published_at and the locator"

step "Deduplication still holds"
# evidence_current_document_uidx is (source_id, source_document_id) where
# superseded_at is null. A second CURRENT row for the same document must fail.
if PGDATABASE="$DB" psql -q -v ON_ERROR_STOP=1 -c "
insert into evidence (source_id, source_run_id, source_document_id, connector_id,
                      original_url, canonical_url, title, retrieved_at, content_hash,
                      extraction_status, access_mode, data_sensitivity_class,
                      published_precision, published_basis)
values ('sec-edgar', 'e31b56a7-1079-4bcf-b94e-89c7862e401f', '0000100493-26-000010', 'sec-edgar',
        'https://www.sec.gov/x', 'https://www.sec.gov/x', 'duplicate', now(), repeat('b', 64),
        'success', 'structured_primary', 'public', 'exact_day', 'stated');" >/dev/null 2>&1; then
    fail "a second current row for the same document was accepted"
fi
pass "a second current row for the same (source, document) is refused"

step "The old values are still refused, so the constraint was not weakened"
for bad in "published_precision = 'minute'" "published_basis = 'source_declared'"; do
    if PGDATABASE="$DB" psql -q -v ON_ERROR_STOP=1 -c "
    insert into evidence (source_id, source_document_id, connector_id, original_url,
                          canonical_url, title, retrieved_at, content_hash,
                          extraction_status, access_mode, data_sensitivity_class,
                          published_at, published_precision, published_basis)
    values ('sec-edgar', 'probe-$RANDOM', 'sec-edgar', 'https://www.sec.gov/y',
            'https://www.sec.gov/y', 'probe', now(), repeat('c', 64),
            'success', 'structured_primary', 'public', now(),
            'exact_day', 'stated');
    update evidence set $bad where source_document_id like 'probe-%';" >/dev/null 2>&1; then
        fail "$bad was accepted; the constraint has been weakened"
    fi
    PGDATABASE="$DB" psql -q -c "delete from evidence where source_document_id like 'probe-%';" >/dev/null 2>&1 || true
done
pass "'minute' and 'source_declared' are still refused"

psql -d postgres -q -c "drop database if exists $DB;" >/dev/null
printf '\n\033[32mSEC evidence payload: accepted by an empty database at the current schema.\033[0m\n'
