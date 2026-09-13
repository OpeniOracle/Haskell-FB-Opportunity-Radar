#!/usr/bin/env bash
#
# Is this deployment's Functions runtime actually configured?
#
# ------------------------------------------------------------------ why
#
# A Netlify deploy whose status is `ready` tells you the functions were built,
# uploaded and registered. It tells you NOTHING about whether they can run:
# every variable they need is read at REQUEST time, so a deploy with none of
# them configured is equally `ready`. The only evidence that settles it is a
# response from the deployed function.
#
# ------------------------------------------- stage 1 needs no credential
#
# `/api/status` validates its environment BEFORE it reads the Authorization
# header. That ordering is what makes this check possible without a token:
#
#   503 + "Deployment is incomplete. Missing: X, Y"
#        -> those variables are not visible to the running function
#   401 + "unauthorized"
#        -> the function RAN. SUPABASE_URL, SUPABASE_SECRET_KEY and
#           SUPABASE_PUBLISHABLE_KEY are all present at Functions scope.
#   200 -> you sent a token; see stage 2
#
# A 401 is the PASS for stage 1. Nothing secret is sent, so nothing secret can
# leak, and there is no token to mishandle.
#
# --------------------------------------------- stage 2, only if you want it
#
# The deeper report -- database reachable as the caller, schema version,
# storage, auth posture -- needs a signed-in user's access token. Stage 2 is
# optional and prompts for it with the characters hidden.
#
# WHERE THE TOKEN NEVER GOES: not a command-line argument (visible in `ps` to
# every other process on the machine), not an environment variable (inherited
# by every child process), not a file, not shell history, and not this
# repository. `read -rs` keeps the characters off the terminal, and the header
# is handed to curl through `--config -` on STDIN, which is the one channel
# that is neither argv nor the environment.
#
# The token is a bearer credential that stays valid until its own expiry, so
# treat it as one: run this, then close the terminal.
set -uo pipefail

BASE="${1:-}"
if [ -z "$BASE" ]; then
    printf 'usage: %s https://deploy-preview-10--haskell-fb-opportunity-radar.netlify.app\n' "$0"
    exit 2
fi
BASE="${BASE%/}"

case "$BASE" in
    https://*) ;;
    *) printf 'Refusing a non-https base URI.\n'; exit 2 ;;
esac

green() { printf '\033[32m%s\033[0m\n' "$1"; }
red()   { printf '\033[31m%s\033[0m\n' "$1"; }
dim()   { printf '\033[2m%s\033[0m\n' "$1"; }

printf '\n== Stage 1: can the function run at all? (no credential is sent) ==\n\n'
dim "GET $BASE/api/status"

body="$(curl -sS --max-time 30 -o - -w '\n%{http_code}' "$BASE/api/status" 2>&1)"
code="$(printf '%s' "$body" | tail -n1)"
payload="$(printf '%s' "$body" | sed '$d')"

case "$code" in
    401)
        green "PASS  HTTP 401 -- the function ran."
        printf '      SUPABASE_URL, SUPABASE_SECRET_KEY and SUPABASE_PUBLISHABLE_KEY are\n'
        printf '      all present at Functions scope in this deployment.\n'
        ;;
    503)
        red "FAIL  HTTP 503 -- the function ran and refused."
        printf '      %s\n\n' "$payload"
        printf '      Those variables are not visible to the running function. Set them in\n'
        printf '      Netlify -> Site configuration -> Environment variables with the\n'
        printf '      *Functions* scope, then REDEPLOY this context: a deploy is frozen at\n'
        printf '      the values it was built with. netlify.toml cannot supply them.\n'
        exit 1
        ;;
    200)
        red "UNEXPECTED  HTTP 200 without a credential."
        printf '      /api/status must never answer without authentication. Stop and report this.\n'
        exit 1
        ;;
    404)
        red "FAIL  HTTP 404 -- /api/status did not reach a function."
        printf '      A _redirects file may be shadowing netlify.toml, or this deploy has no functions.\n'
        exit 1
        ;;
    000|"")
        red "FAIL  the request did not complete."
        printf '      %s\n' "$payload"
        printf '      This is about the network between you and Netlify, not about the deployment.\n'
        exit 1
        ;;
    *)
        red "FAIL  HTTP $code"
        printf '      %s\n' "$payload"
        exit 1
        ;;
esac

printf '\n== Stage 2: the full report (optional) ==\n\n'
printf 'Stage 2 needs a signed-in user'"'"'s access token. Sign in to the deployment,\n'
printf 'then take the access token from the Supabase session in browser storage.\n\n'
printf 'Press Enter alone to skip.\n'
printf 'Access token (hidden): '
read -rs TOKEN
printf '\n'

if [ -z "$TOKEN" ]; then
    dim 'Skipped. Stage 1 already answered the configuration question.'
    exit 0
fi

# The header is written into a curl config document and handed to curl on
# STDIN. It is never an argument and never an environment variable, so it never
# appears in `ps`, in a child process, or in shell history.
response="$(printf '%s\n' \
    "url = \"$BASE/api/status\"" \
    "header = \"Authorization: Bearer $TOKEN\"" \
    'silent' \
    'show-error' \
    'max-time = 30' \
    'write-out = "\n%{http_code}"' \
  | curl --config - 2>&1)"
unset TOKEN

code="$(printf '%s' "$response" | tail -n1)"
payload="$(printf '%s' "$response" | sed '$d')"

if [ "$code" != "200" ]; then
    red "FAIL  HTTP $code"
    printf '      %s\n' "$payload"
    [ "$code" = "401" ] && printf '      The token was rejected. It may have expired -- sign in again.\n'
    exit 1
fi

green "PASS  HTTP 200"
if command -v python3 >/dev/null 2>&1; then
    printf '%s' "$payload" | python3 -m json.tool 2>/dev/null || printf '%s\n' "$payload"
else
    printf '%s\n' "$payload"
fi

printf '\n'
dim 'Read: ok, schema.version, database.reachable, storage.private, auth.*, sec.contactConfirmed,'
dim 'egressAllowlistSize. A model reported as unconfigured is expected and affects nothing.'
dim 'The response names variables, never values. Close this terminal when you are done.'
