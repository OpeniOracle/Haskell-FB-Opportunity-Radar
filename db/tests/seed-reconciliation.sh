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

# Every confirmed-dead candidate, with the array it lived in. Keep in step with
# RETIRED_CANDIDATES in scripts/lib/connectivity-rules.mjs.
RETIRED_FEED='https://www.mars.com/rss.xml https://www.mars.com/news-and-stories/rss https://www.mars.com/feed'
RETIRED_INDEX='https://www.mars.com/news https://www.mars.com/press-releases'

step "A database at the current schema, with the cohort seeded"
psql -d postgres -q -c "drop database if exists $DB;" -c "create database $DB;" >/dev/null
PGDATABASE="$DB" psql -q -v ON_ERROR_STOP=1 -f "$ROOT/db/supabase_compat.sql" >/dev/null
PGDATABASE="$DB" node "$ROOT/db/migrate.mjs" up >/dev/null
PGDATABASE="$DB" node "$ROOT/db/seed.mjs" >/dev/null
pass "seeded"

step "The seed itself carries no retired candidate"
for url in $RETIRED_FEED; do
    [ "$(q "select connector_config->'feedCandidates' @> '[\"$url\"]'::jsonb from sources where id='mars-newsroom';")" = "f" ] \
        || fail "a freshly seeded row already contains $url"
done
for url in $RETIRED_INDEX; do
    [ "$(q "select connector_config->'indexCandidates' @> '[\"$url\"]'::jsonb from sources where id='mars-newsroom';")" = "f" ] \
        || fail "a freshly seeded row already contains $url"
done
pass "a fresh row has none of the five"

# The shipped configuration, asserted exactly. An empty feed array is a real
# configuration and not a missing value; the connector starts its walk at the
# sitemap. If this ever came back non-empty, a dead guess has crept back in.
[ "$(q "select connector_config->'feedCandidates' from sources where id='mars-newsroom';")" = "[]" ] \
    || fail "feedCandidates is not empty in the shipped seed"
[ "$(q "select connector_config->>'sitemapCandidates' from sources where id='mars-newsroom';")" = '["https://www.mars.com/sitemap.xml"]' ] \
    || fail "sitemapCandidates is not the single surviving sitemap"
[ "$(q "select connector_config->>'indexCandidates' from sources where id='mars-newsroom';")" = '["https://www.mars.com/news-and-stories"]' ] \
    || fail "indexCandidates is not the single surviving newsroom index"
pass "shipped config: feeds [], sitemap 1, index 1"

step "Simulate the CURRENT hosted row, plus operator state around it"
# The hosted row today: /rss.xml already removed by the operator's targeted
# update, the four newly confirmed dead candidates still present. Plus three
# things this repository has never heard of -- an operator-added feed, an
# operator-written note, and a flipped flag -- every one of which must survive.
PGDATABASE="$DB" psql -q -v ON_ERROR_STOP=1 -c "
update sources set connector_config = connector_config
  || jsonb_build_object(
       'feedCandidates', jsonb_build_array(
           'https://www.mars.com/news-and-stories/rss',
           'https://www.mars.com/feed',
           'https://www.mars.com/operator-found-this.xml'),
       'sitemapCandidates', jsonb_build_array(
           'https://www.mars.com/sitemap.xml',
           'https://www.mars.com/sitemap-news.xml'),
       'indexCandidates', jsonb_build_array(
           'https://www.mars.com/news-and-stories',
           'https://www.mars.com/news',
           'https://www.mars.com/press-releases'),
       'operatorNote', 'confirmed by hand on the first live run',
       'confirmedOnFirstLiveRun', true)
 where id = 'mars-newsroom';" >/dev/null
pass "hosted-like row prepared"

BEFORE_KEYS="$(q "select string_agg(k, ',' order by k) from jsonb_object_keys(connector_config) k from sources where id='mars-newsroom';" 2>/dev/null || true)"
BEFORE_KEYS="$(q "select string_agg(k, ',' order by k) from sources s, jsonb_object_keys(s.connector_config) k where s.id='mars-newsroom';")"

step "Re-run the seed: every retirement reconciles"
PGDATABASE="$DB" node "$ROOT/db/seed.mjs" >/dev/null

for url in $RETIRED_FEED; do
    [ "$(q "select connector_config->'feedCandidates' @> '[\"$url\"]'::jsonb from sources where id='mars-newsroom';")" = "f" ] \
        || fail "$url survived the reconciliation"
done
for url in $RETIRED_INDEX; do
    [ "$(q "select connector_config->'indexCandidates' @> '[\"$url\"]'::jsonb from sources where id='mars-newsroom';")" = "f" ] \
        || fail "$url survived the reconciliation"
