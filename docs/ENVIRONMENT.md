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

## Four places a variable can live, and which runtime can read it

These are not four ways of doing the same thing. Two of them feed the build and
two of them feed the Functions runtime, and the pairs do not overlap.

| Where it is set | Reaches the **Vite build** | Reaches a **Netlify Function at runtime** |
| --- | --- | --- |
| `netlify.toml` — `[build.environment]` or a `[context.*.environment]` block | **yes** | **NO** |
| Netlify UI / CLI / API, scope **Builds** | **yes** | **NO** |
| Netlify UI / CLI / API, scope **Functions** | no | **yes** |
| Netlify UI / CLI / API, scope **All** | yes | **yes** |

The first row is the one that has been got wrong here before, so it is worth
stating as plainly as Netlify does:

> Environment variables declared in a Netlify configuration file
> (`netlify.toml`) are not available to serverless functions.
> — <https://docs.netlify.com/build/functions/environment-variables/>

A server variable written into `netlify.toml` is not "committed configuration".
It is **absent**. It reaches the build container and stops there; the function
process never sees it, and the only symptom is a `MissingEnvError` at request
time — or, worse, a silent fallback to an optional variable's default.

### Two proofs, not one

1. **The documentation, above.**
2. **The code could not use such a value even if it arrived.** Every server read
   goes through `app/netlify/functions/_shared/env.ts`, which reads
   `process.env[name]` with a **computed** key. No bundler can inline a computed
   property access, so there is no build step at which a `netlify.toml` value
   could have been baked into a function. There is no ambiguity to resolve by
   experiment.

`app/src/test/runtimeConfiguration.test.ts` is the regression guard: it fails if
any function-runtime variable reappears in `netlify.toml`, and it fails if a
handler reads `process.env` outside `env.ts`.

### A deployment captures the values present when it was built

Netlify resolves environment values **at deploy time** and freezes them into that
deploy — for build-embedded values because Vite writes them into the JavaScript,
and for Functions-scope values because the deploy's function configuration is
snapshotted. Changing a variable in the Netlify UI therefore changes **nothing**
about a deploy that already exists.

**After changing any variable, you must redeploy the context you changed.**
Deploys → Trigger deploy → **Clear cache and deploy site** for production; push a
commit or use *Retry deploy* for a Deploy Preview. A `ready` deploy that predates
the change is still serving the old values.

---

## Client-safe — compiled into the bundle, readable by anyone

