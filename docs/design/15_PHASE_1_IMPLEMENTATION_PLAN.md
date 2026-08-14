# Phase 1 Implementation Plan

Haskell Food & Beverage Opportunity Radar · Version 0.1 · **For engineering review**

Authorized by **D1** (separate application), **D2a** (platform architecture), and the
**D9 framework**. Companion to `10_DESIGN_RESPONSE.md`, `12_PILOT_SOURCE_COVERAGE_MATRIX.md`,
`13_GATE_1_DECISION_PACKET.md`, and `docs/adr/`.

**This is a plan. It is not executed.** No application code, migration, infrastructure,
connector, vendor selection, or data import is created by this document.

---

## 1. Objective and completion boundary

### 1.1 What Phase 1 is for

**Phase 1 builds the evidence foundation and a deployable application that renders it —
and stops before any assessment is made about what the evidence means.**

That boundary is not arbitrary. Turning evidence into signals and opportunities requires
model-backed classification, and the AI provider is **D2b/V1, unselected**. Rather than
stub the intelligence layer and pretend, Phase 1 delivers the half that can be built
honestly: collect, preserve, resolve, and show — with health and coverage reporting that
tells the truth about what is and is not being watched.

### 1.2 In scope

| # | Deliverable |
| --- | --- |
| 1 | Deployable frontend application shell with Netlify branch previews, rendering all six Phase 1 surfaces |
| 2 | Canonical schema for organizations, facilities, sources, runs, attempts, evidence, and the research-claim staging layer |
| 3 | Egress gateway as the sole outbound network path, with allowlist, SSRF protection, and rate limiting |
| 4 | Connector framework with logical runs, retry attempts, parked messages, and circuit breakers |
| 5 | Three to four **unauthenticated public API** connectors producing real evidence |
| 6 | Organization and facility identity for the 15 pilot accounts, seeded from our own verified coverage matrix |
| 7 | Source health **and** expected-coverage reporting, kept separate |
| 8 | Research-claim staging with the fail-closed activation gate (ADR 0011) |
| 9 | D9 instrumentation, live from first production-like use |
| 10 | Audit events, evidence retention, and access control |
| 11 | Fixture and synthetic-data test suite, including the first four failure-injection tests |

### 1.3 Explicitly out of scope — and why

| Excluded | Blocked by | Note |
| --- | --- | --- |
| Signal classification, capability alignment, clustering | **D2b/V1** — no AI provider selected | The model gateway *interface* is defined; no provider is called |
| Opportunities, scoring, promotion rules | Depends on signals | The Opportunities surface renders fixtures only, clearly labelled |
| Market trends | Depends on signals | — |
| Alerts, briefings, subscriptions | Depends on opportunities; channel is **D4**, open | Change ledger is built; nothing is dispatched |
| **PACK EXPO import and the engagement-scoring layer** | **D14-L, blocked** | See §1.4 |
| Company newsroom, permit, incentive, and browser-worker connectors | Endpoints unverified (V10); **D5** geographies open; **D13** bottler modelling open | Phase 1 uses only sources verified as machine-readable public APIs |
| Real user authentication | **D2b/V2** — no identity provider selected | Pluggable adapter with a development stub |
| Any CAPTCHA or credentialed source | — | **Phase 1 has no authenticated sources at all.** Nothing to maintain |

### 1.4 The PACK EXPO constraint, and how the account graph is built without it

D14-L blocks import and use of the PACK EXPO workbooks. **Both** workbooks are covered —
the curated targeting file as well as the lead-retrieval export — so Phase 1 cannot take
tier assignments, engagement observations, or the 171-row target universe from them.

It does not need to. The **15 Highest Value account identities are published in
`05_IMPLEMENTATION_ROADMAP.md`**, and their canonical names, CIKs, subsidiaries, and
operators were independently verified in `12_PILOT_SOURCE_COVERAGE_MATRIX.md` — our own
research, not licensed workbook content. Phase 1 seeds the account graph from that matrix.

What stays blocked until D14-L clears: target tier, Highest Value flag as a stored
attribute, engagement observations, the `account_strategy` scoring dimension, and the
Tier 1 / Tier 2 / Tier 3 universe beyond the 15. The `engagement_observations` and
`organization_segment_tiers` tables are **created empty** so the schema is complete and the
import is a data operation later, not a schema change.

