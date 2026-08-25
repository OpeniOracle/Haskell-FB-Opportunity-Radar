# 17 — Architecture and Hosting Reconciliation

**Status:** Correction accepted
**Scope:** Deployment model, tenancy boundary, vendor ownership, and governance ownership
**Supersedes on these points:** `05_IMPLEMENTATION_ROADMAP.md` §Decisions required 1–2,
`03_AUTOMATION_AND_SOURCE_ARCHITECTURE.md` §Deployment recommendation,
`docs/design/10_DESIGN_RESPONSE.md` §10 (D1, D2), `docs/design/13_GATE_1_DECISION_PACKET.md`
(D1, D2a, D2b), `docs/adr/0001`, `docs/adr/0003`, `docs/design/15_PHASE_1_IMPLEMENTATION_PLAN.md`
§4, §13, §14
**Documentation only.** No application code, schema, migration, dependency, or Netlify
configuration changed in this pass.

---

## 1. The correct governing fact

The Haskell Food & Beverage Opportunity Radar is an **externally hosted application
operated by Openi Analytics**. It does not run in Haskell infrastructure, does not share
Haskell Hub infrastructure, and requires Haskell IT to host, administer, connect, or
operate nothing.

Haskell users reach it through the public web interface after authenticating. **Haskell
systems are not connected to the application**, and no component may require access to a
Haskell network, database, identity system, endpoint, or file store.

## 2. Where the error came from, and why it is not being hidden

The design package never contained a wrong answer. It contained a **wrong question**, and
the design response answered it as asked.

`05_IMPLEMENTATION_ROADMAP.md` §Decisions required opens with:

> 1. Will the platform be deployed inside the existing Haskell Hub or as a separate
>    application sharing backend services?
> 2. Which identity, hosting, database, queue, search, storage, and model services are
>    already approved?

Both options are inside Haskell. There is no third branch for *externally hosted and
externally operated*, and question 2 presumes the service inventory is Haskell's.
`03_AUTOMATION_AND_SOURCE_ARCHITECTURE.md` §Deployment recommendation reinforces it:
"These services can share infrastructure with the existing Haskell Hub where operationally
sound."

`10_DESIGN_RESPONSE.md` §10 answered within that frame — "Separate application, shared
identity and infrastructure" — and from there the assumption propagated by ordinary,
careful reasoning into the decision packet, the ADRs, and the implementation plan. Every
downstream document is internally consistent. They are consistently wrong about one thing.

**The baseline package files `00`–`06` are not edited.** They are the historical input, and
the repository README records them as "the design baseline, unchanged from package version
0.1". Editing them would erase the origin of a correction that is worth being able to
trace. This document supersedes them on these points; it does not rewrite them.

## 3. Correction register