done
pass "all five retired candidates removed, from both arrays"

for keep in 'https://www.mars.com/operator-found-this.xml' \
            'https://www.mars.com/sitemap.xml' \
            'https://www.mars.com/sitemap-news.xml' \
            'https://www.mars.com/news-and-stories'; do
    FOUND="$(q "select bool_or(c.value = '$keep') from sources s, jsonb_each(s.connector_config) e(k,v), jsonb_array_elements_text(v) c(value) where s.id='mars-newsroom' and jsonb_typeof(v)='array';")"
    [ "$FOUND" = "t" ] || fail "reconciliation removed $keep, which was not retired"
done
pass "every other candidate survived, including two the repository never knew about"

# A URL retired from ONE array must not be stripped from another. The
# reconciliation is keyed on (url, array) for exactly this reason.
PGDATABASE="$DB" psql -q -v ON_ERROR_STOP=1 -c "
update sources set connector_config = jsonb_set(connector_config, '{sitemapCandidates}',
       (connector_config->'sitemapCandidates') || '[\"https://www.mars.com/news\"]'::jsonb)
 where id = 'mars-newsroom';" >/dev/null
PGDATABASE="$DB" node "$ROOT/db/seed.mjs" >/dev/null
[ "$(q "select connector_config->'sitemapCandidates' @> '[\"https://www.mars.com/news\"]'::jsonb from sources where id='mars-newsroom';")" = "t" ] \
    || fail "a URL retired from indexCandidates was stripped from sitemapCandidates too"
pass "a retirement applies only to the array it was retired from"
# Put it back the way it was.
PGDATABASE="$DB" psql -q -v ON_ERROR_STOP=1 -c "
update sources set connector_config = jsonb_set(connector_config, '{sitemapCandidates}',
       '[\"https://www.mars.com/sitemap.xml\",\"https://www.mars.com/sitemap-news.xml\"]'::jsonb)
 where id = 'mars-newsroom';" >/dev/null

# Order matters: the connector tries candidates in order, so a reconciliation
# that reshuffled them would silently change which path is tried first.
ORDER="$(q "select string_agg(value, '|' order by ordinality) from sources s, jsonb_array_elements_text(s.connector_config->'feedCandidates') with ordinality as c(value, ordinality) where s.id='mars-newsroom';")"
[ "$ORDER" = 'https://www.mars.com/operator-found-this.xml' ] || fail "feed order changed: $ORDER"
ORDER="$(q "select string_agg(value, '|' order by ordinality) from sources s, jsonb_array_elements_text(s.connector_config->'sitemapCandidates') with ordinality as c(value, ordinality) where s.id='mars-newsroom';")"
[ "$ORDER" = 'https://www.mars.com/sitemap.xml|https://www.mars.com/sitemap-news.xml' ] || fail "sitemap order changed: $ORDER"
ORDER="$(q "select string_agg(value, '|' order by ordinality) from sources s, jsonb_array_elements_text(s.connector_config->'indexCandidates') with ordinality as c(value, ordinality) where s.id='mars-newsroom';")"
[ "$ORDER" = 'https://www.mars.com/news-and-stories' ] || fail "index order changed: $ORDER"
pass "order preserved in all three arrays"

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

# NOTHING was retired from sitemapCandidates, so it must come through whole --
# including the entry the operator added that this repository has never seen.
[ "$(q "select jsonb_array_length(connector_config->'sitemapCandidates') from sources where id='mars-newsroom';")" = "2" ] \
    || fail "sitemapCandidates was disturbed"
[ "$(q "select jsonb_array_length(connector_config->'indexCandidates') from sources where id='mars-newsroom';")" = "1" ] \
    || fail "indexCandidates does not hold exactly the surviving newsroom index"
[ "$(q "select jsonb_array_length(connector_config->'feedCandidates') from sources where id='mars-newsroom';")" = "1" ] \
    || fail "feedCandidates does not hold exactly the operator-added feed"
pass "sitemap untouched; feed and index hold exactly the survivors"

# Scalars, nested objects and non-array values must pass through unchanged.
[ "$(q "select connector_config->>'itemPathPattern' from sources where id='mars-newsroom';")" = '(news|press|stor|release|announce)' ] \
    || fail "a scalar value was altered"
[ "$(q "select connector_config->>'minRequestIntervalMs' from sources where id='mars-newsroom';")" = '1500' ] \
    || fail "a numeric value was altered"
pass "non-array values passed through unchanged"

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
RECONCILE="$(sed -n '/^with retired(url, arr) as (/,$p' "$ROOT/db/seed/0006_live_cohort_sources.sql")"
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
