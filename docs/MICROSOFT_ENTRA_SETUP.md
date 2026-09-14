# Microsoft Entra ID sign-in — the manual configuration

Everything in this file is done **by hand**, in the Azure portal and the
Supabase dashboard. None of it can be set from code, and none of it is in this
repository, because all of it is either a credential or a property of somebody
else's tenant.

**Status: Microsoft sign-in is ENABLED in production.**

It was hosted-tested on the PR 13 deploy preview with an existing, allowlisted
**Openi** account. What that test established, and what it did not, is in
"Rollout status" immediately below — read it before treating this feature as
validated for Haskell, because it is not.

---

## Rollout status

### Verified — hosted test, PR 13 deploy preview, existing Openi account

| Checked | Result |
| --- | --- |
| The Microsoft control rendered on the preview | yes |
| Microsoft authentication completed | yes |
| The callback returned to the application | yes |
| Supabase user id (compared by fingerprint) | **unchanged** |
| `has_password` | `true` |
| `email_confirmed` | `true` |
| `identity_count` | `1` → **`2`** |
| `providers` | **`azure,email`** |
| Total users | `5` → **`5`** (no duplicate created) |
| Total identities | `5` → **`6`** |
| Azure identities | `0` → **`1`** |
| Duplicate normalized-address groups | `0` |
| Password sign-in afterwards | still available |
| Recovery by six-digit code | still available |
| Migration 0020 | applied and verified |
| Production `/auth/callback` in the Supabase redirect allowlist | confirmed |

The Microsoft identity **linked to the existing Supabase user**. It did not
create a second account. `auth_invite_allowlist` remained the thing that granted
access, re-read by the server on every request.

### NOT verified — Haskell tenant, pending operational validation

**No Haskell Microsoft account was available before release.** This was an
accepted, explicit risk taken by the project owner, not an oversight and not
something the tests cover. The following are **unknown** and must not be
described as working:

- Whether Haskell's Entra tenant permits user consent to this multitenant
  application, or requires **administrator** consent.
- Whether a Haskell sign-in produces an `AADSTS` tenant-policy error.
- Whether Haskell's specific identity claims — `xms_edov` in particular — pass
  migration 0020's checks.
- Whether each pre-provisioned Haskell reviewer links to their **existing**
  Supabase user on first production login, rather than being refused.

The first Haskell login in production **is** that test. Until it has happened
and been verified with the query in "The hosted test" below, Haskell coverage
is pending.

### If Haskell's tenant refuses

**Do not relax any authorization control to compensate.** Not the allowlist, not
the verified-email requirement, not the identity-linking guard, not `xms_edov`
validation. A tenant-consent failure is a fact about Haskell's directory
settings; loosening a check here would not fix it, and would remove a control
that is doing its job.

The fallback for an affected Haskell reviewer is the one that already exists and
already works: **"Set or reset your password" and the emailed six-digit recovery
code.** Not a shared password, not an administrator-generated temporary
password, not a password communicated out of band.

---

## What this feature is, and what it is not

**It is** the Supabase **Azure social-login provider**: the Radar's Supabase
project consuming Microsoft Entra ID as an identity provider, so a reviewer can
press "Continue with Microsoft" instead of typing a password.

**It is not** Supabase **OAuth Server**. That feature turns Supabase into an
identity provider *for other applications* — the opposite direction — and it
stays off. If you find yourself on a settings page that talks about issuing
tokens to third-party clients, you are in the wrong place.

---

## The rule that everything else follows from

**Microsoft authentication proves identity. It does not grant access.**

A successful Microsoft sign-in tells the Radar who somebody is. Whether that
person may use the Radar is decided separately, by an exact-address row in
`auth_invite_allowlist`, re-read by the server on every single request.

So:

- Everybody at Haskell and everybody at Openi can complete a Microsoft sign-in.
- Almost none of them can see anything afterwards.
- Nobody is admitted because of their tenant, their directory, or an
  `@haskell.com` / `@openi-analytics.com` suffix. There is no code path that
  reads a domain and grants anything, and `microsoftIdentity.test.ts` asserts
  that there is not.

Adding a reviewer is still the same two-step operation it was: put the address
on the allowlist, then let them sign in. Microsoft changes how they prove who
they are; it does not change who is on the list.

---

## 1. Azure App Registration

Azure portal → **Microsoft Entra ID** → **App registrations** → **New
registration**.

| Setting | Value |
| --- | --- |
| **Name** | `Haskell F&B Opportunity Radar` |
| **Supported account types** | **Accounts in any organizational directory (Any Microsoft Entra ID tenant — Multitenant)** |
| **Redirect URI** — platform | **Web** |
| **Redirect URI** — value | `https://dutmdlbangsthclgtkhy.supabase.co/auth/v1/callback` |

