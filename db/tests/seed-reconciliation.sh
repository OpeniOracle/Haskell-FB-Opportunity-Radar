#!/usr/bin/env bash
#
# The seed must be able to RETIRE a dead candidate from a row that already
# exists, without touching anything else in that row's connector_config.
#
# WHY THIS IS NOT OBVIOUS.
#
# `connector_config` is operator state. It is corrected during a live run, from
# a machine that can actually reach the source, and the repository cannot know
# what the right values are -- which is exactly why the upsert in
# db/seed/0006_live_cohort_sources.sql deliberately does NOT list it in the
# `do update set` clause. A seed that overwrote it would throw away the one
# thing only the operator can supply.
#
# But that leaves no route for a RETIREMENT to reach an existing row, so a URL
# confirmed dead would live in the hosted configuration forever, costing a
# request and a log line on every run.
#
# The reconciliation statement resolves that: it removes retired URLs from the
# arrays they appear in and edits nothing else. This proves it against a real
# database rather than by reading the SQL.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DB=radar_seed_reconcile

pass() { printf '    \033[32mok\033[0m    %s\n' "$1"; }
fail() { printf '\n\033[31mFAILED: %s\033[0m\n' "$1"; exit 1; }
step() { printf '\n\033[1m-- %s\033[0m\n' "$1"; }

q() { PGDATABASE="$DB" psql -tAX -q -c "$1"; }

RETIRED='https://www.mars.com/rss.xml'

step "A database at the current schema, with the cohort seeded"
psql -d postgres -q -c "drop database if exists $DB;" -c "create database $DB;" >/dev/null
PGDATABASE="$DB" psql -q -v ON_ERROR_STOP=1 -f "$ROOT/db/supabase_compat.sql" >/dev/null
PGDATABASE="$DB" node "$ROOT/db/migrate.mjs" up >/dev/null
PGDATABASE="$DB" node "$ROOT/db/seed.mjs" >/dev/null
pass "seeded"

step "The seed itself carries no retired candidate"
if [ "$(q "select connector_config->'feedCandidates' @> '[\"$RETIRED\"]'::jsonb from sources where id = 'mars-newsroom';")" != "f" ]; then
    fail "a freshly seeded row already contains the retired candidate"
fi
pass "a fresh row has none"

step "Simulate the hosted row: the retired URL, plus operator state around it"
# This is what the hosted row looked like before the operator's repair, PLUS
# two things the repository has never heard of. Both must survive.
PGDATABASE="$DB" psql -q -v ON_ERROR_STOP=1 -c "
update sources set connector_config = connector_config
  || jsonb_build_object(
       'feedCandidates', jsonb_build_array(
           '$RETIRED',
           'https://www.mars.com/news-and-stories/rss',
           'https://www.mars.com/feed',
           'https://www.mars.com/operator-found-this.xml'),
       'operatorNote', 'confirmed by hand on the first live run',
       'confirmedOnFirstLiveRun', true)
 where id = 'mars-newsroom';" >/dev/null
pass "hosted-like row prepared"

BEFORE_KEYS="$(q "select string_agg(k, ',' order by k) from jsonb_object_keys(connector_config) k from sources where id='mars-newsroom';" 2>/dev/null || true)"
BEFORE_KEYS="$(q "select string_agg(k, ',' order by k) from sources s, jsonb_object_keys(s.connector_config) k where s.id='mars-newsroom';")"

step "Re-run the seed: the retirement reconciles"
PGDATABASE="$DB" node "$ROOT/db/seed.mjs" >/dev/null

if [ "$(q "select connector_config->'feedCandidates' @> '[\"$RETIRED\"]'::jsonb from sources where id='mars-newsroom';")" != "f" ]; then
    fail "the retired candidate survived the reconciliation"
fi
pass "retired candidate removed"

for keep in 'https://www.mars.com/news-and-stories/rss' \
            'https://www.mars.com/feed' \
            'https://www.mars.com/operator-found-this.xml'; do
    if [ "$(q "select connector_config->'feedCandidates' @> '[\"$keep\"]'::jsonb from sources where id='mars-newsroom';")" != "t" ]; then
        fail "reconciliation removed $keep, which was not retired"
    fi
