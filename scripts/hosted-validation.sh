#!/usr/bin/env bash
#
# PR #9 hosted validation — the whole thing, in one run.
#
# Runs every check that needs HTTP access to Netlify and Supabase, which the
# automation environment's egress policy blocks. Everything else (CI, the
# migration contract, the database-layer RLS and storage checks) is already
# proven and is not repeated here.
#
# USAGE
#   1. Sign in to the deploy preview as the bootstrap administrator.
#   2. Copy the access token (see PROCEDURE below).
#   3. export TOKEN='…'  SECRET='sb_secret_…'
#   4. bash scripts/hosted-validation.sh
#   5. Paste the whole output back.
#
# The script never prints TOKEN or SECRET, and never writes them to a file.
# It signs the session out at the very end on purpose — that is check 8.
#
# PROCEDURE for the token, in the browser console on the deploy preview:
#
#   JSON.parse(localStorage.getItem(Object.keys(localStorage)
#     .find(k => k.startsWith('sb-') && k.endsWith('-auth-token')))).access_token
#
set -uo pipefail

PREVIEW="${PREVIEW:-https://deploy-preview-9--haskell-fb-opportunity-radar.netlify.app}"
SUPABASE_URL="https://dutmdlbangsthclgtkhy.supabase.co"
# Not a secret. Committed in netlify.toml; it grants nothing on its own.
PUBLISHABLE="sb_publishable_kE97uOb8HCo51uT_e0mxqg_So2Z0dwH"

CANARY_EV="44444444-4444-4444-8444-444444444444"
CANARY_REF="66666666-6666-4666-8666-666666666666"
CANARY_PATH="canary/evidence-proxy-canary.txt"
CANARY_TEXT="evidence-proxy-canary-$(date -u +%Y%m%dT%H%M%SZ)"

: "${TOKEN:?export TOKEN='<access token>' first}"
: "${SECRET:?export SECRET='sb_secret_…' first}"

pass=0; fail=0
ok()   { printf '  PASS  %s\n' "$1"; pass=$((pass+1)); }
bad()  { printf '  FAIL  %s — %s\n' "$1" "$2"; fail=$((fail+1)); }
sect() { printf '\n== %s\n' "$1"; }

# Never let a secret reach the terminal, even inside an error message.
redact() { sed -e "s/${TOKEN}/<TOKEN>/g" -e "s/${SECRET}/<SECRET>/g"; }

code() { curl -s -o /dev/null -w '%{http_code}' --max-time 30 "$@"; }
body() { curl -s --max-time 30 "$@"; }

# ---------------------------------------------------------------------------
sect "1-2. /api/status as the invited administrator"

STATUS_JSON="$(body "$PREVIEW/api/status" -H "Authorization: Bearer $TOKEN")"
printf '%s\n' "$STATUS_JSON" | (command -v jq >/dev/null && jq . || cat) | redact