### 1.5 Completion boundary — Phase 1 is done when

1. The application renders all six surfaces from a **real database**, not fixtures, for the
   surfaces backed by real data (Company/Facility, Evidence, Source Health & Coverage).
2. At least **three public API connectors** have run on schedule for **two full expected
   cadence cycles each** with no manual intervention.
3. Re-running any connector against unchanged content produces **zero new evidence rows and
   zero new change events**.
4. Every one of the 15 pilot accounts has a declared source expectation, and the coverage
   report names any account below its expected coverage — **including the four with no
   periodic SEC filings**.
5. An injected connector failure produces a structured failure state, an automated retry, a
   health alert, and a coverage impact statement **within one scheduled cycle**, with no
   human involved in detection.
6. Every approved D9 metric emits from first production-like use.
7. No workflow anywhere requires a human to extract, copy, or key source data.

**Phase 1 is not done when the app looks finished.** Criteria 2, 3, and 5 are the ones that
matter, and they take calendar time that cannot be compressed.

---

## 2. Epics, dependencies, and acceptance tests

Epic IDs continue the numbering in `10_DESIGN_RESPONSE.md` §9. **P1a** epics need no vendor
selection; **P1b** and **P1c** each name their blocker.

### 2.1 Dependency graph

```text
P1a  (no vendor selection required — Netlify-renderable)
  E-A1 Repo & CI foundation
    └─ E-A2 Design system & app shell
         └─ E-A3 Domain types & fixture data layer
              └─ E-A4 Six surfaces on fixtures  ◀── FIRST NETLIFY MILESTONE
                   └─ E-A5 Accessibility & responsive pass
  E-A6 Connector dry-run spike (independent; no decision required)

P1b  (requires V3 PostgreSQL hosting; V4 for raw archiving)
  E-B1 Schema & migration harness
    ├─ E-B2 Audit, access control, retention
    ├─ E-B3 Egress gateway
    │    └─ E-B4 Connector framework: logical runs, attempts, parked queue, breakers
    │         └─ E-B5 Public API connectors (SEC EDGAR, openFDA, FSIS MPI, EPA FRS)
    │              └─ E-B6 Evidence store & extraction
    ├─ E-B7 Research-claim staging & activation gate
    └─ E-B8 Identity: organizations, facilities, time-bounded ownership

P1c  (integration)
  E-C1 Source health & expected coverage      (needs E-B4, E-B5)
  E-C2 Change ledger & read models            (needs E-B6, E-B8)
  E-C3 Surfaces switch fixtures → live data   (needs E-C1, E-C2)
  E-C4 D9 instrumentation                     (needs E-A4; live at E-C3)
  E-C5 Failure-injection suite                (needs E-B4, E-C1)
```

### 2.2 Epic detail

