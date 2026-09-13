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
| Site URL | `https://haskell-fb-opportunity-radar.netlify.app` |

**Redirect URLs — these four exact entries**, and nothing broader:

```
https://haskell-fb-opportunity-radar.netlify.app/auth/callback
https://haskell-fb-opportunity-radar.netlify.app/auth/reset-password
https://deploy-preview-9--haskell-fb-opportunity-radar.netlify.app/auth/callback
https://deploy-preview-9--haskell-fb-opportunity-radar.netlify.app/auth/reset-password
```

Exact paths, not `/**`. The allowlist decides where Supabase is willing to send
somebody **carrying a live credential in the URL**, so every entry is a place a
token may legitimately land. `https://*` would make it an open redirector for
auth tokens; even `…netlify.app/**` would let any path on the origin receive
one, and only `/auth/callback` is written to read a credential and remove it.

### The email templates — check these, they are the likely culprit

Supabase → **Authentication → Emails**. Two templates matter: the one named
**Invite user** and the one named **Reset password**. (These are the email
TEMPLATES, not the dashboard's *Invite user* button — that button is never used;
see step 2.)

Both must build their link from `{{ .ConfirmationURL }}`. That variable already
carries the `redirect_to` you passed to the Admin API — it expands to
`https://<ref>.supabase.co/auth/v1/verify?token=…&type=invite&redirect_to=<your redirectTo>`.

A template that was customised to the documented alternative shape —

```html
<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next={{ .RedirectTo }}">
```

— hardcodes **`{{ .SiteURL }}` as the host that receives the credential**, so
every invitation lands on the production origin no matter what `redirectTo`
says, and a preview test can never work. If either template looks like that,
either restore `{{ .ConfirmationURL }}` or change `{{ .SiteURL }}` to
`{{ .RedirectTo }}`.

I cannot read these from here: email templates are platform configuration with
no table and no Management API access from this environment. **Paste what you
see into PR #9** rather than reporting that they looked right.

**Record what you observed**, not what you intended — paste the resulting values
into PR #9. A setting believed to be off is not a setting that is off.

---

## B. Bootstrap the Openi administrator

**Use a named individual's Openi address.** Not a shared mailbox, not
`oracles@openi-analytics.com` — that one is reserved for SEC operational notices
and migration 0017 refuses to allowlist it, so the attempt fails rather than
succeeding quietly. A shared mailbox is the wrong thing to hold an account: its
readers change without anyone revoking anything, every action would be
attributed to a mailbox rather than a person, and a password reset sent to it is
visible to everyone who reads it.

**Order matters, and it is enforced.** The allowlist entry must exist BEFORE
Supabase creates the user. The trigger from migration 0016 fires
`before insert on auth.users`, so an invitation sent to an address that is not
yet allowlisted fails at the moment Supabase tries to create the row — the
invitation email is never sent, and Supabase reports the database error. That is
the intended behaviour, not a bug to work around.

### Step 0 — prove the API is routed, before anything else

