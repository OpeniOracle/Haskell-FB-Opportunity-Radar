# Environment contract

## The provisioned development project

| | |
| --- | --- |
| Project | `haskell-fb-radar-dev` |
| Reference | `dutmdlbangsthclgtkhy` |
| Region | `us-east-1` |
| PostgreSQL | 17.6.1.165 |
| URL | `https://dutmdlbangsthclgtkhy.supabase.co` |
| Evidence bucket | `evidence-raw`, **private** |

`haskell-fb-radar-prod` does not exist yet and is deliberately not created.

Every value the Radar needs at runtime, where it is set, and which half of the
system may read it.

The dividing line is not a convention. Vite **compiles every `VITE_`-prefixed
variable into the JavaScript bundle**, so anything carrying that prefix is
published to every visitor. Everything else exists only in the Netlify Functions
runtime and never reaches a browser.

`app/netlify/functions/_shared/env.ts` is the only module that reads server
values, and it throws at startup if a secret-shaped name ever acquires a `VITE_`
prefix. `app/src/test/boundaries.test.ts` fails if a server variable name appears
anywhere in `app/src`.

---

## Client-safe — compiled into the bundle, readable by anyone

| Variable | Required | Value |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | yes | `https://<project-ref>.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | yes | `sb_publishable_…` |
| `VITE_RADAR_ENV` | no | `development` \| `preview` \| `production` |

### Why the current key system, and not the legacy pair

This project uses Supabase's **current** API keys and deliberately does not
configure the legacy `anon` / `service_role` JWTs.

| | Legacy pair | Current pair |
| --- | --- | --- |
| Browser | `anon` JWT | `sb_publishable_…` |
| Server | `service_role` JWT | `sb_secret_…` |
| Rotation | **one unit** — rotating the service key invalidates the anon key and signs every user out | **independent** — the secret key rotates without touching the publishable key or any session |
| Telling them apart | both are `eyJ…` JWTs, indistinguishable by shape | distinct prefixes |

That second row is the one that matters in an incident. Rotating a leaked
service-role key used to mean signing out every pilot reviewer at the same
moment; now it does not. The third row is what makes a paste error catchable:
`assertKeyShapes` in `app/netlify/functions/_shared/env.ts` rejects a secret key
found behind a `VITE_` prefix, a publishable key found in the server slot, a
legacy JWT in either, and any legacy variable name being set at all.

The publishable key is in the bundle by design and is **not confidential** — it
identifies the project and grants nothing on its own. Row-level security is what
protects the data: `anon` can read nothing, and an authenticated session can read
the dashboard tables and write none of them. If RLS were ever disabled, the
publishable key would become a full read of the database — which is why the
posture is asserted by contract test in `db/test.mjs` rather than trusted to a
dashboard toggle.

`VITE_SUPABASE_URL` is also read at **build** time by
`app/scripts/generate-headers.mjs`, which writes the `connect-src` allowlist into
`dist/_headers`. Unset, the policy falls back to `connect-src 'self'` and the
application can reach nothing but its own functions.

---

## Server-only — Netlify Functions scope, never `VITE_`-prefixed, never committed

### Required

| Variable | Value |
| --- | --- |
| `SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_…`. **Not a secret.** Committed in `netlify.toml`. Needed server-side so a function can read *as the caller* — under the current key system a user-scoped request sends the publishable key as `apikey` and the user's token as `Authorization`. Without it every server read would use the secret key and bypass RLS. |
| `SUPABASE_SECRET_KEY` | `sb_secret_…`. **Confidential. Bypasses RLS.** Functions scope only. |
| `SEC_EDGAR_USER_AGENT` | See below |
| `INGEST_SHARED_SECRET` | Long random string; authenticates the manual admin trigger |

### Optional

| Variable | Default | Value |
| --- | --- | --- |
| `SUPABASE_DB_URL` | — | Session-pooler connection string. Only for `db/migrate.mjs` and `db/seed.mjs`; no function uses it. |
| `SUPABASE_JWT_SECRET` | — | **Normally absent.** Only needed by a project still signing access tokens with HS256 that publishes no JWKS — see *JWT verification* below. |
| `SUPABASE_EVIDENCE_BUCKET` | `evidence-raw` | Private Storage bucket for preserved evidence |
| `EGRESS_ALLOWLIST` | *(empty — denies everything)* | Comma-separated hostnames the egress gateway may reach |
| `MODEL_PROVIDER` | `anthropic` | `anthropic` \| `bedrock` \| `vertex` |
| `MODEL_API_KEY` | — | **Absent means classification fails closed.** Nothing is fabricated. |
| `MODEL_ID` | — | Required when `MODEL_API_KEY` is set |
| `MODEL_PROMPT_VERSION` | `v0` | Folded into the replay-cache key |
| `SEC_CONTACT_CONFIRMED` | `false` | Exactly `true` or `false`. **Committed as `true` in `netlify.toml`** — see below. Not a secret. |
| `RADAR_ENV` | `development` | `development` \| `preview` \| `production` |

### `SEC_EDGAR_USER_AGENT` — CONFIRMED

SEC requires every automated client to declare a User-Agent carrying a contact
address that a human actually monitors, and rate-limits to 10 requests per
second. Committed in `netlify.toml`:

```
SEC_EDGAR_USER_AGENT  = "Openi Analytics Haskell F&B Radar oracles@openi-analytics.com"
SEC_CONTACT_CONFIRMED = "true"
```

**Confirmed 2026-08-26**: `oracles@openi-analytics.com` is an active, monitored
Openi mailbox.

#### `SEC_CONTACT_CONFIRMED` holds no secret

It is a boolean recording that a person checked something. Committing it is
better than putting it in a dashboard: the attestation then has an author, a
date and a diff, which is what makes it auditable. A dashboard toggle has none of
those, and nobody can tell later who flipped it or when.

`parseSecConfirmation` accepts **only** the exact strings `true` and `false`, and
throws on anything else. Loose truthiness is refused on purpose — if `1`, `yes`
or `TRUE ` were accepted, an unrelated typo could switch a regulatory declaration
on by accident, and the failure would be silent because SEC serves the request
either way.

#### The mailbox is not an application account

It is a shared, role-based address for automated-source identification and
operational notices. It must never hold an account, and migration 0017 makes
that impossible rather than merely documented: `reserved_service_addresses`
lists it, and a trigger refuses to put a reserved address on
`auth_invite_allowlist` — on INSERT *and* on UPDATE. Since migration 0016 makes
an account impossible without an allowlist entry, the mailbox cannot become a
user by any route, including someone inviting it in good faith.

Why it matters: a shared mailbox's readers change without anyone revoking
anything, every action it took would be attributed to a mailbox rather than a
person, and a password reset sent to it is visible to everyone who reads it.

### `EGRESS_ALLOWLIST`

The single egress gateway checks this on **every** hop, including after each
redirect — `redirect: 'follow'` would check the first URL and then go wherever it
was sent, which is not an allowlist. An entry permits the host and its
subdomains, and nothing else: `sec.gov` permits `data.sec.gov` and does not
permit `notsec.gov` or `sec.gov.example.net`. Empty denies everything.

For the pilot's three source families:

```
sec.gov,data.sec.gov,www.sec.gov,fsis.usda.gov,www.fsis.usda.gov
```

plus the corporate newsroom hosts, added as each connector is verified.

---

## Setting them in Netlify

Site configuration → Environment variables. Scope the client-safe values to
**Builds** (Vite needs them at build time). Scope the server values to
**Functions**; there is no reason for a secret to be present during a build, and
a build log is a place secrets get printed.

Use **different Supabase projects** for the deploy-preview context and
production. A preview pointed at production data is a production deployment with
a preview URL and no access control story.

---

## Verifying a deployment

`GET /api/status` with a signed-in user's bearer token reports what is
configured — by **name**, never by value:

```json
{
  "ok": true,
  "modelConfigured": false,
  "radarEnv": "preview",
  "caller":  { "userId": "…", "invited": true },
  "database": { "reachable": true, "organizationsVisible": 15 },
  "schema":   { "version": "0018" },
  "storage":  { "bucket": "evidence-raw", "configured": true, "private": true },
  "model":    { "configured": false, "describe": "unavailable" },
  "auth":     {
    "inviteOnlyEnforced": true,
    "evidenceSessionCheckInstalled": true,
    "evidenceAccessAuthorized": true,
    "jwtVerification": "asymmetric",
    "dashboardTokenLifetime": "supabase_default_until_exp"
  },
  "sec":      { "contactConfirmed": true },
  "requiredServerVariables": ["SUPABASE_URL", "..."],
  "egressAllowlistSize": 5
}
```

`modelConfigured: false` is a **legitimate state, not a failure**, and it does
not affect `ok`. `ok` reports the foundation — whether the database is reachable
*as the calling user*. Collection, preservation, entity resolution, storage and
authentication all run without a model key; only classification refuses, and it
refuses rather than inventing an answer.

The endpoint reads **as the calling user**, not as the service role. That is
deliberate — a status check querying with the service role would report success
even with every RLS policy missing, which is the failure it exists to catch.

### The application is private

Every surface sits behind `RequireAuth`. Five routes are public and no more:

| Route | What it is |
| --- | --- |
| `/login` | email and password. No registration path exists anywhere. |
| `/auth/callback` | the ONE place a credential in a URL is read, and immediately removed from history |
| `/auth/set-password` | choosing a password after an invitation |
| `/forgot-password` | requesting a recovery link |
| `/auth/reset-password` | choosing a new password from a recovery link |

`/api/session` exists for the gate: `auth_invite_allowlist` is deliberately
unreadable by a signed-in session (migration 0016 revokes it), so the browser
cannot check its own membership. That endpoint answers the one bit — which is
what makes removing somebody take effect on their next page load rather than at
token expiry.

**Supabase Auth redirect URLs.** Site URL is
`https://haskell-fb-opportunity-radar.netlify.app`; the Redirect URL allowlist
holds four exact entries, `/auth/callback` and `/auth/reset-password` on the
production origin and on the PR #9 preview. Exact paths, not `/**` — the
allowlist decides where Supabase will send someone carrying a live credential,
and `/auth/callback` is the only route written to read one and scrub it.