| Epic | Scope | Depends on | Acceptance test |
| --- | --- | --- | --- |
| **E-A1** Repo & CI foundation | Monorepo layout, typed language toolchain, linting, formatting, test runner, CI on every PR, Netlify build config with branch previews | — | A PR from a fork-free branch produces a Netlify preview URL; CI fails on a lint or type error; no secrets in the repo |
| **E-A2** Design system & app shell | Tokens (colour, type, spacing), layout primitives, navigation, empty/loading/error/stale states, theme handling | E-A1 | Every state has a rendered component in a component gallery; contrast passes WCAG 2.2 AA in both themes |
| **E-A3** Domain types & fixture data layer | Types generated from `platform.schema.json` + the delta proposal; a `DataSource` interface with a fixture adapter; the API-adapter seam | E-A1 | Types compile against the schema; swapping adapters is one build-time flag; **no surface imports fixtures directly** |
| **E-A4** Six surfaces on fixtures | Daily Pulse, Opportunities, Company & Facility, Evidence detail, Source Health & Coverage, Saved Pursuits & Watches | E-A2, E-A3 | All six render from fixtures on a Netlify preview; every surface shows its empty, loading, and degraded states; **Opportunities is visibly labelled as illustrative** |
| **E-A5** Accessibility & responsive | Keyboard paths, focus states, semantic regions, colour-independent status, mobile review layouts | E-A4 | Automated a11y scan clean; keyboard-only walkthrough of all six surfaces; status meaning survives a greyscale screenshot |
| **E-A6** Connector dry-run spike | Non-production script: resolve ~30 newsroom/IR endpoints, record feed/sitemap/HTML shape, re-confirm 15 CIKs against EDGAR | **Nothing** | A written report updating every *Unverified* cell in the coverage matrix; **writes to no Haskell system** |
| **E-B1** Schema & migration harness | Canonical tables per the delta proposal; migration runner; forward migration from empty **and** from the v0.1 baseline | **V3** | Migration suite passes from empty and from the v0.1 fixture; rollback tested; temporal, confidence-axis, and interval constraints enforced by the database |
| **E-B2** Audit, access control, retention | `audit_events` on every mutation; role model; `data_sensitivity_class`; retention job | E-B1 | Every mutating operation writes an audit row in an integration run; a restricted-class row is unreachable from the API surface |
| **E-B3** Egress gateway | Sole outbound path: allowlist, DNS/IP validation, redirect policy, byte/MIME caps, per-host rate limits, robots posture, full telemetry | E-B1 | Non-allowlisted host, plain HTTP, private IP, and DNS-rebind fixtures all fail closed and are logged; **no other module can open a socket** (enforced in CI) |
| **E-B4** Connector framework | Logical runs keyed `(source_id, collection_window_start)`; attempts as child rows; bounded retries; parked queue; per-source circuit breaker; seven-state status | E-B3 | Duplicate scheduler fire creates **one** logical run; a permanently failing message parks after bounded retries and does not redeliver; breaker trips and backs off the schedule |
| **E-B5** Public API connectors | SEC EDGAR submissions; openFDA food enforcement; FSIS MPI establishments; FSIS recalls; EPA FRS (identity only). **All unauthenticated, machine-readable, verified** | E-B4 | Each runs on schedule for two expected cadence cycles unattended; conditional collection yields `unchanged` when nothing changed |
| **E-B6** Evidence store & extraction | Raw archive before commit; content hashing; native-PDF-then-OCR; locators; **temporal model with precision and basis**; access modes | E-B5, **V4** for raw archiving | Same document re-collected → one evidence row; a source stating "in 2027" stores an interval at `year` precision and **never** 2027-01-01; reference-only evidence carries no body |
| **E-B7** Research-claim staging | `research_claims` + activation gate; both pilot graph files staged | E-B1 | Re-running the staging dry run reproduces **0 validated · 16 staged · 9 needs_evidence · 1 rejected** for the 6–10 file; a rejected claim without a reason is refused by the database |
| **E-B8** Identity | Organizations, facilities, aliases, identifiers, `facility_organizations` and `organization_relationships` with half-open intervals; the 15 pilot accounts seeded from the coverage matrix | E-B1 | Adversarial set produces **zero incorrect merges**; as-at-date attribution returns Nestlé Waters for 2023 and Primo Brands for 2026; `scope_class_status` defaults to `provisional` |
| **E-C1** Health & coverage | Per-source cadence baselines; anomaly detection; `account_source_expectations` seeded from the coverage matrix; two independent metric families | E-B4, E-B5 | An account with all connectors green and no expected coverage is reported **uncovered**, not quiet; FDA silence for a `fnb_adjacent` account raises nothing |
| **E-C2** Change ledger & read models | `change_events`, `user_read_state`, read projections for the surfaces | E-B6, E-B8 | An unchanged re-run emits **zero** change events; a new evidence family emits exactly one |
| **E-C3** Surfaces on live data | Swap the fixture adapter for the API adapter on the surfaces backed by real data | E-C1, E-C2 | Company, Facility, Evidence, and Source Health render from the database; Pulse shows real evidence-level change; Opportunities remains fixture-backed and labelled |
| **E-C4** D9 instrumentation | Session-duration, adoption, presented-set, and action-event capture; outcome fields | E-A4 | Every approved D9 metric emits a value from the first production-like session; the presented-set denominator is queryable |
| **E-C5** Failure-injection suite | Tests 1, 2, 3, 7 from `10` §8.7 — the four exercisable without AI or alerts | E-B4, E-C1 | All four pass in CI against staging fixtures |

---

## 3. Epic → conflict register and ADR mapping

