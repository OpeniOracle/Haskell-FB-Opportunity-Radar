# ADR 0013 — The Radar is externally hosted, with no Haskell-side runtime dependency

**Status: Accepted** · **Approved via:** D1 (corrected) and D2b (corrected) ·
**Relates to:** D1, D2a, D2b, ADR 0001, ADR 0002, ADR 0003 ·
**Correction record:** `docs/design/17_ARCHITECTURE_HOSTING_RECONCILIATION.md`

## Context

The design package framed deployment as a choice between two places, both of them inside
Haskell. `05_IMPLEMENTATION_ROADMAP.md` §Decisions required asks whether the platform ships
"inside the existing Haskell Hub or as a separate application sharing backend services",
and follows it with "Which identity, hosting, database, queue, search, storage, and model
services are **already approved**?" — a question that only makes sense if Haskell's service
inventory governs.

`10_DESIGN_RESPONSE.md` answered the question as posed: *separate application, shared
identity and infrastructure*. That answer was recorded as D1, ratified in the Gate 1
packet, cited in the status line of ADR 0001, and carried into `15_PHASE_1_IMPLEMENTATION_PLAN.md`
as four vendor selections owned by Haskell IT. Each step was a reasonable inference from
the step before it. The whole chain rests on a premise nobody stated as a premise.

The premise is false. The Radar is operated by **Openi Analytics** as an externally hosted
application. Haskell hosts nothing, administers nothing, and connects nothing.

This matters beyond tidiness. The false premise created a **hard gate that did not exist**:
`15_...` §14 recorded that "V3 is a hard gate for everything from PR 3 onward", so the
entire persistence half of Phase 1 was recorded as blocked pending a Haskell IT decision
that was never Haskell's to make.

## Decision

**The Radar is a separate, externally hosted application operated by Openi Analytics. It
shares no runtime infrastructure with the Haskell Hub. Haskell users receive authenticated
browser access and nothing else.**

The platform for the pilot:

| Concern | Choice | Owner |
|---|---|---|
| Frontend hosting | Netlify | Openi |
| Identity (V2) | Supabase Auth, **invite-only** | Openi |
| Database (V3) | Supabase PostgreSQL, dedicated project | Openi |
| Object storage (V4) | Supabase Storage, private buckets | Openi |
| AI provider (V1) | **Open** — blocks AI-assisted classification only | Openi |

**The trust boundary.** A Haskell user's browser reaches a Netlify-hosted frontend, which
reaches Openi's Supabase project and Openi's server-side workers. Outside the boundary, and
never contacted: Haskell internal networks, databases, Hub infrastructure, identity
services, file systems, and administrative credentials. **The application must function
with no connectivity to any Haskell-controlled system.**

**Internet-accessible, authenticated, private.** The login surface is reachable over the
Internet; the content behind it is not public. No unauthenticated user may reach Haskell
opportunity, evidence, company, facility, saved-view, health, or administrative data.
Public self-registration is disabled, and Openi controls invitations and removals.
"Reachable" is not "public", and the distinction is worth stating because the first
phrasing of this record blurred it.

**No integration with a Haskell-controlled system is in the pilot.** Two follow from that
directly:

- **CRM linkage (D3) is deferred and out of pilot.** Pursuit activity stays inside the
  Radar. A user may copy a link or manually export a record they are authorized to see; no
  automated integration exists, and the Radar neither reads from nor writes to a Haskell
  system. A future integration is a new scoped decision covering architecture, security,
  data handling and authorization.
- **Alerting (D4) is phased with no Haskell-controlled channel.** Phase 1 is in-application
  notices and watches. A later authorized phase adds email through an **Openi-controlled**
  transactional service. **Microsoft Teams is deferred and outside the pilot** — it would
  require a Haskell tenant application, a webhook or Graph permission, and Haskell IT
  action, all of which this decision exists to avoid.

