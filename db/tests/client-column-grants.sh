#!/usr/bin/env bash
#
# Can a signed-in browser actually SELECT what the interface asks for?
#
# THE PRODUCTION INCIDENT. Every surface reported "Your access to the Radar has
# been withdrawn. Contact your administrator." to a user who was signed in,
# verified, and present in `auth_invite_allowlist`. Nothing was wrong with the
# account.
#
# Migration 0015 grants SELECT on `evidence` and `sources` COLUMN BY COLUMN --
# deliberately, because body_text, archive_uri and connector_config are withheld
# from the browser and a column list is the only way to say so. A column-level
# grant does not extend to columns created afterwards, and migration 0021 added
# fifteen columns and granted none of them.
#
# `freshness()` selects `sources.last_success_at` on EVERY surface, so every
# page failed with 42501, which the client mapped onto "access withdrawn".
#
# This runs the interface's real queries as the `authenticated` role.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DB=radar_client_grants

pass() { printf '    \033[32mok\033[0m    %s\n' "$1"; }
fail() { printf '\n\033[31mFAILED: %s\033[0m\n' "$1"; exit 1; }
step() { printf '\n\033[1m-- %s\033[0m\n' "$1"; }

# Runs SQL as the browser's role. Succeeds or reports the SQLSTATE.
as_authenticated() {
    PGDATABASE="$DB" psql -tAX -q -v ON_ERROR_STOP=1 \
        -c "set role authenticated; $1" 2>&1
}

step "An empty database, migrated and seeded"
psql -d postgres -q -c "drop database if exists $DB;" -c "create database $DB;" >/dev/null
PGDATABASE="$DB" psql -q -v ON_ERROR_STOP=1 -f "$ROOT/db/supabase_compat.sql" >/dev/null
PGDATABASE="$DB" node "$ROOT/db/migrate.mjs" up >/dev/null
PGDATABASE="$DB" node "$ROOT/db/seed.mjs" >/dev/null
pass "schema at $(PGDATABASE="$DB" psql -tAX -qc "select max(version) from public.schema_migrations;")"

step "The queries the interface actually issues, as the browser's role"

# freshness(), which runs on EVERY surface. This is the one that failed.
if ! as_authenticated \
    "select id, enabled, health_status, last_success_at from sources where enabled = true;" >/dev/null
then
    fail "freshness() is still denied: sources.last_success_at is not granted"
fi
pass "sources: id, enabled, health_status, last_success_at"

# Source Health reads two more.
if ! as_authenticated \
    "select id, name, enabled, health_status, last_success_at, expected_cadence_hours from sources;" >/dev/null
then
    fail "the Source Health query is denied"
fi
pass "sources: the Source Health column set"

# The evidence detail view.
if ! as_authenticated "select id, title, canonical_url, resolved_url, publisher, published_at,
        retrieved_at, first_seen_at, last_seen_at, content_hash, access_mode, evidence_excerpt,
        classification_status, review_status, connector_id, connector_version,
        source_document_id, source_id, superseded_by_evidence_id from evidence;" >/dev/null
then
    fail "the evidence detail query is denied"
fi
pass "evidence: the detail column set, including every column 0021 added"

# The opportunities list.
if ! as_authenticated "select id, title, executive_summary, stage, status, confidence,
        why_it_matters, capability_alignment, last_material_change_at from opportunities;" >/dev/null
then
    fail "the opportunities query is denied"
fi
pass "opportunities: the list column set"

# R2 (0025 - 0030). The columns the display rule needs to tell a machine-derived
# candidate from an accepted opportunity, and an ended project from an active one.
# `opportunities` and `sources` are granted column by column, and a column grant
# does not reach a column added later: this is the exact trap 0021 fell into.
if ! as_authenticated "select id, review_state, project_lifecycle, commercial_qualification
        from opportunities;" >/dev/null
then
    fail "the R2 opportunity columns are not granted: review_state, project_lifecycle, commercial_qualification"
fi
pass "opportunities: review_state, project_lifecycle, commercial_qualification (0025)"

if ! as_authenticated "select id, name, rights_class from sources;" >/dev/null; then
    fail "sources.rights_class is not granted (0026)"
fi
pass "sources: rights_class (0026)"

# `signals` and `facility_identifiers` are granted at TABLE level, which does
# cover a column added later. Asserted, not assumed.
if ! as_authenticated "select id, event_date, event_date_role from signals;" >/dev/null; then
    fail "signals.event_date_role is not readable (0027)"
fi
if ! as_authenticated "select id, facility_id, identifier_system, identifier_value from facility_identifiers;" >/dev/null; then
    fail "facility_identifiers is not readable"
fi
pass "signals.event_date_role and facility_identifiers: readable under their table-level grants"

