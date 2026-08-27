# ADR 0015 — The evidence proxy checks the session table, so sign-out revokes it immediately

**Status:** Accepted
**Date:** 2026-08-26
**Supersedes nothing. Narrows:** ADR 0006 (evidence access modes), ADR 0014 (D19 pilot evidence-access rule)

## Context

The evidence proxy exists because a Storage signed URL is a bearer credential:
once minted it works for whoever holds it until it expires, and a CDN or proxy
can retain the *response* even after the token dies. Expiry is not revocation.
That argument is what put an authenticated same-origin endpoint in front of
preserved evidence instead of a URL.

The first implementation authenticated each request with
`supabase.auth.getUser(token)` and re-checked the invitation allowlist. That is
a real per-request decision and it closed the allowlist half of the problem.

It did not close the sign-out half. **A Supabase access token stays
cryptographically valid until its own `exp`, even after sign-out.** Signing out
revokes the *session* — the refresh token stops working and GoTrue deletes the
`auth.sessions` row — but the access token already in the caller's hands is a
self-contained, correctly signed JWT with, by default, up to an hour of life
left. Verifying its signature answers *"was this issued to a real user"*, never
*"is this caller still signed in"*.

So the original design had reintroduced, in a smaller form, the exact property
it was built to remove: a credential that outlives its authorisation.

## Decision

**For confidential evidence only**, the server asks the database a question the
token cannot answer. `GET /api/evidence/:id` now:

1. verifies the JWT signature cryptographically — locally against the project's
   published JWKS where the project uses asymmetric signing keys, locally with
   `SUPABASE_JWT_SECRET` where it still uses HS256, or, failing both, by
   delegating to GoTrue, which refuses a forged token;
2. refuses anything at or past `exp`, with **no clock-skew grace** — a grace
   period is a window in which an expired credential still works;
3. reads `sub` and `session_id` from the **verified** claims, and refuses a
   token that carries no `session_id`;
4. calls `public.authorize_evidence_access(sub, session_id)`, which answers one
   boolean after checking that the user still exists, that the session still
   exists, that the session belongs to that user, and that the address is still
   on `auth_invite_allowlist`;
5. maps every refusal to one indistinguishable `401`.

Because sign-out deletes the `auth.sessions` row, step 4 turns a signed-out
access token into a refusal on the caller's **very next request**.

### Why a `security definer` function rather than a query

The answer lives in `auth.sessions`, GoTrue's private state. Granting any
application role read access to it would expose every session for every user —
device metadata, refresh cadence, AAL, last-seen times — in order to answer a
yes/no question.

`public.authorize_evidence_access(uuid, uuid)` is that yes/no question and
nothing else. It returns `boolean`, never a row, a count, or a session id. It is
`security definer` with a pinned `search_path`, so the caller needs no rights on
`auth` and cannot shadow the tables it reads. Execute is revoked from `public`,
`anon` and `authenticated`, and granted only to `service_role` — a browser
session cannot call it at all, not even to probe whether a given session id
exists.

## Scope — and what this deliberately does NOT do

**This applies to `/api/evidence` and to nothing else.** Ordinary authenticated
reads — `/api/status`, and every direct PostgREST read the dashboard makes —
keep Supabase's documented behaviour: an already issued access token remains
usable until it expires, whether or not the user has signed out.

That is not an oversight. Changing it project-wide would mean either a
database round trip on every read, or shortening the platform's token lifetime,
and neither is warranted by the threat. The difference in stake is the whole
argument: a stale dashboard read shows data the caller could have read a minute
earlier anyway; a stale evidence fetch hands over a preserved copy of
confidential source material, which is the thing this endpoint was built to
control.

**No documentation, response, or status field may describe Supabase tokens as
revoked on sign-out in general.** `/api/status` reports
`auth.dashboardTokenLifetime: "supabase_default_until_exp"` precisely so the
distinction is visible rather than assumed, and
`app/src/test/sessionRevocation.test.ts` fails the build on an unscoped
revocation claim in any of the source or documentation files it reads.

## Consequences

* Migration 0018 adds the function. `db/supabase_compat.sql` gains an
  `auth.sessions` stub so the migration and its tests run on a plain PostgreSQL
  container exactly as they do on Supabase.
* `/api/evidence` costs one extra database round trip per request. It is a
  single indexed lookup on a primary key, and it replaces the network call to
  GoTrue that the previous implementation made, so the request does not get
  slower in the asymmetric and HS256 verification modes.
* A token minted before this change, carrying no `session_id` claim, is refused
  rather than accepted. Supabase has issued `session_id` for years; a caller
  holding a token without one has a token old enough that refusing it is right.
* `/api/status` reports `evidenceSessionCheckInstalled`, so a project that never
  received migration 0018 is visible rather than silently unprotected.
* `SUPABASE_JWT_SECRET` becomes an optional server variable. It is only needed by
  a project still signing with HS256 that publishes no JWKS; with asymmetric
  signing keys there is no secret to hold.