Invitations must be sent through the Admin API with an explicit `redirectTo`.
The dashboard's *Invite user* button uses the Site URL, which sends a preview
invitation to production. See `docs/HOSTED_VALIDATION_RUNBOOK.md` § B.

---

### JWT verification, and what `dashboardTokenLifetime` is telling you

`jwtVerification` names how the evidence proxy verified the caller's token:

| Mode | Meaning |
| --- | --- |
| `asymmetric` | The project uses JWT signing keys. The public half came from `/auth/v1/.well-known/jwks.json` and verification happened locally. **This is the mode to be in** — there is no secret to hold. |
| `hs256` | The project still uses the legacy shared JWT secret, and `SUPABASE_JWT_SECRET` is set. Verified locally. |
| `delegated` | Neither was available, so GoTrue verified the signature via `/auth/v1/user`. Still cryptographic verification; performed by the issuer rather than by us. |

`evidenceSessionCheckInstalled` is probed, not asserted: `/api/status` calls
`authorize_evidence_access` with an id pair that cannot exist and reports whether
the function answered. A project that never received migration 0018 shows
`false` rather than quietly serving evidence without the check.

`dashboardTokenLifetime` is there to stop a true statement about one endpoint
being read as a claim about the whole project.

**A Supabase access token stays valid until its `exp`, even after sign-out.**
`/api/evidence` is the exception, and only because it additionally checks
`auth.sessions` on every request — so a signed-out token is refused there on the
caller's next request. Every other authenticated read on this project keeps the
platform's documented behaviour. See ADR 0015.