| Epic | Conflict-register items closed or implemented | ADRs |
| --- | --- | --- |
| E-A1 | — | — |
| E-A2 | — | ADR 0010 (coverage states must be renderable) |
| E-A3 | C14 (schema/type drift — one generated source of truth) | — |
| E-A4 | C17 (change ledger surfaces), C22 (scope class visible) | ADR 0009, ADR 0010 |
| E-A5 | — | — |
| E-A6 | Closes V10, V13; informs C20, D5 | — |
| E-B1 | C1, C2, C3, C9, C10, C12, C13, C14, C15, C16, C19, C24 | ADR 0004, ADR 0005, ADR 0008 |
| E-B2 | C6 (sensitivity class), C21 | ADR 0011 |
| E-B3 | C5 (mode enforcement), C21 | **ADR 0002** |
| E-B4 | C8 (logical runs vs attempts), C27, C29 | ADR 0010 |
| E-B5 | C20 (source scope), C23 (coverage denominators) | ADR 0006, ADR 0010 |
| E-B6 | **C2** (temporal), C5 (access modes), C16 (evidence families), C26 (corrections) | **ADR 0004**, ADR 0006, **ADR 0012** |
| E-B7 | C1, C22, C25 (claim provenance) | **ADR 0011** |
| E-B8 | C3, C12, C13, **C24** (time-bounded ownership) | **ADR 0005** |
| E-C1 | **C23**, C27, C28 (breaker state visible) | **ADR 0010** |
| E-C2 | **C17**, C7 (dedupe key shape) | ADR 0007 |
| E-C3 | C22 (provisional classification rendered as provisional) | ADR 0009 |
| E-C4 | — (D9 framework) | — |
| E-C5 | C26, C27, C29 | ADR 0010, ADR 0012 |

Register items **not** addressed in Phase 1, because they depend on classification or
scoring: C4, C11, C18, C25 (partially). ADRs 0003, 0007 (dispatch half), and 0009 are
implemented structurally but not exercised until Phase 2.

---

## 4. Vendor-neutral architecture, and where each D2b selection becomes blocking

Phase 1 is designed so that **no vendor choice is embedded in application code**. Each
external dependency sits behind a narrow interface with a development implementation.

| Selection | Interface | Development stand-in | Becomes blocking at |
| --- | --- | --- | --- |
| **V1 AI provider** | `ModelGateway.infer(task, inputs, schema, promptVersion)` returning a schema-validated object plus provenance | **No stand-in that produces classifications.** A recording/replay harness only | **Phase 2.** No Phase 1 epic calls it. This is why Phase 1 stops before signals |
| **V2 Identity provider** | `AuthAdapter` — session resolution, role claims, sign-out | Local development stub; Netlify previews run a fixed mock session **and carry no real data** | **E-C3**, the first time a surface renders real data to a real person |
| **V3 PostgreSQL hosting** | Standard SQL through a migration harness; no proprietary extensions beyond `pgcrypto` | Local containerized Postgres for development and CI | **E-B1**. Everything in P1b is blocked until it lands |
| **V4 Object storage** | `EvidenceArchive.put/get/head` returning a URI | Filesystem-backed implementation for development and CI | **E-B6**, the first time raw bytes are archived from a live source |

**Two properties keep this honest.** No module outside the adapter may import a vendor SDK,
and CI enforces it with a dependency rule. And the model gateway is *defined* in Phase 1 —
its interface, provenance record, and replay-cache key (ADR 0003) — while remaining
uncalled, so Phase 2 wires a provider in rather than retrofitting a boundary.

---

## 5. Connector dry-run spike (E-A6)

**Depends on no decision and can begin immediately.** It is a non-production spike that
reads public endpoints and writes to no Haskell system.

Per endpoint, record: whether it resolves; whether it offers RSS/Atom, JSON Feed, sitemap,
structured HTML, or plain HTML; whether it requires JavaScript rendering; robots posture;
observed update cadence; and a machine-readability verdict.

**Priority order.** The four accounts with **no periodic SEC coverage** first — **Nestlé
(Nestlé USA, Purina), Mars (plus Kellanova), Danone (Danone North America), and Niagara
Bottling** — because their newsrooms are their only coverage, and if those endpoints are
fragile the pilot's coverage assumptions change. Then Coca-Cola Consolidated, then the
remaining pilot newsrooms, then all 15 CIKs re-confirmed directly against EDGAR.

**Output:** an updated coverage matrix with every *Unverified* cell resolved, and a list of
endpoints that are **not** machine-readable — which is a Phase 2 scoping input, not a
Phase 1 blocker.

This spike is also the only way to close V10 and V13, and it is the largest remaining
schedule risk in the programme.