done
pass "every other candidate survived, including one the repository never knew about"

# Order matters: the connector tries candidates in order, so a reconciliation
# that reshuffled them would silently change which path is tried first.
ORDER="$(q "select string_agg(value, '|' order by ordinality) from sources s, jsonb_array_elements_text(s.connector_config->'feedCandidates') with ordinality as c(value, ordinality) where s.id='mars-newsroom';")"
EXPECTED='https://www.mars.com/news-and-stories/rss|https://www.mars.com/feed|https://www.mars.com/operator-found-this.xml'
[ "$ORDER" = "$EXPECTED" ] || fail "candidate order changed: $ORDER"
pass "order preserved"

step "Nothing unrelated was touched"
AFTER_KEYS="$(q "select string_agg(k, ',' order by k) from sources s, jsonb_object_keys(s.connector_config) k where s.id='mars-newsroom';")"
[ "$BEFORE_KEYS" = "$AFTER_KEYS" ] || fail "the set of connector_config keys changed: $BEFORE_KEYS -> $AFTER_KEYS"
pass "same keys: $AFTER_KEYS"

[ "$(q "select connector_config->>'operatorNote' from sources where id='mars-newsroom';")" = 'confirmed by hand on the first live run' ] \
    || fail "an operator-written key was lost"
pass "operator-written key intact"

[ "$(q "select connector_config->>'confirmedOnFirstLiveRun' from sources where id='mars-newsroom';")" = 'true' ] \
    || fail "an operator-flipped flag was reset by the seed"
pass "operator-flipped flag not reset"

[ "$(q "select connector_config->'sitemapCandidates' @> '[\"https://www.mars.com/sitemap.xml\"]'::jsonb from sources where id='mars-newsroom';")" = 't' ] \
    || fail "sitemapCandidates was disturbed"
[ "$(q "select jsonb_array_length(connector_config->'indexCandidates') from sources where id='mars-newsroom';")" = "3" ] \
    || fail "indexCandidates was disturbed"
pass "sitemap and index candidates untouched"

step "Idempotent: a third run changes nothing"
SNAPSHOT="$(q "select connector_config::text from sources where id='mars-newsroom';")"
PGDATABASE="$DB" node "$ROOT/db/seed.mjs" >/dev/null
[ "$(q "select connector_config::text from sources where id='mars-newsroom';")" = "$SNAPSHOT" ] \
    || fail "a repeat run changed connector_config"
pass "connector_config byte-identical after a repeat run"

# ASSERTED ON THE STATEMENT, NOT ON THE ROW.
#
# An earlier version of this check compared `updated_at` and failed -- but that
# column is bumped by the UPSERT's own `do update set`, which fires on every
# seed run and has nothing to do with the reconciliation. The honest test is
# whether the reconciliation statement itself matches any rows, so run it alone
# and read the tag.
RECONCILE="$(sed -n '/^with retired(url) as (/,$p' "$ROOT/db/seed/0006_live_cohort_sources.sql")"
[ -n "$RECONCILE" ] || fail "could not extract the reconciliation statement from the seed"
TAG="$(printf '%s' "$RECONCILE" | PGDATABASE="$DB" psql -X -v ON_ERROR_STOP=1 -f - 2>&1 | tr -d ' ')"
[ "$TAG" = "UPDATE0" ] || fail "the reconciliation is not a no-op once applied: got '$TAG'"
pass "the reconciliation statement matches zero rows once applied"

step "Both sources are still disabled"
for src in sec-edgar mars-newsroom; do
    [ "$(q "select enabled from sources where id='$src';")" = "f" ] || fail "$src is enabled"
done
pass "sec-edgar and mars-newsroom both enabled = false"

psql -d postgres -q -c "drop database if exists $DB;" >/dev/null
printf '\n\033[32mSeed reconciliation: all checks passed.\033[0m\n'
