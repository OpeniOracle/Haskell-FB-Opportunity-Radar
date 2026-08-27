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
git switch claude/production-foundation
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
git switch claude/production-foundation
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
git switch claude/production-foundation && git pull
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
Openi mailbox. `SEC_CONTACT_CONFIRMED = "true"` is committed in `netlify.toml`,
so there is nothing to enter and nothing to toggle. `/api/status` reports
`sec.contactConfirmed: true`.

The mailbox is reserved for automated-source identification and operational
notices only, and `reserved_service_addresses` makes it impossible to allowlist
as an application account.