---

## What is deliberately absent

There is no `CONTACT_*`, no CRM credential, no Teams webhook and no
Haskell-controlled endpoint of any kind. The Radar is externally hosted and
operated by Openi (ADR 0013); no application component may require access to a
Haskell network, database, identity system or endpoint.

There is no variable that unlocks the D14-L tables. That gate is a foreign key to
an empty `licence_authorizations` table, not a feature flag, so no configuration
change can open it.

---

## What must be entered by hand, and where

There is no Netlify CLI or API token in the automation environment, so **no
Netlify variable can be set programmatically from here**. Everything non-secret
is therefore committed to `netlify.toml`, where it is reviewable in a pull
request. The four values below are secrets and are the only ones left to enter.

Netlify → **Site configuration → Environment variables → Add a variable**.

For each: choose **Same value for all deploy contexts** unless noted, set
**Scopes** as given, and mark it **Secret** (Netlify then hides the value after
saving, including from build logs).

**Three values now.** A fourth is optional and may be left for later.

| # | Key | Scope | Deploy contexts | Secret? | Where the value comes from |
| --- | --- | --- | --- | --- | --- |
| 1 | `VITE_SUPABASE_PUBLISHABLE_KEY` | **Builds** | All (Production, Deploy previews, Branch deploys) | no | Supabase → Project Settings → API Keys → **Publishable key** (`sb_publishable_…`) |
| 2 | `SUPABASE_SECRET_KEY` | **Functions** | All | **yes** | Supabase → Project Settings → API Keys → **Create a secret key** (`sb_secret_…`) |
| 3 | `INGEST_SHARED_SECRET` | **Functions** | All | **yes** | Generate one: `openssl rand -base64 48` |
| — | `MODEL_API_KEY` | **Functions** | All | **yes** | Anthropic Console. **Optional.** Leave absent for PR #9. |