---

## 6. Automated ingestion and failure recovery

**No step in this pipeline permits a human to extract, copy, or key source data.** Human
involvement is limited to approving a source before enablement and, later, to bounded
Connector Care actions — none of which exist in Phase 1, because Phase 1 has no
authenticated sources.

### 6.1 Pipeline

```text
scheduler ──▶ logical run (source_id, collection_window_start)   ── idempotent
                 │
                 ├─▶ attempt 1..N  ── bounded retries, jittered backoff
                 │        └─▶ egress gateway ── allowlist, SSRF, caps, rate limit
                 │                 └─▶ conditional GET (ETag / If-Modified-Since)
                 │
                 ├─▶ per-document isolation ── one bad document fails one document
                 │
                 └─▶ transaction: evidence row + run metrics + outbox event
                          └─▶ outbox relay ──▶ extract ──▶ resolve ──▶ change ledger
```

### 6.2 Failure states and automated responses

| Failure | Automated response | Human involvement |
| --- | --- | --- |
| Transient HTTP error | Bounded retry with jitter inside the run budget | None |
| Persistent 4xx/5xx above threshold | Circuit breaker opens; schedule backs off; source marked `degraded` | None |
| Permanently unprocessable document | Parked queue after bounded retries; alert on oldest-parked age | Engineer fixes the extractor; **never re-keys the document** |
| Source returns valid-but-empty for two expected cycles | Flagged stale against **its own** cadence baseline | None |
| Structural change breaking extraction | Minimum-content validation fails → `partial_success`; health event with coverage impact | Engineer updates the connector |
| Auth expiry or CAPTCHA | **Cannot occur in Phase 1** — no authenticated sources | Deferred to Phase 2 Connector Care |

Every one produces a **structured failure state**, an **automated retry or breaker action**,
a **health alert**, and a **coverage impact statement**. A run that fails is never recorded
as zero new signals.

### 6.3 Idempotency

Three levels, all enforced by database constraint rather than application care: logical run
`(source_id, collection_window_start)`; evidence `(source_id, content_hash)`; change events
`(object_type, object_id, dedupe_key)`. Together these make criterion 3 of the completion
boundary structurally true.

---

## 7. Data-model implementation sequence

Ordered so that every step leaves the schema in a consistent, testable state. **Constraints
land with their tables, not afterwards** — a nullable column added "for now" becomes
permanent.

| Step | Tables | Why here |
| --- | --- | --- |
| 1 | Reference data: sectors, capabilities, signal families, `signal_event_types`, `scoring_configs` | Everything else has FKs into these (ADR 0008) |
| 2 | `sources`, `source_runs`, `source_run_attempts`, `parked_messages` | Collection can be built and tested before anything is collected |
| 3 | `evidence`, `evidence_families`, `evidence_relationships` — **with the full temporal model and access modes from the first migration** | ADR 0004 and ADR 0012. Retrofitting means reprocessing the corpus |
| 4 | `organizations`, aliases, identifiers, `scope_class` + `scope_class_status` | Identity before facilities |
| 5 | `facilities`, `facility_aliases`, `facility_identifiers`, `facility_candidates` | — |
| 6 | `facility_organizations`, `organization_relationships` — **half-open intervals** | ADR 0005, C24 |
| 7 | `evidence_entity_links` | Needs both sides |
| 8 | `research_batches`, `research_claims` + activation gate | ADR 0011 |
| 9 | `import_batches`, `import_records`, `organization_candidates`, `approved_entity_mappings`, `engagement_observations`, `organization_segment_tiers` — **created empty** | Schema complete; population waits for D14-L |
| 10 | `account_source_expectations` | Seeded from the coverage matrix |
| 11 | `change_events`, `user_read_state`, `audit_events` | — |
| 12 | Signals, opportunities, trends, alerts — **structure only, no writers** | Present so Phase 2 adds behavior, not tables |

**Confidence axes.** `evidence_strength`, `assessment_type`, and `confidence_level` are
created in step 3 with their guardrail constraints, even though nothing writes them until
Phase 2. The columns and their rules are cheap now and expensive later.

---

## 8. D9 instrumentation

Live from **first production-like use** — meaning the first day a real user opens the
application against real data, which is E-C3, not the Netlify fixture preview.

