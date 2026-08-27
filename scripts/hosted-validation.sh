#!/usr/bin/env bash
#
# PR #9 hosted validation -- Bash equivalent of scripts/Invoke-HostedValidation.ps1.
#
# The PowerShell script is the primary procedure. This one exists for a
# Linux/macOS operator and performs the SAME checks under the same names, so two
# runs can be compared line for line.
#
# SECRET HANDLING. Neither value is a parameter, an environment variable, or a
# command-line argument, and neither is ever written to disk:
#
#   * both are prompted for with `read -rs`, so the characters are not echoed and
#     never enter shell history -- nothing is typed on a command line;
#   * every request that carries a credential builds its headers in a curl
#     config read from STDIN, so the value never appears in `ps` output;
#   * redaction is done with bash parameter expansion rather than `sed`, because
#     a sed script is itself an argv;
#   * the script refuses to start under `set -x` or `set -v`;
#   * both variables are cleared in a trap on EXIT, INT, TERM and HUP.
#
# THE CANARY. This script creates its own evidence records and its own storage
# object with identifiers unique to the run, and removes all of them in the exit
# trap -- on success, on failure, and on Ctrl-C. Nothing is left staged in the
# hosted database waiting for a human.
#
#   cd /path/to/Haskell-FB-Opportunity-Radar
#   git switch claude/production-foundation
#   bash scripts/hosted-validation.sh
#
# Paste the whole output into PR #9.

set -uo pipefail

# --- 0a. Refuse to run anywhere the values could be captured. ---------------
case "$-" in
    *x*) echo "Refusing to run under 'set -x': tracing would print request headers." >&2; exit 2 ;;
    *v*) echo "Refusing to run under 'set -v': verbose mode would echo the input." >&2; exit 2 ;;
esac
if [ -n "${BASH_XTRACEFD:-}" ]; then
    echo "Refusing to run with BASH_XTRACEFD set: a trace is being captured." >&2; exit 2
fi
set +o history 2>/dev/null || true

PREVIEW="${PREVIEW:-https://deploy-preview-9--haskell-fb-opportunity-radar.netlify.app}"
BRANCH="${BRANCH:-claude/production-foundation}"
REPOSITORY="${REPOSITORY:-OpeniOracle/Haskell-FB-Opportunity-Radar}"
EXPECTED_HEAD="${EXPECTED_HEAD:-}"

# Not secret. Committed in netlify.toml; it grants nothing on its own.
SUPABASE_URL="https://dutmdlbangsthclgtkhy.supabase.co"
PUBLISHABLE="sb_publishable_kE97uOb8HCo51uT_e0mxqg_So2Z0dwH"
BUCKET="evidence-raw"

TOKEN=""
SECRET=""
SIGNED_OUT=0
PASS=0
FAIL=0

CANARY_RUN=""
CANARY_ARCHIVED=""
CANARY_REFERENCE=""
CANARY_PATH=""
CANARY_TEXT=""
CREATED=""

