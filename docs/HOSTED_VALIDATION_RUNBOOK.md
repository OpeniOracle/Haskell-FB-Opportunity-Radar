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

**Use a named individual's Openi address.** Not a shared mailbox, not
`oracles@openi-analytics.com` — that one is reserved for SEC operational notices
and migration 0017 refuses to allowlist it, so the attempt fails rather than
succeeding quietly. A shared mailbox is the wrong thing to hold an account: its
readers change without anyone revoking anything, every action would be attributed
to a mailbox rather than a person, and a password reset sent to it is visible to
everyone who reads it.

**Order matters, and it is enforced.** The allowlist entry must exist BEFORE
Supabase creates the user. The trigger from migration 0016 fires
`before insert on auth.users`, so an invitation sent to an address that is not
yet allowlisted fails at the moment Supabase tries to create the row — the
invitation email is never sent, and Supabase reports the database error. That is
the intended behaviour, not a bug to work around.

The full sequence, in order:

| # | Step | Where | What enforces it |
| --- | --- | --- | --- |
| 1 | Insert the address into `auth_invite_allowlist` | SQL Editor | 0017 refuses a reserved service address |
| 2 | Invite the same address | Dashboard → Authentication → Users | 0016 refuses any address not from step 1 |
| 3 | Accept the invitation, set a password, sign in | Email → browser | Supabase Auth |
| 4 | Prove an unlisted address is refused | SQL Editor | 0016 |
| 5 | Prove exactly one account exists | SQL Editor | — |

**Step 1 — allowlist the address FIRST.** Supabase → SQL Editor. Replace
`firstname.lastname@openi-analytics.com` with the real individual address:

```sql
insert into auth_invite_allowlist (email_normalized, email_as_entered, invited_by, note)
values (
  lower(trim('firstname.lastname@openi-analytics.com')),
  'firstname.lastname@openi-analytics.com',
  'firstname.lastname@openi-analytics.com',
  'Bootstrap Openi administrator, PR #9'
);

-- Confirm the row landed before going near the dashboard.
select email_normalized, invited_at from auth_invite_allowlist;
```

If you mistakenly use the SEC mailbox, this step fails with
`oracles@openi-analytics.com is a reserved service address (SEC EDGAR
automated-source identification and operational notices) and must not hold an
application account.` That is correct. Use an individual address.

**Step 2 — invite.** Authentication → **Users → Invite user**, the same address.

Sanity check that the order was enforced: try inviting a *different*, unlisted
address first. It must fail with `Self-registration is disabled. … was not
invited; add it to auth_invite_allowlist first.` If it succeeds, migration 0016
did not apply and you should stop.

**Step 3 — accept the invitation and sign in.** Follow the emailed link, set a
password, and reach the deployed preview signed in.

**Step 4 — prove the guard refuses what it should.** SQL Editor:

```sql
-- MUST fail: Self-registration is disabled. …
insert into auth.users (id, email)
values (gen_random_uuid(), 'not-invited@example.invalid');

-- MUST fail: Anonymous and email-less accounts are not permitted…
insert into auth.users (id, email) values (gen_random_uuid(), null);

-- MUST fail: … is a reserved service address …
insert into auth_invite_allowlist (email_normalized, email_as_entered, invited_by)
values ('oracles@openi-analytics.com', 'oracles@openi-analytics.com', 'test');
```

All three are already proven on this project; running them again confirms
nothing drifted between then and your session.

**Step 5 — confirm exactly one account exists.**

```sql
select
  (select count(*) from auth.users)                          as accounts,       -- 1
  (select count(*) from auth.users where email is null)      as anonymous,      -- 0
  (select count(*) from auth_invite_allowlist)               as allowlisted,    -- 1
  (select count(*) from reserved_service_addresses)          as reserved;       -- 1
```

Do **not** invite any Haskell user yet.

---

## C. Netlify variables

Site configuration → Environment variables. **Three values now**, all for every
deploy context (one development project currently serves all of them):

| Key | Scope | Contexts | Secret |
| --- | --- | --- | --- |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | **Builds** | all | no |
| `SUPABASE_SECRET_KEY` | **Functions** | all | yes |
| `INGEST_SHARED_SECRET` | **Functions** | all | yes |

`MODEL_API_KEY` (Functions, secret) is **optional** and may be left absent.
`SEC_EDGAR_USER_AGENT` and `SEC_CONTACT_CONFIRMED` need no entry — both are
committed in `netlify.toml`. Full reasoning in `docs/ENVIRONMENT.md`.

Then **Deploys → Trigger deploy → Clear cache and deploy site**, so the build
picks up the new build-scope variable.

---

## D–E. Everything else, in one script

`scripts/hosted-validation.sh` runs every remaining hosted check in a single
pass: `/api/status` authenticated and unauthenticated, the evidence-proxy canary
(upload, retrieve, headers, path-leak scan), direct-Storage refusal from three
angles, self-registration refusal, session revocation, and canary object cleanup.

The canary DATABASE rows are pre-staged and are removed afterwards from the
automation side, so the script only needs to handle the object and the HTTP.

```bash
# In the browser console on the deploy preview, signed in as the administrator:
#   JSON.parse(localStorage.getItem(Object.keys(localStorage)
#     .find(k => k.startsWith('sb-') && k.endsWith('-auth-token')))).access_token

export TOKEN='<the access token>'
export SECRET='<the sb_secret_… key>'
bash scripts/hosted-validation.sh
```

The script never prints either value and never writes them to a file. It signs
the session out at the end deliberately — that is the revocation check — so sign
back in afterwards.

Paste the whole output into PR #9.

---

## F. SEC contact — done

`oracles@openi-analytics.com` was confirmed on 2026-08-26 as an active, monitored
Openi mailbox. `SEC_CONTACT_CONFIRMED = "true"` is committed in `netlify.toml`,
so there is nothing to enter and nothing to toggle. `/api/status` reports
`sec.contactConfirmed: true`.

The mailbox is reserved for automated-source identification and operational
notices only, and `reserved_service_addresses` makes it impossible to allowlist
as an application account.