"All contexts" is correct *today* because one development project serves every
context. When `haskell-fb-radar-prod` exists, values 1 and 2 become
**per-context**: the production context points at the production project and the
preview contexts stay on development. A preview pointed at production data is a
production deployment with a preview URL and no access-control story.

Scope, not context, is the security boundary here:

- **`VITE_SUPABASE_PUBLISHABLE_KEY` is Builds-only.** Vite inlines it at build
  time; a function has no use for it, and a value present in a runtime that does
  not need it is a value that can leak from a runtime that does not need it.
- **`SUPABASE_SECRET_KEY` and `INGEST_SHARED_SECRET` are Functions-only.**
  Scoping either to Builds would put it into the build log's environment.

**Do not create or paste a legacy `anon` or `service_role` JWT.** `assertKeyShapes`
throws if either name is set, and CI fails if either name is referenced outside
the code that forbids it. If some library turns out to require the legacy pair,
report the specific failure rather than reverting quietly.

`MODEL_API_KEY` being absent is a supported state: `/api/status` reports the
model as unconfigured and every other check still passes. Collection,
preservation and resolution all run; only classification refuses, and it refuses
rather than inventing an answer.

`SUPABASE_DB_URL` is optional and only needed if migrations are ever run from a
machine rather than through the Supabase API. It is Supabase → Project Settings
→ Database → **Connection string → Session pooler**. Scope it to **Functions**
if you set it, though no function reads it.

Three deliberate scope choices:

- **`VITE_SUPABASE_ANON_KEY` is Builds-only.** Vite inlines it at build time; a
  function has no use for it, and a value present in a runtime that does not
  need it is a value that can leak from a runtime that does not need it.
- **The service-role key is Functions-only.** Scoping it to Builds would put a
  key that bypasses every row-level security policy into the build log's
  environment.
- **`MODEL_API_KEY` is Functions-only** for the same reason, and its absence is
  survivable: collection, preservation and resolution all run without it, and
  the classification stage refuses rather than inventing an answer.

## Supabase dashboard settings that cannot be set from code

GoTrue's signup configuration is platform state with no table behind it, so it
cannot be applied by a migration or tested in CI. Migration 0016 adds the half
that *can* be enforced — a trigger on `auth.users` that refuses any address not
on `auth_invite_allowlist`, and refuses a null email, which is what an anonymous
sign-in looks like. **That is defence in depth, not a substitute.** Set these in
Supabase → Authentication → Sign In / Providers:

| Setting | Required value |
| --- | --- |
| Allow new users to sign up | **off** |
| Allow anonymous sign-ins | **off** |
| Confirm email | **on** |
| Site URL | the production Netlify URL |
| Redirect URLs | the production URL, plus `https://deploy-preview-*--haskell-fb-opportunity-radar.netlify.app/**` for previews |

### Inviting someone

Two steps, in this order. The trigger refuses the invite otherwise — which is
what "invite-only" means: who may hold an account is a deliberate, auditable
record rather than a property of who found the sign-up form.

```sql
insert into auth_invite_allowlist (email_normalized, email_as_entered, invited_by, note)
values (lower(trim('Person@example.com')), 'Person@example.com', 'you@openi-analytics.com', 'Haskell pilot reviewer');
```

Then Supabase → Authentication → Users → **Invite user**.