| Variable | Required | Value |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | yes | `https://<project-ref>.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | yes | `sb_publishable_…` |
| `VITE_RADAR_ENV` | no | `development` \| `preview` \| `production` |
| `VITE_AUTH_MICROSOFT_ENABLED` | no | exactly `true` to offer "Continue with Microsoft" |

### `VITE_AUTH_MICROSOFT_ENABLED`

Whether this deployment shows the **Continue with Microsoft** button. Read at
BUILD time by Vite, so changing it requires a rebuild of that context.

**Set per context in `netlify.toml`, never in the Netlify UI.** Production
`"false"`, deploy previews `"true"`, branch deploys `"false"`, everything else
unset and therefore disabled. Values in `netlify.toml` override the Netlify UI
and API, so a dashboard value for this variable would be silently ignored —
which is why it is not declared in `[build.environment]` at all, and why each
context states it explicitly. `app/src/test/microsoftFlagContexts.test.ts`
fails if that shape drifts.

Off unless the value is exactly the string `true`. Absent, empty, `1`, `yes` and
`TRUE` all mean off: a configuration flag whose failure mode is "enabled by
accident" is the wrong way round.

It is **not a security control**. It decides whether a button is rendered, and
every authorization rule holds identically whether it is on or off. Its purpose
is to stop a deployment offering a door that opens onto an error, since
Microsoft sign-in only works where an Entra registration exists and its
credentials have been entered into that Supabase project.

The Entra **client ID, tenant ID and client secret are NOT here and never will
be.** They live in the Supabase dashboard, because the token exchange is
server-to-server between Supabase and Microsoft and the browser has no part in
it. `bundleSecrets.test.ts` plants an Entra-secret-shaped value at build time
and fails if anything resembling it reaches the bundle.

The full manual configuration — Azure App Registration, the required `xms_edov`
optional claim, the Supabase provider fields, administrator consent, and the
hosted test — is in **`docs/MICROSOFT_ENTRA_SETUP.md`**.

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
| `SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_…`. **Not a secret**, but it must still be set in the **Netlify UI with Functions scope** — `netlify.toml` cannot deliver it. Needed server-side so a function can read *as the caller* — under the current key system a user-scoped request sends the publishable key as `apikey` and the user's token as `Authorization`. Without it every server read would use the secret key and bypass RLS. |
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
| `MODEL_API_KEY` | — | **Currently read by nothing but `/api/status`.** No ingestion path calls a model — see *The model is not wired into the pipeline*. |
| `MODEL_ID` | — | **Required** once `MODEL_API_KEY` is set; a key without it throws |
| `MODEL_PROMPT_VERSION` | `v0` | Folded into the replay-cache key |
| `SEC_CONTACT_CONFIRMED` | `false` | Exactly `true` or `false`. Not a secret, but **Netlify UI, Functions scope** — see below. |
| `RADAR_ENV` | `development` | `development` \| `preview` \| `production` |

### `SEC_EDGAR_USER_AGENT` — CONFIRMED

SEC requires every automated client to declare a User-Agent carrying a contact
address that a human actually monitors, and rate-limits to 10 requests per
second. Both values are read by a **function**, so both belong in the Netlify UI
with **Functions** scope:

```
SEC_EDGAR_USER_AGENT  = Openi Analytics Haskell F&B Radar oracles@openi-analytics.com
SEC_CONTACT_CONFIRMED = true
```

**Confirmed 2026-08-26**: `oracles@openi-analytics.com` is an active, monitored
Openi mailbox.

These two were previously written into `netlify.toml`. That did not work and was
never capable of working — see *Four places a variable can live*. They have been
removed from the file so that nothing reads as configured when it is not.

#### `SEC_CONTACT_CONFIRMED` holds no secret

It is a boolean recording that a person checked something, so the honest place
for the **attestation** — who checked, when, and what they found — is this
document and the pull request that changed it, where it has an author, a date and
a diff. What it cannot be is a `netlify.toml` assignment, because the function
that enforces it would never receive one. The record is reviewed here; the value
is entered in the dashboard.

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

Comma-separated **exact hostnames**. Empty or absent denies every outbound
request, which is the correct default: a misconfigured deployment collects
nothing rather than reaching somewhere nobody reviewed.

The single egress gateway checks the value on **every** hop, including after each
redirect — `redirect: 'follow'` would check the first URL and then go wherever it
was sent, which is not an allowlist.

#### What an entry does and does not permit

| | |
| --- | --- |
| `www.sec.gov` permits | `www.sec.gov` |
| and also permits | anything beneath it, e.g. `a.www.sec.gov` |
| does **not** permit | `sec.gov`, `notsec.gov`, `www.sec.gov.example.net` |
| does **not** permit | `https://x@www.sec.gov/` — userinfo is refused outright |
| does **not** permit | `https://www.sec.gov:8443/` — non-default ports are refused |
| does **not** permit | `https://93.184.216.34/` — IP literals are refused, allowlisted or not |
| does **not** permit | `http://…` — https only, on the first hop and every redirect |

There is no wildcard syntax. `*.sec.gov` is not a pattern; it is a hostname that
matches nothing.

#### Name the hosts, not the domain

**Do not enter a bare parent domain.** `sec.gov` as an entry would authorise
every host SEC ever publishes, because the suffix rule covers everything beneath
an entry. The connectors therefore declare the exact hosts they request —
`SEC_HOSTS` and `MARS_HOSTS` — and the allowlist names those and no more.

The cost is real and deliberate: if SEC or Mars redirects to a host that is not
listed, that source fails with a message naming the host to add. That is a
configuration decision an operator makes, rather than one the allowlist quietly
makes for them.

#### The value for the first live cohort

```
data.sec.gov,www.sec.gov,www.mars.com
```

Add `www.fsis.usda.gov` only if the FSIS connector is enabled; nothing in the
first cohort requests it.

#### A connector cannot grant itself egress

Before a source runs, the runner checks every host that connector declares
against `EGRESS_ALLOWLIST` and fails the source if one is missing. It does not
merge the connector's hosts in — that would let any connector authorise itself,
which is the property ADR 0002 exists to provide.

#### The model API is not covered by this

`app/netlify/functions/_shared/modelGateway.ts` calls `api.anthropic.com`
directly rather than through the gateway, so `api.anthropic.com` does **not**
belong in `EGRESS_ALLOWLIST` and adding it would have no effect. The allowlist
governs **source retrieval** — the traffic where "what did we read, and from
where" has to be answerable from evidence. The model call is a fixed, single,
first-party endpoint chosen by `MODEL_PROVIDER`, carries no source URL, and
preserves nothing.

