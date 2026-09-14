#!/usr/bin/env bash
#
# Can this machine reach the primary sources, and what do they answer?
#
# CREDENTIAL-FREE BY CONSTRUCTION. Every endpoint here is public. Nothing is
# sent but a declared User-Agent, so this can be run from any machine, pasted
# into a ticket, and re-run by anyone.
#
# WHAT IT DOES NOT DO. It does not authenticate, does not write anything, does
# not follow a challenge, and does not retry. A 403 here is data, not a problem
# to route around.
#
# ---------------------------------------------------------------------------
# A CANDIDATE HAS A ROLE, AND THE ROLE DECIDES THE WEIGHT.
#
# This script used to count every probe the same way: any non-200 incremented a
# failure counter and it exited 1. So Mars answering 200 on robots.txt, 200 on
# the newsroom index and 200 on the sitemap, but 404 on one GUESSED rss path,
# was reported as a failure -- on a source that is entirely viable.
#
# The connector never had that bug. `discoverMars` walks feed -> sitemap ->
# index, records each miss, and continues; it reports a problem only when
# nothing was discovered by any path. A pre-flight stricter than the thing it
# predicts is wrong in the worst direction: it argues for disabling a source
# that works.
#
#   required   every one must answer   (SEC's documented APIs; Mars robots.txt)
#   discovery  optional, tried in order, ONE is enough; each miss is a WARNING
#
# The rules live in scripts/lib/connectivity-rules.mjs and are asserted by
# app/src/test/sourceConnectivity.test.ts. Keep the tables below in step with
# that module -- a test fails if they drift.
#
# Usage: bash scripts/test-source-connectivity.sh [user-agent]

set -uo pipefail

UA="${1:-Openi-Haskell-FB-Radar-Operator/1.0 (oracles@openi-analytics.com)}"

blue()  { printf '\033[36m%s\033[0m\n' "$1"; }
pass()  { printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
fail()  { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; }
warn()  { printf '  \033[33mwarn\033[0m  %s\n' "$1"; }
note()  { printf '  note  %s\n' "$1"; }

CHALLENGE='captcha|verify you are human|checking your browser|incapsula|attention required'

# Per-source tallies, reset by `begin_source`.
REQUIRED_BAD=0
DISCOVERY_OK=0
DISCOVERY_BAD=0
DISCOVERY_TOTAL=0
LOCAL_FAILURES=0
ANSWERED=0
CHALLENGES=0
EXIT=0

# "<array> <url>" per line, for every discovery candidate that answered 404.
# Drives the remediation block at the end; empty means nothing is printed.
DEAD=""

begin_source() {
  blue ""
  blue "== $1"
  REQUIRED_BAD=0; DISCOVERY_OK=0; DISCOVERY_BAD=0; DISCOVERY_TOTAL=0
  LOCAL_FAILURES=0; ANSWERED=0; CHALLENGES=0
}

# probe <role> <label> <url> <array-or-dash> [expected-substring]
#
# <array-or-dash> names the connector_config array this candidate lives in, so
# a 404 can be turned into the exact statement that removes it. `-` for a
# required endpoint, which is not configuration and cannot be retired.
probe() {
  local role="$1" label="$2" url="$3" arr="$4" expect="${5:-}"
  [ "$role" = "discovery" ] && DISCOVERY_TOTAL=$((DISCOVERY_TOTAL + 1))

  local tmp status outcome
  tmp="$(mktemp)"
  # No `|| echo 000`: curl already writes 000 for a failed transfer, and
  # appending another made every failure read "000000" and fall through to the
  # unexpected-status branch, hiding whose refusal it was.
  status="$(curl -sS -o "$tmp" -w '%{http_code}' --max-time 25 \
            -H "User-Agent: $UA" -H 'Accept-Encoding: gzip, deflate' \
            --compressed "$url" 2>"$tmp.err")"

  case "$status" in
    000)
      if grep -qi 'connect tunnel failed\|proxy\|407\|firewall' "$tmp.err" 2>/dev/null; then
        outcome=local_network
      else
        outcome=unreachable
      fi
      ;;
    200)
      if [ -n "$expect" ] && ! grep -qi -- "$expect" "$tmp"; then
        outcome=unexpected
      else
        outcome=ok
      fi
      ;;
    301|302|307|308) outcome=redirect ;;
    404)             outcome=absent ;;
    429)             outcome=rate_limited ;;
    403|503)
      if grep -qiE "$CHALLENGE" "$tmp"; then outcome=challenge; else outcome=refused; fi
      ;;
    *) outcome=unexpected ;;
  esac
  rm -f "$tmp" "$tmp.err"

  printf '  %-46s HTTP %-4s %s\n' "$label" "$status" "$outcome"

  case "$outcome" in
    local_network|unreachable) LOCAL_FAILURES=$((LOCAL_FAILURES + 1)) ;;
    *) ANSWERED=$((ANSWERED + 1)) ;;
  esac
  [ "$outcome" = "challenge" ] && CHALLENGES=$((CHALLENGES + 1))

  if [ "$outcome" = "ok" ]; then
    [ "$role" = "discovery" ] && DISCOVERY_OK=$((DISCOVERY_OK + 1))
    pass "$label"
    return
  fi

  # ONLY A 404 EARNS A REMOVAL. The remediation deletes a URL from
  # configuration, so the bar is evidence the path is not there -- not evidence
  # it did not answer this time. A 403 may be a WAF in front of a real page, a
  # 429 is a rate limit, a redirect is the page moving, and a transport error is
  # usually this machine. Retiring on any of those deletes a working candidate
  # because of a bad afternoon.
  if [ "$role" = "discovery" ] && [ "$outcome" = "absent" ] && [ "$arr" != "-" ]; then
    DEAD="${DEAD}${arr} ${url}