| Metric | Captured by | Emitted from |
| --- | --- | --- |
| Median active session duration per user per day | Client session events, idle gaps >2 min excluded | E-C4 |
| Adoption: days opened ÷ working days | Session events | E-C4 |
| Presented set (the denominator) | Server-side record of which opportunities were rendered to which user | E-C4 |
| Action rate | Pursue / Watch / Assign events against the presented set | E-C4 |
| Dismissal rate with reason codes | Dismissal events; reason required | E-C4 |
| Conversion to qualified conversation | Outcome fields on the opportunity, recorded by the assigned BD owner | E-C4 |
| Expected-coverage completeness | `account_source_expectations` vs enabled healthy sources | E-C1 |
| Evidence-link availability | Invariant check over presented records | E-C2 |

**Two notes.** Phase 1 has no opportunities, so the presented-set, action, dismissal, and
conversion metrics will legitimately read **zero** — but the pipeline emitting them must be
proven working before Phase 2, or week 1 of the measurement window is lost. And the
**weeks 1–4 measured baseline period is not evaluated against acceptance targets** while
every approved metric is still collected; the instrumentation must be complete on day one
of that period, not built during it.

---

## 9. Security, access control, audit, and evidence retention

| Requirement | Phase 1 implementation | Verified by |
| --- | --- | --- |
| Sole egress path | Egress gateway; CI dependency rule forbids network imports elsewhere | E-B3 acceptance |
| SSRF protection | DNS resolution then private/link-local/metadata range rejection, re-checked at connect | Rebind fixture test |
| Transport | HTTPS only; plain HTTP fails closed | Fixture test |
| Secrets | Outside application data; never in the repository; **no secrets needed in Phase 1** — every source is unauthenticated | Secret scan in CI |
| Access control | Role-based; `data_sensitivity_class` on sources and evidence; restricted classes unreachable from the API | E-B2 acceptance |
| Audit | `audit_events` on every mutation, actor-typed (user/system/connector/model), immutable | Integration-run assertion |
| Evidence retention | `retention_days` per source; `retention_expires_at` per evidence row; retention job in the maintenance queue | Licensed-source fixture |
| Evidence immutability | Raw archive write-once; corrections as relationships, never overwrites | ADR 0012 test |
| Personal data | **None ingested in Phase 1.** `contact_records` remains uncreated; controls specified and dormant | Absence assertion in CI |
| Licensing | `license_mode` and `access_mode` per source; unknown licensing defaults to reference-only | Schema constraint |

---

## 10. Test strategy

**Fixtures and synthetic data only. No live source is called in CI**, and no production
data exists to test against.

| Layer | Approach |
| --- | --- |
| Schema | Migration from empty and from the v0.1 baseline; constraint tests asserting the database *rejects* invalid states — a date without precision, a rejected claim without a reason, an inference without a note, a reference-mode row with a body |
| Connector | Recorded HTTP fixtures per source, including a valid response, an empty response, a malformed response, a 429, a 403, and a redirect chain |
| Extraction | A small corpus of real-shaped documents: HTML, JSON, native PDF, scanned PDF. **Committed as fixtures, not fetched at test time** |
| Temporal | A table-driven suite of source phrasings — "in 2027", "Q3 2027", "by spring 2029", "second half of next year", "within 18 months of closing" — each asserting interval, precision, and basis, and asserting that **no fabricated day appears** |
| Identity | The adversarial set: Mars vs Mars brands, Nestlé on two sheets, three Coca-Cola bottlers, Niagara vs unrelated "Niagara" registrants. Asserts **zero incorrect merges** |
| Idempotency | Re-run every connector fixture twice; assert zero new rows and zero new change events |
| Failure injection | Tests 1, 2, 3, 7 from `10` §8.7 |
| Frontend | Component gallery snapshots for every state; a11y scan; keyboard walkthrough |
| Synthetic data | A generated pilot dataset — 15 organizations, ~40 facilities, ~500 evidence rows — used for UI development and load sanity. **Clearly marked synthetic and never mixed with real evidence** |

---

## 11. Frontend application shell and Netlify previews

### 11.1 Shape

A single-page application built as a static bundle, deployed to Netlify with a preview per
branch. It talks to the backend through one `DataSource` interface with two
implementations selected at build time:

- **`fixture`** — typed fixture data compiled into the bundle. No backend, no network, no
  credentials. This is what branch previews use.
- **`api`** — the real backend, used in the deployed application after E-C3.