---

## Setting them in Netlify

Site configuration → Environment variables. Scope the client-safe values to
**Builds** (Vite needs them at build time). Scope the server values to
**Functions**; there is no reason for a secret to be present during a build, and
a build log is a place secrets get printed.

**Every variable in this section — required and optional, secret and not — must
be created here.** None of them can be supplied by `netlify.toml`. Only
`VITE_`-prefixed values and build tooling settings belong in that file.

After adding or changing any of them, **redeploy**: an existing deploy keeps the
values it was built with.

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
  "schema":   { "version": "0021" },
  "storage":  { "bucket": "evidence-raw", "configured": true, "private": true },
  "model":    { "configured": false, "describe": "unavailable", "detail": null },
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
Netlify variable can be set programmatically from here**. Nor can a
function-runtime value be committed: `netlify.toml` does not reach a function, so
every variable in this table has to be entered by a person in the dashboard,
secret or not.

Netlify → **Site configuration → Environment variables → Add a variable**.

For each: choose **Same value for all deploy contexts** unless noted, set
**Scopes** as given, and mark it **Secret** where the table says so (Netlify then
hides the value after saving, including from build logs).

**Two of these are already set** — production `/api/session` works, which is
only possible if `SUPABASE_URL` and `SUPABASE_SECRET_KEY` are present with
Functions scope. Confirm the rest before the first live run.

| # | Key | Scope | Deploy contexts | Secret? | Where the value comes from |
| --- | --- | --- | --- | --- | --- |
| 1 | `VITE_SUPABASE_PUBLISHABLE_KEY` | **Builds** | All (Production, Deploy previews, Branch deploys) | no | Supabase → Project Settings → API Keys → **Publishable key** (`sb_publishable_…`) |
| 2 | `SUPABASE_URL` | **Functions** | All | no | `https://<project-ref>.supabase.co` |
| 3 | `SUPABASE_PUBLISHABLE_KEY` | **Functions** | All | no | The same publishable key as row 1. Functions need their own copy — a Builds-scope value is not readable at runtime. |
| 4 | `SUPABASE_SECRET_KEY` | **Functions** | All | **yes** | Supabase → Project Settings → API Keys → **Create a secret key** (`sb_secret_…`) |
| 5 | `INGEST_SHARED_SECRET` | **Functions** | All | **yes** | Generate one: `openssl rand -base64 48` |
| 6 | `SEC_EDGAR_USER_AGENT` | **Functions** | All | no | `Openi Analytics Haskell F&B Radar oracles@openi-analytics.com` |
| 7 | `SEC_CONTACT_CONFIRMED` | **Functions** | All | no | `true` — the attestation is recorded above; this is the switch it controls |
| 8 | `EGRESS_ALLOWLIST` | **Functions** | All | no | See *`EGRESS_ALLOWLIST`* above. **Empty or absent denies every outbound request.** |
| 9 | `RADAR_ENV` | **Functions** | Per context | no | `production` / `preview`. Optional; defaults to `development`, which only affects reporting. |
| — | `MODEL_PROVIDER`, `MODEL_ID`, `MODEL_PROMPT_VERSION` | **Functions** | All | no | **Optional.** Only meaningful once `MODEL_API_KEY` is set. |
| — | `MODEL_API_KEY` | **Functions** | All | **yes** | Anthropic Console. **Optional.** Absent means classification fails closed. |
| — | `SUPABASE_EVIDENCE_BUCKET` | **Functions** | All | no | **Optional**, defaults to `evidence-raw`. |
| — | `SUPABASE_JWT_SECRET` | **Functions** | All | **yes** | **Optional and normally absent** — see *JWT verification*. |

Rows 2, 3, 6, 7 and 8 were previously declared in `netlify.toml` and were
therefore never delivered to any function. Rows 2 and 4 are demonstrably already
present in the dashboard, because the endpoints that require them work in
production. The rest need checking by hand.

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

`MODEL_API_KEY` being absent is a supported state, and the reason is stronger
than "supported" — see the next section.

`SUPABASE_DB_URL` is optional and only needed if migrations are ever run from a
machine rather than through the Supabase API. It is Supabase → Project Settings
→ Database → **Connection string → Session pooler**. Scope it to **Functions**
if you set it, though no function reads it.