sect() { printf '\n== %s\n' "$1"; }
ok()   { PASS=$((PASS+1)); printf '  PASS  %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); printf '  FAIL  %s -- %s\n' "$1" "$(redact "$2")"; }
note() { printf '  note  %s\n' "$1"; }
check() { if [ "$2" = "1" ]; then ok "$1"; else bad "$1" "${3:-}"; fi }

# Redaction without argv. `sed -e "s/$TOKEN/.../"` would put the token in `ps`.
redact() {
    local text="$1"
    [ -n "$TOKEN" ] && text="${text//$TOKEN/<TOKEN>}"
    [ -n "$SECRET" ] && text="${text//$SECRET/<SECRET>}"
    printf '%s' "$text"
}

uuid() {
    if [ -r /proc/sys/kernel/random/uuid ]; then cat /proc/sys/kernel/random/uuid
    else python3 -c 'import uuid;print(uuid.uuid4())'; fi
}

# --- 0b. Refuse to run against the wrong tree. -----------------------------
sect "0. Repository guard"
git rev-parse --show-toplevel >/dev/null 2>&1 || {
    echo "ABORTED: not inside a git repository. cd into the clone and run again." >&2; exit 2; }
note "repository root: $(git rev-parse --show-toplevel)"

REMOTE="$(git remote get-url origin 2>/dev/null || true)"
NORMALISED="${REMOTE#git@github.com:}"
NORMALISED="${NORMALISED#https://github.com/}"
NORMALISED="${NORMALISED%.git}"
if [ "$NORMALISED" != "$REPOSITORY" ]; then
    echo "ABORTED: origin is '$NORMALISED', expected '$REPOSITORY'. This script must not run against another repository." >&2
    exit 2
fi
ok "origin is $REPOSITORY"

DIRTY="$(git status --porcelain)"
if [ -n "$DIRTY" ]; then
    echo "ABORTED: the working tree is not clean. Validating a tree that differs from the pull request proves nothing about the pull request." >&2
    printf '%s\n' "$DIRTY" >&2
    exit 2
fi
ok "working tree is clean"

CURRENT="$(git rev-parse --abbrev-ref HEAD)"
if [ "$CURRENT" != "$BRANCH" ]; then
    echo "ABORTED: on branch '$CURRENT', expected '$BRANCH' (the head branch of PR #9)." >&2; exit 2
fi
ok "on $BRANCH"

git fetch origin "$BRANCH" >/dev/null 2>&1 || { echo "ABORTED: could not fetch origin/$BRANCH." >&2; exit 2; }
HEAD_SHA="$(git rev-parse HEAD)"
REMOTE_SHA="$(git rev-parse FETCH_HEAD)"
if [ "$HEAD_SHA" != "$REMOTE_SHA" ]; then
    echo "ABORTED: HEAD is $HEAD_SHA but origin/$BRANCH is $REMOTE_SHA. Pull, then run again." >&2; exit 2
fi
ok "HEAD matches origin/$BRANCH"
if [ -n "$EXPECTED_HEAD" ] && [ "$HEAD_SHA" != "$EXPECTED_HEAD" ]; then
    echo "ABORTED: HEAD is $HEAD_SHA but EXPECTED_HEAD was $EXPECTED_HEAD." >&2; exit 2
fi
printf '  head: %s\n' "$HEAD_SHA"

# --- HTTP, with credentials kept out of argv. ------------------------------
#
# Sets HTTP_STATUS, HTTP_HEADERS and HTTP_BODY. `--config -` reads the request
# -- including the Authorization and apikey headers -- from stdin, so nothing
# confidential ever reaches the process table.
http() {
    local method="$1" url="$2" auth="$3" apikey="$4" body="${5:-}" ctype="${6:-application/json}"
    local config="" raw="" authval="" keyval=""

    # A USER's access token is a JWT and belongs in Authorization, paired with
    # the publishable key as `apikey` -- what a browser sends.
    #
    # The SECRET key is an OPAQUE key, not a JWT. It goes in `apikey` and
    # nowhere else: sent as a bearer value, PostgREST parses it as a JWT, fails,
    # and answers 401 -- which reads as a bad key and is not. Asking for
    # `secret` as the auth therefore routes it to `apikey`.
    case "$auth" in
        token)  authval="$TOKEN" ;;
    esac
    case "$apikey" in
        publishable) keyval="$PUBLISHABLE" ;;
        secret)      keyval="$SECRET" ;;
    esac
    [ "$auth" = "secret" ] && keyval="$SECRET"

    config="url = \"$url\"
request = \"$method\"
silent
show-error
include
user-agent = "Openi-Haskell-FB-Radar-Operator/1.0"
max-time = 45
write-out = \"\\n<<<STATUS>>>%{http_code}\"
"
    [ -n "$authval" ] && config+="header = \"Authorization: Bearer $authval\"
"
    [ -n "$keyval" ] && config+="header = \"apikey: $keyval\"
"
    if [ -n "$body" ]; then
        config+="header = \"Content-Type: $ctype\"