**Run this before every invitation.** It takes seconds, uses no credentials, and
answers the one question that is impossible to read off the symptom:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Test-DeployedRoutes.ps1
```

```bash
bash scripts/test-deployed-routes.sh   # Linux / macOS
```

It reports **two separate verdicts**, and both must pass:

| Verdict | Means | If it fails |
| --- | --- | --- |
| **ROUTING** | every `/api/*` path reaches a function rather than the SPA | a `_redirects` file is shadowing `netlify.toml` |
| **READINESS** | every protected route refuses an anonymous caller with **401** | a required variable is missing — the message names it |

**HTTP 503 is a deployment failure, not a pass.** It proves routing works (only
a function can produce that body) and proves the deployment is *not ready*. The
script prints every status it saw and the safe `not_configured` message, exits
non-zero, and tells you not to send an invitation or delete an account.

The decisive routing signal is the **content type**, not the status: a SPA
fallback answers `200 text/html`, and a 200 looks like success everywhere else.

Variables must be set with **Functions** scope and for the **Deploy Preview**
context — a variable set only for production is invisible to a preview's
functions, which is exactly how `SEC_EDGAR_USER_AGENT` went missing.

### Step 1 — allowlist the address FIRST

Supabase → SQL Editor. Replace `firstname.lastname@openi-analytics.com` with the
real individual address:

```sql
insert into auth_invite_allowlist (email_normalized, email_as_entered, invited_by, note)
values (
  lower(trim('firstname.lastname@openi-analytics.com')),
  'firstname.lastname@openi-analytics.com',
  'firstname.lastname@openi-analytics.com',
  'Bootstrap Openi administrator, PR #9'
);

-- Confirm the row landed before going near the invitation.
select email_normalized, invited_at from auth_invite_allowlist;
```

If you mistakenly use the SEC mailbox, this step fails with
`oracles@openi-analytics.com is a reserved service address … and must not hold an
application account.` That is correct. Use an individual address.

### Step 1b — clear any account already holding the address

**Do this every time before re-inviting.** An invitation to an address that
already has a *confirmed* account is refused by the helper, deliberately, and an
account left over from an earlier attempt is the most common reason a fresh
invitation appears to do nothing.

Supabase → Authentication → Users → find the address → **Delete user**. Then
confirm it is gone, and confirm the allowlist row survived — the two live in
different tables and deleting the user does not touch the allowlist:

```sql
-- Expect zero rows.
select id, email, confirmed_at from auth.users
where email = lower(trim('firstname.lastname@openi-analytics.com'));

-- Expect exactly one row. If it is missing, go back to Step 1.
select email_normalized, invited_at from auth_invite_allowlist;
```

### Step 2 — send the invitation with `Send-BootstrapInvitation.ps1`

**Do not use the dashboard's *Invite user* action.** It offers no way to name a
redirect and always sends to the project's **Site URL** — the production origin.
PR #9 is unmerged, so production does not contain `/auth/callback` or any other
authentication route. An invitation sent that way lands on an application that
cannot read it, which is the failure this milestone was opened to fix.

**And do not hand-roll the API call.** The destination is a QUERY PARAMETER on
the raw endpoint:

```
POST /auth/v1/invite?redirect_to=<URL-encoded absolute URL>
```

`options.redirectTo` in the JSON body is the JavaScript **SDK's** shape. The raw
GoTrue endpoint has no such field, ignores it without complaining, and falls
back to the Site URL — which is exactly how the second live invitation reached
production. Nothing errors and nothing warns; the only visible symptom is that
the link goes to the wrong origin. The helper now sends it correctly, and the
Windows PowerShell 5.1 loopback test parses the real request line to prove it.

```powershell
cd C:\path\to\Haskell-FB-Opportunity-Radar
git switch main
git pull
pwsh -File .\scripts\Send-BootstrapInvitation.ps1
```

Windows PowerShell 5.1 works too:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Send-BootstrapInvitation.ps1
```

It asks for two things and checks a great deal before it sends anything:

| Prompt | Visible? | Why |
| --- | --- | --- |
| Openi email address | **yes** | Not a credential, and you must be able to see you typed it correctly before an email is sent |
| Supabase secret key | **no** | Hidden, held as a `SecureString`, never an argument, an environment variable, or a file |

It refuses, in this order, before the key is ever requested: a repository that is
not this one · a dirty working tree · a branch other than
`claude/production-foundation` · a `HEAD` that is not the freshly fetched remote
head · a running transcript, verbose or debug output, script tracing or a
debugger · `oracles@openi-analytics.com`, the reserved SEC mailbox. Then, once
the key is entered: an address with no `auth_invite_allowlist` row, and an
address a **confirmed** account already occupies. An *unconfirmed* invitation is
resent, because that is exactly the case worth resending.

The redirect is a constant in the script, not a parameter:

```
https://deploy-preview-9--haskell-fb-opportunity-radar.netlify.app/auth/callback
```

A redirect that can be overridden on a command line is one that will eventually
be overridden back to the production Site URL. It must be byte-identical to an
entry in the Redirect URL allowlist from § A — Supabase silently falls back to
the Site URL for a value that is not on it, which looks exactly like the bug
being avoided.

**Nothing is printed**: not the key, not the invitation link, not any token, not
Supabase's response body. You get a sanitised success or a sanitised failure.

### Step 3 — accept it

Follow the emailed link. What must happen now, in order:

| # | Where you land | What you should see |
| --- | --- | --- |
| 1 | `…/auth/callback#access_token=…` | briefly — "Checking your session…" |
| 2 | `/auth/set-password` | **"Choose a password"**, addressed to your email, with the requirements listed before you type |
| 3 | `/` | the Daily Pulse, with your address and a **Sign out** control in the navigation |

The address bar must contain **no token** by the time you reach step 2 — the
callback rewrites the history entry before anything renders. Press Back: you
must not be able to return to a URL carrying the credential.

If step 2 shows *"That link cannot be used"*, the link expired or was already
opened. Send another. If it shows *"This account cannot be used"*, the address
is not on the allowlist — go back to step 1.

### Step 4 — prove the guard still refuses what it should

SQL Editor:

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

### Step 5 — confirm exactly one account exists

```sql
select
  (select count(*) from auth.users)                          as accounts,       -- 1
  (select count(*) from auth.users where email is null)      as anonymous,      -- 0
  (select count(*) from auth_invite_allowlist)               as allowlisted,    -- 1
  (select count(*) from reserved_service_addresses)          as reserved;       -- 1
```

### Step 6 — walk the rest of the journey before hosted validation

The point of this milestone is that the application is private. Check it:

1. **Sign out.** The interface must disappear immediately and land on `/login`.
2. **Open a private window** and go to the preview root. You must get the
   sign-in page and see no navigation, no account names, no counts — not even
   for an instant.
3. **Ask for a deep link while signed out**, e.g. `/accounts`. You are sent to
   `/login?next=%2Faccounts`; after signing in you land on `/accounts`.
4. **Sign in with the wrong password.** One generic message; no hint about
   whether the address exists.
5. **Forgot password.** The reset link lands on `/auth/callback` and forwards to
   `/auth/reset-password`; after setting a new password you are returned to
   `/login` and must sign in with it.

Do **not** invite any Haskell user yet.

---

## B2. Administrator pre-provisioning

**The second approved onboarding method.** It is not an invitation and it is not
self-registration, and the difference matters:

| | Invitation | **Administrator pre-provisioning** | Self-registration |
| --- | --- | --- | --- |
| Script | `Send-BootstrapInvitation.ps1` | `New-PreprovisionedAccounts.ps1` | — |
| Account exists | only after acceptance | **immediately, silently** | — |
| Email sent by us | one single-use link | **none, ever** | — |
| Password at creation | none | **none** | — |
| How a password is set | `/auth/set-password` from the link | **"Set or reset your password"** | — |
| Allowlist row required first | yes | **yes** | — |
| Available on this project | yes | yes | **no, by any route** |

Use pre-provisioning when the accounts are approved in advance and you would
rather not send anything: nothing is emailed, nothing is generated, and there is
no link that can expire before somebody gets round to it.

### What it does, and what it deliberately does not

The script creates each account through the **Auth Admin API** with
`email_confirm: true` and **no password**. It never inserts into `auth.users`
directly — GoTrue owns that table, and a row placed behind it is a user that
half-works in ways that surface much later.

**No temporary password is generated, stored, displayed or transmitted.** A
password the script invented would have to reach the person somehow — an email,
a chat message, a spreadsheet — and every one of those is a place it then lives.
It would also be a credential the administrator knows, which makes "only you
could have done this" untrue for as long as it exists. The only password these
accounts ever have is the one their owner chooses.

### Before you run it

1. **Allowlist every address first.** Migration 0016's trigger fires
   `before insert on auth.users`, so it applies to the Admin API exactly as it
   applies to an invitation — an address that is not on the list cannot be given
   an account by any path. The script checks first anyway, so a missing row is
   an explanation rather than a database error halfway down the list.
2. **Keep the addresses out of this repository.** They are typed in at the
   prompt, or read from a file you keep elsewhere. The script refuses an address
   file inside the working tree. Nothing in version control names an individual.

### Running it

```powershell
cd C:\path\to\Haskell-FB-Opportunity-Radar
git switch main
git pull
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\New-PreprovisionedAccounts.ps1
```

It refuses, before the key is requested: another repository · a dirty tree · the
wrong branch · a `HEAD` that is not the freshly fetched remote head · a
transcript, `-Verbose`, `-Debug`, tracing or a debugger · an address outside
`haskell.com` or `openi-analytics.com` · a shared mailbox (`info@`, `support@`,
`admin@`, `oracles@`, …) · a list you do not confirm by typing `CREATE` exactly.

It is **idempotent**: an address that already has an account is reported and left
untouched. It is never updated — somebody may already have set a password, and
overwriting that would lock them out silently.

### What to tell each person

There is nothing to send them from here. Through whatever channel you normally
use:

> 1. Go to the Radar sign-in page.
> 2. Choose **"Set or reset your password"**.
> 3. Enter your approved address.
> 4. Open the emailed link and choose a password.
> 5. Sign in with it.

For them this is **activation**; for everyone else the same page is ordinary
recovery. It is one flow on purpose — the page cannot tell you whether an
address has a password yet, and it must not, because that is a fact about
somebody's account.

### Authorization is identical either way

A pre-provisioned user gets no privilege from having been created by an
administrator, and none from their email domain. They must be a non-anonymous
Supabase user, currently on `auth_invite_allowlist`, holding a live session in
`auth.sessions` for evidence access — and removing the allowlist row denies
evidence on their next request, exactly as for an invited user. Before they set
a password there is no way for them to sign in at all.

**No application rows need creating.** There is no `after insert` trigger on
`auth.users` and no profile table: the only per-user table, `user_read_state`,
has no foreign key and is written lazily on first use. An Admin-API-created
account therefore needs nothing that an invited one does not.

## C. Netlify variables

### `netlify.toml` cannot configure a function

Netlify's documentation is explicit:

> Environment variables declared in a Netlify configuration file
> (`netlify.toml`) are not available to serverless functions.
> — <https://docs.netlify.com/build/functions/environment-variables/>

So there are **four distinct places**, and only two of them reach a function:

| Where it is set | Reaches the Vite **build** | Reaches a **Function** |
| --- | --- | --- |
| `netlify.toml` (`[build.environment]`, `[context.*.environment]`) | yes | **no** |
| Netlify UI / CLI / API, scope **Builds** | yes | **no** |
| Netlify UI / CLI / API, scope **Functions** | no | **yes** |
| Netlify UI / CLI / API, scope **All** | yes | **yes** |

Earlier revisions of this runbook said `SUPABASE_URL`, `SEC_EDGAR_USER_AGENT`,
`SEC_CONTACT_CONFIRMED` and `EGRESS_ALLOWLIST` were "committed in
`netlify.toml`" and therefore needed no entry. **That was wrong.** Those
declarations never reached a function. They have been removed from the file, and
the values must be entered in the dashboard like any other runtime value.

`netlify.toml` now carries build settings and `VITE_`-prefixed values only.
`app/src/test/runtimeConfiguration.test.ts` fails if a runtime variable
reappears there.

### A deploy is frozen at the values it was built with

Netlify resolves environment values when a deploy is created and freezes them
into it. Changing a variable in the dashboard changes nothing about an existing
deploy, including one whose status is `ready`.

**After every change below, redeploy the context you changed** — Deploys →
Trigger deploy → **Clear cache and deploy site** for production, or *Retry
deploy* / a fresh push for a Deploy Preview — and confirm afterwards with
`/api/status`, which reports what the running function can actually see.

### The values

Site configuration → Environment variables. One development project currently
serves every context, so *Same value for all deploy contexts* is correct today.

**Builds scope** — read by Vite, inlined into the bundle:

| Key | Secret |
| --- | --- |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | no |

**Functions scope** — read by a function at request time. None of these can be
committed:

| Key | Secret | Notes |
| --- | --- | --- |
| `SUPABASE_URL` | no | Already set — production `/api/session` works, which is only possible if it is present |
| `SUPABASE_PUBLISHABLE_KEY` | no | Same value as the `VITE_` one; a Builds-scope value is not visible to a function |
| `SUPABASE_SECRET_KEY` | **yes** | Already set, for the same reason as `SUPABASE_URL` |
| `INGEST_SHARED_SECRET` | **yes** | Required by `admin-run` |
| `SEC_EDGAR_USER_AGENT` | no | Required before any SEC request |
| `SEC_CONTACT_CONFIRMED` | no | Exactly `true` or `false`; anything else throws |
| `EGRESS_ALLOWLIST` | no | **Absent means every outbound request is denied** |
| `RADAR_ENV` | no | Optional, per context; reporting only |
| `MODEL_API_KEY` | **yes** | **Optional.** Absent means classification fails closed |

Full reasoning, including why the publishable key is entered twice, is in
`docs/ENVIRONMENT.md`.

---

## D–E. Everything else, in one script

Two scripts, doing the same checks under the same names. **PowerShell is the
primary procedure**; the Bash one is the equivalent for a Linux or macOS
operator.

### Nothing is typed on a command line

Neither script takes a credential as a parameter, an environment variable, or an
argument, and neither writes one to disk. Both prompt with the input hidden and
keep the values in process memory only.

`export TOKEN=…` was the earlier instruction and it was wrong: an exported value
sits in the shell's environment for every later process to read, and the command
that set it sits in shell history — `.bash_history`, or PSReadLine's
`ConsoleHost_history.txt`, which is a plain text file on disk. Do not do it, and
do not paste either value into a terminal for any other reason.

| Property | How |
| --- | --- |
| hidden while typed | `Read-Host -AsSecureString` / `read -rs` |
| never in `ps` output | PowerShell builds headers in memory; Bash passes the whole request to `curl --config -` on stdin |
| never in shell history | nothing confidential is ever typed as a command |
| never on disk | no temporary files; the scripts write nothing but console output |
| redacted from errors | both filter output through a redactor; Bash uses parameter expansion rather than `sed`, because a `sed` script is itself an argv |
| cleared on exit | PowerShell `finally` + `PowerShell.Exiting`; Bash `trap … EXIT INT TERM HUP` |
| refuses to be watched | both abort under verbose/trace; PowerShell also refuses a running transcript, a breakpoint, and `-Debug` |

### The scripts refuse to run against the wrong tree

Before prompting for anything, both check that `origin` is
`OpeniOracle/Haskell-FB-Opportunity-Radar`, that the working tree is clean, that
the branch is `claude/production-foundation` — **the head branch of PR #9** — and
that `HEAD` equals `origin/claude/production-foundation` after a fresh fetch.
Validating a tree that differs from the pull request proves nothing about the
pull request.

### The canary is created and removed by the run

Each run creates its own collection run, two evidence rows and one Storage
object, with identifiers unique to that run, and removes all of them in a
`finally` block — on success, on failure, and on Ctrl-C. Nothing is left staged
in the hosted database waiting for a human to come back.

### Windows — the primary procedure

```powershell
cd C:\path\to\Haskell-FB-Opportunity-Radar
git switch main
git pull
pwsh -File .\scripts\Invoke-HostedValidation.ps1
```

Windows PowerShell 5.1 works too:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Invoke-HostedValidation.ps1
```

It will ask for two values, each hidden as you type:

1. **Administrator access token.** In the browser console on the deploy preview,
   signed in as the administrator:

   ```js
   JSON.parse(localStorage.getItem(Object.keys(localStorage)
     .find(k => k.startsWith('sb-') && k.endsWith('-auth-token')))).access_token
   ```

2. **Supabase secret key** (`sb_secret_…`), from Project Settings → API keys.

### Linux / macOS

```bash
cd /path/to/Haskell-FB-Opportunity-Radar
git switch main && git pull
bash scripts/hosted-validation.sh
```

### What it runs

`/api/status` authenticated and unauthenticated; the evidence-proxy canary
(create, retrieve, byte comparison, header assertions, path- and signed-URL leak
scan); the ADR 0014 reference-only `409`; direct-Storage refusal from seven
angles with one positive control; self-registration refusal; **sign-out
revocation**; and canary cleanup with proof.

The revocation check is check 8 and it runs last, because it ends the session.
Sign back in afterwards.

It also prints one INFORMATIONAL line: what `/api/status` answered *after*
sign-out. That is not a pass or a fail. `/api/status` does not perform the
session-table check, so an already issued token may still work there until it
expires — Supabase's documented behaviour. Immediate revocation is a property of
`/api/evidence`, which checks `auth.sessions` on every request. See ADR 0015.

Paste the whole output into PR #9.

---

## F. SEC contact — done

`oracles@openi-analytics.com` was confirmed on 2026-08-26 as an active, monitored
Openi mailbox. **The confirmation is done; the configuration is not.**

An earlier revision said `SEC_CONTACT_CONFIRMED = "true"` was committed in
`netlify.toml` and there was nothing to enter. That declaration never reached a
function, so set both values in the Netlify UI with **Functions** scope:

```
SEC_EDGAR_USER_AGENT  = Openi Analytics Haskell F&B Radar oracles@openi-analytics.com
SEC_CONTACT_CONFIRMED = true
```

Then redeploy, and confirm `/api/status` reports `sec.contactConfirmed: true`.
Until it does, the value is not set, whatever the repository says.

The mailbox is reserved for automated-source identification and operational
notices only, and `reserved_service_addresses` makes it impossible to allowlist
as an application account.

---

# F. First live collection — Tyson Foods, PepsiCo, Mars

**Read this section end to end before running anything in it.** Every step is
reversible; the point of reading first is that the stop conditions matter more
than the commands.

The collection runs **on the deployment**, not on your machine. Your machine
sends one authenticated request. Nothing here needs the Supabase secret key.

## F0. What this will and will not do

It will retrieve documents from SEC EDGAR and the Mars newsroom, store each one
as evidence with its provenance, classify what it can, and derive opportunities
only where the evidence supports one. It will not delete anything, will not
modify a document it already holds, and will not send any email.

**A company producing zero opportunities is a valid outcome.** If Mars published
nothing about a facility in the last year, the correct result is zero. Do not
fill that in.

## F1. Apply migration 0021, after the already-applied 0020

**Read the ordering note first.** This migration was drafted as `0019` and never
applied. While it sat unapplied, `0020` (the Microsoft identity guard) was
merged and **applied** to the hosted database. It has been renumbered to `0021`
so that version order and application order agree.

The hosted path is therefore **0018 → 0020 → 0021**. A clean replay in filename
order reaches the same schema; `db/verify.sh` proves both, and the two dumps are
byte-identical. **Do not reapply or modify 0020.**

Backward compatible: every column is nullable or defaulted, every index is
partial or on a new column, and a pre-0021 application keeps working against the
migrated database.

### If you have `psql` and the pooler URL

```bash
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f db/migrations/0021_live_source_ingestion.up.sql
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -c "insert into public.schema_migrations (version, name, checksum, stamped)
  values ('0021','live_source_ingestion','fd15cdc30a526e9575fe9c0644d8055e4346290ea8d7596048f78b9e7afc53b7', false);"
```

### If you are using the Supabase SQL Editor

**The SQL Editor does not keep one session across the statements of a script.**
This was learned the hard way applying 0020: a temporary table created by one
statement was already gone by the next, and — far worse — an explicit
`begin; … commit;` therefore does not wrap the script either. **A multi-statement
script that looks atomic can commit its first half and fail on its second.**

So wrap the whole thing in a single `DO` block, which is one statement and runs
in one transaction whatever the client does with it:

```sql
do $apply0021$
declare
    n bigint;
begin
    if exists (select 1 from public.schema_migrations where version = '0021') then
        raise exception 'ABORT: migration 0021 is already recorded. Nothing to do.';
    end if;
    if not exists (select 1 from public.schema_migrations where version = '0020') then
        raise exception 'ABORT: migration 0020 is not present. Apply it first.';
    end if;
    if not exists (select 1 from public.schema_migrations where version = '0018') then
        raise exception 'ABORT: migration 0018 is not present.';
    end if;

    execute $mig$
-- >>> paste the ENTIRE contents of
-- >>> db/migrations/0021_live_source_ingestion.up.sql here, verbatim
    $mig$;

    insert into public.schema_migrations (version, name, checksum, stamped)
    values ('0021', 'live_source_ingestion',
            'fd15cdc30a526e9575fe9c0644d8055e4346290ea8d7596048f78b9e7afc53b7', false);

    select count(*) into n from public.schema_migrations where version = '0021';
    if n <> 1 then raise exception 'ABORT: 0021 is not recorded exactly once.'; end if;

    raise notice 'Migration 0021 applied and recorded.';
end
$apply0021$;
```

Any line containing `ABORT:` means **nothing was committed**.

**Rollback**, if you need it: `db/migrations/0021_live_source_ingestion.down.sql`,
then `delete from public.schema_migrations where version = '0021';`. It drops
only what 0021 added, and it will **refuse** rather than invent or delete data if
any opportunity row is unscored. Evidence rows written by a live run would lose
their `source_document_id`, so roll back **before** collecting, not after.

## F1b. Verify the ledger and the schema

Read-only. Run before going any further.

```sql
select version, name, checksum, stamped
from public.schema_migrations
where version in ('0018','0020','0021')
order by version;

select to_regclass('public.source_document_cache')                     as cache_table,
       to_regclass('public.evidence_current_document_uidx')            as current_doc_index,
       to_regclass('public.source_runs_single_active_uidx')            as single_active_run,
       to_regproc('public.auth_guard_microsoft_identity') is not null  as microsoft_guard_intact,
       (select count(*) from public.schema_migrations)                 as migrations_applied;
```

**Expected:** three rows — `0018`, `0020` (checksum
`55514d77a1e92019598127d733df47f1895eb6166c5ddf003df10a1ebb968832`, untouched),
and `0021` (checksum `fd15cdc30a526e9575fe9c0644d8055e4346290ea8d7596048f78b9e7afc53b7`),
all `stamped = false`. The second query: all four object checks non-null/true,
and `migrations_applied` = **20**.

`microsoft_guard_intact` is there on purpose. 0021 touches none of the auth
objects, and this is the cheapest way to prove it did not.

## F1c. Apply the live-cohort source seed

```bash
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f db/seed/0006_live_cohort_sources.sql
```

**Expected:** two `INSERT 0 1`. The seed is idempotent — running it twice updates
the rows and never resets `enabled` or `health_status`.

## F2. Confirm the sources exist and are still disabled

```sql
select id, enabled, health_status, connector_id, last_success_at from sources order by id;
```

**Expected:** `sec-edgar` and `mars-newsroom`, both `enabled = false`,
`health_status = 'disabled'`, `last_success_at` null. Seeded off deliberately:
enabling is an operator decision made while someone is watching.

## F3. Check the network path, before the credential

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Test-SourceConnectivity.ps1
```

```bash
bash scripts/test-source-connectivity.sh
```

**Expected:** `HTTP 200` for `company_tickers.json`, the submissions API, and at
least one Mars candidate.

**Stop conditions:**

| What you see | What it means | What to do |
| --- | --- | --- |
| `this machine's network refused the connection` | Your proxy, not the source | Run from a machine with direct egress, or allow the hosts. **Do not disable the source.** |
| `403` / `503` with a challenge marker | A WAF or interstitial | Do not work around it. Look for an official feed, sitemap or IR distribution endpoint and record the exact URL and status. |
| `404` on a Mars candidate | The guessed path is wrong | Expected. Correct it in F6. |
| `429` | Rate limited | Wait. The connector honours `Retry-After`; you should too. |

The three SEC endpoints failing while Mars succeeds (or vice versa) is
informative — record which.

## F4. Confirm the deployed environment

`EGRESS_ALLOWLIST` must permit the connector hosts, or the run fails with a
message naming the host. The connector will not grant itself egress.

Required, Functions scope, all deploy contexts:

```
SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY,
INGEST_SHARED_SECRET, SEC_EDGAR_USER_AGENT, SEC_CONTACT_CONFIRMED
EGRESS_ALLOWLIST = data.sec.gov,www.sec.gov,www.mars.com
```

All of them are entered in the **Netlify UI with Functions scope**. None can be
committed — see § C.

`SEC_EDGAR_USER_AGENT` must name the organisation and a monitored address, e.g.
`Openi-Haskell-FB-Radar/1.0 (oracles@openi-analytics.com)`. SEC's fair-access
guidance asks for a contact; an anonymous agent is the one that gets blocked.

### Exact scopes and contexts

Every row is **Netlify UI, Functions scope**. There is no committed alternative.

| Variable | Contexts | Notes |
| --- | --- | --- |
| `SUPABASE_URL` | all | already set — `/api/session` works in production |
| `SUPABASE_PUBLISHABLE_KEY` | all | **verify** — was declared only in `netlify.toml`, so it may never have been delivered |
| `SUPABASE_SECRET_KEY` | all | **secret**; already set |
| `INGEST_SHARED_SECRET` | all | **secret**; required by `admin-run` |
| `SEC_EDGAR_USER_AGENT` | all | **verify** — was declared only in `netlify.toml` |
| `SEC_CONTACT_CONFIRMED` | all | **verify** — was declared only in `netlify.toml` |
| `EGRESS_ALLOWLIST` | all | **verify and set** — see below |

`EGRESS_ALLOWLIST` was previously declared in `netlify.toml` and therefore never
reached the egress gateway. An absent allowlist parses to an empty array, and an
empty allowlist **denies every outbound request**, so the first live run would
have failed every source with `Egress to "…" is not on the allowlist. Permitted:
(none configured).` rather than reaching SEC or Mars. That is the control failing
closed, which is the correct direction, but it is not configured.

The value for the first cohort is:

```
data.sec.gov,www.sec.gov,www.mars.com
```

**Exact hosts, no bare parent domain.** An entry authorises every host beneath
it, so `sec.gov` would grant every SEC subdomain in one keystroke. The
connectors declare exactly these hosts, and the runner refuses to start a source
whose declared hosts are not all permitted — it will not merge them in for you.

Add `www.fsis.usda.gov` only if the FSIS connector is enabled. Nothing in the
first cohort requests it, and `api.anthropic.com` does not belong here at all —
the model gateway does not use the egress allowlist.

### Supabase redirect allowlist — the PR 10 preview

The preview now carries Microsoft sign-in, so its callback must be allowlisted
before you sign in to it. **Supabase Dashboard → Authentication → URL
Configuration → Redirect URLs** must contain, exactly:

```
https://deploy-preview-10--haskell-fb-opportunity-radar.netlify.app/auth/callback
https://deploy-preview-10--haskell-fb-opportunity-radar.netlify.app/auth/reset-password
```

Assume they are absent until you have seen them. Without the first, Microsoft
authenticates you and Supabase then refuses the redirect — which fails *after*
the identity provider has already succeeded, and reads like a broken
application rather than a missing configuration line.

## F5. Enable the sources

```sql
update sources set enabled = true, health_status = 'healthy' where id in ('sec-edgar', 'mars-newsroom');
```

## F6. Correct the Mars retrieval strategy, if F3 showed you the real paths

The candidate URLs are **configuration, not code**. There is no deploy.

```sql
update sources
   set connector_config = connector_config || jsonb_build_object(
         'feedCandidates', jsonb_build_array('<the real feed URL>'),
         'indexCandidates', jsonb_build_array('<the real newsroom URL>'),
         'confirmedOnFirstLiveRun', true)
 where id = 'mars-newsroom';
```

The development environment that wrote this connector could not reach mars.com,
so the seeded candidates are conventional guesses. Confirming them is part of
this run, not a defect.

## F7. Run the backfill

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Invoke-LiveBackfill.ps1 `
  -BaseUri 'https://deploy-preview-<N>--haskell-fb-opportunity-radar.netlify.app' `
  -WindowDays 365
```

It refuses before asking for the secret: another repository, a dirty tree, the
wrong branch, a `HEAD` behind the remote, a transcript, `-Verbose`, `-Debug`,
tracing, a debugger. Then it does a **dry run** (authenticates, checks
configuration, writes nothing), asks you to type `BACKFILL`, runs, and then
**runs the same window again** to prove idempotency.

Twelve months is the window recorded in **ADR 0016**.

**Expected on the first run:** per source, a `runStatus`, counts, and a note.

**Stop conditions:**

| Response | Meaning | Action |
| --- | --- | --- |
| `401` | Wrong or missing operator secret | Check `INGEST_SHARED_SECRET`. Do not retry blindly. |
| `503 not_configured` | A variable is missing | The message names it. Add it, redeploy, re-run. |
| `502 collection_failed` | The run threw server-side | Read the message. Do not re-run until you know why. |
| any source `runStatus: failure` | That source did not complete | **The cohort is not current.** Investigate that source. |
| `mars-newsroom` `manual_review_required` | No compliant automated path | Correct. Import by hand; do not bypass the control. |

**Expected on the repeat run:** `evidenceCreated: 0` for every source and
`duplicatesPrevented` greater than zero. The script says so explicitly. If the
repeat run creates records, stop and investigate before trusting any count.

## F8. Verify in the database

```sql
-- Per company: what was collected and what it produced.
select o.canonical_name,
       count(distinct e.id)  filter (where e.superseded_at is null) as current_evidence,
       count(distinct s.id)                                          as signals,
       count(distinct opp.id)                                        as opportunities
  from organizations o
  left join evidence_entity_links l on l.organization_id = o.id
  left join evidence e   on e.id = l.evidence_id
  left join signals s    on s.organization_id = o.id
  left join opportunities opp on opp.organization_id = o.id
 where o.entity_key in ('sec:0000077476', 'sec:0000100493', 'radar:mars-incorporated')
 group by o.canonical_name order by o.canonical_name;

-- Provenance is present on every stored document.
select source_id, connector_id, connector_version,
       count(*) as documents,
       count(*) filter (where source_document_id is null) as missing_document_id,
       count(*) filter (where published_at is null)       as no_published_date,
       min(first_seen_at) as first_seen, max(last_seen_at) as last_seen
  from evidence where connector_id is not null group by 1,2,3;

-- Run outcomes, including the ones that found nothing.
select source_id, run_status, items_seen, items_stored, duplicate_count,
       started_at, completed_at, error_summary
  from source_runs order by started_at desc limit 20;
```

**Expected:** `missing_document_id = 0`. Every live document has a stable source
identity — that is what makes the second run a no-op.

## F9. Verify in the authenticated preview

**Sign in first**, at
`https://deploy-preview-10--haskell-fb-opportunity-radar.netlify.app`. Either
method works and both should be exercised once:

- **Continue with Microsoft** — the preview context builds with the button on.
  Requires the redirect URL from F4.
- **Email and password**, or **Set or reset your password** and the emailed
  six-digit code.

Neither is affected by anything in this section: live data changes what the
application shows, never who may see it.

Then check:

1. **Sign-in is still required.** Open the preview in a private window; every
   protected route redirects to `/login` with no data visible.
2. **No illustrative data.** There is no "illustrative" banner and no
   preview-state control in the navigation — both are gated on a flag the live
   provider sets to false.
3. **`?state=empty` does nothing.** The parameter is inert outside a development
   build; the page shows live state.
4. **Counts match F8.** The opportunity count on screen equals the query.
5. **Empty is honest.** A company with no qualifying signal reads as "no
   qualifying opportunity has been found", not as an error.
6. **Evidence resolves through the proxy** and the response carries
   `Cache-Control: private, no-store`.
7. **Source URLs and timestamps are visible** and match the filing or article.
8. **Source Health** shows the real run outcomes, including
   `manual_review_required` if that is what happened.
9. **Sign out** removes all protected content immediately.
10. **No credential survives** in the URL, in history, in rendered content, or
    in the console.

## F10. Cleanup

**Nothing to clean up.** This procedure creates no canary: the verification uses
the real collected records and the repeat run, so there is no test row to
remove and no artefact to leave behind.

If you need to re-run a window from scratch — after correcting a Mars URL, say —
delete that source's rows rather than the cohort's:

```sql
-- Reversible and scoped to one source. Evidence rows cascade to their links.
delete from evidence     where source_id = 'mars-newsroom';
delete from source_runs  where source_id = 'mars-newsroom';
delete from source_document_cache where source_id = 'mars-newsroom';
update sources set last_success_at = null, health_status = 'healthy',
                   consecutive_failures = 0
 where id = 'mars-newsroom';
```

Signals and opportunities derived only from those documents lose their evidence
links and should be reviewed before deletion — an opportunity an analyst has
since touched is not the collector's to remove.

## F11. Schedule

The collector runs **`0 6 * * *` — 06:00 UTC daily**, which is **02:00 US
Eastern during daylight time and 01:00 during standard time**. It is pinned to
UTC deliberately: an Eastern-pinned schedule would move twice a year and put a
shifted collection window either side of the change.

The scheduled function has no HTTP route and cannot be invoked by a request.
`admin-run` is the only manual path and carries its own operator credential.
Overlap is refused by the database, not by a check in the handler.