"
  fi

  # A miss on an OPTIONAL candidate is information about a guess, not a fault.
  if [ "$role" = "discovery" ]; then
    DISCOVERY_BAD=$((DISCOVERY_BAD + 1))
    case "$outcome" in
      absent)        warn "$label -- 404. A guessed path that does not exist; retire it from connector_config." ;;
      challenge)     warn "$label -- interstitial challenge. Do NOT work around it; prefer an official feed." ;;
      refused)       warn "$label -- refused. Record the status and URL; do not retry in a loop." ;;
      rate_limited)  warn "$label -- rate limited. The connector honours Retry-After; so should you." ;;
      redirect)      note "$label -- redirected; the connector follows and re-checks the allowlist per hop." ;;
      local_network) warn "$label -- this machine's network refused the connection, NOT the source." ;;
      unreachable)   warn "$label -- no response (DNS, TLS or timeout)." ;;
      *)             warn "$label -- unexpected answer." ;;
    esac
    return
  fi

  REQUIRED_BAD=$((REQUIRED_BAD + 1))
  case "$outcome" in
    local_network) fail "$label -- this machine's network refused the connection, NOT the source." ;;
    unreachable)   fail "$label -- no response (DNS, TLS or timeout)." ;;
    challenge)     fail "$label -- interstitial challenge on a REQUIRED endpoint." ;;
    absent)        fail "$label -- 404 on a REQUIRED endpoint. The source changed shape." ;;
    *)             fail "$label -- $outcome on a REQUIRED endpoint." ;;
  esac
}

# end_source <name>
end_source() {
  local name="$1"
  local conclusive=1
  # If every failure was this machine, the run says nothing about the source.
  if [ "$LOCAL_FAILURES" -gt 0 ] && [ "$ANSWERED" -eq 0 ]; then conclusive=0; fi

  echo ''
  if [ "$conclusive" -eq 0 ]; then
    note "$name: INCONCLUSIVE -- nothing answered from this machine."
    note "  That is a statement about this network, not about the source."
    note "  Re-run from a machine with direct egress before concluding anything."
    return
  fi

  if [ "$REQUIRED_BAD" -gt 0 ]; then
    fail "$name: NOT VIABLE -- $REQUIRED_BAD required endpoint(s) did not answer."
    EXIT=1
    return
  fi

  if [ "$DISCOVERY_TOTAL" -gt 0 ] && [ "$DISCOVERY_OK" -eq 0 ]; then
    fail "$name: NOT VIABLE -- no discovery path answered."
    EXIT=1
    return
  fi

  if [ "$DISCOVERY_BAD" -gt 0 ]; then
    pass "$name: VIABLE -- $DISCOVERY_OK of $DISCOVERY_TOTAL discovery path(s) usable, $DISCOVERY_BAD warning(s)."
    note "  A failed optional candidate does not disable a source. Retire it from"
    note "  connector_config so it stops being requested; see the command below."
  else
    pass "$name: VIABLE -- every endpoint answered."
  fi

  if [ "$CHALLENGES" -gt 0 ]; then
    note "  $CHALLENGES candidate(s) returned an interstitial challenge. That is the one"
    note "  warning class to act on: find an official feed rather than defeating it."
  fi
}