data-binary = \"$body\"
"
    fi

    raw="$(printf '%s' "$config" | curl --config - 2>&1)"
    HTTP_STATUS="${raw##*<<<STATUS>>>}"
    raw="${raw%$'\n'<<<STATUS>>>*}"
    # Split the last header block from the body; a redirect can produce two.
    HTTP_HEADERS="${raw%%$'\r\n\r\n'*}"
    HTTP_BODY="${raw#*$'\r\n\r\n'}"
    if [ "$HTTP_HEADERS" = "$raw" ]; then HTTP_HEADERS=""; fi
    case "$HTTP_STATUS" in ''|*[!0-9]*) HTTP_STATUS=0 ;; esac
}

header_value() {
    printf '%s' "$HTTP_HEADERS" | tr -d '\r' | awk -v n="$(printf '%s' "$1" | tr 'A-Z' 'a-z')" \
        'BEGIN{IGNORECASE=1} {i=index($0,":"); if(i){k=tolower(substr($0,1,i-1)); if(k==n){print substr($0,i+2)}}}'
}

jfield() {
    printf '%s' "$HTTP_BODY" | python3 -c '
import json, sys
path = sys.argv[1].split(".")
try:
    value = json.load(sys.stdin)
except Exception:
    print(""); raise SystemExit
for part in path:
    if not isinstance(value, dict) or part not in value:
        print(""); raise SystemExit
    value = value[part]
print("" if value is None else json.dumps(value).strip(chr(34)))
' "$1" 2>/dev/null
}

bool() { if [ "$1" = "1" ] || [ "$1" = "true" ]; then echo 1; else echo 0; fi }

# --- Cleanup, always. ------------------------------------------------------
cleanup() {
    local code=$?
    set +e
    if [ -n "$CREATED" ]; then
        sect "9. Canary cleanup"
        case "$CREATED" in *object*)
            http DELETE "$SUPABASE_URL/storage/v1/object/$BUCKET/$CANARY_PATH" secret secret
            check "canary object deleted" "$([ "$HTTP_STATUS" = 200 ] || [ "$HTTP_STATUS" = 204 ] && echo 1 || echo 0)" "got $HTTP_STATUS"
            http GET "$SUPABASE_URL/storage/v1/object/$BUCKET/$CANARY_PATH" secret secret
            check "and it is gone" "$([ "$HTTP_STATUS" != 200 ] && echo 1 || echo 0)" "got $HTTP_STATUS"
        ;; esac
        case "$CREATED" in *evidence*)
            for id in "$CANARY_ARCHIVED" "$CANARY_REFERENCE"; do
                http DELETE "$SUPABASE_URL/rest/v1/evidence?id=eq.$id" secret secret
                check "canary evidence ${id:0:8} deleted" "$([ "$HTTP_STATUS" = 200 ] || [ "$HTTP_STATUS" = 204 ] && echo 1 || echo 0)" "got $HTTP_STATUS"
            done
        ;; esac
        case "$CREATED" in *source_run*)
            http DELETE "$SUPABASE_URL/rest/v1/source_runs?id=eq.$CANARY_RUN" secret secret
            check "canary collection run deleted" "$([ "$HTTP_STATUS" = 200 ] || [ "$HTTP_STATUS" = 204 ] && echo 1 || echo 0)" "got $HTTP_STATUS"
        ;; esac
        http GET "$SUPABASE_URL/rest/v1/evidence?select=id" secret secret
        check "no evidence rows remain" "$([ "$(printf '%s' "$HTTP_BODY" | tr -d ' \r\n')" = "[]" ] && echo 1 || echo 0)" "remaining: $HTTP_BODY"
        http GET "$SUPABASE_URL/rest/v1/source_runs?select=id" secret secret
        check "no collection runs remain" "$([ "$(printf '%s' "$HTTP_BODY" | tr -d ' \r\n')" = "[]" ] && echo 1 || echo 0)" "remaining: $HTTP_BODY"
        if [ "$FAIL" -ne 0 ]; then
            printf '  canary identifiers, in case anything above failed:\n'
            printf '    evidence: %s, %s\n    source_run: %s\n    object: %s\n' \
                "$CANARY_ARCHIVED" "$CANARY_REFERENCE" "$CANARY_RUN" "$CANARY_PATH"
        fi
    fi

    # Overwrite, then unset. Bash strings cannot be wiped from memory with
    # certainty, but dropping the references is what is available here.
    TOKEN=""; SECRET=""
    unset TOKEN SECRET

    printf '\nhead %s\n' "$HEAD_SHA"
    printf '%d passed, %d failed\n' "$PASS" "$FAIL"
    if [ "$FAIL" -eq 0 ] && [ "$code" -eq 0 ]; then
        printf 'HOSTED VALIDATION PASSED. Paste this whole output into PR #9.\n'
    else
        printf 'HOSTED VALIDATION FAILED. Paste this whole output into PR #9 without editing it.\n'
    fi
    [ "$SIGNED_OUT" = "1" ] && printf 'The administrator session was signed out by check 8. Sign back in before using the preview.\n'
    if [ "$FAIL" -ne 0 ]; then exit 1; fi
    exit "$code"
}
trap cleanup EXIT INT TERM HUP

