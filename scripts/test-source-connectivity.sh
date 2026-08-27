#!/usr/bin/env bash
#
# Can this machine reach the primary sources, and what do they answer?
#
# CREDENTIAL-FREE BY CONSTRUCTION. Every endpoint here is public: SEC's ticker
# file and submissions API, and whatever Mars serves at its robots and feed
# paths. Nothing is sent but a declared User-Agent, so this can be run from any
# machine, pasted into a ticket, and re-run by anyone.
#
# WHAT IT IS FOR. Before a backfill, to confirm the network path exists and the
# sources answer the way the connectors expect. After a failed run, to tell
# apart "our deployment is broken" from "the source changed" -- which are
# indistinguishable from a run report alone.
#
# WHAT IT DOES NOT DO. It does not authenticate, does not write anything, does
# not follow a challenge, and does not retry. A 403 here is data, not a problem
# to route around.
#
# Usage: bash scripts/test-source-connectivity.sh [user-agent]

set -uo pipefail

UA="${1:-Openi-Haskell-FB-Radar-Operator/1.0 (oracles@openi-analytics.com)}"
FAILED=0
CHECKED=0

blue()  { printf '\033[36m%s\033[0m\n' "$1"; }
pass()  { printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
fail()  { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; FAILED=$((FAILED + 1)); }
note()  { printf '  note  %s\n' "$1"; }

probe() {
  # $1 label, $2 url, $3 what a healthy body should contain (optional)
  local label="$1" url="$2" expect="${3:-}"
  CHECKED=$((CHECKED + 1))

  local tmp status
  tmp="$(mktemp)"
  # No `|| echo 000` here: curl already writes 000 for a failed transfer, and
  # appending another made every failure read "000000" and fall through to the
  # unexpected-status branch -- which hid whose refusal it actually was.
  status="$(curl -sS -o "$tmp" -w '%{http_code}' --max-time 25 \
            -H "User-Agent: $UA" -H 'Accept-Encoding: gzip, deflate' \
            --compressed "$url" 2>"$tmp.err")"

  printf '  %-58s HTTP %s\n' "$label" "$status"

  if [ "$status" = "000" ]; then
    # Say WHOSE refusal this is. A proxy denial and a source denial are
    # different problems and look identical in a status code of zero.
    if grep -qi 'connect tunnel failed\|proxy' "$tmp.err" 2>/dev/null; then
      fail "$label -- the local network refused the connection (proxy/egress policy), NOT the source"
    else
      fail "$label -- no response (DNS, TLS or timeout)"
    fi
    rm -f "$tmp" "$tmp.err"
    return
  fi

  case "$status" in
    200)
      if [ -n "$expect" ] && ! grep -qi -- "$expect" "$tmp"; then
        fail "$label -- answered 200 but the body did not contain '$expect'"
      else
        pass "$label"
      fi
      ;;
    301|302|307|308) note "$label -- redirected; the connector follows and re-checks the allowlist per hop" ;;
    403|503)
      if grep -qiE 'captcha|verify you are human|checking your browser|incapsula' "$tmp"; then
        fail "$label -- an interstitial challenge. Do not work around it; find the official feed."
      else
        fail "$label -- refused. Record the status and the URL; do not retry in a loop."
      fi
      ;;
    429) fail "$label -- rate limited. Slow down; the connector honours Retry-After." ;;
    404) fail "$label -- not found. If this is a configured candidate URL, correct it in connector_config." ;;
    *)   fail "$label -- unexpected status" ;;
  esac
  rm -f "$tmp" "$tmp.err"
}

blue "== User-Agent"
echo "  $UA"
if ! printf '%s' "$UA" | grep -q '@'; then
  fail "SEC fair access asks for a contact address in the User-Agent"
else
  pass "names a contact address"
fi

blue ""
blue "== SEC EDGAR (documented JSON APIs)"
probe "company_tickers.json"                 "https://www.sec.gov/files/company_tickers.json" "cik_str"
probe "submissions API responds"             "https://data.sec.gov/submissions/CIK0000100493.json" "filings"
probe "archive folder index"                 "https://www.sec.gov/Archives/edgar/data/100493/"

blue ""
blue "== Mars (official corporate sources)"
probe "robots.txt"                           "https://www.mars.com/robots.txt"
probe "newsroom index"                       "https://www.mars.com/news-and-stories"
probe "rss candidate"                        "https://www.mars.com/rss.xml"
probe "sitemap candidate"                    "https://www.mars.com/sitemap.xml"

blue ""
blue "== Result"
echo "  $CHECKED endpoint(s) checked, $FAILED did not answer as expected"
echo ""
echo "  A failure here is NOT a reason to disable a source. It is a reason to"
echo "  find out whose refusal it was: this machine's network, or the source."
echo "  Mars candidate URLs are configuration -- correct them with:"
echo ""
echo "    update sources set connector_config = connector_config || '{\"feedCandidates\":[\"<url>\"]}'::jsonb"
echo "     where id = 'mars-newsroom';"
echo ""

[ "$FAILED" -eq 0 ] || exit 1