blue "== User-Agent"
echo "  $UA"
if ! printf '%s' "$UA" | grep -q '@'; then
  fail "SEC fair access asks for a contact address in the User-Agent"
  EXIT=1
else
  pass "names a contact address"
fi

begin_source "SEC EDGAR (documented JSON APIs)"
probe required "company_tickers.json"   "https://www.sec.gov/files/company_tickers.json"      - "cik_str"
probe required "submissions API"        "https://data.sec.gov/submissions/CIK0000100493.json" - "filings"
probe required "archive folder index"   "https://www.sec.gov/Archives/edgar/data/100493/"     -
end_source "sec-edgar"

begin_source "Mars (official corporate sources)"
probe required  "robots.txt"        "https://www.mars.com/robots.txt"        -
# Discovery, in the connector's own order: feed, sitemap, index.
#
# THERE IS NO FEED CANDIDATE, AND THAT IS A FINDING. All six guessed paths were
# probed from direct egress and four are gone -- /rss.xml (2026-09-13), then
# /news-and-stories/rss, /feed, /news and /press-releases (2026-09-14), every
# one HTTP 404. `feedCandidates` is now legitimately empty and discovery starts
# at the sitemap. See RETIRED_CANDIDATES in scripts/lib/connectivity-rules.mjs.
probe discovery "sitemap candidate" "https://www.mars.com/sitemap.xml"       sitemapCandidates
probe discovery "newsroom index"    "https://www.mars.com/news-and-stories"  indexCandidates
end_source "mars-newsroom"

# ---------------------------------------------------------------------------
# REMEDIATION IS DERIVED FROM THIS RUN, NOT PRINTED FROM A TEMPLATE.
#
# This block used to print the same example SQL every time, naming
# https://www.mars.com/rss.xml -- a URL that had already been removed from the
# hosted row. Advice that is irrelevant on every run after the first teaches an
# operator to skip the section, which is exactly when a real one appears.
#
# So: if nothing 404ed, nothing is printed. If something did, the statement
# below names those URLs, in the array they actually live in.
# ---------------------------------------------------------------------------
if [ -n "$DEAD" ]; then
  blue ""
  blue "== Candidates this run proved do not exist"
  echo ''
  echo '  Each of these answered 404. Remove them from connector_config; a'
  echo '  dead candidate costs a request and a log line on every run.'
  echo ''
  for arr in $(printf '%s' "$DEAD" | awk 'NF {print $1}' | sort -u); do
    # Every URL for this array, single-quoted and comma-separated.
    urls="$(printf '%s' "$DEAD" | awk -v a="$arr" '$1 == a {print $2}' \
            | sed "s/^/'/; s/\$/'/" | paste -sd, - | sed 's/,/, /g')"
    printf '    -- %s\n' "$arr"
    printf '    update sources\n'
    printf '       set connector_config = jsonb_set(\n'
    printf "             connector_config, '{%s}',\n" "$arr"
    printf '             coalesce((select jsonb_agg(value order by ordinality)\n'
    printf "                         from jsonb_array_elements_text(connector_config->'%s')\n" "$arr"
    printf '                              with ordinality as c(value, ordinality)\n'
    printf '                        where value not in (%s)), %s)),\n' "$urls" "'[]'::jsonb"
    printf '           updated_at = now()\n'
    printf "     where id = 'mars-newsroom';\n\n"
  done
  echo '  One array per statement, so the others are untouched. Do NOT use the'
  echo "  \`connector_config || '{...}'\` form unless you are supplying the"
  echo '  COMPLETE remaining array: that form replaces the whole key.'
  echo ''
fi

exit "$EXIT"