# --- Prompt. ---------------------------------------------------------------
command -v python3 >/dev/null 2>&1 || { echo "ABORTED: python3 is required to read JSON fields." >&2; exit 2; }

cat <<'EOF'

Two values are needed. Neither is echoed, stored, or written to disk.
  1. The bootstrap administrator access token. In the browser console on the
     deploy preview, signed in:
       JSON.parse(localStorage.getItem(Object.keys(localStorage)
         .find(k => k.startsWith("sb-") && k.endsWith("-auth-token")))).access_token
  2. The Supabase secret key (sb_secret_...), from Project Settings > API keys.

EOF
printf 'Administrator access token: '
read -rs TOKEN; printf '\n'
printf 'Supabase secret key: '
read -rs SECRET; printf '\n'
[ -n "$TOKEN" ] || { echo "ABORTED: no access token entered." >&2; exit 2; }
[ -n "$SECRET" ] || { echo "ABORTED: no secret key entered." >&2; exit 2; }

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
CANARY_RUN="$(uuid)"
CANARY_ARCHIVED="$(uuid)"
CANARY_REFERENCE="$(uuid)"
CANARY_PATH="canary/$STAMP-$(uuid).txt"
CANARY_TEXT="evidence-proxy-canary $STAMP"
printf '  canary run id: %s\n' "$CANARY_RUN"

# ---------------------------------------------------------------------------
sect "1-2. /api/status as the invited administrator"
http GET "$PREVIEW/api/status" token none
check "status responds 200" "$([ "$HTTP_STATUS" = 200 ] && echo 1 || echo 0)" "got $HTTP_STATUS $HTTP_BODY"
printf '%s\n' "$(redact "$HTTP_BODY")" | python3 -m json.tool 2>/dev/null || true

check "foundation ok"                    "$(bool "$(jfield ok)")"
check "database reachable as the caller" "$(bool "$(jfield database.reachable)")"
check "schema version is 0018"           "$([ "$(jfield schema.version)" = "0018" ] && echo 1 || echo 0)" "got '$(jfield schema.version)'"
check "evidence bucket is private"       "$(bool "$(jfield storage.private)")"
check "model credential configured"      "$(bool "$(jfield modelConfigured)")"
check "SEC contact confirmed"            "$(bool "$(jfield sec.contactConfirmed)")"
check "invite-only enforced"             "$(bool "$(jfield auth.inviteOnlyEnforced)")"
check "session guard installed (0018)"   "$(bool "$(jfield auth.evidenceSessionCheckInstalled)")" "migration 0018 is not applied to this project"
check "this session passes the guard"    "$(bool "$(jfield auth.evidenceAccessAuthorized)")"
note  "JWT verification mode: $(jfield auth.jwtVerification)"
check "caller is invited"                "$(bool "$(jfield caller.invited)")"
case "$HTTP_BODY" in
    *sb_secret_*|*sb_publishable_*) check "response leaks no key" 0 "a key appears in the status body" ;;
    *) check "response leaks no key" 1 ;;
