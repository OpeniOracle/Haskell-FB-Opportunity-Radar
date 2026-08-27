#!/usr/bin/env bash
# Linux/macOS equivalent of Test-DeployedRoutes.ps1.
#
# Proves that every /api/* route on a deployment reaches its Netlify function
# rather than the single-page application. No credentials are used or required.
#
# The decisive signal is the CONTENT TYPE, not the status. A `_redirects` file
# carrying only the SPA catch-all is processed before netlify.toml, so
# `/*  /index.html  200` matches /api/session and Netlify answers 200 with an
# HTML document. A 200 looks like success everywhere except here.
set -uo pipefail

ORIGIN="${1:-https://deploy-preview-9--haskell-fb-opportunity-radar.netlify.app}"
UA='Openi-Haskell-FB-Radar-Operator/1.0'
pass=0
fail=0

check() { # check <description> <condition-exit-code> [why]
  if [ "$2" -eq 0 ]; then
    printf '  PASS  %s\n' "$1"; pass=$((pass + 1))
  else
    printf '  FAIL  %s\n' "$1"; [ -n "${3:-}" ] && printf '        %s\n' "$3"; fail=$((fail + 1))
  fi
}

probe() { # probe <path> -> sets STATUS TYPE CACHE LOCATION BODY
  local body_file; body_file=$(mktemp)
  local meta
  # No -L: a redirect to /login is itself the finding, and following it hides it.
  meta=$(curl -sS -o "$body_file" -A "$UA" -H 'Accept: application/json' \
          -w '%{http_code}\t%{content_type}\t%{redirect_url}' \
          "$ORIGIN$1" 2>/dev/null) || meta=$'0\t\t'
  STATUS=$(printf '%s' "$meta" | cut -f1)
  TYPE=$(printf '%s' "$meta" | cut -f2)
  LOCATION=$(printf '%s' "$meta" | cut -f3)
  BODY=$(head -c 400 "$body_file")
  CACHE=$(curl -sS -I -A "$UA" "$ORIGIN$1" 2>/dev/null | tr -d '\r' \
          | awk 'tolower($1)=="cache-control:"{$1="";sub(/^ /,"");print}')
  rm -f "$body_file"
}

# TWO VERDICTS, KEPT APART.
#
# An earlier version accepted 401 OR 503 and reported "20 passed, 0 failed"
# while all three protected endpoints answered 503 -- telling an operator the
# deployment was ready when authentication was switched off. 503 proves ROUTING
# works (only a function can produce that body) and proves the deployment is NOT
# READY. Different questions, different answers. Readiness requires 401.
routing_ok=1
ready_ok=1

test_api_route() { # test_api_route <path>
  printf '\n%s\n' "$1"
  probe "$1"
  if [ "$STATUS" = "0" ]; then
    check "$1 is reachable" 1 "no response"; routing_ok=0; ready_ok=0; return
  fi

  # The status, always, whatever the verdict.
  printf '        HTTP %s   content-type: %s\n' "$STATUS" "$TYPE"

  # ---- Routing: did this reach a function at all? ----
  # `html` is a word, not an exit code. Conflating the two is how the previous
  # version reported "the SPA fallback is winning" about a JSON response.
  case "$TYPE$BODY" in
    *text/html*|'<'*) html=yes ;;
    *) html=no ;;
  esac
  [ "$html" = "no" ]; not_spa=$?
  [ "$not_spa" -ne 0 ] && routing_ok=0
  check "$1 is not the single-page application" "$not_spa" \
        "content-type '$TYPE' -- the SPA fallback is winning, so this route never reaches its function"

  case "$TYPE" in *application/json*) r=0 ;; *) r=1 ;; esac
  [ "$r" -ne 0 ] && routing_ok=0
  check "$1 declares JSON" "$r" "content-type '$TYPE'"

  [ -z "$LOCATION" ]; loc=$?
  [ "$loc" -ne 0 ] && routing_ok=0
  check "$1 does not redirect to the interface" "$loc" "Location: $LOCATION"

  # ---- Readiness: is it actually able to serve? ----
  if [ "$STATUS" = "503" ]; then
    ready_ok=0
    check "$1 is ready (expected HTTP 401)" 1 "HTTP 503 -- the function ran but the deployment is incomplete"
    # The safe message: it names what is missing and contains no value.
    detail=$(printf '%s' "$BODY" | python3 -c "
import json, sys
try:
    e = json.loads(sys.stdin.read()).get('error', {})
    print(e.get('code', '') + ': ' + e.get('message', ''))
except Exception:
    pass
" 2>/dev/null)
    [ -n "$detail" ] && printf '        %s\n' "$detail"
    return
  fi

  [ "$STATUS" = "401" ]; st=$?
  [ "$st" -ne 0 ] && ready_ok=0
  check "$1 refuses an unauthenticated caller with HTTP 401" "$st" "got HTTP $STATUS"

  if [ "$html" = "no" ]; then
    printf '%s' "$BODY" | python3 -c 'import json,sys; json.loads(sys.stdin.read())' 2>/dev/null
    check "$1 returns parseable JSON" $? "the body is not JSON"
  fi

  if [ -n "$CACHE" ]; then
    { printf '%s' "$CACHE" | grep -q 'no-store' && printf '%s' "$CACHE" | grep -q 'private'; }
    check "$1 is private and not stored" $? "cache-control: $CACHE"
  fi
}

printf '== Deployed API route contract\n   origin: %s\n' "$ORIGIN"
printf '   No credentials are used or required. Three unauthenticated GETs.\n'

# Unauthenticated: each must refuse with HTTP 401, in JSON.
test_api_route '/api/session'
test_api_route '/api/status'
test_api_route '/api/evidence/00000000-0000-4000-8000-000000000000'

printf '\n/api/not-a-route (must not be the SPA)\n'
probe '/api/not-a-route'
{ [ "$STATUS" = "404" ] || ! printf '%s' "$TYPE" | grep -q 'text/html'; }
check '/api/not-a-route does not return the application' $? "status $STATUS, content-type '$TYPE'"

printf '\n/opportunities (must be the SPA)\n'
probe '/opportunities'
{ [ "$STATUS" = "200" ] && printf '%s' "$TYPE" | grep -q 'text/html'; }
check 'a deep link still serves the application' $? "status $STATUS, content-type '$TYPE'"

printf '\n%d passed, %d failed\n\n' "$pass" "$fail"

# Routing first: a routing failure explains every readiness failure beneath it.
if [ "$routing_ok" -ne 1 ]; then
  printf 'ROUTING: FAILED\n'
  printf '  An /api route is being served by the single-page application.\n'
  printf '  Check that no _redirects file shadows the rules in netlify.toml.\n\n'
  printf 'DO NOT send an invitation. The callback cannot verify a session.\n'
  exit 1
fi
printf 'ROUTING: OK -- every /api route reaches its function.\n'

if [ "$ready_ok" -ne 1 ]; then
  printf 'READINESS: FAILED\n'
  printf '  The routes reach their functions, but a function reported that the\n'
  printf '  deployment is incomplete (HTTP 503). The message above names what is\n'
  printf '  missing. Set it in Netlify with Functions scope, for this deploy\n'
  printf '  context, and redeploy.\n\n'
  printf 'DO NOT send an invitation and DO NOT delete any account yet.\n'
  printf 'Sign-in cannot succeed while a required variable is missing.\n'
  exit 1
fi
printf 'READINESS: OK -- every protected route refuses an anonymous caller with 401.\n\n'
printf 'This deployment is routed and ready.\n'