**Why this matters.** A reviewer opens a preview URL and sees the actual product on
realistic data, in the first week, without any vendor selection, database, or connector.
The fixture adapter is not a mock to be thrown away — it is the same interface the API
adapter implements, and it stays as the test double.

**Preview safety:** previews are fixture-only and carry a persistent visible marker; the
`api` adapter is not buildable without configuration that previews do not have.

### 11.2 Surfaces

| Surface | Phase 1 content | Data source at Phase 1 end |
| --- | --- | --- |
| **Daily Pulse** | What changed since your last visit; coverage banner; freshness | Live (evidence-level change) |
| **Opportunities** | Queue and detail drawer, score explanation layout, evidence links | **Fixtures, visibly labelled illustrative** — no opportunities exist yet |
| **Company & Facility** | Account summary, related entities, facility list and detail, timeline, coverage status | **Live** |
| **Evidence detail** | Source, retrieval and publication time, excerpt, locator, access mode, temporal precision and basis, correction relationships | **Live** |
| **Source Health & Coverage** | Two panels, never merged: connector health; expected coverage per account | **Live** |
| **Saved Pursuits & Watches** | Saved views, watch list, action affordances | Live for the view mechanics; empty of opportunities |

### 11.3 Provisional classification in the interface

`scope_class_status = 'provisional'` renders as a visible qualifier wherever a
classification appears, and provisional accounts are excluded from relevance metrics.
Confirming a classification is a **data change, not a code change** (D11).

---

## 12. UX direction

`04_UX_DESIGN_SPEC.md` governs. The direction below is how Phase 1 interprets it, and it
is provisional pending **D10** (design system and brand assets).

**The product is a radar, not a database.** The default view answers three questions —
what changed, what matters, what next — and everything else is one click away.

- **Restraint as the organizing principle.** Warm white or very light neutral ground,
  charcoal text, generous white space, one Haskell accent used sparingly. Colour carries
  meaning only for status, and **every status is legible in greyscale** through icon and
  text, per `04`'s colour-independence requirement.
- **Cards over tables by default.** Tables stay available for power users and are secondary.
- **Evidence is progressive.** A card shows the claim and the evidence count; one interaction
  reveals source, time, and excerpt; a second opens the full record. The evidence is never
  more than two steps away and never crowds the card.
- **Honesty is visual.** Degraded coverage, stale sources, provisional classifications,
  inferred dates, and illustrative data all carry a visible marker. "Expected 2027" and
  "expected H2 2027 (inferred)" must look different at a glance.
- **Scores never appear without their components.** `04` requires it; the layout is built
  for it in Phase 1 even though nothing is scored yet.
- **Density is earned.** High information density only in expanded views.
- **Desktop is the planning surface; mobile is for review.** Pulse, evidence, and the four
  actions work on a phone. Administration does not need to.

Accessibility is a build requirement, not a review step: WCAG 2.2 AA, keyboard paths,
visible focus, semantic regions, map results mirrored as a synchronized list.

---

## 13. Blocked capabilities and what unblocks each

| Blocked capability | Blocked by | Exactly what is needed |
| --- | --- | --- |
| Any persistent backend | **V3** | IT selects PostgreSQL hosting — managed or self-hosted, and the environment |
| Raw evidence archiving from live sources | **V4** | IT selects object storage with retention and access controls |
| Real user access to real data | **V2** | IT selects identity provider and SSO standard |
| Signal classification, capability alignment, clustering | **V1** | IT and procurement select AI provider and model tier **with data-processing terms confirming Haskell content is not used for provider model training** |
| Opportunities, scoring, promotion | V1, then **D19** and **D16** | Provider selection, then evidence-access promotion rules and confidence decomposition ratified |
| PACK EXPO import, engagement layer, tier attributes, `account_strategy` scoring | **D14-L** | Legal/Commercial Contracts complete the event lead-retrieval agreement review |
| Newsroom, incentive, permit connectors | **E-A6 results**, then **D5**, **D13** | Dry-run verdicts; then priority geographies and bottler/subsidiary modelling |
| Alerts and briefings | **D4**, plus opportunities | Alert channel decision |
| Final pilot metrics | **D11 confirmation**, **D9-T** | F&B market leader confirms four classifications; week-4 checkpoint sets targets |
| Commercial permit or project data | **D21 evaluation** | Vendor evaluation completes; contract terms confirmed |