esac

# ---------------------------------------------------------------------------
sect "3. Unauthenticated access is refused"
http GET "$PREVIEW/api/status" none none
check "unauthenticated /api/status is 401" "$([ "$HTTP_STATUS" = 401 ] && echo 1 || echo 0)" "got $HTTP_STATUS"
http GET "$PREVIEW/api/evidence/$CANARY_ARCHIVED" none none
check "unauthenticated /api/evidence is 401" "$([ "$HTTP_STATUS" = 401 ] && echo 1 || echo 0)" "got $HTTP_STATUS"
GARBAGE="eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJub25lIn0.bm90LWEtc2lnbmF0dXJl"
TOKEN_REAL="$TOKEN"; TOKEN="$GARBAGE"
http GET "$PREVIEW/api/status" token none
TOKEN="$TOKEN_REAL"; TOKEN_REAL=""
check "a well-formed but invalid token is 401" "$([ "$HTTP_STATUS" = 401 ] && echo 1 || echo 0)" "got $HTTP_STATUS"
http GET "$PREVIEW/api/evidence/00000000-0000-4000-8000-000000000000" token none
check "an unknown evidence id is 404" "$([ "$HTTP_STATUS" = 404 ] && echo 1 || echo 0)" "got $HTTP_STATUS"

# ---------------------------------------------------------------------------
sect "5. Evidence canary -- create, retrieve, verify"
http POST "$SUPABASE_URL/rest/v1/source_runs" secret secret \
    "{\"id\":\"$CANARY_RUN\",\"source_id\":\"sec-edgar\",\"status\":\"success\",\"run_status\":\"success\",\"items_seen\":1,\"items_stored\":1}"
check "canary collection run created" "$(case $HTTP_STATUS in 200|201|204) echo 1;; *) echo 0;; esac)" "got $HTTP_STATUS $HTTP_BODY"
case $HTTP_STATUS in 200|201|204) CREATED="$CREATED source_run" ;; esac

http POST "$SUPABASE_URL/storage/v1/object/$BUCKET/$CANARY_PATH" secret secret "$CANARY_TEXT" "text/plain"
check "canary object uploaded to the private bucket" "$(case $HTTP_STATUS in 200|201) echo 1;; *) echo 0;; esac)" "got $HTTP_STATUS $HTTP_BODY"
case $HTTP_STATUS in 200|201) CREATED="$CREATED object" ;; esac

NOW_ISO="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
H1="$(printf '1%.0s' $(seq 64))"
H2="$(printf '2%.0s' $(seq 64))"
http POST "$SUPABASE_URL/rest/v1/evidence" secret secret \
"[{\"id\":\"$CANARY_ARCHIVED\",\"source_id\":\"sec-edgar\",\"source_run_id\":\"$CANARY_RUN\",\"original_url\":\"https://www.sec.gov/canary\",\"resolved_url\":\"https://www.sec.gov/canary\",\"title\":\"Evidence proxy canary $STAMP\",\"retrieved_at\":\"$NOW_ISO\",\"content_hash\":\"$H1\",\"mime_type\":\"text/plain\",\"extraction_status\":\"success\",\"access_mode\":\"archived_full_text\",\"raw_storage_uri\":\"$CANARY_PATH\"},{\"id\":\"$CANARY_REFERENCE\",\"source_id\":\"sec-edgar\",\"source_run_id\":\"$CANARY_RUN\",\"original_url\":\"https://example.invalid/newsroom\",\"resolved_url\":\"https://example.invalid/newsroom\",\"title\":\"Reference-only canary $STAMP\",\"retrieved_at\":\"$NOW_ISO\",\"content_hash\":\"$H2\",\"mime_type\":\"text/html\",\"extraction_status\":\"success\",\"access_mode\":\"reference_only\"}]"
check "canary evidence rows created" "$(case $HTTP_STATUS in 200|201|204) echo 1;; *) echo 0;; esac)" "got $HTTP_STATUS $HTTP_BODY"
case $HTTP_STATUS in 200|201|204) CREATED="$CREATED evidence" ;; esac

