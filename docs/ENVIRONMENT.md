# Environment contract

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
| `VITE_SUPABASE_ANON_KEY` | yes | The project's **publishable** (anon) key |
| `VITE_RADAR_ENV` | no | `development` \| `preview` \| `production` |

The anon key is in the bundle by design. It is safe **only because row-level
security is enabled on every table** (migration 0015): `anon` can read nothing,
and an authenticated session can read the dashboard tables and write none of
them. If RLS were ever disabled, this key would become a full read of the
database — which is why the posture is asserted by contract test in `db/test.mjs`
rather than trusted to a dashboard toggle.

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
| `SUPABASE_SERVICE_ROLE_KEY` | The project's **secret** (service-role) key. Bypasses RLS. |
| `SEC_EDGAR_USER_AGENT` | See below — SEC requires a real monitored address |
| `INGEST_SHARED_SECRET` | Long random string; authenticates the manual admin trigger |

### Optional

| Variable | Default | Value |
| --- | --- | --- |
| `SUPABASE_DB_URL` | — | Session-pooler connection string. Only for `db/migrate.mjs` and `db/seed.mjs`; no function uses it. |
| `SUPABASE_EVIDENCE_BUCKET` | `evidence-raw` | Private Storage bucket for preserved evidence |
| `EGRESS_ALLOWLIST` | *(empty — denies everything)* | Comma-separated hostnames the egress gateway may reach |
| `MODEL_PROVIDER` | `anthropic` | `anthropic` \| `bedrock` \| `vertex` |
| `MODEL_API_KEY` | — | **Absent means classification fails closed.** Nothing is fabricated. |
| `MODEL_ID` | — | Required when `MODEL_API_KEY` is set |
| `MODEL_PROMPT_VERSION` | `v0` | Folded into the replay-cache key |
| `RADAR_ENV` | `development` | `development` \| `preview` \| `production` |

### `SEC_EDGAR_USER_AGENT`

SEC requires every automated client to declare a User-Agent carrying a contact
address that a human actually monitors, and rate-limits to 10 requests per
second. The format is:

```
Openi Analytics Haskell F&B Radar <MONITORED_OPENI_EMAIL>
```

**`<MONITORED_OPENI_EMAIL>` is a placeholder and must be replaced with a real
monitored Openi address before any SEC production request is made.** Sending the
placeholder would be a false contact declaration to a federal regulator, so the
connector refuses to start while it is still there.

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
  "radarEnv": "development",
  "database": { "reachable": true, "organizationsVisible": 15 },
  "model": { "available": false, "describe": "unavailable" },
  "requiredServerVariables": ["SUPABASE_URL", "..."],
  "egressAllowlistSize": 5
}
```

`"model": { "available": false }` is a legitimate state, not a failure: every
non-model stage runs, and the classification stage refuses rather than inventing
an answer.

The endpoint reads **as the calling user**, not as the service role. That is
deliberate — a status check querying with the service role would report success
even with every RLS policy missing, which is the failure it exists to catch.

---

## What is deliberately absent

There is no `CONTACT_*`, no CRM credential, no Teams webhook and no
Haskell-controlled endpoint of any kind. The Radar is externally hosted and
operated by Openi (ADR 0013); no application component may require access to a
Haskell network, database, identity system or endpoint.

There is no variable that unlocks the D14-L tables. That gate is a foreign key to
an empty `licence_authorizations` table, not a feature flag, so no configuration
change can open it.