### Why multitenant, and why not "personal accounts"

The reviewers span **two** directories — Haskell's and Openi's. A
single-tenant registration can only authenticate one of them, so it cannot
serve this cohort. Multitenant is the least permissive option that works.

Do **not** choose any option whose name includes *"and personal Microsoft
accounts"*. That would admit outlook.com and hotmail.com identities to the
sign-in screen. They would still be refused by the allowlist, but the
registration is the right place to keep them out, and it is the primary control.

The application also refuses the Microsoft consumer tenant
(`9188040d-6c67-4c5b-b112-36a304b66dad`) server-side as a second line — see
`emailIdentity.ts`. That check only fires when the token happens to carry a
tenant claim, which is exactly why it is second and not first. **Configure the
registration correctly; do not rely on the fallback.**

### The redirect URI is Supabase's, not the Radar's

`https://dutmdlbangsthclgtkhy.supabase.co/auth/v1/callback` is the only value
Entra needs. Microsoft returns to Supabase, Supabase completes the token
exchange, and only then does the browser come back to the Radar. The
application's own callback (`/auth/callback`) is configured in Supabase, in
step 3 — it is not an Entra redirect URI and adding it there does nothing.

---

## 2. API permissions and the `xms_edov` claim

### Permissions

**API permissions** → the registration ships with `User.Read` (Microsoft Graph,
delegated). Reduce it to the minimum:

| Permission | Type | Keep? |
| --- | --- | --- |
| `openid` | Delegated | **Yes** |
| `email` | Delegated | **Yes** |
| `profile` | Delegated | **Yes** |
| `User.Read` | Delegated | **Remove** |
| Anything else | — | **Remove** |

The Radar reads **nothing** from Microsoft Graph. It does not read the
directory, mail, group membership or a photo. It learns who is signing in and
stops there, because it authorizes from its own allowlist — and a permission
that is never used is a permission that can only ever be misused.

Removing `User.Read` is safe: `openid`, `email` and `profile` are OpenID Connect
scopes, not Graph scopes, and they are what the ID token is built from.

### `xms_edov` — required, not optional

**Token configuration** → **Add optional claim** → token type **ID** → select
**`xms_edov`** → Add. If the portal offers to turn on the Microsoft Graph
`email` permission to support it, accept.

`xms_edov` ("email domain owner verified") is how Microsoft states whether the
address in the token belongs to a domain the tenant has actually proven it
owns. Supabase reads it to decide whether an OAuth identity may be linked to an
existing account by email.

**Without this claim, Microsoft sign-in will be refused.** That is deliberate
and it fails closed. An email address in a token is a *claim*; in a tenant that
permits it, a directory administrator can set a user's mail attribute to any
string, including a reviewer's. If an unverified address were allowed to match
an allowlist row, that would be access to somebody else's account with no
password involved. So "we were not told" is treated as "not verified".

The refusal is visible in **Supabase → Logs → Auth** and reads:

> Microsoft did not assert this address as verified. Configure the xms_edov
> optional claim on the application registration; an unverified address will not
> be accepted.

That message comes from migration 0020's trigger. If you see it, this step was
missed or has not propagated yet.

### Client secret

**Certificates & secrets** → **New client secret**. Set an expiry you will
actually diarise — 24 months is the practical maximum, and an expired secret
breaks sign-in with no warning.

**Copy the secret VALUE, not the Secret ID.** The portal shows the value once
and never again. It goes into Supabase in step 3 and nowhere else: not into
this repository, not into `netlify.toml`, not into a Netlify environment
variable, not into a chat message. The browser never needs it — the token
exchange is server-to-server between Supabase and Microsoft — and
`bundleSecrets.test.ts` plants an Entra-secret-shaped value at build time and
fails if anything like it reaches the bundle.

### Values to record

From **Overview**, note the **Application (client) ID** and the **Directory
(tenant) ID**. Neither is secret; both are needed in step 3.

---

## 3. Supabase

**Supabase Dashboard → Authentication → Sign In / Providers → Azure**

| Field | Value |
| --- | --- |
| **Enable Sign in with Azure** | On |
| **Application (Client) ID** | the client ID from step 2 |
| **Secret Value** | the client secret **value** from step 2 |
| **Azure Tenant URL** | *leave blank* |

### Leave the tenant URL blank

Blank means the `common` endpoint, which is what authenticates users from **any**
organizational directory. Filling in a single tenant's URL would lock sign-in to
that one tenant, and this cohort spans two.

`common` is the default Microsoft organizational flow, and it is the correct one
here. There is no more restrictive configuration that still serves both Haskell
and Openi.

### Redirect URLs

**Authentication → URL Configuration → Redirect URLs** must include:

```
https://haskell-fb-opportunity-radar.netlify.app/auth/callback
```

Add the preview origin as well if Microsoft sign-in is to be exercised on a
deploy preview.

This is Supabase's allowlist of places it will send a browser after a completed
sign-in. The application only ever asks to be sent to its own
`/auth/callback` — the URL is built by `microsoftRedirectUrl()`, which is
same-origin by construction and passes any `?next=` through the open-redirect
filter before it is sent and again when it comes back.

### What must NOT be enabled

- **OAuth Server** — the wrong feature, in the wrong direction. Off.
- **Allow new users to sign up** — stays off. Migration 0016's trigger refuses
  an uninvited address at the database anyway, but the toggle is the primary
  control.
- **Anonymous sign-ins** — stays off, for the same reason.

---

## 4. Administrator consent

**Is it required?** Probably, for Haskell; possibly not for Openi. It depends on
the tenant's user-consent policy, which is Haskell's setting and not ours to
read.

- If the tenant permits users to consent to apps for themselves, the first
  Haskell reviewer sees a Microsoft consent screen listing "View your basic
  profile" and "View your email address", accepts, and that is the end of it.
- If the tenant requires administrator consent — a common default in a
  regulated environment — every reviewer will be stopped with *"Need admin
  approval"*, and the Radar will show them **"Microsoft did not complete the
  sign-in"**.

### The safe consent procedure

Send the Haskell Entra administrator this, and nothing else:

> Openi Analytics operates the Haskell F&B Opportunity Radar. It uses Microsoft
> Entra ID for sign-in only.
>
> It requests three delegated OpenID Connect permissions and no others:
> `openid`, `email`, `profile`. It requests **no Microsoft Graph permissions**,
> reads no directory data, no mail and no group membership, and writes nothing
> to your tenant.
>
> Access to the Radar is granted per person from a list Openi maintains.
> Approving this application does not give anyone at Haskell access to the
> Radar; it only allows the named reviewers to sign in without a separate
> password.
>
> Application (client) ID: `<the client ID from step 2>`

Grant consent in the Azure portal, in the **Haskell** tenant, under **Enterprise
applications** → the application → **Permissions** → *Grant admin consent*. An
administrator can also complete it by signing in themselves and accepting the
consent prompt on behalf of the organization.

**Do not send a hand-built consent URL containing a client secret, a tenant ID
and a redirect in a query string.** It is unnecessary — the portal path above
does the same thing — and such a URL is a credential-bearing link in somebody's
inbox, which is the exact class of problem the recovery-code work just removed.

If consent is refused or cannot be obtained, that is the blocker to report. Do
not work around it. Password sign-in continues to work throughout, and the
temporary-password fallback described in the task brief is a separate,
controlled piece of work that has not been started.

---

## 5. Netlify — nothing to do

**There is no Netlify UI variable to set, and adding one would not work.**

`VITE_AUTH_MICROSOFT_ENABLED` is declared per context in `netlify.toml`:

| Context | Value | Effect |
| --- | --- | --- |
| `[context.production.environment]` | `"true"` | production shows the button |
| `[context.deploy-preview.environment]` | `"true"` | pull-request previews show it |
| `[context.branch-deploy.environment]` | `"false"` | branch deploys do not |
| anything else (a named branch context, `netlify dev`, a laptop) | unset | disabled |

**Values in `netlify.toml` override anything set in the Netlify UI or API.** An
earlier version of this file told you to switch the flag on in the dashboard
while the repository committed a single global `"false"`. That could not have
worked: the dashboard value would have been silently ignored, the preview would
have built with the button off, and nothing anywhere would have said why.

So the flag moved into three explicit per-context declarations, and turning it
on for production is a **commit** — an edit to
`[context.production.environment]`, reviewed like any other change — rather than
a dashboard toggle nobody can see the history of.

`app/src/test/microsoftFlagContexts.test.ts` holds that shape. It fails if the
flag reappears in `[build.environment]`, if any context stops declaring it, if a
context resolves to the wrong value, or if the two context builds stop differing.

The Entra client ID, tenant ID and client secret are **not** in Netlify at all.
They belong to the Supabase project; the browser never sees them, and the build
scan plants an Entra-shaped secret and fails if anything like it ships.

## 6. Migration 0020

Apply before enabling the flag. It adds the database half of all of this:

- one account per address, so a Microsoft sign-in can never create a duplicate
  of a pre-provisioned reviewer;
- a Microsoft identity may only attach to the account holding the **same**
  address;
- and only on an address Microsoft asserted as **verified**.

**Numbering note.** This is `0020`. The live-data migration that was drafted as `0019` was never applied, and has been renumbered to `0021` so that version order and application order agree: the hosted path is 0018, then 0020, then 0021. This migration is unaffected and is not reapplied.