http GET "$PREVIEW/api/evidence/$CANARY_ARCHIVED" token none
check "the proxy serves the preserved copy" "$([ "$HTTP_STATUS" = 200 ] && echo 1 || echo 0)" "got $HTTP_STATUS $HTTP_BODY"
SERVED_HEADERS="$HTTP_HEADERS"
BODY_TRIMMED="$(printf '%s' "$HTTP_BODY" | tr -d '\r\n')"
check "the bytes are the bytes that were stored" "$([ "$BODY_TRIMMED" = "$CANARY_TEXT" ] && echo 1 || echo 0)" "got '$HTTP_BODY'"

sect "7. Cache and disclosure headers"
CACHE="$(header_value cache-control)"
check "cache-control is 'private, no-store'" "$(case "$CACHE" in *private*no-store*|*no-store*private*) echo 1;; *) echo 0;; esac)" "got '$CACHE'"
check "pragma: no-cache"                "$(case "$(header_value pragma)" in *no-cache*) echo 1;; *) echo 0;; esac)"
check "content-disposition: attachment" "$(case "$(header_value content-disposition)" in *attachment*) echo 1;; *) echo 0;; esac)"
check "x-content-type-options: nosniff" "$(case "$(header_value x-content-type-options)" in *nosniff*) echo 1;; *) echo 0;; esac)"
check "referrer-policy: no-referrer"    "$(case "$(header_value referrer-policy)" in *no-referrer*) echo 1;; *) echo 0;; esac)"
LEAK="$SERVED_HEADERS
$HTTP_BODY"
check "no storage path in the response" "$(case "$LEAK" in *"$CANARY_PATH"*) echo 0;; *) echo 1;; esac)"
check "no signed URL in the response"   "$(case "$LEAK" in *"token="*|*"/object/sign/"*|*"X-Amz-Signature"*) echo 0;; *) echo 1;; esac)"
check "no bucket name in the response"  "$(case "$LEAK" in *"$BUCKET"*) echo 0;; *) echo 1;; esac)"

sect "5b. Reference-only evidence (ADR 0014)"
http GET "$PREVIEW/api/evidence/$CANARY_REFERENCE" token none
check "reference-only evidence answers 409" "$([ "$HTTP_STATUS" = 409 ] && echo 1 || echo 0)" "got $HTTP_STATUS"
check "and names no_retained_content" "$(case "$HTTP_BODY" in *no_retained_content*) echo 1;; *) echo 0;; esac)"

# ---------------------------------------------------------------------------
sect "6. Direct Storage access is refused"
http GET "$SUPABASE_URL/storage/v1/object/public/$BUCKET/$CANARY_PATH" none none
check "anonymous public-object URL is refused" "$([ "$HTTP_STATUS" != 200 ] && echo 1 || echo 0)" "got $HTTP_STATUS"
http GET "$SUPABASE_URL/storage/v1/object/$BUCKET/$CANARY_PATH" none publishable
check "anonymous authenticated-path URL is refused" "$([ "$HTTP_STATUS" != 200 ] && echo 1 || echo 0)" "got $HTTP_STATUS"
http GET "$SUPABASE_URL/storage/v1/object/$BUCKET/$CANARY_PATH" token publishable
check "a signed-in browser session cannot fetch the object directly" "$([ "$HTTP_STATUS" != 200 ] && echo 1 || echo 0)" "got $HTTP_STATUS"
http GET "$SUPABASE_URL/storage/v1/bucket/$BUCKET" token publishable
check "a signed-in session cannot read bucket metadata" "$([ "$HTTP_STATUS" != 200 ] && echo 1 || echo 0)" "got $HTTP_STATUS"
http GET "$SUPABASE_URL/rest/v1/evidence?select=raw_storage_uri&limit=1" token publishable
check "a signed-in session cannot select raw_storage_uri" \
    "$(if [ "$HTTP_STATUS" != 200 ]; then echo 1; else case "$HTTP_BODY" in *canary/*) echo 0;; *) echo 1;; esac; fi)" "got $HTTP_STATUS $HTTP_BODY"