step "What is still withheld from the browser"
# The grant is narrow on purpose. Preserved content and operational
# configuration stay server-side; a column list is the only way to say that.
for forbidden in 'select body_text from evidence;' \
                 'select archive_uri from evidence;' \
                 'select raw_storage_uri from evidence;' \
                 'select connector_config from sources;'; do
    if as_authenticated "$forbidden" >/dev/null 2>&1; then
        fail "the browser can read: $forbidden"
    fi
done
pass "body_text, archive_uri, raw_storage_uri and connector_config are all still refused"

# R2 must not widen what a column list withholds. These were withheld before it
# and are withheld after it; none is read by any surface.
for forbidden in 'select derived_by from opportunities;' \
                 'select derived_at from opportunities;' \
                 'select opportunity_key from opportunities;' \
                 'select account_strategy from opportunities;' \
                 'select connector_id from sources;' \
                 'select query_scope from sources;' \
                 'select extracted_text_uri from evidence;'; do
    if as_authenticated "$forbidden" >/dev/null 2>&1; then
        fail "R2 widened a column grant: the browser can read: $forbidden"
    fi
done
pass "derived_by, derived_at, opportunity_key, account_strategy, connector_id, query_scope and extracted_text_uri are still refused"

# The two server-side tables R2 creates. RLS is enabled and forced, every
# privilege is revoked and no policy exists: a signed-in session sees nothing.
for forbidden in 'select count(*) from ingestion_tasks;' \
                 'select count(*) from evidence_text_fingerprints;' \
                 "insert into ingestion_tasks (source_run_id, task_key) values (gen_random_uuid(), 'x');" \
                 "update sources set rights_class = 'federal_public_record';" \
                 "update opportunities set review_state = 'accepted';"; do
    if as_authenticated "$forbidden" >/dev/null 2>&1; then
        fail "the browser can reach what R2 keeps server-side: $forbidden"
    fi
done
pass "the work queue and the fingerprints are unreachable, and the new columns are not writable, from the browser"

step "The allowlist is still unreadable by a signed-in session"
# Migration 0016 revokes it. Publishing the roster of everyone with access to
# every person with access is not a trade this project makes, and the gate at
# /api/session exists precisely because the browser cannot answer this itself.
if as_authenticated "select email_normalized from auth_invite_allowlist;" >/dev/null 2>&1; then
    fail "a signed-in session can read auth_invite_allowlist"
fi
pass "auth_invite_allowlist is still refused"

step "The columns named in the migration are exactly the columns granted"
GRANTED="$(PGDATABASE="$DB" psql -tAX -qc "
    select string_agg(column_name, ',' order by column_name)
      from information_schema.column_privileges
     where grantee = 'authenticated' and table_name = 'evidence'
       and column_name in ('source_document_id','connector_id','connector_version',
                           'first_seen_at','last_seen_at','classification_status',
                           'review_status','document_revision','superseded_at');")"
EXPECTED='classification_status,connector_id,connector_version,first_seen_at,last_seen_at,review_status,source_document_id'
[ "$GRANTED" = "$EXPECTED" ] || fail "evidence grants are $GRANTED, expected $EXPECTED"
pass "evidence: seven columns granted, document_revision and superseded_at withheld"

step "The R2 columns granted are exactly the columns named, and no others"
GRANTED_OPP="$(PGDATABASE="$DB" psql -tAX -qc "
    select string_agg(column_name, ',' order by column_name)
      from information_schema.column_privileges
     where grantee = 'authenticated' and table_name = 'opportunities'
       and column_name in ('review_state','project_lifecycle','commercial_qualification',
                           'opportunity_key','derived_by','derived_at','account_strategy');")"
EXPECTED_OPP='commercial_qualification,project_lifecycle,review_state'
[ "$GRANTED_OPP" = "$EXPECTED_OPP" ] || fail "opportunities grants are $GRANTED_OPP, expected $EXPECTED_OPP"
pass "opportunities: three R2 columns granted; opportunity_key, derived_by, derived_at and account_strategy withheld"
GRANTED_SRC="$(PGDATABASE="$DB" psql -tAX -qc "
    select string_agg(column_name, ',' order by column_name)
      from information_schema.column_privileges
     where grantee = 'authenticated' and table_name = 'sources'
       and column_name in ('rights_class','connector_id','connector_config','query_scope',
                           'extraction_config','retry_policy','operator_intervention');")"
[ "$GRANTED_SRC" = "rights_class" ] || fail "sources grants are $GRANTED_SRC, expected rights_class"
pass "sources: rights_class granted; the operational configuration columns withheld"

psql -d postgres -q -c "drop database if exists $DB;" >/dev/null
printf '\n\033[32mClient column grants: the interface can read what it asks for.\033[0m\n'
