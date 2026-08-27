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

test_api_route() { # test_api_route <path> <acceptable status regex>
  printf '\n%s\n' "$1"
  probe "$1"
  if [ "$STATUS" = "0" ]; then check "$1 is reachable" 1 "no response"; return; fi

  case "$TYPE$BODY" in
    *text/html*|'<'*) is_html=0 ;;
    *) is_html=1 ;;
  esac
  check "$1 is not the single-page application" "$is_html" \
        "content-type '$TYPE' -- the SPA fallback is winning, so this route never reaches its function"

  case "$TYPE" in *application/json*) r=0 ;; *) r=1 ;; esac
  check "$1 declares JSON" "$r" "content-type '$TYPE'"

  [ -z "$LOCATION" ]; check "$1 does not redirect to the interface" $? "Location: $LOCATION"

  printf '%s' "$STATUS" | grep -Eq "$2"; check "$1 answers $2" $? "got $STATUS"

  if [ "$is_html" -ne 0 ]; then
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

# A 503 is an acceptable refusal: the function ran and found the deployment
# incomplete, which still proves the route reached a function.
test_api_route '/api/session' '^(401|503)$'
test_api_route '/api/status'  '^(401|503)$'
test_api_route '/api/evidence/00000000-0000-4000-8000-000000000000' '^(401|503)$'

printf '\n/api/not-a-route (must not be the SPA)\n'
probe '/api/not-a-route'
{ [ "$STATUS" = "404" ] || ! printf '%s' "$TYPE" | grep -q 'text/html'; }
check '/api/not-a-route does not return the application' $? "status $STATUS, content-type '$TYPE'"

printf '\n/opportunities (must be the SPA)\n'
probe '/opportunities'
{ [ "$STATUS" = "200" ] && printf '%s' "$TYPE" | grep -q 'text/html'; }
check 'a deep link still serves the application' $? "status $STATUS, content-type '$TYPE'"

printf '\n%d passed, %d failed\n' "$pass" "$fail"
if [ "$fail" -gt 0 ]; then
  printf '\nThe API is not correctly routed on this deployment.\n'
  printf 'Do not send an invitation until this passes: the callback will fail\n'
  printf 'with a session-verification error that looks like an account problem.\n'
  exit 1
fi
printf 'The API is correctly routed on this deployment.\n'