**Gate ownership.** Openi engineering owns architecture and implementation approval; Openi
security or the designated Openi platform owner reviews hosting, authentication, database,
storage, secrets, logging and operations. The Haskell business sponsor reviews product
scope, workflows, user access and relevance; Haskell Legal/Commercial reviews contractual
permission for Haskell-provided data, including **D14-L — the only Haskell-side contractual
gate in the programme**. **Haskell IT is not a standing gate attendee, infrastructure
reviewer, or implementation approver**, and an externally hosted application is not blocked
on a general Haskell security or IT approval unless an applicable contract specifically
requires one.

**Credential discipline.** The browser gets the public client configuration and is
constrained by RLS. Service-role and administrative credentials exist only in
Openi-controlled server-side functions and workers, and never in code that ships to a
browser.

**Haskell corporate SSO is deferred and optional.** The pilot must not be blocked on
Haskell identity infrastructure. If Haskell later asks for SSO, that is a new decision and
`AuthAdapter` is where it lands.

## Alternatives considered

- **Embed in the Haskell Hub.** Rejected for the reason the original D1 gave and which
  still holds: the F&B ontology, daily cadence and page model differ enough that coupling
  slows both products. The Hub remains a product and UX reference.
- **Separate application sharing Haskell identity and infrastructure.** This was the
  recorded decision. Rejected because it describes an arrangement that does not exist —
  Haskell operates none of it — and because it makes the pilot's schedule hostage to a
  Haskell IT queue for work Haskell was never going to do.
- **Self-hosted PostgreSQL and object storage under Openi's own operation.** Rejected for
  the pilot: it adds patching, backup verification and restore drills to a team that gains
  nothing from them at 15 accounts. Revisit if data-residency or contractual terms demand
  it.
- **A separate identity provider from the database vendor.** Rejected for the pilot as an
  extra vendor relationship and a second security review for no pilot benefit. The
  `AuthAdapter` boundary is what keeps this reversible.

## Consequences

Good. The pilot's schedule no longer depends on a Haskell IT decision queue. The security
review has a small, legible surface: one hosting account, one Supabase project, one set of
credentials, no inbound path into Haskell. Onboarding a Haskell user is an invitation, not
an infrastructure change. And **PR 3 is unblocked** — what remains is provisioning, which
Openi does for itself.

Bad. Openi carries operational responsibility that would otherwise be Haskell's: backups
and restore drills, RLS correctness, secret rotation, monitoring, and incident response.
And Haskell has less direct visibility into an application it does not operate, so
reporting has to substitute for access.

**Vendor concentration is accepted, not unresolved.** Supabase supplies PostgreSQL, Auth
and Storage, so an exit touches three concerns at once. Openi accepts that for the pilot
because it materially reduces complexity and operational burden — one project, one
credential model, one set of RLS semantics — and because the acceptance is conditioned on
exit staying cheap: standard version-controlled PostgreSQL migrations, export through
standard PostgreSQL tools, objects exportable through documented storage mechanisms, no
unnecessary Supabase-specific extensions, and authentication and authorization logic
documented well enough to support a future migration. **Re-evaluate before expanding beyond
the pilot or adding additional customers.**

Neutral but worth stating. **Selecting a vendor is not provisioning one.** A dedicated
Supabase project may still need creating and configuring. That is an implementation
dependency, not an approval gate, and it must never again be recorded as one.

**No PostgreSQL major version is assumed here.** Engineering inspects the provisioned
project and verifies the version, `pgcrypto`, and any other required feature before
applying migrations.

## Portability

Vendor selection is not consent to lock-in.

- Standard PostgreSQL and `pgcrypto` where supported; avoid unnecessary Supabase-specific
  database extensions.
- Migration files stay version-controlled in this repository, runnable against any
  conforming PostgreSQL.
- Data stays exportable through standard mechanisms — `pg_dump`/`pg_restore`, logical
  replication, ordinary object listing and download.
- `AuthAdapter` and `EvidenceArchive` remain narrow interfaces, so replacing a vendor is
  bounded work rather than a rewrite.

## Revisit when

Haskell requests SSO, domain controls, or any other enterprise integration; a data
residency or contractual term rules out the chosen hosting; the vendor concentration
across auth, database and storage becomes a recorded risk rather than an accepted one; or
any proposal arises to connect the Radar to a Haskell-controlled system — which is a new
decision, not an extension of this one.