http GET "$SUPABASE_URL/rest/v1/licence_authorizations?select=*" token publishable
check "the D14-L licence gate is unreadable" \
    "$(if [ "$HTTP_STATUS" != 200 ]; then echo 1; else [ "$(printf '%s' "$HTTP_BODY" | tr -d ' \r\n')" = "[]" ] && echo 1 || echo 0; fi)" "got $HTTP_STATUS $HTTP_BODY"
http GET "$SUPABASE_URL/rest/v1/organizations?select=id&limit=1" none publishable
check "an anonymous table read returns nothing" \
    "$(if [ "$HTTP_STATUS" != 200 ]; then echo 1; else [ "$(printf '%s' "$HTTP_BODY" | tr -d ' \r\n')" = "[]" ] && echo 1 || echo 0; fi)" "got $HTTP_STATUS $HTTP_BODY"
http GET "$SUPABASE_URL/rest/v1/organizations?select=id&limit=1" token publishable
check "positive control: the dashboard read DOES work" \
    "$(if [ "$HTTP_STATUS" = 200 ] && [ "$(printf '%s' "$HTTP_BODY" | tr -d ' \r\n')" != "[]" ]; then echo 1; else echo 0; fi)" "got $HTTP_STATUS $HTTP_BODY"

# ---------------------------------------------------------------------------
sect "3b. Self-registration is refused"
http POST "$SUPABASE_URL/auth/v1/signup" none publishable \
    "{\"email\":\"uninvited-$STAMP@example.invalid\",\"password\":\"$(uuid)\"}"
check "signup is refused" "$([ "$HTTP_STATUS" != 200 ] && echo 1 || echo 0)" "got $HTTP_STATUS $HTTP_BODY"
[ "$HTTP_STATUS" = 200 ] && note "If a user was created, delete it in the dashboard and re-check the Auth settings."

# ---------------------------------------------------------------------------
sect "8. Sign-out revokes evidence access immediately"
EXP="$(printf '%s' "$TOKEN" | python3 -c '
import base64, json, sys
try:
    part = sys.stdin.read().split(".")[1]
    part += "=" * (-len(part) % 4)
    print(json.loads(base64.urlsafe_b64decode(part)).get("exp", 0))
except Exception:
    print(0)
')"
LEFT=$(( EXP - $(date -u +%s) ))

http GET "$PREVIEW/api/evidence/$CANARY_ARCHIVED" token none
check "evidence retrievable immediately before sign-out" "$([ "$HTTP_STATUS" = 200 ] && echo 1 || echo 0)" "got $HTTP_STATUS"

http POST "$SUPABASE_URL/auth/v1/logout?scope=global" token publishable
check "sign-out accepted" "$(case $HTTP_STATUS in 200|204) echo 1;; *) echo 0;; esac)" "got $HTTP_STATUS $HTTP_BODY"
SIGNED_OUT=1

http GET "$PREVIEW/api/evidence/$CANARY_ARCHIVED" token none
check "the SAME token is refused by the evidence proxy after sign-out" "$([ "$HTTP_STATUS" = 401 ] && echo 1 || echo 0)" "got $HTTP_STATUS"
check "and the token had not merely expired" "$([ "$LEFT" -gt 60 ] && echo 1 || echo 0)" "only ${LEFT}s of life remained; re-run with a fresh token"
note "the token still had ${LEFT}s before its own exp"

# INFORMATIONAL, deliberately not pass/fail. Ordinary reads keep Supabase's
# documented behaviour: an issued access token remains valid until it expires.
# Only the evidence proxy checks the session table.
http GET "$PREVIEW/api/status" token none
note "informational -- /api/status after sign-out answered $HTTP_STATUS."
note "That endpoint does NOT perform the session-table check, and this run does not"
note "assert a value for it. Immediate revocation is a property of /api/evidence only."

exit 0