### Why the publishable key is entered twice

Rows 1 and 3 hold the same value under two names and two scopes, and that is
deliberate rather than an oversight. `VITE_SUPABASE_PUBLISHABLE_KEY` is inlined
into the bundle by Vite and is meaningless at runtime; `SUPABASE_PUBLISHABLE_KEY`
is read by a function so that it can query *as the caller*. Netlify scopes are
not a fallback chain — a Builds-scope value is simply not in the function's
environment — so one entry cannot serve both. Giving the pair distinct names also
keeps `assertKeyShapes` able to tell a misplaced key from a correctly placed one.

## The model is not wired into the pipeline

This document used to say that without `MODEL_API_KEY` "only classification
refuses". That reads as: no key, no classification, no opportunities. **It is
not what the code does**, and the difference decides whether a model credential
is a precondition for the first cohort.

`modelGateway` is imported by exactly one file — `netlify/functions/status.ts` —
and only to report whether it is configured. **No ingestion code path calls it.**
Classification is `connectors/classify.ts`: deterministic, regex-based,
requiring a project action, a physical asset and a corroborating fact to
co-occur in one window.

So with no model configured, every stage still writes its rows: `evidence` for
each retrieved document, `signals` for each qualifying passage, `opportunities`
wherever the confidence bar is met. A document that carries no signal is
**retained** as `not_relevant` — evaluated and found to carry nothing. There is
no `failed` state and nothing is discarded, so reprocessing later is a re-read
of `evidence` rather than a re-fetch from the source.

`app/src/test/modelDependency.test.ts` runs the pipeline under four permutations
of the four `MODEL_` variables and asserts the written rows are identical, with
no outbound request in any of them.

### If one is configured anyway

- **Endpoint:** `https://api.anthropic.com/v1/messages`, a literal argument to
  `fetch`. Not from the environment, not from `connector_config`, not a
  template. A retrieved document cannot redirect a model request.
- **Not on `EGRESS_ALLOWLIST`,** and adding it would have no effect.
- **`MODEL_ID` is required** once a key is set; `bedrock` and `vertex` have no
  adapter and refuse rather than falling back.
- **No timeout, retry or rate limit in the adapter.** The egress gateway has all
  three; the model adapter has none. Stated because it is a real gap.
- **Prompts and responses are not stored** — only the replay key, a digest over
  every input that can change the answer.

### A half-configured model no longer breaks `/api/status`

`modelEnv()` correctly throws for a key with no `MODEL_ID` and for an unknown
provider. `status.ts` called it outside its error handler, so either one escaped
and the endpoint answered 500 with HTML — on the one endpoint an operator runs
*because* something is wrong. It now reports `model.configured: false` with
`model.detail` naming what is missing, and every other component still answers.

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

## Live collection (added by the first live-data phase)

All three are set in the **Netlify UI with Functions scope**. None of them can
be committed — see *Four places a variable can live*. After setting them, the
context must be redeployed before a function sees them.

| Variable | Scope | Required by | Notes |
| --- | --- | --- | --- |
| `SEC_EDGAR_USER_AGENT` | Netlify UI, Functions, all contexts | the scheduled collector and `admin-run` | Must name the organisation **and a monitored contact address**. SEC's fair-access guidance asks for one; an anonymous agent is the one that gets blocked. Example: `Openi-Haskell-FB-Radar/1.0 (oracles@openi-analytics.com)` |
| `EGRESS_ALLOWLIST` | Netlify UI, Functions, all contexts | the egress gateway | Comma-separated **exact** hosts, no bare parent domain. For the first cohort: `data.sec.gov,www.sec.gov,www.mars.com` |
| `INGEST_SHARED_SECRET` | Netlify UI, Functions, all contexts | `admin-run` | The operator credential for a manual run. Distinct from any user session; a signed-in reviewer cannot force a collection. |

**A connector cannot grant itself egress.** If `EGRESS_ALLOWLIST` does not
permit a connector's hosts, that source fails with a message naming the host to
add, and the run continues for the others. Merging a connector's own hosts into
the allowlist would defeat the control that ADR 0002 exists to provide.

**What is deliberately NOT configured here:** no CIK. The SEC connector resolves
each company's CIK at run time from SEC's own `company_tickers.json`, matched
against the canonical name held in the database. A CIK in configuration is used
only as a cross-check, and a mismatch fails the run rather than picking a winner.