| # | File and section | Current wording | Why it is incorrect | Corrected meaning |
|---|---|---|---|---|
| 1 | `05_IMPLEMENTATION_ROADMAP.md` §Decisions required, item 1 | "deployed inside the existing Haskell Hub or as a separate application sharing backend services" | Offers only Haskell-hosted options. The platform is externally hosted by Openi | Neither. The Radar is externally hosted and operated by Openi Analytics |
| 2 | `05_IMPLEMENTATION_ROADMAP.md` §Decisions required, item 2 | "Which identity, hosting, database, queue, search, storage, and model services are **already approved**?" | Presumes Haskell's approved-service inventory governs | Openi selects and owns the platform services. Haskell approves none of them |
| 3 | `05_IMPLEMENTATION_ROADMAP.md` §Phase 0 | "Confirm existing Haskell Hub components available for reuse" | No Hub component is reused | The Hub is a product and UX reference only |
| 4 | `03_AUTOMATION_AND_SOURCE_ARCHITECTURE.md` §Deployment recommendation | "These services can share infrastructure with the existing Haskell Hub where operationally sound" | Shared infrastructure is not the model | Runtime infrastructure is Openi's and is not shared with the Hub |
| 5 | `10_DESIGN_RESPONSE.md` §10 decision-state paragraph | "**D1** separate application sharing identity and infrastructure" | Identity and infrastructure are not shared | Separate, externally hosted application operated by Openi |
| 6 | `10_DESIGN_RESPONSE.md` §10, D1 row | "Separate application, shared identity and infrastructure" | As above | As above |
| 7 | `10_DESIGN_RESPONSE.md` §10, D2 row | "Which identity, hosting, DB, queue, search, storage, model services are approved?" | Frames the selection as Haskell's | Openi selects; the pilot platform is recorded in §5 below |
| 8 | `10_DESIGN_RESPONSE.md` §Approval sequence, G-4 row | "Engineering, IT security, data owner" | Implies Haskell IT security gates the architecture | Openi platform engineering, with the Haskell sponsor for product scope |
| 9 | `13_GATE_1_DECISION_PACKET.md` D1 | "a separate **internal** application sharing identity and infrastructure with the Haskell Hub" | It is external, and shares nothing | Corrected in §4 below and marked **Approved** |
| 10 | `13_GATE_1_DECISION_PACKET.md` D1 §Operational consequence | "Shared identity keeps administration single-source" | There is no shared identity | Supabase Auth, invite-only, administered by Openi |
| 11 | `13_GATE_1_DECISION_PACKET.md` D2b table row | "Vendor selections … **Open — IT selection required** … Owner: IT" | The selections are Openi's, and three of four are now made | V2, V3, V4 **selected and approved**; V1 open and Openi-owned |
| 12 | `13_GATE_1_DECISION_PACKET.md` §D2b body | "These are IT's to make; they are not made here and must not be assumed" | Correct discipline, wrong owner | They are Openi's, and are recorded in §5 |
| 13 | `13_GATE_1_DECISION_PACKET.md` §D2a | "No claim is made about the components' familiarity to Haskell IT" | Haskell IT familiarity is irrelevant — they do not operate it | Removed as a consideration |
| 14 | `13_GATE_1_DECISION_PACKET.md` §Who decides what | "**D2b** — vendor selections V1–V4 · **IT**, procurement for V1 terms" | Wrong owner | Openi platform engineering; Openi commercial for V1 terms |
| 15 | `15_PHASE_1_IMPLEMENTATION_PLAN.md` §4 vendor table | V2/V3/V4 listed as pending selections behind interfaces | The interfaces remain correct; the selections are made | Selections recorded; the adapter discipline is retained for portability |
| 16 | `15_PHASE_1_IMPLEMENTATION_PLAN.md` §13 | "**IT selects** PostgreSQL hosting", "IT selects object storage", "IT selects identity provider", "IT and procurement select AI provider" | Wrong owner on all four | Openi. V2/V3/V4 resolved; V1 open and Openi-owned |
| 17 | `15_PHASE_1_IMPLEMENTATION_PLAN.md` §14, PR 3 row | Gated by **V3** | V3 is resolved | PR 3 gated by provisioning availability, not by a vendor decision |
| 18 | `15_PHASE_1_IMPLEMENTATION_PLAN.md` §14 | "PRs 1, 2, and S1 need no vendor selection at all and can proceed while **IT** works through V1–V4" | Wrong owner | Openi |
| 19 | `15_PHASE_1_IMPLEMENTATION_PLAN.md` §14 | "**PR 3 has no such fallback** — V3 is a hard gate for everything from PR 3 onward" | The gate was a vendor decision that no longer exists | Replaced by a provisioning dependency |
| 20 | `docs/adr/0001` status line | "D1 (separate application sharing identity and infrastructure)… **D2b** … remain open and are **IT's to make**" | Both halves wrong | Corrected; see ADR 0013 |
| 21 | `docs/adr/0003` status line | "with IT and procurement" | V1 is Openi's | Openi platform engineering with Openi commercial |
| 22 | `docs/adr/README.md` §Two acceptances are bounded | "are **D2b and remain open with IT**" | Wrong owner and stale status | Openi; V2–V4 resolved, V1 open |
| 23 | `11_SCHEMA_DELTA_PROPOSAL.sql` header | "Migration authoring happens after gate G-4" | G-4 was defined as a Haskell IT-security architecture gate | Migration authoring proceeds once the Supabase development target or an authorized CI PostgreSQL target is available |

**Not in the register, deliberately.** `01_PRODUCT_BRIEF.md`, `02_DATA_AND_SIGNAL_MODEL.md`,
`04_UX_DESIGN_SPEC.md`, `06_SOURCE_DATA_PROFILE.md`, `12_PILOT_SOURCE_COVERAGE_MATRIX.md`
and `14_EXTERNAL_RESEARCH_RECONCILIATION.md` contain no deployment, hosting, identity, or
vendor-ownership claim. `16_PHASE_1_IMPLEMENTATION_NOTES.md` refers to D2b only to record
that PR 1 and PR 2 selected no vendor, which remains true.

---

## 4. D1, corrected

> **D1 — Deployment and tenancy. Status: Approved (corrected).**
>
> The Radar is a **separate, externally hosted application operated by Openi Analytics**.
> It does not share runtime infrastructure with the Haskell Hub. Haskell users receive
> authenticated browser access to the Radar.

The Haskell Hub remains a **product and UX reference**. Any future integration between the
two applications is a separate decision and is not in scope for the pilot.

**Owner.** Openi Analytics, with the Haskell executive sponsor informed.