---

## 14. Proposed PR sequence

Small, reviewable, each independently mergeable. **No PR mixes schema, connector, and UI
changes.**

| # | PR | Epic | Reviewable in | Needs |
| --- | --- | --- | --- | --- |
| 1 | Repo scaffold, CI, Netlify config | E-A1 | 30 min | — |
| 2 | Design tokens, layout primitives, state components, component gallery | E-A2 | 1 h | — |
| 3 | Domain types generated from schema + `DataSource` interface + fixture adapter | E-A3 | 1 h | — |
| 4 | Pulse and Opportunities surfaces on fixtures | E-A4 | 1 h | — |
| 5 | Company, Facility, and Evidence surfaces on fixtures | E-A4 | 1 h | — |
| 6 | Source Health & Coverage, Saved Pursuits surfaces on fixtures | E-A4 | 45 min | **← FIRST NETLIFY MILESTONE** |
| 7 | Accessibility and responsive pass | E-A5 | 45 min | — |
| 8 | Connector dry-run spike + coverage-matrix update | E-A6 | 1 h | — |
| 9 | Migration harness + reference data + sources/runs/attempts | E-B1 | 1 h | **V3** |
| 10 | Evidence, temporal model, access modes, evidence relationships | E-B1, E-B6 | 1.5 h | V3 |
| 11 | Organizations, facilities, time-bounded ownership, seeded pilot accounts | E-B8 | 1 h | V3 |
| 12 | Research-claim staging + activation gate + staged graph files | E-B7 | 1 h | V3 |
| 13 | Audit events, roles, sensitivity class, retention job | E-B2 | 1 h | V3 |
| 14 | Egress gateway + SSRF/allowlist tests | E-B3 | 1.5 h | V3 |
| 15 | Connector framework: logical runs, attempts, parked queue, breakers | E-B4 | 1.5 h | V3 |
| 16 | SEC EDGAR connector + fixtures | E-B5 | 1 h | V3 |
| 17 | openFDA + FSIS recalls connectors + fixtures | E-B5 | 1 h | V3 |
| 18 | FSIS MPI establishments + EPA FRS identity connectors | E-B5 | 1 h | V3 |
| 19 | Extraction, hashing, locators, raw archive | E-B6 | 1.5 h | V3, **V4** |
| 20 | Source health, cadence baselines, expected coverage | E-C1 | 1.5 h | V3 |
| 21 | Change ledger and read models | E-C2 | 1 h | V3 |
| 22 | D9 instrumentation | E-C4 | 1 h | V3 |
| 23 | Auth adapter + surfaces switched to the API adapter | E-C3 | 1 h | **V2** |
| 24 | Failure-injection suite | E-C5 | 1 h | V3 |

PRs 1–8 need **no vendor selection at all** and can start immediately.

---

## 15. First Netlify-renderable milestone

**PR 6 — all six surfaces rendering from typed fixtures on a Netlify branch preview.**

At that point a reviewer opens a URL and sees the real product: Pulse with change and
coverage, the opportunity queue and its evidence drawer, company and facility views, the
evidence record with its temporal precision and access mode, health and coverage as two
separate panels, and saved pursuits. Every empty, loading, stale, and degraded state is
reachable.

**What it proves:** the information architecture, the visual direction, the surface
inventory, and the honesty markers — all reviewable by the market leader and BD before a
single connector exists.

**What it does not prove:** anything about data. It is fixture-backed, visibly marked, and
carries no real evidence. Reaching it requires **no vendor selection, no database, no
connector, and no AI provider**.

---

## 16. Sequencing summary

```text
week 0 ──▶ PRs 1-8   no vendor selection required
              PR 6 = FIRST NETLIFY MILESTONE
              PR 8 = dry-run spike closes V10/V13
   │
   ├─ V3 lands ──▶ PRs 9-22   schema, gateway, connectors, evidence, health, D9
   ├─ V4 lands ──▶ PR 19      raw archiving
   ├─ V2 lands ──▶ PR 23      real auth, live surfaces  ──▶ D9 baseline clock starts
   └─ V1 lands ──▶ Phase 2    classification, signals, opportunities
```

The D9 twelve-week measurement window begins at **PR 23**, not at merge and not at PR 6.
The weeks 1–4 measured baseline requires PR 22 complete, or metrics will be missing from
the period whose entire purpose is to produce them.