j() { printf '%s' "$STATUS_JSON" | python3 -c "
import json,sys
try: d=json.load(sys.stdin)
except Exception: print('PARSE_ERROR'); raise SystemExit
for k in '$1'.split('.'):
    d = d.get(k) if isinstance(d, dict) else None
print(json.dumps(d))
"; }

[ "$(j ok)" = "true" ]                      && ok "ok: true"                       || bad "ok" "$(j ok)"
[ "$(j database.reachable)" = "true" ]      && ok "database connected"             || bad "database" "$(j database.reachable)"
[ "$(j schema.version)" = '"0017"' ]        && ok "migration version 0017"         || bad "schema version" "$(j schema.version)"
[ "$(j storage.private)" = "true" ]         && ok "storage private"                || bad "storage.private" "$(j storage.private)"
[ "$(j storage.configured)" = "true" ]      && ok "storage configured"             || bad "storage.configured" "$(j storage.configured)"
[ "$(j modelConfigured)" = "true" ]         && ok "model configured"               || bad "modelConfigured" "$(j modelConfigured)"
[ "$(j sec.contactConfirmed)" = "true" ]    && ok "SEC contact confirmed"          || bad "sec.contactConfirmed" "$(j sec.contactConfirmed)"
[ "$(j caller.invited)" = "true" ]          && ok "caller is on the allowlist"     || bad "caller.invited" "$(j caller.invited)"
[ "$(j auth.inviteOnlyEnforced)" = "true" ] && ok "invite-only enforced"           || bad "auth.inviteOnlyEnforced" "$(j auth.inviteOnlyEnforced)"

# The response must carry no secret, no path, no connection string, no role.
if printf '%s' "$STATUS_JSON" \
     | grep -qEi 'sb_secret_|service_role|postgres(ql)?://|sk-ant-|eyJ[A-Za-z0-9_-]{20,}|canary/'; then
  bad "status response leaks something" "see body above"
else
  ok "status response contains no secret, path, connection string or role"
fi

# ---------------------------------------------------------------------------
sect "3. Unauthenticated and invalid-session access"

c="$(code "$PREVIEW/api/status")"
[ "$c" = "401" ] && ok "unauthenticated /api/status → 401" || bad "unauthenticated /api/status" "got $c"

c="$(code "$PREVIEW/api/status" -H 'Authorization: Bearer not-a-real-token')"
[ "$c" = "401" ] && ok "invalid session /api/status → 401" || bad "invalid session /api/status" "got $c"

c="$(code "$PREVIEW/api/evidence/$CANARY_EV")"
[ "$c" = "401" ] && ok "unauthenticated evidence → 401" || bad "unauthenticated evidence" "got $c"

c="$(code "$PREVIEW/api/evidence/$CANARY_EV" -H 'Authorization: Bearer not-a-real-token')"
[ "$c" = "401" ] && ok "invalid session evidence → 401" || bad "invalid session evidence" "got $c"

# ---------------------------------------------------------------------------
sect "5. Evidence proxy canary"

printf '%s\n' "$CANARY_TEXT" > /tmp/radar-canary.txt
up="$(code -X POST "$SUPABASE_URL/storage/v1/object/evidence-raw/$CANARY_PATH" \
        -H "Authorization: Bearer $SECRET" -H "apikey: $SECRET" \
        -H 'Content-Type: text/plain' --data-binary @/tmp/radar-canary.txt)"
[ "$up" = "200" ] && ok "canary object uploaded" || bad "canary upload" "got $up"

got="$(body "$PREVIEW/api/evidence/$CANARY_EV" -H "Authorization: Bearer $TOKEN")"
if printf '%s' "$got" | grep -q "$CANARY_TEXT"; then
  ok "invited administrator retrieved the canary"
else
  bad "canary retrieval" "body did not contain the canary text"
  printf '%s\n' "$got" | head -3 | redact
fi

c="$(code "$PREVIEW/api/evidence/$CANARY_REF" -H "Authorization: Bearer $TOKEN")"
[ "$c" = "409" ] && ok "reference-only evidence refused with 409 (ADR 0014)" \
                 || bad "reference-only evidence" "got $c, expected 409"

c="$(code "$PREVIEW/api/evidence/00000000-0000-4000-8000-000000000000" -H "Authorization: Bearer $TOKEN")"
[ "$c" = "404" ] && ok "unknown evidence id → 404" || bad "unknown evidence id" "got $c"

c="$(code "$PREVIEW/api/evidence/not-a-uuid" -H "Authorization: Bearer $TOKEN")"
[ "$c" = "404" ] && ok "malformed evidence id → 404" || bad "malformed evidence id" "got $c"

# ---------------------------------------------------------------------------
sect "7. Response headers"

HDRS="$(curl -sI --max-time 30 "$PREVIEW/api/evidence/$CANARY_EV" -H "Authorization: Bearer $TOKEN")"
printf '%s\n' "$HDRS" | grep -Ei 'cache-control|pragma|content-disposition|x-evidence-id' | redact

printf '%s' "$HDRS" | grep -qi 'cache-control: *private, *no-store' \
  && ok "Cache-Control: private, no-store" || bad "Cache-Control" "not private, no-store"
printf '%s' "$HDRS" | grep -qi 'pragma: *no-cache' \
  && ok "Pragma: no-cache" || bad "Pragma" "not no-cache"

if printf '%s' "$HDRS" | grep -qEi 'evidence-raw|canary/|storage/v1|sb_secret_'; then
  bad "headers reveal the bucket path" "see above"
else
  ok "headers reveal no bucket path"
fi

if body "$PREVIEW/api/evidence/$CANARY_EV" -H "Authorization: Bearer $TOKEN" \
     | grep -qEi 'evidence-raw|storage/v1|token='; then
  bad "body reveals a storage path or reusable URL" ""
else
  ok "body reveals no storage path or reusable URL"
fi

# ---------------------------------------------------------------------------
sect "6. Direct Storage access must fail"

c="$(code "$SUPABASE_URL/storage/v1/object/public/evidence-raw/$CANARY_PATH")"
[ "$c" != "200" ] && ok "anonymous public object URL → $c" || bad "anonymous object URL" "returned 200"

c="$(code "$SUPABASE_URL/storage/v1/object/evidence-raw/$CANARY_PATH" \
       -H "apikey: $PUBLISHABLE")"
[ "$c" != "200" ] && ok "anonymous authenticated-path object → $c" || bad "anon object" "returned 200"

c="$(code "$SUPABASE_URL/storage/v1/object/evidence-raw/$CANARY_PATH" \
       -H "Authorization: Bearer $TOKEN" -H "apikey: $PUBLISHABLE")"
[ "$c" != "200" ] && ok "signed-in browser direct object → $c" || bad "browser object" "returned 200"

c="$(code "$SUPABASE_URL/storage/v1/bucket/evidence-raw" \
       -H "Authorization: Bearer $TOKEN" -H "apikey: $PUBLISHABLE")"
[ "$c" != "200" ] && ok "signed-in browser bucket metadata → $c" || bad "bucket metadata" "returned 200"

c="$(code "$SUPABASE_URL/rest/v1/evidence?select=raw_storage_uri&limit=1" \
       -H "Authorization: Bearer $TOKEN" -H "apikey: $PUBLISHABLE")"
[ "$c" != "200" ] && ok "browser read of raw_storage_uri → $c" || bad "raw_storage_uri" "returned 200"

c="$(code "$SUPABASE_URL/rest/v1/licence_authorizations?select=id&limit=1" \
       -H "Authorization: Bearer $TOKEN" -H "apikey: $PUBLISHABLE")"
[ "$c" != "200" ] && ok "browser read of licence_authorizations → $c" || bad "licence gate" "returned 200"

c="$(code "$SUPABASE_URL/rest/v1/organizations?select=canonical_name&limit=1" \
       -H "apikey: $PUBLISHABLE")"
[ "$c" != "200" ] && ok "UNauthenticated read of organizations → $c" || bad "anon read" "returned 200"

c="$(code "$SUPABASE_URL/rest/v1/organizations?select=canonical_name&limit=1" \
       -H "Authorization: Bearer $TOKEN" -H "apikey: $PUBLISHABLE")"
[ "$c" = "200" ] && ok "signed-in read of organizations → 200 (the dashboard works)" \
                 || bad "authenticated dashboard read" "got $c"

# ---------------------------------------------------------------------------
sect "Self-registration must be unavailable"

SIGNUP="$(body -X POST "$SUPABASE_URL/auth/v1/signup" -H "apikey: $PUBLISHABLE" \
  -H 'Content-Type: application/json' \
  -d '{"email":"uninvited-probe@example.invalid","password":"Nd8s7!kQz2vLp0xR"}')"
printf '%s\n' "$SIGNUP" | head -c 400 | redact; echo
if printf '%s' "$SIGNUP" | grep -qiE 'signup|not allowed|disabled|Database error|invited|error'; then
  ok "self-registration refused"
else
  bad "self-registration" "the endpoint did not refuse — check Auth settings"
fi

# ---------------------------------------------------------------------------
sect "8. Sign out, then prove the session no longer works"

curl -s -o /dev/null --max-time 30 -X POST "$SUPABASE_URL/auth/v1/logout" \
  -H "Authorization: Bearer $TOKEN" -H "apikey: $PUBLISHABLE"
sleep 2

c="$(code "$PREVIEW/api/evidence/$CANARY_EV" -H "Authorization: Bearer $TOKEN")"
[ "$c" = "401" ] && ok "revoked session evidence → 401" || bad "revoked session evidence" "got $c"

c="$(code "$PREVIEW/api/status" -H "Authorization: Bearer $TOKEN")"
[ "$c" = "401" ] && ok "revoked session /api/status → 401" || bad "revoked session status" "got $c"

# ---------------------------------------------------------------------------
sect "9. Remove the canary object"

c="$(code -X DELETE "$SUPABASE_URL/storage/v1/object/evidence-raw/$CANARY_PATH" \
       -H "Authorization: Bearer $SECRET" -H "apikey: $SECRET")"
[ "$c" = "200" ] && ok "canary object deleted" || bad "canary delete" "got $c"

c="$(code "$SUPABASE_URL/storage/v1/object/evidence-raw/$CANARY_PATH" \
       -H "Authorization: Bearer $SECRET" -H "apikey: $SECRET")"
[ "$c" != "200" ] && ok "canary object gone → $c" || bad "canary still present" "returned 200"

rm -f /tmp/radar-canary.txt

# ---------------------------------------------------------------------------
printf '\n=========================================\n'
printf '  %d passed, %d failed\n' "$pass" "$fail"
printf '=========================================\n'
printf '\nSign back in afterwards — check 8 signed you out on purpose.\n'
printf 'The canary DATABASE rows are removed separately and their removal proven.\n'
[ "$fail" -eq 0 ]