**What this changes from the superseded entry.** The superseded D1 read "a separate
internal application sharing identity and infrastructure with the Haskell Hub." Three words
were wrong: *internal*, *identity*, and *infrastructure*. The rest — that it is separate
rather than embedded, and that the F&B ontology and cadence justify separation — survives
unchanged and was always the substantive part of the decision.

---

## 5. D2, corrected — architecture retained, vendor ownership fixed

**D2a platform architecture remains Approved and is unchanged.** All five structural
choices still hold: PostgreSQL as system of record and job queue; object storage separate
from the database; all model access through one gateway; one identity source; no managed
search, vector service, or external broker in the pilot. None of them depended on who owns
the account.

**D2b is corrected in owner and in status.**

| # | Selection | Status | Owner |
|---|---|---|---|
| — | **Frontend hosting** | **Netlify — selected and approved for the pilot** | Openi |
| **V1** | AI provider and model tier | **Open.** Required before AI-assisted classification | **Openi** platform engineering, with Openi commercial for data-processing terms |
| **V2** | Identity | **Supabase Auth — selected and approved for the pilot** | Openi |
| **V3** | PostgreSQL hosting | **Supabase PostgreSQL — selected and approved for the pilot** | Openi |
| **V4** | Object storage | **Supabase Storage — selected and approved for the pilot** | Openi |

**Haskell IT owns none of V1–V4.** Openi is the platform operator and the vendor-account
owner.

### Selection is not provisioning

These are distinct, and conflating them is what turned a resolved decision into a phantom
gate:

- **The vendor decisions are resolved.** Netlify and Supabase are chosen.
- **A dedicated Supabase project may still need to be created or configured.** That is an
  **implementation dependency**, not an architecture-approval gate. It blocks the moment
  work needs a live target, and it is unblocked by Openi doing the provisioning — no
  stakeholder decision is required.

### PostgreSQL version and extensions are not assumed

This document **records no PostgreSQL major version**. Engineering must inspect the
provisioned Supabase project and verify the available PostgreSQL version, the presence of
`pgcrypto`, and any other required feature **before applying migrations**. A version
assumed here and contradicted by the project would be exactly the kind of quiet error this
reconciliation exists to correct.

---

## 6. Authentication, corrected

The pilot uses **invite-only Supabase Auth accounts**.

- **No public self-registration.**
- **Openi invites and disables users.**
- **Haskell supplies the approved user list.** That is the whole of Haskell's role in
  identity.
- Authentication state is managed through Supabase Auth.
- Authorization is enforced with **Supabase RLS and application roles**.
- **Administrative and service-role credentials never enter browser code.**
- Service-role operations run only in **Openi-controlled server-side functions or
  workers**.
- **Haskell corporate SSO is deferred and optional.** It may be evaluated later, only if
  Haskell requests it.
- **The pilot must not be blocked on Haskell identity infrastructure.**

Nothing here is implemented in this pass. Authentication lands in its scheduled roadmap PR.

---

## 7. Database and storage, corrected

- A **dedicated Supabase project** for the Radar.
- **Supabase PostgreSQL is the system of record.**
- **Supabase Storage** holds archived source material in **private buckets**.
- The frontend **never receives database administrative credentials or a Supabase
  service-role key**.
- Browser access uses the **public client configuration plus RLS**.
- Privileged ingestion, connector, migration and administrative activity runs
  **server-side**.
- Evidence objects are **private**, reached through authorized application flows or
  **time-limited signed URLs**.
- **No Haskell database, network, file store, identity directory, or API is involved.**

### Portability is a requirement, not a preference

Choosing a vendor is not the same as accepting lock-in.

- **Standard PostgreSQL and `pgcrypto`** where supported.
- **Migration files remain version-controlled** in this repository.
- Data must remain **exportable through standard PostgreSQL and object-storage
  mechanisms** — `pg_dump`/`pg_restore`, logical replication, and ordinary object listing
  and download.
- **Avoid unnecessary Supabase-specific database extensions** and any irreversible
  lock-in. Where a Supabase convenience and a portable equivalent both exist, the portable
  one wins unless there is a recorded reason.

The adapter discipline from `15_PHASE_1_IMPLEMENTATION_PLAN.md` §4 is **retained for
portability**, not because the vendor is undecided. `EvidenceArchive` and `AuthAdapter`
stay narrow interfaces so a future migration is bounded work.

---

## 8. Governance ownership, corrected

"IT" was ambiguous throughout and, wherever it appeared as an owner of platform work, it
was wrong.