---

## 7. Order of operations — completed

This is the order that was followed, kept as the record and as the recipe for
any future project. **The flag was last, and that was the point.**

1. ~~Apply migration 0020.~~ Applied and verified.
2. ~~Complete the Azure registration, including `xms_edov`.~~ Done.
3. ~~Configure the Supabase provider and redirect URLs.~~ Done; the production
   callback is confirmed in the redirect allowlist.
4. Administrator consent — obtained for Openi by the sign-in itself.
   **Haskell's tenant is untested; see "Rollout status".**
5. ~~Confirm the allowlist row for the one reviewer doing the hosted test.~~ Done.
6. ~~Enable deploy previews and run the hosted test there.~~ Passed, with an
   existing Openi account.
7. ~~Enable PRODUCTION by setting `[context.production.environment]` to `"true"`
   and merging.~~ Done — that is what this release is.
8. Tell the four Haskell reviewers. Their first production sign-in is the
   remaining validation, not a formality.

Doing 7 before 2–4 would have shown every reviewer a button that could not work.
Doing 7 before 1 would have removed the database guards from a live sign-in
path.

---

## 8. The hosted test

Use **one** existing pre-provisioned reviewer. Do not delete, recreate or
re-invite the account, and do not set a temporary password.

**Before:** record the reviewer's Supabase user ID (Authentication → Users).
You will compare it afterwards; that comparison is the whole test.

1. Open the Radar signed out. The sign-in page shows **Continue with Microsoft**
   above the password form.
2. Press it. Microsoft asks the reviewer to sign in — and, the first time, to
   consent.
3. They come back to the Radar and land in the application.
4. **Check the user ID again. It must be the same one.** A new ID means a
   duplicate account was created and the linking has not worked; stop, and do
   not tell the other reviewers.
5. Authentication → Users → the reviewer → confirm they now have **two**
   identities, `email` and `azure`, on the **same** user row.
6. The address bar carries no `code` and no `state`.
7. Sign out. Sign in with Microsoft again — it should complete without a consent
   prompt this time.

**Then prove the allowlist is still the thing that grants access.** This is the
half that is easy to skip and is the only half that proves the security claim:

8. Remove the reviewer's row from `auth_invite_allowlist`.
9. Have them reload. They must be refused, with **"You are signed in, but not
   authorized"**, and no application content.
10. Put the row back. They reload and are admitted again.

**And confirm password sign-in still works**, since it is the fallback the whole
plan depends on: a reviewer who already has a password signs in with it, and
"Set or reset your password" still issues a six-digit code.

### If the Radar refuses a reviewer who should be admitted

Check in this order:

1. Is their exact address on `auth_invite_allowlist`? It is an exact match after
   normalization — no domain rules, no wildcards.
2. **Supabase → Logs → Auth** for the `xms_edov` message from step 2. That is
   the most likely cause and it is a portal setting, not a code problem.
3. Does the address contain any non-ASCII character? Such addresses are refused
   deliberately — see the long note in `emailIdentity.ts` — because JavaScript
   and Postgres do not reliably agree on how to lowercase them, and a
   disagreement there is a bypass in one direction and a lockout in the other.
   Nobody in the current cohort is affected; if that changes, it needs a
   decision, not a quiet loosening.

---

## 9. Rollback

**Flag only. Four lines of intent, and nothing else changes.**

1. In `netlify.toml`, change **only** the production context back:

   ```toml
   [context.production.environment]
     VITE_AUTH_MICROSOFT_ENABLED = "false"
   ```

   Leave `[context.deploy-preview.environment]` at `"true"` and
   `[context.branch-deploy.environment]` at `"false"`.

2. Deploy that as a reviewed hotfix to `main`. Production rebuilds and the
   button disappears. The flag is read at build time, so a deploy is required —
   there is no dashboard toggle, and a Netlify UI variable could not override
   the committed value anyway.

3. **Password sign-in and recovery by code keep working throughout.** They never
   depended on any of this, and the rollback must not touch them.

4. **The Supabase Azure provider may stay enabled.** With the control gone the
   application never starts an OAuth flow, so leaving the provider on changes
   nothing a user can reach. Disable it only if you want sign-ins already in
   flight to fail too.

5. **Do not delete identities or users.** A linked `azure` identity is attached
   to a reviewer's existing account; removing it is a data operation with no
   benefit, and it would have to be redone. **Do not roll back migration 0020**
   either — its guards are protective, cost nothing while the button is off, and
   rolling them back would remove the one-account-per-address rule from a live
   project.

To end one person's access immediately, remove their `auth_invite_allowlist`
row. That takes effect on their next request regardless of which method they
signed in with, and it is the correct lever — not the feature flag.
