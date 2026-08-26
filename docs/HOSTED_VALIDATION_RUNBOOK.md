# Hosted validation runbook

The steps that need something the automation environment does not have: a
Supabase dashboard session, a Netlify token, a real mailbox, or plain network
reachability to `*.supabase.co` (this environment's egress policy blocks it, and
the Supabase MCP reaches the database over a different path that does not carry
HTTP requests to the project's API).

Everything here has been written so it can be pasted and run. Each step says
what it proves and what a failure means.

---

## A. Supabase Auth settings

**Why this cannot be automated.** GoTrue's configuration is platform state. There
is no table behind it, so no migration can set it and no CI job can test it.
Migration 0016 adds the half that *can* be enforced — a trigger on `auth.users`
that refuses any address not on `auth_invite_allowlist` and refuses a null email
— but a trigger cannot stop the sign-up endpoint from existing.

Supabase → **Authentication → Sign In / Providers**:

| Setting | Required | What goes wrong otherwise |
| --- | --- | --- |
| Allow new users to sign up | **off** | Anyone with the publishable key can create an account. The trigger then refuses it, so the account is never created — but the endpoint is answering strangers, and that is a surface with no reason to exist |
| Allow anonymous sign-ins | **off** | An anonymous session is a signed-in caller with nobody behind it |
| Confirm email | **on** | An unverified address can hold an account |
| Email provider | **enabled**; every other provider **disabled** | An enabled OAuth provider is a second door past the invite list |

Supabase → **Authentication → URL Configuration**:

| Setting | Value |
| --- | --- |
| Site URL | the production Netlify origin |
| Redirect URLs | the production origin, plus `https://deploy-preview-*--haskell-fb-opportunity-radar.netlify.app/**` |

Nothing else. A wildcard like `https://*` turns the redirect allowlist into an
open redirector for auth tokens.

**Record what you observed**, not what you intended — paste the resulting values
into PR #9. A setting believed to be off is not a setting that is off.

---

## B. Bootstrap the Openi administrator

Order matters. The allowlist entry must exist first, or the trigger refuses the
invitation — which is exactly what "invite-only" means.

**1. Allowlist the address.** Supabase → SQL Editor:

```sql
insert into auth_invite_allowlist (email_normalized, email_as_entered, invited_by, note)
values (
  lower(trim('ADMIN@openi-analytics.com')),
  'ADMIN@openi-analytics.com',
  'ADMIN@openi-analytics.com',
  'Bootstrap Openi administrator, PR #9'
);
```

**2. Invite.** Authentication → Users → **Invite user**, same address.

**3. Complete the invitation and sign in** from the invitation email.

**4. Prove the guard refuses an address that was not allowlisted.** SQL Editor:

```sql
-- MUST fail with: Self-registration is disabled. …
insert into auth.users (id, email)
values (gen_random_uuid(), 'not-invited@example.invalid');

-- MUST fail with: Anonymous and email-less accounts are not permitted…
insert into auth.users (id, email) values (gen_random_uuid(), null);
```

**5. Confirm exactly one account exists.**

```sql
select count(*) as accounts, count(*) filter (where email is null) as anonymous
from auth.users;
-- expected: accounts = 1, anonymous = 0
```

Do **not** invite any Haskell user yet.

---

## C. Netlify variables

Site configuration → Environment variables. Values, scopes and the reasoning are
in `docs/ENVIRONMENT.md`. In short: `VITE_SUPABASE_PUBLISHABLE_KEY` (Builds),
`SUPABASE_SECRET_KEY` (Functions, secret), `INGEST_SHARED_SECRET` (Functions,
secret), and optionally `MODEL_API_KEY` (Functions, secret).

Then **Deploys → Trigger deploy → Clear cache and deploy site**, so the build
picks up the new build-scope variable.

---

## D. `/api/status` as the invited administrator

Get an access token from the browser console on the deployed preview, signed in
as the bootstrap administrator:

```js
(await window.supabase?.auth.getSession())?.data?.session?.access_token
// or, if the client is not exposed globally:
JSON.parse(localStorage.getItem(
  Object.keys(localStorage).find(k => k.startsWith('sb-') && k.endsWith('-auth-token'))
)).access_token
```

Then:

```bash
PREVIEW="https://deploy-preview-9--haskell-fb-opportunity-radar.netlify.app"
TOKEN="…"

# 1. Unauthenticated MUST be 401.
curl -s -o /dev/null -w '%{http_code}\n' "$PREVIEW/api/status"

# 2. Invalid token MUST be 401.
curl -s -o /dev/null -w '%{http_code}\n' "$PREVIEW/api/status" \
  -H "Authorization: Bearer not-a-real-token"

# 3. Authenticated MUST be 200.
curl -s "$PREVIEW/api/status" -H "Authorization: Bearer $TOKEN" | jq
```

Expected shape — note that **no key, path, connection string or role name
appears**:

```json
{
  "ok": true,
  "radarEnv": "preview",
  "caller": { "userId": "…", "invited": true },
  "database": { "reachable": true, "organizationsVisible": 15 },
  "schema":   { "version": "0016" },
  "storage":  { "bucket": "evidence-raw", "configured": true, "private": true },
  "model":    { "configured": false, "describe": "unavailable" },
  "auth":     { "inviteOnlyEnforced": true },
  "sec":      { "contactConfirmed": false }
}
```

**4. Prove the response leaks nothing.** This is the check worth automating into
your shell history rather than eyeballing:

```bash
curl -s "$PREVIEW/api/status" -H "Authorization: Bearer $TOKEN" \
  | grep -Ei 'sb_secret_|service_role|postgres(ql)?://|eyJ[A-Za-z0-9_-]{20,}|evidence-raw/|sk-ant-' \
  && echo 'LEAK' || echo 'clean'
```

`"model": { "configured": false }` is a pass, not a failure. Every other check
must still be green with the model key absent.

---

## E. Evidence proxy, end to end with a canary

**Why a canary is needed.** The database half of this path is already proven
hosted — the storage path is unreadable by any browser session, `storage.objects`
is unreachable, `anon` cannot read evidence at all, and the bucket is private.
What is *not* proven from the automation environment is the byte retrieval,
because uploading an object needs the Storage API over HTTP.

Run from a machine with network access and the secret key.

```bash
PROJECT="dutmdlbangsthclgtkhy"
URL="https://$PROJECT.supabase.co"
SECRET="sb_secret_…"          # never echo this into a shared terminal log
PREVIEW="https://deploy-preview-9--haskell-fb-opportunity-radar.netlify.app"
TOKEN="…"                     # the administrator's access token
CANARY_EV="44444444-4444-4444-8444-444444444444"
CANARY_RUN="55555555-5555-4555-8555-555555555555"
CANARY_PATH="canary/evidence-proxy-canary.txt"
```

**1. Upload the canary object.**

```bash
printf 'evidence proxy canary %s\n' "$(date -u +%FT%TZ)" > /tmp/canary.txt
curl -sS -X POST "$URL/storage/v1/object/evidence-raw/$CANARY_PATH" \
  -H "Authorization: Bearer $SECRET" -H "apikey: $SECRET" \
  -H "Content-Type: text/plain" --data-binary @/tmp/canary.txt
```

**2. Create the evidence row pointing at it.** SQL Editor:

```sql
insert into source_runs (id, source_id, status, run_status)
values ('55555555-5555-4555-8555-555555555555', 'sec-edgar', 'success', 'success');

insert into evidence (
  id, source_id, source_run_id, original_url, resolved_url, title,
  retrieved_at, content_hash, mime_type, extraction_status,
  access_mode, raw_storage_uri
) values (
  '44444444-4444-4444-8444-444444444444', 'sec-edgar',
  '55555555-5555-4555-8555-555555555555',
  'https://data.sec.gov/canary', 'https://data.sec.gov/canary',
  'Evidence proxy canary', now(), repeat('c', 64), 'text/plain', 'success',
  'archived_full_text', 'canary/evidence-proxy-canary.txt'
);
```

**3. The eight required tests.**

```bash
E="$PREVIEW/api/evidence/$CANARY_EV"

# 1 — unauthenticated MUST be 401
curl -s -o /dev/null -w '1 unauth: %{http_code}\n' "$E"

# 2 — invalid session MUST be 401
curl -s -o /dev/null -w '2 bad token: %{http_code}\n' "$E" \
  -H "Authorization: Bearer not-a-real-token"

# 3 — invited administrator MUST be 200 and return the canary body
curl -s "$E" -H "Authorization: Bearer $TOKEN" | head -1

# 4 — required no-cache headers
curl -sI "$E" -H "Authorization: Bearer $TOKEN" \
  | grep -Ei 'cache-control|pragma|content-disposition'
# expect: cache-control: private, no-store   /   pragma: no-cache

# 5 — the response must not reveal the bucket path
curl -sD - "$E" -H "Authorization: Bearer $TOKEN" \
  | grep -E 'evidence-raw|canary/|storage/v1' && echo 'LEAK' || echo '5 no path: clean'

# 6 — direct ANONYMOUS bucket access MUST fail
curl -s -o /dev/null -w '6 anon object: %{http_code}\n' \
  "$URL/storage/v1/object/public/evidence-raw/$CANARY_PATH"

# 7 — direct AUTHENTICATED browser access to storage MUST fail
curl -s -o /dev/null -w '7 authed object: %{http_code}\n' \
  "$URL/storage/v1/object/evidence-raw/$CANARY_PATH" \
  -H "Authorization: Bearer $TOKEN" -H "apikey: $PUBLISHABLE"
curl -s -o /dev/null -w '7b storage.objects via REST: %{http_code}\n' \
  "$URL/rest/v1/objects?select=name" \
  -H "Authorization: Bearer $TOKEN" -H "apikey: $PUBLISHABLE"

# 8 — after sign-out the SAME token must stop working
#     (sign out in the browser first, then re-run with the old token)
curl -s -o /dev/null -w '8 revoked: %{http_code}\n' "$E" \
  -H "Authorization: Bearer $TOKEN"
```

Expected: `401`, `401`, the canary text, the two headers, `clean`, `400`/`404`,
`400`/`403`, `400`/`403`, `401`.

Test 8 is the one that distinguishes this design from signed URLs. A signed URL
issued before sign-out keeps working until it expires; this endpoint stops at the
next request.

**4. Remove the canary and prove it is gone.**

```bash
curl -sS -X DELETE "$URL/storage/v1/object/evidence-raw/$CANARY_PATH" \
  -H "Authorization: Bearer $SECRET" -H "apikey: $SECRET"
```

```sql
delete from evidence   where id = '44444444-4444-4444-8444-444444444444';
delete from source_runs where id = '55555555-5555-4555-8555-555555555555';

select
  (select count(*) from evidence)          as evidence_rows,       -- expect 0
  (select count(*) from source_runs)       as run_rows,            -- expect 0
  (select count(*) from storage.objects)   as stored_objects;      -- expect 0
```

```bash
curl -s -o /dev/null -w 'canary after delete: %{http_code}\n' "$E" \
  -H "Authorization: Bearer $TOKEN"   # expect 404
```

---

## F. SEC contact

Do not set `SEC_CONTACT_CONFIRMED` until someone has confirmed that
`oracles@openi-analytics.com` is an active, monitored Openi mailbox — or replaced
it. Until then SEC collection refuses to run, by design, and that is the correct
state rather than a blocker to work around.