| Domain | Correct owner |
|---|---|
| Hosting, database, authentication, storage, secrets, migrations, monitoring, incident response, vendor accounts | **Openi platform engineering / Openi operations** |
| Connector operation, backups, RLS policy, user administration | **Openi operations** |
| AI provider selection and model governance (V1) | **Openi**, with Openi commercial for data-processing terms |
| Product scope, user approval, opportunity relevance, business rules, workflow | **Haskell business sponsor / F&B market leader** |
| Permission to use Haskell-provided licensed or proprietary data — including the D14-L event-data review | **Haskell Legal / Commercial Contracts** |
| SSO, domain controls, or another explicit enterprise integration | **Haskell IT — only if Haskell later requests it** |

**No ordinary platform work is assigned to Haskell IT.**

Haskell's responsibilities in the pilot are exactly five: identify authorized users; review
product behaviour and opportunity relevance; provide business rules and feedback; resolve
contractual permission for Haskell-provided proprietary data; and optionally request future
SSO or enterprise controls.

---

## 9. Trust boundary

```
        ┌──────────────────────────── Openi-operated ────────────────────────────┐
        │                                                                        │
Haskell │   Netlify-hosted Radar          Supabase project (dedicated)           │
  user  │   ┌──────────────────┐          ┌──────────────────────────────┐       │
browser ┼──▶│  static frontend │────────▶ │  Auth · PostgreSQL · Storage │       │
        │   └──────────────────┘          └──────────────────────────────┘       │
        │            │                                   ▲                       │
        │            │  public client config + RLS       │ service role,         │
        │            ▼                                   │ server-side only      │
        │   ┌──────────────────────────────────────────┐ │                       │
        │   │ Openi-controlled server-side functions   │─┘                       │
        │   │ and workers — connectors, migrations,    │                         │
        │   │ ingestion, administration                │                         │
        │   └──────────────────────────────────────────┘                         │
        └────────────────────────────────────────────────────────────────────────┘

Explicitly OUTSIDE the boundary — the application never reaches any of these:
  · Haskell internal networks        · Haskell identity services
  · Haskell databases                · Haskell file systems
  · Haskell Hub infrastructure       · Haskell administrative credentials
```

**The application must function with no connectivity to any Haskell-controlled system.**
The only thing that crosses the boundary is a Haskell user's browser making an ordinary
authenticated request to a public web address.

This does not weaken the egress posture in ADR 0002. Outbound collection still leaves
through a single controlled gateway to public sources. What changes is that the gateway is
Openi's, sits in Openi's infrastructure, and never traverses a Haskell network.

---

## 10. Roadmap gates, corrected

| Item | Before | After |
|---|---|---|
| **PR 3** — schema and migrations | Blocked by **V3** vendor selection | **No vendor gate.** May begin once this correction merges and a dedicated Supabase development target **or** an authorized CI PostgreSQL target is available |
| **CI PostgreSQL service container** | Unassigned; treated as needing authorization | **Authorized** as part of the migration harness. It touches no Haskell system |
| **PR 4, 5, 8, 10** | Gated by V3 | Gated by provisioning availability only |
| **PR 6** | V3, **V4** | V4 selected; provisioning and implementation scheduled in PR 6 |
| **PR 7** | V3; **V2** for the auth half | V2 selected; the 7a/7b split is no longer forced by an undecided vendor, though it remains available as a sequencing convenience |
| **PR 9** | V2, V3, V4 | All three selected; scheduled implementation only |
| **V1 (AI provider)** | Open, IT-owned | **Open, Openi-owned.** Blocks AI-assisted classification **only** — no Phase 1 epic calls it |
| **D14-L** | Blocks PACK EXPO import and derived engagement data | **Unchanged.** Still blocks exactly that, still owned by Haskell Legal/Commercial |

**No phase depends on Haskell IT infrastructure approval.**
**No phase may connect to a Haskell system without a new explicit decision.**

The PR boundaries themselves are unchanged. Schema is still never mixed with connectors,
connectors are still never mixed with production UI integration, and PR 9 is still the only
PR that changes what real users see with real data.

---

## 11. What did not change

Recorded so the scope of this correction is legible:

- Every decision status unrelated to hosting, identity, storage, or vendor ownership.
  **D8, D10, D13, D16, D17, D19 and the rest remain Open**; ADRs 0002, 0006, 0007, 0008,
  0009, 0010 remain **Proposed**; ADR 0005 remains **Accepted in part**.
- **D11** remains approved provisionally.
- **D14-L** remains blocked and remains Haskell Legal/Commercial's.
- The modular-monolith shape, runtime split, queue classes, and transaction rules in
  ADR 0001.
- The egress-gateway posture in ADR 0002.
- The model-gateway and replay-cache design in ADR 0003 — only its ownership line changes.
- The data model, the schema delta proposal, the conflict register, and every acceptance
  test.
- All application code, dependencies, Netlify configuration, schemas, and migrations.
