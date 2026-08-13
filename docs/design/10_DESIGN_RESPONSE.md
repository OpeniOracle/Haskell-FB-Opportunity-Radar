# Design Response 01 — Haskell Food & Beverage Opportunity Radar

Prepared in response to `00_CLAUDE_MASTER_PROMPT.md`
Baseline reviewed: package version 0.1 (2026-08-12)
Response version: **0.3** · Status: **for stakeholder review**

**Version 0.3 reconciles external research** (Gemini and Perplexity outputs supplied
2026-08-13) against this design. Every external claim was treated as untrusted input
requiring reconciliation; no external record entered a canonical table, and no migration
was created or applied. Full dispositions — 12 accepted, 5 accepted with modification,
4 already addressed, 8 rejected, 1 staging-only — are in
`14_EXTERNAL_RESEARCH_RECONCILIATION.md`. The material deltas landing in this document
are: a facility-identity source we had missed (FSIS MPI), a source that can never be built
(the FOIA-exempt FDA registry), EPA/permits sequencing resolved, operability containment
(§8.6) and a failure-injection suite (§8.7), evidence corrections as relationships rather
than overwrites (§6.10), a four-value scope vocabulary (§7.5), and a Phase 2 exit
criterion that no longer rests on a fixed 14-day window (§9).

**Version 0.2 is a design-reconciliation pass over 0.1.** It corrects two findings that
0.1 overstated, and deepens seven areas that were under-specified. Corrections:

1. **The PACK EXPO governance finding was wrong in kind.** The supplied "Pack Expo 2025
   Email List" sheet carries a Company column only — 519 populated rows, 183 unique
   company strings — and no names, email addresses, or other direct personal
   identifiers. The supplied XPressLeads export likewise contains no populated contact
   fields. Version 0.1 described this as "519 rows of personal data." It is not. It is
   **proprietary company-level engagement data**, which raises confidentiality and
   licensing obligations rather than privacy ones. Personal-data controls are retained as
   **conditional requirements** that activate if contact-level, badge-holder, email, or
   individual campaign data is ever ingested. See §2 C6 and §6.5.
2. **The EDGAR coverage count was unsupported.** Version 0.1 asserted that five of the
   fifteen pilot accounts file nothing with the SEC. That number was not verified.
   `docs/design/12_PILOT_SOURCE_COVERAGE_MATRIX.md` replaces it with a per-account matrix
   built from confirmed CIKs, with an explicit confidence label on every cell. The
   corrected finding is materially different and is summarized in §7.

Companion documents:

| Document | Contains |
| --- | --- |
| `12_PILOT_SOURCE_COVERAGE_MATRIX.md` | Verified per-account source coverage for all 15 Highest Value accounts |
| `13_GATE_1_DECISION_PACKET.md` | Every unresolved decision with default, alternatives, consequence, cost, owner, and timing |
| `11_SCHEMA_DELTA_PROPOSAL.sql` | Proposed schema delta. Not a migration; nothing has been applied |
| `14_EXTERNAL_RESEARCH_RECONCILIATION.md` | Disposition of every material external research finding, the research-claim staging contract, and the change register |

Every file in the package was read before this response was written: `README.md`,
`01`–`06`, `schemas/platform.schema.json`, `schemas/database.sql`,
`schemas/source-config.example.yaml`, `schemas/sample-opportunity.json`.

This is a design response. No production application code is proposed here. Schema
deltas, interface contracts, pseudocode, and wireframe descriptions appear only where
they resolve a design decision. The companion delta is
`docs/design/11_SCHEMA_DELTA_PROPOSAL.sql` — a **proposal**, not a migration.

---

## 1. What we are building

**A monitored-account intelligence system that turns public and licensed evidence into
a small number of evidence-backed, facility-anchored capital-project opportunities each
day, without an analyst in the loop.**

Four properties define it, and each one is a constraint on everything downstream:

1. **Evidence is the substrate, not the output.** The system stores what a source
   actually said, with URL, hash, retrieval time, and locator. Signals, opportunities,
   and trends are *assessments layered on top of* that record and are recomputable from
   it. Nothing is displayed that cannot be traced back to a retrievable document.
2. **The account is the company; the opportunity lives at the facility.** Haskell sells
   design and construction of physical plants. An opportunity that cannot name a site —
   or at least a plausible site region — is a lead, not an opportunity. Facility
   modeling is therefore load-bearing, not a nice-to-have.
3. **Priority and readiness are orthogonal.** Tier 1 and Highest Value describe *whose
   call we want to take*. Stage and confidence describe *whether a project exists*. The
   scoring model caps account strategy at 10 of 100 precisely so a marketing tier can
   never manufacture a project.
4. **The absence of news must be distinguishable from the failure to collect news.**
   This is the single requirement that most shapes the architecture. It forces run
   semantics, content hashing, freshness SLAs, anomaly detection, and a bounded operator
   surface — and it is why "just ask a model to search the web" is not an acceptable
   implementation.

What it is **not**: a CRM, a news reader, a lead-generation list, or a place where a
person types in what they read this morning. The current ChatGPT-and-spreadsheet
workflow is exactly the thing being replaced, and reproducing it with a nicer interface
would be a failure.

**Working definition of success for the pilot:** a business-development user opens Pulse
once a day, spends under ten minutes, and leaves with a short list of accounts and
facilities worth a phone call — and can defend each one with a link.

---

## 2. Conflict and gap register

The master prompt requires that conflicts and missing decisions be named explicitly
rather than silently resolved. Twenty-nine are listed: twenty-two from v0.1, of which
C2, C4, C5, C6, C7, C8, and C22 were revised in v0.2; three added by the v0.2 design
reconciliation (C23–C25); and four added by the v0.3 external-research reconciliation
(C26–C29). Each carries a proposed default; **none has been applied to the baseline
files, and no migration has been run.**

Severity: **B** = blocks implementation, **C** = correctness/compliance risk,
**D** = design decision that can be deferred but not ignored.

| # | Sev | Conflict or gap | Where | Proposed default |
| --- | --- | --- | --- | --- |
| C1 | B | `06` requires raw import records, organization *candidates*, engagement observations, and facility *candidates*. `database.sql` has none of these tables. There is no legal place to put an unresolved PACK EXPO row. | `06` §Required ingestion model vs `schemas/database.sql` | Add `import_batches`, `import_records`, `organization_candidates`, `engagement_observations`, `facility_candidates`. See §6.1. |
| C2 | B | "Missing dates must remain missing" vs `event_date date`. A source saying "in 2027" or "second half of next year" cannot be stored without inventing a month and day. The schema also cannot distinguish a date the source stated from one the system inferred. | `README` non-negotiables vs `database.sql`, `platform.schema.json` | Full temporal model: raw expression, start, end, precision (`exact_day`/`month`/`quarter`/`half_year`/`year`/`range`/`relative`/`unknown`), basis (`stated`/`inferred`), and an inference explanation when inferred. See §6.2. |
| C3 | B | `facilities.organization_id` is `not null` and singular, but `01` requires "Link multiple companies or brands to a facility when supported by evidence" (co-manufacturing, JV plants, multi-tenant cold storage). | `01` §Facility intelligence vs `database.sql` | Add `facility_organizations` (facility, org, role, evidence, dates). Keep a denormalized `primary_organization_id`. |
| C4 | C | Stage `confirmed` and confidence `confirmed` are different concepts with the same word. Worse, the single confidence enum conflates three independent questions: how good is the evidence, what kind of claim is this, and how sure are we. | `02` §Opportunity stages, §Confidence | Keep the lifecycle **Emerging / Developing / Confirmed** unchanged. Replace the confidence enum with three fields: **evidence strength** (indicative/corroborated/authoritative), **assessment type** (observed fact/inference/hypothesis), **confidence level** (low/moderate/high). See §6.4. |
| C5 | C | Broad news discovery (GDELT) vs "allowlisted HTTPS destinations." GDELT returns arbitrary publisher URLs; fetching their bodies is by definition off-allowlist. The model also has no way to record *how much* of a document we actually hold. | `00` constraints vs `03` §Initial source families | Five **evidence access modes**: structured primary, archived full text, licensed full text, reference-only, metadata-only. Promotion rules bar the last two from independently establishing authoritative evidence or a Confirmed opportunity. See §7.4. |
| C6 | D | **Corrected in v0.2.** The supplied event data is **proprietary company-level engagement data**, not personal data: the "Pack Expo 2025 Email List" sheet has a Company column only (519 rows, 183 unique strings), and the XPressLeads export's `UserAccount` and `DeviceLabel` columns are empty. No package file addresses confidentiality, licensing, or access control for third-party event data — nor does any file define what happens if contact-level data arrives later. | `06` Workbooks 1 and 2 | Govern as confidential third-party business data: access-controlled, licence-bounded, retention-bounded, not redistributable. Add **conditional** personal-data requirements that activate on first ingestion of contact, badge-holder, email, or individual campaign data. See §6.5. |
| C7 | C | `alerts` uniqueness is `(subscription_id, material_change_key)`, and `subscription_id` is nullable. In PostgreSQL, `NULL` values are distinct, so system-generated alerts can duplicate without limit. The key also omits recipient and channel, so the same person cannot be deduplicated across subscriptions or told once per channel. | `database.sql` | A **non-null** `alert_dedupe_key` composed of recipient + channel + target object + material-change fingerprint, unique on its own. See §6.6. |
| C8 | C | No idempotency key on `source_runs`, and no separation between a logical collection cycle and the retry attempts inside it. A scheduler retry or duplicate worker lease produces two runs for one slot; retries inflate run counts and corrupt the success rate that Phase 2 exit depends on. | `database.sql` | A **logical run** keyed `(source_id, collection_window_start)`, with `source_run_attempts` as child rows. Metrics computed per logical run; attempt counts reported separately. See §6.6. |
| C9 | C | `sources.schedule` is a bare cron string with no timezone. Freshness SLAs and "one scheduled cycle" become ambiguous across DST. | `database.sql`, `source-config.example.yaml` | All schedules UTC. Add `schedule_timezone` defaulting to `UTC`; render local time only in the UI. |
| C10 | D | `signals` can be org-less and facility-less only for `market_demand`, yet have no geography column. A regional demand signal has nowhere to record its region. | `database.sql` check constraint | Add `geo_scope` (`country_code`, `region`, `metro`) to `signals`. |
| C11 | D | `organizations.engagement jsonb` flattens PACK EXPO engagement into an untraceable blob, contradicting `06`'s requirement that every derived value trace to an import record. | `database.sql` vs `06` §Data-quality rules | Replace with `engagement_observations` rows; keep the jsonb only as a materialized rollup. |
| C12 | D | Unique index on `lower(canonical_name)` globally. Two legitimately distinct entities can share a name; the index forces a premature merge — the exact failure `06` warns against. | `database.sql` | Drop the global unique. Enforce identity through `organization_identifiers` and a deterministic `entity_key`; allow duplicates to exist pending resolution. |
| C13 | D | Tier is modeled as one value per organization, but the workbook assigns tier per **segment sheet** (Nestlé appears twice). | `06` §Curated target counts vs `database.sql` | `organization_segment_tiers (org, sector, tier, source_row)`; expose `effective_tier = max()` for alerting. |
| C14 | D | Enum drift: `platform.schema.json` enumerates sectors and capabilities; `database.sql` stores them as unconstrained `text[]`. Two sources of truth already disagree on `capability_alignment` minimum length (JSON requires ≥1 on opportunities, SQL does not). | both schemas | Reference tables + FK-backed arrays, and generate the JSON Schema from the SQL enums (or vice versa) in CI. |
| C15 | D | `confidence_multiplier` is pinned in a `check` constraint while `opportunity_score_snapshots.calculation_version` implies the formula is versioned. Changing the multiplier means a migration. | `database.sql` | Move multipliers and dimension caps into a `scoring_configs` table keyed by version; keep range checks only. |
| C16 | D | `signals.independent_source_count` vs `02`'s rule to count *independent organizations*, not articles. The column name invites the wrong implementation. | `02` §Corroboration rules vs `database.sql` | Rename to `independent_publisher_count`, add `independent_evidence_family_count`, and add an `evidence_families` table for syndication grouping (`signal_evidence.source_family_key` currently points at nothing). |
| C17 | D | `04` requires "changes since your last visit" and "material change summary," but the model stores only a `last_material_change_at` timestamp. There is no ledger of *what* changed and no per-user read state. | `04` §Pulse vs `database.sql` | Add `change_events` (append-only, typed, carries the alert dedupe key) and `user_read_state`. This single addition powers Pulse deltas, alert dedup, and the daily brief. |
| C18 | D | `01` requires a reason on dismissal; the model captures reasons only inside `manual_override`. Status transitions have no history. | `01` §Feedback vs `database.sql` | `opportunity_status_history (from, to, actor, reason_code, reason_text, at)`. Reason codes feed the false-positive metrics in `05`. |
| C19 | D | `market_trends.velocity` is constrained to [-1, 1] with no definition of how it is computed or over what window. Two implementations would produce different numbers. | `database.sql`, `04` §Trend card | Define velocity as the normalized change in independent-organization-weighted signal rate over a 30-day window vs the prior 90-day baseline; store `velocity_method` and `window_days`. |
| C20 | D | Pilot scope says 15 Highest Value accounts; the SEC source config ships `account_selection: highest_value_and_tier_1`; `03` lists Regulations.gov, which never appears in Phase 2. | `00`, `05` §Phase 2 vs `source-config.example.yaml`, `03` | Pilot = 15 accounts; Tier 1 loaded but not alerting. Regulations.gov deferred to Phase 4. |
| C21 | D | Robots/ToS handling is never mentioned. Neither is a crawl-delay or user-agent policy. | all | Add `robots_policy` and `user_agent` to the source contract; default to honoring robots for non-API methods and identifying the collector honestly. |
| C22 | D | Four of the fifteen Highest Value accounts are not Food & Beverage manufacturers, and the package has no vocabulary for saying so. Treating them as list errors would be wrong — they are on the list for commercial reasons — but treating them as core F&B produces misfiring signal families and unexplainable silence. | `05` §Pilot cohort vs `01` §Market coverage | Add an **account scope classification**: Core Food & Beverage / Adjacent Consumer Products / Strategic supplier or partner / Scope confirmation required. Applied in §7.5; Sherwin-Williams is flagged for confirmation, not assumed to be an artifact. |
| C23 | C | `05` §Acceptance metrics mixes connector reliability with intelligence quality, and Phase 2 exit leads with a 95% connector-success rate. Nothing in the package prevents "95% of runs succeeded" from being read as "we are covering the market." For four pilot accounts with no periodic filing coverage, both statements can be true while the account is effectively unmonitored. | `05` §Phase 2 exit, §Acceptance metrics | Separate **operational health** from **intelligence coverage** as independent metric families with independent thresholds, and require both in every exit gate. See §8.5. |
| C24 | C | Ownership is modeled as a single current pointer (`facilities.organization_id`, `organizations.parent_organization_id`). Verification found **four completed corporate reorganizations across the pilot cohort in roughly twenty months, with two more in flight** — Mars/Kellanova, Nestlé Waters→BlueTriton→Primo Brands, Unilever's ice-cream demerger, KDP/JDE Peet's plus its planned split, and Kimberly-Clark/Kenvue pending. A current-state pointer silently misattributes projects after every one. | `12_PILOT_SOURCE_COVERAGE_MATRIX.md` vs `database.sql` | Time-bounded, evidence-backed relationships: `facility_organizations` and `organization_relationships` both carry `from_date`, `to_date`, and `evidence_id`. Attribute a project to the operator **as at the event date**, not as at query time. |
| C25 | C | The replay cache proposed in v0.1 was keyed on content hash, prompt version, model, and schema version. That key is incomplete: taxonomy version, extractor version, system instructions, model parameters, and injected structured context all change the output while leaving the key unchanged, so a stale result would be served as if fresh. | v0.1 §4.3, ADR 0003 | Key on **every effective input**. A cache entry stores the full input fingerprint and its components. See §6.7 and ADR 0003. |
| C26 | C | No way to record that **evidence itself** was corrected, retracted, or withdrawn. v0.2 handles negative *signals* (closures, cancellations) but not a source reissuing or retracting a document — so a corrected attribution or an expanded recall has nowhere to live. | External research E11 vs `database.sql` | Typed relationships — `corrects`, `retracts`, `withdraws`, `contradicts`, `supersedes`, `delays`, `cancels` — with the presented view **computed** from correction status, authority, specificity, and applicability. Never an overwrite. See §6.10, ADR 0012. |
| C27 | C | Novelty and staleness anomalies are evaluated against trailing runs with no per-source expectation. A state incentive board that posts twice a quarter is judged like a news feed, so it looks broken when it is idle and healthy when it has silently died. | `03` §Required anomaly detection | Per-source `expected_cadence` and observed `baseline_yield`; anomalies evaluated against that source's own history. See §8.6. |
| C28 | C | Nothing bounds *outbound* alert volume. The change ledger and dedupe key prevent duplicates, but a classifier regression produces alerts that are each well-formed, correctly deduplicated, and wrong — and all of them ship. | `04` §Alerts vs `10` §6.6 | Outbound-alert circuit breaker: quarantine the notification queue **before delivery** when volume exceeds a multiple of its moving average, and pin the inference version. See §8.6. |
| C29 | D | No terminal state for a message that can never succeed. v0.2 has retries with jitter and per-document isolation, but a permanently malformed document retries until a human notices. | `03` §Retry, external research E10 | Bounded retries → **parked queue** → circuit-breaker state recorded on the source; parked messages drained by deliberate replay, never automatic redelivery. See §8.6. |

---

## 3. Traceability matrix

Business goal → product capability → data requirement → acceptance evidence. Every row
is testable; rows without a test are not in the MVP.

| ID | Business goal | Product capability | Data requirement | Acceptance evidence |
| --- | --- | --- | --- | --- |
| G1 | Stop losing capital projects to late awareness | Daily Pulse of new/changed opportunities ranked by pursuit score | `opportunities`, `change_events`, `opportunity_score_snapshots` | Pulse shows every opportunity whose stage, confidence, score band, or evidence set changed since the user's last visit; verified against a seeded change set |
| G2 | Make every claim defensible in front of a client | Evidence drawer on every card and detail page | `evidence` (URL, hash, `retrieved_at`, excerpt, locator), `signal_evidence` | Zero displayed opportunities with an empty evidence set; automated invariant test, not a spot check |
| G3 | Replace manual report compilation | Auto-generated daily and weekly briefings | `change_events`, `opportunities`, `market_trends`, `source_health_events` | Briefing produced with no human input; content diffable against the underlying query results |
| G4 | Focus effort on the accounts we can win | Tier and Highest Value as a *bounded* score dimension | `organization_segment_tiers`, `engagement_observations` | Score audit: no opportunity reaches "pursue-band" on account strategy alone; property test over the scoring function |
| G5 | Anchor pursuit to real plants | Facility-level opportunity and map | `facilities`, `facility_organizations`, `opportunity_facilities`, geocodes | ≥70% of Confirmed-stage pilot opportunities carry a resolved facility or a named city; the rest are explicitly labeled "site unknown" |
| G6 | Trust the feed | Source health visible within one cycle | `source_runs`, `source_health_events`, freshness SLA | Injected failure surfaces in Source Health and in the next brief within one scheduled cycle; measured, not asserted |
| G7 | Operate without analysts | Bounded Connector Care actions only | `sources.operator_intervention`, `source_health_events.action_required` | Zero Connector Care tasks that ask a human to read, copy, or re-key content; enforced by task-type allowlist |
| G8 | Don't mistake buzz for a project | Trend and Opportunity as separate objects with separate surfaces | `market_trends`, `market_trend_signals` | No trend renders in an opportunity list; usability test confirms users describe the difference unprompted |
| G9 | Keep negative news | Negative signals reduce or close, never delete | `signals.negative_signal`, `opportunity_signals.signal_role`, `opportunity_status_history` | Seeded closure/layoff evidence demonstrably lowers momentum and can move status to `on_hold`/closed, with the evidence still visible |
| G10 | Don't merge the wrong companies | Conservative entity resolution with durable approved mappings | `organization_identifiers`, `organization_aliases`, `organization_candidates`, resolution confidence | Ambiguous candidates remain unresolved; adversarial name set (Mars, Nestlé, Coca-Cola bottlers) resolves correctly or not at all |
| G11 | Reuse the kernel for other Haskell markets | Ingestion/evidence/resolution/observability separated from F&B ontology | Module boundary; ontology in reference tables, not code | A second market can be configured by adding sources + vocabularies, with no change to collection or evidence modules |
| G12 | Stay inside licensing and confidentiality limits | Access mode, licence mode, and retention per source; conditional controls if contact-level data ever arrives | `sources.license_mode`, `retention_days`, `evidence.access_mode`, `data_sensitivity_class` | Reference-only and metadata-only evidence never store or render full text; retention job proven on a licensed-source fixture; ingesting a contact-level field without an approved lawful basis fails closed |
| G13 | Know what we are *not* covering | Expected-coverage model per account and source family, reported beside connector health | `account_source_expectations`, coverage and discovery-yield metrics | An account with healthy connectors but zero expected-source coverage is reported as **uncovered**, not as quiet; verified against the four no-filing-coverage pilot accounts |
| G14 | Survive corporate reorganization | Time-bounded, evidence-backed ownership | `facility_organizations`, `organization_relationships` with `from_date`/`to_date`/`evidence_id` | Replaying the Mars–Kellanova and Nestlé Waters–Primo Brands transitions attributes each project to the operator as at the event date, not as at query time |

---

## 4. System architecture

### 4.1 Shape recommendation

**Recommended default: a modular monolith with three isolated runtimes, on PostgreSQL,
with a hard network boundary at the egress gateway.** Not microservices.

The justification is operational, not aesthetic. The pilot's expected volume — 15
accounts across roughly 8 source families — is on the order of **hundreds to a few
thousand documents per day**. That is three to four orders of magnitude below where a
message bus and independently deployed services pay for themselves. Meanwhile `00`
states there is no dedicated analyst team, and `05` does not name a platform team
either. A twelve-service deployment would create an operational burden larger than the
manual reporting process being replaced.

The bounded modules from `03` §Deployment recommendation are preserved as **enforced
module boundaries with explicit interfaces** — separate schemas, no cross-module table
reads, interaction through typed calls and outbox events — so any module can be
extracted into its own service later without a rewrite. Two boundaries are *physical*
from day one because they are security boundaries, not scaling ones.

```
                       ┌───────────────────────────────────────────┐
   users ──────────────▶  Runtime A: Web app + API (BFF)            │
                       │  Pulse · Opportunities · Accounts · Map    │
                       │  Briefings · Admin · Ask (NL query)        │
                       └───────────────┬───────────────────────────┘
                                       │ typed calls
                       ┌───────────────▼───────────────────────────┐
                       │  Runtime B: Worker pool (no inbound net)   │
                       │  scheduler · connectors · extraction/OCR   │
                       │  resolution · classification · clustering  │
                       │  scoring · change/notify · briefs          │
                       └───┬───────────────┬───────────────┬───────┘
                           │               │               │
              ┌────────────▼───┐  ┌────────▼────────┐  ┌───▼──────────────┐
              │ PostgreSQL     │  │ Object store    │  │ Model Gateway    │
              │ system of      │  │ raw evidence    │  │ schema-locked    │
              │ record + queue │  │ WORM + retention│  │ replay-cached    │
              └────────────────┘  └─────────────────┘  └───┬──────────────┘
                                                            │
                       ┌────────────────────────────────────▼───────────┐
                       │  Runtime C: Egress Gateway (only egress path)   │
                       │  allowlist · DNS/IP pinning · redirect policy   │
                       │  size+MIME caps · rate limits · robots · audit  │
                       │      └── Browser Worker sandbox (approved only) │
                       └─────────────────┬──────────────────────────────┘
                                         ▼
                                  public internet
```

### 4.2 Service boundaries and contracts

| Boundary | Owns | Must not | Key contract |
| --- | --- | --- | --- |
| **Egress Gateway** (physical) | *All* outbound HTTPS. Allowlist, DNS resolution + IP-range denial (SSRF), redirect policy, byte/MIME caps, per-host rate limits, robots policy, request/response audit | Never proxies an arbitrary URL supplied at runtime without a source-scoped policy | `fetch(source_id, url, policy) → {status, headers, bytes, resolved_url, redirect_chain, timing}` |
| **Browser Worker** (physical, inside C) | Rendering for explicitly approved sources only | Never holds long-lived credentials; never used as a general fallback; never automates CAPTCHA | Same contract as gateway fetch, plus `render_policy` |
| **Source Registry & Scheduler** | Source config as code (YAML in git) projected into `sources`; emits run intents | Never mutates evidence | Run intent keyed `(source_id, scheduled_for)` — idempotent |
| **Connector Workers** | One worker per *collection method*, not per source. Discovery, conditional GET (ETag/Last-Modified), checkpointing, partial-success accounting | Never writes signals or opportunities | Emits `evidence` rows + raw bytes; returns a run status from the seven-state enum |
| **Evidence Store** | Immutable raw bytes + `evidence` rows; retention and license tags | Never overwritten; deletion only via retention policy | Write-once; `(source_id, content_hash)` idempotent |
| **Extraction & OCR** | Sandboxed, per-document isolation, native-PDF-before-OCR, locators, versioned extractors | No network except through the gateway | `extract(evidence_id, extractor_version) → {text_uri, locators, status}`; deterministic for a given version |
| **Entity Resolution** | Deterministic identifiers → aliases → domains → addresses → blocked fuzzy scoring; durable approved mappings | Never auto-merges on name similarity alone; never assigns ambiguity to the biggest name | `resolve(mention, context) → {org_id?, facility_id?, confidence, method, candidates[]}` — returning *unresolved* is a valid success |
| **Model Gateway** (logical, strict) | Sole path to any LLM. Schema-constrained output, prompt/version registry, cost and rate limits, redaction, full call audit, **replay cache keyed by `(content_hash, prompt_version, model, schema_version)`** | Never performs retrieval; never sees a URL it is asked to fetch | `infer(task, inputs, schema, prompt_version) → {output, provider, model, prompt_version, schema_version, cached, processed_at}` |
| **Classification & Clustering** | Signal family/event type, capability alignment, dedupe, evidence families | Never invents dates or amounts absent from evidence | Pure function of evidence + versions → signals |
| **Scoring & Promotion** | Versioned rules; component scores + explanation; promotion and demotion | Never mutates evidence or signals | Pure function of stored state → score snapshot + `change_events` |
| **Change & Notification** | Material-change ledger → alerts, digests, briefs; per-user dedupe | Never derives new facts | `change_event → alert?` with a stable dedupe key |
| **Query & Search** | Postgres FTS + `pgvector` for candidate generation and NL query grounding | Never answers from model memory | Every answer returns applied filters + record IDs + coverage caveats |

### 4.3 Three architectural decisions worth arguing about

**The Model Gateway replay cache.** `00` requires that important classifications be
reproducible from stored evidence, and `03` requires deterministic reprocessing. LLMs
are not deterministic. The resolution is to make the *system* deterministic even when
the model is not: cache every inference keyed by content hash plus prompt and schema
version. Re-running the pipeline over unchanged evidence then returns byte-identical
classifications at near-zero cost, and a prompt-version bump becomes an explicit,
auditable, budgeted reprocessing event. This is what makes "a second run against
unchanged content must not create duplicate alerts" true by construction rather than by
careful coding.

**The egress gateway as the only network path.** SSRF protection, allowlists, redirect
policy, rate limiting, and robots compliance are stated in `03` as properties of the
system. Properties enforced in many places are enforced in none. One chokepoint, with
every other component network-isolated, converts a policy into a mechanism — and
produces the HTTP telemetry that Source Health needs for free.

**Postgres as queue and system of record.** Transactional outbox plus a
Postgres-backed queue means an evidence write and its downstream job enqueue commit
together. At pilot volume this removes an entire class of "the row exists but the job
never ran" bugs, and removes a broker from the operational surface. Revisit if sustained
throughput exceeds roughly 50 documents per second, which the pilot will not approach.

### 4.4 Runtime responsibilities in detail

#### Runtime A — Application

Owns HTTP request/response for users, session and authorization, read models, and
write-side commands for *human* decisions (status change, assignment, dismissal with
reason, saved views, subscriptions, source approval, Connector Care completion).

It performs **no collection, no extraction, no scoring**. Its only writes are
user-intent writes plus their audit events. This is what keeps a slow model call or a
runaway extraction from ever degrading page latency.

#### Runtime B — Workers

Owns everything scheduled or event-driven. Internally partitioned into **queue classes**
with separate concurrency limits, so one saturated stage cannot starve the others:

| Queue class | Work | Concurrency posture | Failure isolation |
| --- | --- | --- | --- |
| `collect` | Connector runs and attempts | Bounded per source *and* per host | One attempt fails, the logical run continues |
| `extract` | HTML, PDF, OCR | Bounded by CPU; OCR on its own sub-queue | **Per-document isolation** — one malformed PDF fails one document |
| `resolve` | Entity resolution | Moderate | Unresolved is a success, not a retry |
| `classify` | Model-backed classification | Bounded by model-gateway rate limit and budget | Schema violation → retry → quarantine, never a silent write |
| `score` | Promotion, scoring, change events | Low concurrency, ordered per opportunity | Serialized per object to avoid lost updates |
| `notify` | Alerts, digests, briefs | Low | Dedupe key makes retry safe |
| `maintain` | Retention, rollups, health rollups, reprocessing | Lowest priority | Preemptible |

#### Runtime C — Egress and browser sandbox

Owns all outbound network access and nothing else. It holds no application database
credentials and cannot write evidence; it returns bytes and telemetry to Runtime B.

### 4.5 Transaction and queue boundaries

The rule is one sentence: **a database transaction never spans a network call, and a job
is never enqueued outside the transaction that produced its cause.**

```text
  connector attempt completes
        │
        ▼
  ┌─────────────────────────────────────────── single transaction ──┐
  │ insert evidence row (idempotent on source_id + content_hash)     │
  │ update source_run_attempt + logical run metrics                  │
  │ insert outbox row: evidence.captured                             │
  └──────────────────────────────────────────────────────────────────┘
        │  commit
        ▼
  outbox relay (at-least-once) ──▶ extract queue ──▶ … ──▶ score ──▶ notify
```

**Outbox behavior.** The relay polls committed outbox rows, publishes to the queue, and
marks them dispatched. Delivery is at-least-once, so every consumer is idempotent on a
natural key — evidence on `(source_id, content_hash)`, signals on cluster key, change
events on `(object_type, object_id, dedupe_key)`, alerts on `alert_dedupe_key`. Ordering
is guaranteed only per object, which is why the `score` queue serializes per opportunity.

Raw bytes go to object storage **before** the transaction commits, and the row references
them. A crash between the two leaves an orphaned object, which the `maintain` queue
reaps — the safe direction. The reverse order would leave a row pointing at nothing.

**Failure isolation summary.** An attempt failure degrades a logical run to
`partial_success`. A logical-run failure degrades a source to `degraded`, then
`action_required` at the configured thresholds, and backs off its schedule so a dead
source stops consuming the shared per-host rate budget. A model-gateway outage stalls the
`classify` queue while `collect` and `extract` keep filling the corpus — collection never
depends on inference availability.

### 4.6 How one gateway serves five collection modes

The egress gateway is not an HTTP client wrapper; it is a policy engine with five
execution profiles over one audited contract.

| Mode | Gateway behavior | Returns | Notes |
| --- | --- | --- | --- |
| **API / structured** | Signed or keyed request, pagination cursor honored, JSON size cap, schema pre-validation before hand-back | Parsed records + raw response | Credentials injected at the gateway, never held by the connector |
| **Reference-mode discovery** | Fetches only the *discovery* endpoint (e.g. GDELT). **Publisher URLs discovered inside the payload are not fetched** unless independently allowlisted | Metadata + link + provided snippet | This is the mechanism, not a convention — the connector cannot fetch what the gateway refuses |
| **Document** | Conditional GET, MIME allowlist, byte cap, streams to object storage, hashes in flight | Storage URI + hash + headers | Content-type mismatch is a rejection, not a warning |
| **OCR path** | Same as document, then the sandboxed OCR worker runs with **no network at all** | Text + page locators | Native PDF text is always attempted before OCR |
| **Constrained browser** | Approved sources only, fixed navigation budget, no long-lived credentials, no third-party requests off the allowlist, full navigation trace recorded | Rendered DOM snapshot + trace | Never a generic fallback; a permitted CAPTCHA routes to an operator, never to an automated solver |

Every mode emits the same telemetry envelope, so Source Health treats a browser-rendered
page and an API call identically for reliability accounting.

---

## 5. Information architecture and page map

### 5.1 Navigation

Primary (as specified in `04`): **Pulse · Opportunities · Accounts · Market Trends ·
Map · Briefings**. Secondary: Alerts & Subscriptions, Saved Views, Administration
(Source Health, Connector Care, Source Registry, Imports, Audit), Settings.

Facilities intentionally have no top-level entry — they are reached from Accounts,
Opportunities, and Map, matching `04` §Facilities. A global **Ask** control (NL query)
sits in the header rather than in the nav, because it is a lens over existing data, not
a destination.

### 5.2 Page map

| Route | Page | Primary question | Notable states |
| --- | --- | --- | --- |
| `/` | **Pulse** | What changed, what matters, where do I focus? | First visit (no delta baseline); quiet day; **degraded coverage banner** |
| `/opportunities` | Opportunity queue | What is worth pursuing right now? | Empty filter result vs. no data at all — visually distinct |
| `/opportunities/:id` | Opportunity detail | Is this real, and what do I do? | Manually overridden; dismissed-with-reason; closed by negative signal |
| `/accounts` | Account list | Which accounts are active? | Coverage-incomplete badge |
| `/accounts/:id` | Account detail | What is the full story on this account? | No facilities resolved yet; engagement-only account |
| `/facilities/:id` | Facility detail | What is happening at this site? | **Candidate facility** (uncorroborated address) — visually distinct from confirmed |
| `/trends` · `/trends/:id` | Market Trends | What is moving in the market? | Explicitly labeled "not an account opportunity" |
| `/map` | Map | Where is activity concentrated? | Clustered; synchronized accessible list always present |
| `/briefings` · `/briefings/:date` | Briefings | Give me the summary | Generation failed → shows partial brief plus what was missing |
| `/alerts` | Alerts & subscriptions | What am I told about? | Muted; digest paused |
| `/views` | Saved views | My working lists | — |
| `/admin/sources` | Source registry | What are we collecting? | Draft / dry-run required / enabled |
| `/admin/health` | Source Health | What is broken and what does it cost us? | Healthy / degraded / action required / disabled / unsupported |
| `/admin/care/:taskId` | Connector Care | One bounded action | Test → resume → confirm recovery |
| `/admin/imports` | Import batches | What did the workbooks produce? | Unresolved candidates queue |
| `/admin/audit` | Audit log | Who or what changed this? | — |

### 5.3 Two IA decisions

**Opportunity detail is a page with a drawer preview, not a drawer alone.** `04`
describes opening a detail drawer from a card. Drawers are right for a 5-second triage
glance; they are wrong for the evidence, score explanation, timeline, and audit history
`04` also requires. Default: card → drawer (summary, evidence count, score components,
four actions) → "Open full detail" for the complete record. Deep links always resolve
to the full page so a brief or Teams alert lands somewhere shareable.

**Coverage honesty is a first-class UI element, not an admin screen.** Under `04`'s
requirement to state when coverage is incomplete, a source failure must be visible where
the decision is made. Pulse carries a compact coverage indicator; any filtered view
whose source coverage is degraded shows an inline band naming the affected accounts or
geographies. Without this, a silent connector failure reads to a user as "quiet week."

---

## 6. Data model review

The baseline model is sound in its core structure: the Evidence → Signal →
Opportunity/Trend separation is correct, the seven-state run enum is right, score
components are stored alongside the result, and score snapshots are versioned. The
recommended changes fall into three groups.

### 6.1 Group 1 — Missing tables that block Phase 1 (C1, C3, C11, C17, C18, C24)

`06` specifies an ingestion model the SQL cannot express. Phase 1 cannot start without
these.

```text
import_batches(id, source_filename, sheet_inventory, file_hash, row_count,
               imported_at, imported_by, transformation_version)
import_records(id, batch_id, sheet_name, source_row_number, original_values jsonb,
               record_hash)                       -- raw row JSON, never edited
organization_candidates(id, import_record_id, original_string, normalized_string,
               resolved_organization_id NULL, resolution_state, resolution_confidence,
               resolution_method, transformation_version, resolved_at, resolved_by)
                                                  -- may stay unresolved forever
approved_entity_mappings(id, normalized_string, scope, organization_id, facility_id,
               approved_by, approved_at, evidence_id, active)
                                                  -- durable rule; survives re-import
engagement_observations(id, organization_candidate_id, organization_id NULL,
               event_name, event_year, declared_interests text[], industry_response,
               company_role_response, address_candidate jsonb, repeat_count,
               import_record_id, transformation_version)
facility_candidates(id, address jsonb, organization_candidate_id, source_kind,
               corroboration_status, corroborating_evidence_id, promoted_facility_id NULL)
                                                  -- event address stays a candidate
facility_organizations(facility_id, organization_id, relationship, evidence_id,
               from_date, to_date)                -- C3 + C24: time-bounded operators
organization_relationships(parent_id, child_id, relationship, evidence_id,
               from_date, to_date)                -- C24: reorganizations
change_events(id, object_type, object_id, change_type, from_state jsonb, to_state jsonb,
              materiality, dedupe_key, occurred_at)   -- C17: powers Pulse + alerts
user_read_state(user_id, surface, last_seen_at)
opportunity_status_history(id, opportunity_id, from_status, to_status, actor_type,
              actor_id, reason_code, reason_text, occurred_at)   -- C18
evidence_families(id, family_key, origin_evidence_id, detection_method)  -- C16
```

Two properties matter more than the table list. **Every derived row carries
`transformation_version`**, so a normalization-rule change is a versioned reprocessing
event and `06`'s requirement that every derived value trace to its import record and
transformation version becomes checkable. And **`approved_entity_mappings` is the durable
rule store** — a human resolution decision must survive re-import, re-normalization, and
extractor upgrades, or the unresolved queue regenerates the same work forever.

**Event addresses never become facilities directly.** A `facility_candidate` promotes to
a `facility` only when a company, regulatory, permit, mapping, or official facility source
corroborates it, and the corroborating evidence is recorded on the promotion.

`change_events` deserves emphasis: it is one table that simultaneously satisfies "what
changed since my last visit" (Pulse), "material change summary" (card), alert
deduplication, and the daily brief. Without it, three features each grow their own
half-correct diffing logic.

### 6.2 Group 2 — The temporal model (C2)

This is the change with the widest blast radius, because it is a stated non-negotiable
the current schema cannot honor. `event_date date` forces "production begins in 2027"
to be stored as `2027-01-01`, and offers no way to tell a date the source stated from one
the system worked out.

Six fields replace one, on `evidence`, `signals`, and facility open/close dates:

```sql
temporal_raw_expression  text,     -- verbatim: "in the second half of 2027"
temporal_start           date,     -- 2027-07-01  (interval start, not "the date")
temporal_end             date,     -- 2027-12-31  (interval end)
temporal_precision       text not null default 'unknown',
temporal_basis           text not null default 'unknown',
temporal_inference_note  text      -- required when basis = 'inferred'
```

**Precision** — `exact_day`, `month`, `quarter`, `half_year`, `year`, `range`,
`relative`, `unknown`. `relative` covers "within eighteen months of closing," where the
anchor is another event rather than a calendar position; the raw expression is preserved
and the interval is only computed once the anchor resolves.

**Basis** — `stated` when the source gives the timing, `inferred` when the platform
derived it. Inference is permitted; **silent inference is not**. When basis is
`inferred`, `temporal_inference_note` must say what it was inferred from, and the UI
labels it as an inference rather than a source fact.

The three consequences that make this worth the cost:

1. **Queryable without fabrication.** "What might start in 2027?" is
   `temporal_start <= '2027-12-31' and temporal_end >= '2027-01-01'` — an interval
   overlap. The record answers the query without ever claiming January 1.
2. **The UI renders the truth.** "Expected 2027" and "expected H2 2027 (inferred from
   the announced eighteen-month build)" are different strings, and a user pursuing a
   project can see which one they are relying on.
3. **Scoring stops being falsely precise.** Timing and momentum consume interval width
   and basis; a year-precision inferred date cannot score like a stated, dated
   groundbreaking.

Storing an interval rather than a point is the part that does the work. A point plus a
precision label still tempts every consumer to read the point.

### 6.3 Group 3 — Correctness changes (C9, C10, C12, C15, C16)

Timezone-explicit schedules; geographic scope on market-demand signals; removal of the
global unique index on lowercased company name; scoring multipliers moved out of a check
constraint; and the evidence-family model that makes corroboration count independent
publishers rather than syndicated copies. Each is small; each is load-bearing for a
stated requirement. Idempotency (C7, C8) is treated separately in §6.6.

### 6.4 The three axes that replace `confidence` (C4)

`02` uses one enum — Possible / Probable / Confirmed — to answer three questions at
once, and reuses the word "Confirmed" for a lifecycle stage. Splitting it costs one
column and removes a permanent source of confusion.

**The lifecycle is unchanged: Emerging → Developing → Confirmed.** It describes the
*project*: does one credible leading indicator exist, is it forming, or has an
authoritative source established it. It is a property of the world, and it stays the
plain-language vocabulary users already have.

The three new fields describe our *knowledge* of that project:

| Field | Values | Answers | Set by |
| --- | --- | --- | --- |
| **Evidence strength** | `indicative` · `corroborated` · `authoritative` | How good is the record? | Deterministic rules over evidence: access mode, source authority, count of independent evidence families and organizations |
| **Assessment type** | `observed_fact` · `inference` · `hypothesis` | What kind of claim is this? | The classifier, from whether the evidence states the claim, supports it indirectly, or merely suggests it |
| **Confidence level** | `low` · `moderate` · `high` | How sure are we, all things considered? | Derived from the first two, plus corroboration, recency, and resolution confidence — overridable with a reason |

**How they interact without duplicating meaning.** Evidence strength is a property of
*documents*; it can be computed without reading the claim. Assessment type is a property
of the *claim's relationship to those documents*; the same authoritative filing supports
an observed fact ("capex of $X is allocated") and an inference ("therefore a plant
project is likely") at very different reliability. Confidence level is the *composite*,
and it is the only one of the three that scoring consumes directly.

The combinations that are individually legal but jointly meaningful are the point:

- *Authoritative + observed fact + high* — a company announced the project. Promote.
- *Authoritative + inference + moderate* — the filing is unimpeachable, our reading of it
  is not. This is the combination that most often produces a false Confirmed today.
- *Indicative + hypothesis + low* — a lead. Real, worth watching, must never page anyone.
- *Corroborated + observed fact + high* — two independent publishers report the same
  stated fact. The workhorse combination.

**Guardrails.** Confidence level is capped at `moderate` when assessment type is
`inference`, and at `low` when it is `hypothesis` — regardless of evidence strength. An
opportunity cannot reach the **Confirmed** stage without at least one supporting signal
that is `authoritative` + `observed_fact`. The confidence multiplier in the scoring
formula keys off confidence level, so `02`'s 0.60 / 0.80 / 1.00 semantics carry over
intact with `low` / `moderate` / `high` in place of Possible / Probable / Confirmed.

### 6.5 Event-data governance, corrected (C6)

The supplied workbooks contain **no personal data**. The engagement sheet has a Company
column only; the XPressLeads export's person-oriented columns (`UserAccount`,
`DeviceLabel`) are empty, and `TerminalID` holds two manual-import identifiers that are
provenance, not people.

What the data *is*: **proprietary, third-party, company-level engagement information**,
obtained through event participation and a lead-retrieval product. The obligations that
attach to it are confidentiality, licensing, and access control — not privacy:

- **Confidentiality.** It reveals Haskell's targeting and campaign strategy. It is
  internal-only, not redistributable, and must not appear in any exported briefing that
  could leave the organization.
- **Licensing.** Event lead-retrieval data typically carries contractual restrictions
  from the event organizer on retention, resale, and use. This is a real review item and
  it replaces the privacy review v0.1 called for.
- **Provenance.** Declared interests are self-reported at a trade show. `02` already
  says PACK EXPO activity raises account relevance but never project maturity; that rule
  stands unchanged and is the substantive control.
- **Retention.** Bounded by whatever the event agreement permits, tracked per import
  batch.

Sources and evidence therefore carry a `data_sensitivity_class`
(`public` · `licensed` · `confidential_internal` · `restricted_personal`), and the event
imports land as `confidential_internal`.

**Conditional personal-data requirements.** These are specified now and dormant until
triggered. Any of the following activates them: contact names, email addresses, phone
numbers, badge-holder or scan records, job titles tied to a named individual, or
individual-level campaign engagement (opens, clicks, video completions attributed to a
person).

On trigger, and *before* the first such row is stored:

1. Personal fields are stored only in a `contact_records` table classified
   `restricted_personal`, encrypted at rest, with access control independent of the
   Radar's own roles.
2. A lawful basis and a retention expiry are recorded per record; ingestion **fails
   closed** without them.
3. No personal field is reachable from any Radar API surface, briefing, export, or
   model prompt. Engagement continues to be modeled at organization grain.
4. Deletion and subject-access paths exist before ingestion, not after.
5. Legal and marketing-operations review is a gating step, not a follow-up.

The distinction matters practically: today's obligation is a contract review, and it
should not be presented to stakeholders as a privacy incident.

### 6.6 Idempotency, repaired (C7, C8)

Two defects, both of which corrupt numbers the pilot is judged on.

**Alerts.** The dedupe key becomes non-null and self-sufficient, composed of every
dimension that makes two notifications genuinely the same notification:

```text
alert_dedupe_key = hash(recipient_key, delivery_channel, target_type, target_id,
                        material_change_fingerprint)

material_change_fingerprint = hash(change_type, from_state_digest, to_state_digest,
                                   scoring_version)
```

Recipient rather than subscription, so one user matching through three saved views is
told once. Channel included, so the same person may legitimately get a Teams alert and
appear in tomorrow's email digest. Scoring version included, so a deliberate rescoring
run can re-notify without a schema change, while an unchanged recomputation cannot.

**Source runs.** A **logical run** is one collection cycle for one source and one
scheduled window; **attempts** are the tries inside it:

```text
source_runs(id, source_id, collection_window_start, collection_window_end, status, …)
  unique (source_id, collection_window_start)
source_run_attempts(id, source_run_id, attempt_number, started_at, completed_at,
                    status, error_code, http_status_distribution, …)
```

Metrics are computed **per logical run**: the success rate that Phase 2 exit depends on
counts logical runs, never attempts, so a source that succeeds on its third try is one
success, not two failures and a success. Attempt-level metrics are reported separately
and are the more useful reliability signal — *attempts per successful run* is what tells
an administrator a source is degrading before it starts failing outright.

### 6.7 Replay cache key, corrected (C25)

The v0.1 key — content hash, prompt version, model, schema version — was incomplete, and
an incomplete cache key is worse than no cache: it serves stale output as if it were
fresh. The key covers **every effective input**:

```text
replay_key = hash(
    content_hash,                -- the evidence bytes
    preprocessing_version,       -- extractor/OCR version that produced the text
    task,                        -- extract | classify | align | summarize | cluster
    provider, model,             -- provider-side identity
    model_parameters,            -- temperature, top_p, max_tokens, seed, tool config
    system_instructions_hash,    -- the system prompt, not just its label
    prompt_version,              -- the task prompt template version
    schema_version,              -- the output contract
    taxonomy_version,            -- sectors, capabilities, families, event types
    structured_context_digest    -- injected account/facility/prior-signal context
)
```

`structured_context_digest` is the one most easily forgotten and the most dangerous:
classification prompts include resolved account and facility context, so the same article
legitimately classifies differently once a facility resolves. Without it in the key, the
cache would pin the pre-resolution answer forever.

Each cache row stores the components as well as the hash, so a version bump can be scoped
precisely — "reprocess everything affected by taxonomy v3" is a query, not a full
recompute.

### 6.8 Ontology and configuration (C13, C14, C19, C22)

Move sectors, capabilities, signal families, event types, and scoring configuration out
of `check` constraints and into versioned reference tables with FK enforcement. Three
reasons: `05` requires a reusable market module for other Haskell departments (G11), and
an ontology welded into `check` constraints cannot be reconfigured; `event_type` is
currently free text with no vocabulary at all, which will produce dozens of spellings of
"plant expansion" within a month; and scoring weights will change during the pilot —
that must be a config version bump with recomputable snapshots, not a migration.

### 6.9 What I recommend keeping unchanged

Named explicitly, because `README` asks that defined requirements not be silently
replaced: the seven run statuses, **the three-stage Emerging / Developing / Confirmed
lifecycle**, the five scoring dimensions and their caps, the confidence multipliers
(0.60 / 0.80 / 1.00), the ten opportunity statuses, the nine signal families, and the
eighteen organization roles all stand.

The C4 change is **additive, not a replacement of the lifecycle**: stage names are
untouched, and the multipliers keep their values — they simply key off `confidence_level`
(low / moderate / high) instead of a single overloaded enum. The promotion rules,
corroboration rules, and the account-strategy cap of 10 in `02` are unchanged.

### 6.10 Corrections, retractions, and supersession (C26)

Sources correct themselves. A release is reissued attributing an expansion to an
independent bottler rather than the brand owner; a recall is expanded; a 2027 project is
delayed and then cancelled. v0.2 handled negative *signals* but had no way to record that
**the evidence itself** changed status.

Seven typed relationships carry it — `corrects`, `retracts`, `withdraws`, `contradicts`,
`supersedes`, `delays`, `cancels` — and **claims stay immutable**. The presented view is
computed in this order:

1. **Correction status** — retracted or withdrawn claims leave the presented view while
   remaining readable.
2. **Source authority** — primary over official secondary over secondary.
3. **Specificity** — a claim naming a facility outranks one naming a region.
4. **Temporal applicability** — which claim applies at the event date (§7.1a).
5. **Recency** — the final tiebreak, never the first test.

The external automation review proposed the opposite: newer documents automatically
overwriting older conflicting properties. That is rejected in both directions it fails.
Overwriting destroys the audit trail the evidence-first principle exists to protect — the
moment a user asks "why did you tell me this last month," the answer is gone. And recency
is not authority: a syndicated aggregator publishing Thursday is newer and weaker than the
company's own Tuesday release. See ADR 0012.


---

## 7. Source-coverage strategy for the pilot cohort

### 7.1 The corrected finding

**Version 0.1 claimed that five of the fifteen pilot accounts file nothing with the SEC.
That number was asserted, not verified. It is replaced here.**

`docs/design/12_PILOT_SOURCE_COVERAGE_MATRIX.md` documents all fifteen accounts
individually — canonical company, public or private status, CIK, useful periodic filing
coverage, ownership-only or incidental coverage, newsroom, IR source, subsidiaries and
facility operators, priority state/permit/incentive/regulatory/utility sources, coverage
gaps, and a recommended connector portfolio — with a confidence label on every cell and
an explicit statement of what could not be checked from this environment.

The corrected finding, from verified CIKs:

- **Eleven of fifteen** accounts have operational periodic SEC coverage under a CIK
  confirmed from an SEC-controlled URL or accession number: PepsiCo (0000077476),
  The Coca-Cola Company (0000021344), Kroger (0000056873), Tyson Foods (0000100493),
  Hershey (0000047111), Kimberly-Clark (0000055785), Unilever PLC (0000217410, 20-F),
  Procter & Gamble (0000080424), Sherwin-Williams (0000089800), Ecolab (0000031462),
  Keurig Dr Pepper (0001418135).
- **Four have no periodic filing coverage**: Nestlé S.A. (Swiss-listed, OTC Level-1 ADR),
  Mars, Incorporated (private), Danone S.A. (historical 20-Fs under CIK 0001048515;
  now an OTCQX Level-1 ADR with no periodic obligation), and Niagara Bottling (private,
  no CIK found).
- **One has excellent coverage that reaches the wrong assets.** The Coca-Cola Company
  files as a brand owner and concentrate producer. The US plants that generate
  Haskell-shaped projects belong to independent bottlers — above all **Coca-Cola
  Consolidated (CIK 0000317540)**, the largest US Coca-Cola bottler, operating across
  fourteen states and DC, which files its own 10-K.

So the operative statement is not "five file nothing." It is: **four accounts have no
periodic SEC coverage, and a fifth has periodic coverage that does not reach the
facilities.** For those five, company newsrooms and state and local incentive and permit
sources are the *only* pilot coverage that exists.

**Two related distinctions the matrix enforces.** Mars appears in EDGAR only as a filer
of beneficial-ownership documents against targets — including the SC 13D on Kellanova —
which is genuinely useful as an M&A signal but is **ownership-only coverage**, not
company coverage. And a company's name appearing inside someone else's filing is
**incidental coverage**, usable for discovery and never counted toward monitoring.

### 7.1a Corporate structure moved under four of fifteen accounts

Verified during the reconciliation pass, and the strongest argument in the package for
time-bounded ownership (C24):

| Event | Date | Consequence for the radar |
| --- | --- | --- |
| Mars completes the Kellanova acquisition | 11 Dec 2025 | A private, filing-free account absorbs a large US snack-plant footprint; Kellanova's own filings (CIK 0000055067) end as a source at deregistration |
| Nestlé Waters NA → BlueTriton (2021) → **Primo Brands** (CIK 0002042694) | merger closed 8 Nov 2024 | Poland Spring, Deer Park, Ozarka, Ice Mountain, Pure Life activity is **not Nestlé** — attributing it there is a resolution error against a Highest Value account |
| Unilever separates ice cream as **The Magnum Ice Cream Company** | operational separation 1 Jul 2025; **legal demerger 6 Dec 2025**; listing and trading 8 Dec 2025 | Ben & Jerry's, Magnum, Cornetto, Wall's plants leave Unilever. Unilever **retained ~19.85%** — a minority interest, not a termination |
| KDP acquires JDE Peet's, then plans a tax-free split into two US-listed companies | acquisition ~Apr 2026; separation readiness targeted year-end 2026 | **KDP will likely become two accounts during the pilot** — and separations generate capital projects |
| Kimberly-Clark / Kenvue | approved Jan–Feb 2026, expected 2H 2026 | A sixth structural change may land inside the pilot window |

Four completed reorganizations in roughly twenty months, two more in flight, across a
fifteen-account cohort. Ownership cannot be a current-state pointer. Projects must be
attributed to the operator **as at the event date**, which is what `facility_organizations`
and `organization_relationships` with `from_date` / `to_date` / `evidence_id` provide.

### 7.2 Coverage matrix

Priority: **A** = enable in pilot week 1, **B** = pilot week 3, **C** = Phase 4.
Cohort coverage counts are from `12_PILOT_SOURCE_COVERAGE_MATRIX.md`.

| Source family | Method | Cohort coverage | Priority | Expected yield | Main risk |
| --- | --- | --- | --- | --- | --- |
| SEC EDGAR submissions + filing docs | API + PDF/HTML | **11 verified CIKs**, plus Coca-Cola Consolidated and Kellanova-while-filing | A | Capex guidance, acquisitions, facility mentions; low volume, high authority | Fair-access rate limits; long filings are expensive to extract; **reaches no plants for KO** |
| Company and subsidiary newsrooms | Feed → sitemap → structured HTML | 15 of 15 (**~25–30 endpoints** incl. bottlers, Nestlé USA, Purina, Danone NA, Kellanova, MICC) | **A** | **The only coverage for four accounts**; primary announcements can support authoritative evidence directly | Highest breakage rate; each is a bespoke selector — budget for this explicitly |
| State & local incentives / economic development | API, feed, or approved adapter | Decisive for Mars, Nestlé, Danone, Niagara; strong for Tyson, KDP, P&G | **A (3–5 states)** | Site selection and Developing-stage evidence months before press | Fragmented, per-state formats |
| FDA food enforcement (openFDA) | API | ~9 of 15 — **not applicable to KMB, PG, SHW** | A | Facility-level, named firms; negative and food-safety signals | Firm names need alias resolution; recalls ≠ opportunities |
| USDA FSIS recalls and alerts | API + feeds | Tyson primarily | A | Plant-level, authoritative | Narrow applicability |
| **USDA FSIS MPI establishment directory API** | API | Meat, poultry, egg establishments — Tyson-critical | **A** | **Facility-grade identity keyed by establishment number**, updated weekly. Added by the external-research pass; it was missing from v0.2 | Establishment-to-organization join quality unproven |
| **EPA ECHO / FRS** | Web services | ~12 of 15 | **A — promoted from B** | **Facility Registry Service ID as a stable cross-program facility key.** Promoted for *identity*, not for its enforcement signal, which lags | Multiple sub-APIs with differing schemas |
| Broad news discovery (GDELT) | API, **discovery-only** | All | A | Regional and trade reporting EDGAR never sees | Licensing and allowlist conflict — see §7.4 |
| Permits & planning (ArcGIS / Socrata / Legistar) | API | Geography-dependent | **A for Niagara**, B otherwise | Earliest credible project formation | Highest per-source setup cost; sparse hit rate |
| Water / wastewater permits | API or portal | Niagara, beverage, dairy, protein | **A for Niagara**, B otherwise | Distinctive early signal for bottling siting | Jurisdiction-specific; often PDF |
| **Commercial permit / project feed** (Shovels, IIR, Dodge, BuildCentral, ConstructConnect) | Vendor API | Potentially all | **Evaluate in parallel (D21)** | One integration instead of dozens of municipal connectors | Coverage depth for F&B is unproven for every vendor; all are quote-only |
| PACK EXPO / marketing import | Controlled import | Engagement only | A (one-time) | Account strategy dimension only | Never raises project maturity (`02`) |
| Regulations.gov | API | Sector-wide | C | Regulatory-change trends | Deferred (C20) |
| Licensed business news | Licensed feed | All | C | Full text under licence | Cost and retention terms (D6) |

### 7.3 Rollout sequence

**Revised in v0.2.** Version 0.1 sequenced newsrooms and incentives as week 3. That is
wrong for this cohort: Nestlé, Mars, Danone, and Niagara have no periodic filing
coverage, and Coca-Cola's filings do not reach its plants. Deferring their only sources
by two weeks would produce green connector health and an empty pipeline for a third of
the pilot — precisely the failure the platform exists to prevent.

- **Weeks 1–2.** EDGAR for the eleven verified CIKs **plus Coca-Cola Consolidated**;
  openFDA; FSIS; the PACK EXPO controlled import; GDELT in reference mode; **and the
  no-filing-coverage newsrooms first** — Nestlé USA, Purina, Mars, Kellanova, Danone
  North America, Niagara — followed by pathfinder newsrooms chosen to exercise the feed,
  sitemap, structured-HTML, and PDF paths.
- **Weeks 2–3.** State incentive sources for the geographies those four accounts
  concentrate in; **local permit and water sources for Niagara**, promoted from Phase B
  because they are that account's only coverage.
- **Weeks 3–4.** Remaining newsrooms including private bottlers and MICC; EPA ECHO.
- **Weeks 5–6.** Two or three metro permit portals in the geographies the first four
  weeks actually surface, rather than the ones guessed in advance.

Every source still passes **dry run → sample review → enable**, per the
`require_dry_run_before_enable` default already in the config. For sources marked
*Unverified* in the coverage matrix, the dry run is also the endpoint-existence check.

**The permits and environmental sequencing conflict, resolved (C6/E6).** The external
source catalog placed EPA ECHO in a later phase while the external backtest argued that
water, wastewater, utility, incentive, and local-approval actions are among the earliest
indicators. Both are partly right, and the resolution turns on separating *identity* from
*signal*:

1. **EPA ECHO and FSIS MPI enter the pilot stack for facility identity.** FRS IDs and
   establishment numbers are stable cross-program facility keys, and facility identity is
   the load-bearing problem for the entire platform. Their enforcement and recall content
   is a lagging indicator and is not why they are promoted.
2. **Local permit and planning connectors stay narrow** — only jurisdictions around
   *verified* pilot facilities and priority expansion geographies, and only where a
   structured API (Legistar, Socrata, ArcGIS) is confirmed. A jurisdiction without one is
   **out of scope**, not a candidate for scraping or for PDF board minutes requiring human
   interpretation.
3. **A commercial permit feed is evaluated in parallel** (D21), because one vendor
   integration may replace dozens of municipal connectors — or may not cover F&B at all,
   which is exactly what the evaluation is for.
4. **No promise of comprehensive national industrial-permit coverage from public
   sources.** It cannot be kept, and promising it at Gate G-3 would set an expectation the
   pilot then fails against.

The backtest's underlying insight survives even though its examples are largely uncited:
sub-municipal actions genuinely do precede press releases. What changed is only *how* we
propose to reach them.

### 7.4 Evidence access modes (C5)

Broad news discovery and strict destination allowlisting are in direct tension, and the
v0.1 two-tier split was too coarse to express what we actually hold. Five access modes:

| Mode | What is stored | Fetch behavior | Max evidence strength |
| --- | --- | --- | --- |
| **structured_primary** | Parsed records from an official API or filing, plus the raw response | Direct, allowlisted | **authoritative** |
| **archived_full_text** | Full text and raw bytes archived, excerptable, locators preserved | Direct, allowlisted primary source or approved publisher | **authoritative** |
| **licensed_full_text** | Full text held under licence, display and retention bounded by contract | Licensed feed or API | **authoritative** |
| **reference_only** | URL, title, publisher, timestamps, and a snippet the discovery source itself supplied. No body | **Publisher is never fetched** | **indicative** |
| **metadata_only** | Existence, identifiers, timestamps. No text at all (e.g. a docket index entry) | Index or listing only | **indicative** |

**Promotion rules — the enforceable part:**

1. `reference_only` and `metadata_only` evidence **cannot set evidence strength above
   `indicative`**, regardless of how many such records agree.
2. An opportunity **cannot reach the Confirmed stage** unless at least one supporting
   signal carries `authoritative` evidence strength with assessment type `observed_fact`
   — which by rule 1 requires a structured, archived, or licensed record.
3. Any number of `reference_only` records can raise **momentum and trend velocity**, and
   can create or sustain an Emerging opportunity. They can never, alone, promote one.
4. Syndicated copies collapse into one evidence family before corroboration is counted,
   so breadth of discovery never inflates apparent corroboration (`02`).
5. The mode is enforced in the schema — reference and metadata modes may not carry a raw
   storage or extracted-text URI — and in the gateway, which refuses to fetch publisher
   URLs discovered inside a reference-mode payload.

The practical effect: GDELT makes us *aware* of a project within hours and can put it on
the Pulse as an Emerging lead, while promotion to Confirmed waits for the company, the
regulator, or the permit office. That is the correct direction to be wrong in, and D6
(a licensed feed) is the remedy if it proves too conservative.

### 7.5 Account scope classification (C22)

Four Highest Value accounts are not core Food & Beverage. Version 0.1 framed this as a
list error, which was wrong — these accounts are on the list for commercial reasons.
What was missing is vocabulary. Every monitored account carries a scope class:

| Value | Class | Ontology treatment |
| --- | --- | --- |
| `fnb_core` | Core Food & Beverage | Full signal ontology; full alerting weight |
| `fnb_adjacent` | Adjacent — consumer products, or a strategic supplier or partner | Suppress food-safety families; keep facility, process, packaging, automation, utilities, distribution. For supplier accounts, signals about *customers'* plants route to account intelligence rather than the pursuit queue; signals about the account's **own** facilities remain eligible |
| `non_fnb` | Outside this platform's scope | Monitored only if a stakeholder directs it; excluded from F&B relevance metrics and from the pursuit queue |
| `unknown` | Not yet classified | Monitored, clearly labeled, excluded from relevance metrics until classified. **A transient state, not a resting place** |

The four values are the ones the external research recommended, and they replace the
longer prose labels used in v0.2. `fnb_adjacent` deliberately covers both adjacent
manufacturers and strategic suppliers, because the ontology treatment is the same and the
routing difference is a property of *which facility a signal concerns*, not of the account
class.

Applied to the four:

- **Kimberly-Clark** — `fnb_adjacent`. Tissue and nonwovens plants are
  water- and energy-intensive; industrial water and wastewater is a strong Haskell match.
  Food-safety families produce nothing and must be suppressed rather than left to look
  like silence.
- **Procter & Gamble** — `fnb_adjacent`. Large US plant network, and
  historically incentive-announced site expansions, which suits the state-incentive
  connector well.
- **Ecolab** — `fnb_adjacent`, supplier routing. Ecolab sells water, hygiene, and
  sanitation programs into the same plants Haskell designs. Its own facility projects
  remain a legitimate but small opportunity surface; the larger value is as market
  intelligence and possible channel. Treating it as a pursuit target would generate
  confident, wrong recommendations against a Highest Value account.
- **Sherwin-Williams** — **`non_fnb`, with stakeholder confirmation still required.** The
  external research recommends classifying it out of Food & Beverage scope outright, and
  on the evidence that is the right default: coatings manufacturing and a paint-store
  distribution network share no vocabulary with the F&B signal ontology, and FDA and FSIS
  produce nothing for it. Haskell adjacency is nonetheless real — process systems,
  automation, material handling, industrial water and wastewater, and large distribution
  facilities are all genuine Sherwin-Williams needs.

  So the classification changes and the question does not go away. **`non_fnb` is the
  default; whether the account belongs on a Food & Beverage radar at all is D11, and it is
  a commercial-intent question for the market leader, not a data-quality defect.** If it is
  confirmed in scope, a coatings vocabulary is required and that is real work.

---

## 8. Connector reliability and observability plan

### 8.1 Reliability mechanics

- **Conditional collection.** ETag / If-Modified-Since / feed cursors, checkpointed per
  run. `unchanged` is a first-class success — it is the state that proves the difference
  between "no news" and "no collection."
- **Per-document isolation.** One malformed PDF fails one document, not the run. That is
  what makes `partial_success` meaningful rather than a euphemism for failure.
- **Retry with jitter** per the config defaults (4 attempts, 30s → 30m). Retries stay
  inside the run budget; exhausted units become explicit failed units with reasons.
- **Idempotency** at three levels: the logical run `(source_id, collection_window_start)`
  with retries recorded as child attempts; evidence `(source_id, content_hash)`; and the
  non-null `alert_dedupe_key` over recipient, channel, target, and material-change
  fingerprint (§6.6). Together these deliver "a second run against unchanged content
  produces no duplicate alerts" structurally rather than by careful coding.
- **Dry run before enable**, and dry run again before resuming from Connector Care.
- **Circuit breaking.** Two consecutive failures → `degraded`; four → `action_required`
  and the schedule backs off, so a dead source does not burn the rate-limit budget of a
  healthy one on the same host.

### 8.2 Observability

Three layers, because they answer three different questions:

1. **Per-run telemetry** — the metrics in `03` (discovered/fetched/extracted/rejected/
   duplicates, HTTP status distribution, redirect violations, auth failures, schema
   failures, extraction completeness, timing). Gateway-emitted, so connectors cannot
   under-report.
2. **Per-source health** — 7/30-day success rates, consecutive failures, freshness lag
   against SLA, last-new-record recency, health state with transition history.
3. **Coverage impact** — *which accounts, sectors, and geographies are affected*. This
   is the layer usually missing, and it is the one that matters: "the Tennessee permits
   connector is down" is an admin fact; "we have no permit coverage for Niagara or Tyson
   in TN since Tuesday" is a business fact and belongs in the daily brief.

**Anomaly detection** per `03`: unexpected zero-result runs (against a trailing-10
baseline), record-count swings beyond 80%, required-field disappearance, content-type
change, new redirect domain, auth expiry, pagination loops, duplicate explosion,
sub-threshold extraction, SLA staleness. All are computed from stored run metrics, so
they are auditable rather than heuristic-in-code.

### 8.3 Model observability

The Model Gateway logs provider, model, prompt version, schema version, latency, tokens,
cost, cache hit, and schema-validation outcome per call. Two derived metrics matter for
`05`'s intelligence-quality acceptance: **schema-violation rate** (rises sharply when a
provider changes model behavior — an early warning) and **cache hit rate** (a collapse
means the pipeline has stopped being deterministic).

### 8.4 Connector Care task contract

A task is only creatable if its type is in this allowlist:
`oauth_reauthorize`, `replace_api_key`, `approve_domain`, `approve_selector_change`,
`complete_permitted_captcha`. Each task must carry: source, exact problem, last
successful collection, coverage affected, **exactly one** bounded action, a test control,
and an audit record. No task may request content entry — enforced in code, not policy,
which is the mechanism behind G7.

### 8.5 Operational health is not market coverage (C23)

`05` lists acceptance metrics in one undifferentiated block and leads Phase 2 exit with a
95% connector-success rate. Nothing in the package stops that number from being read as
evidence that the market is being covered. It is not, and the coverage matrix shows
exactly how the two can diverge: for Nestlé, Mars, Danone, and Niagara, every enabled
connector can be green while the account is effectively unmonitored, because the sources
that would carry their signals were never built.

**A connector-success rate measures whether we collected what we configured. It says
nothing about whether we configured the right things.**

Two independent metric families, with independent thresholds, both required at every
exit gate:

#### Family 1 — Operational health (are the connectors working?)

| Metric | Definition | Pilot target |
| --- | --- | --- |
| **Connector execution success** | Logical runs ending `success`/`unchanged`/`partial_success` ÷ scheduled logical runs. **Attempts excluded**; `action_required` counts as failure | ≥95% over 14 days |
| **Attempts per successful run** | Mean attempts inside a successful logical run | ≤1.3; a rise predicts failure before the success rate moves |
| **Source freshness** | Sources within their freshness SLA ÷ enabled sources, measured continuously | ≥95%, no source stale >2 cycles |
| **Extraction completeness** | Documents reaching `extraction_status = success` with required fields and above minimum text ÷ documents fetched | ≥90%, tracked per method (PDF and OCR will be worse) |
| **Operator-action rate** | Connector Care tasks per source per 30 days | <0.5; the automation-first requirement in numeric form |
| **Median recovery time** | `action_required` → next successful run | <2 business days |

#### Family 2 — Intelligence coverage (are we seeing the market?)

| Metric | Definition | Pilot target |
| --- | --- | --- |
| **Expected coverage completeness** | Enabled, healthy sources ÷ **expected** sources for each account, from a declared per-account source expectation | 100% of accounts at ≥80%; **no account below 50%** |
| **Discovery yield** | Distinct new signals per account per 30 days, and the share of accounts with zero | Zero-signal accounts must be **explained** — either a declared quiet period or a coverage gap — never unexplained |
| **Duplicate suppression** | Duplicate opportunity clusters ÷ presented opportunities; duplicate alerts ÷ alerts sent | <10% clusters (`05`); <2% duplicate alerts |
| **Opportunity relevance** | Dismissal rate with reason codes, plus user-rated relevance | Dismissal <30%, with the false-positive category share falling over time |
| **Evidence-link availability** | Opportunities whose every claim resolves to retrievable evidence | 100% — invariant, not a target |
| **Resolution accuracy** | Organization and facility resolution measured against the adversarial set | Above the approved threshold, with **zero incorrect merges** |

#### The mechanism that makes coverage measurable

Family 2 depends on one new object: **`account_source_expectations`** — a declared
statement, per account, of which source families *should* produce signal. It is seeded
directly from the coverage matrix. Without it, "expected coverage" has no denominator
and zero signals from Nestlé is indistinguishable from a quiet quarter.

It also fixes the Kimberly-Clark problem: FDA enforcement is declared *not expected* for
Adjacent Consumer Products accounts, so its silence is correct rather than alarming, and
the account is not penalized for a source that was never going to fire.

**Reporting rule.** Pulse, the daily brief, and the Phase 2 exit review all report the
two families side by side and never substitute one for the other. An account with healthy
connectors and no expected coverage is reported as **uncovered**, not as quiet.

**One invariant, stated because an external review proposed violating it.** A stale source
reduces **coverage assurance**; it must never mutate `evidence_strength`. The review
suggested pausing confidence scoring for entities that depend on a stale source. A
document retrieved and hashed six months ago is exactly as true today as it was then — the
source going quiet says nothing about it. Degrade coverage, never the evidence.

### 8.6 Operability containment (C27, C28, C29)

Three containment mechanisms the v0.2 design lacked. Each closes a path by which the
system degrades into manual work.

**Per-source cadence and yield baselines (C27).** Every source declares an
`expected_cadence` and accumulates an observed `baseline_yield`; novelty and staleness
anomalies are evaluated against *that source's* history. An external review proposed a
global rule — alert when new entities in seven days fall below the historical P99 — which
fails twice over: a fixed seven-day window is meaningless for a board that meets
quarterly, and a P99 band on a low-count series is mostly noise. A source that publishes
twice a quarter must be judged as such, or it looks broken when idle and healthy when dead.

**Outbound-alert circuit breaker (C28).** The change ledger and the dedupe key prevent
*duplicate* alerts. Neither prevents a **legitimate-looking flood**: a classifier
regression, or a silent provider-side model change, produces alerts that are individually
well-formed, correctly deduplicated, and wrong. When outbound volume exceeds a configured
multiple of its moving average, the notification queue is quarantined **before delivery**
and the inference version in use is pinned. Perfect deduplication would have shipped the
storm.

**Poison-message isolation and parked queues (C29).** A message that can never succeed —
a permanently malformed PDF, a document that always exceeds the context limit — currently
retries until a human notices, burning model quota. Added: bounded retries → **parked
queue** → circuit-breaker state recorded on the source. Parked messages are drained by a
deliberate replay after a fix, never by automatic redelivery. Alerting is on
oldest-parked-message age, retry-exhaustion rate, and depth relative to source volume —
**not** on "parked queue is non-empty," which would page someone forever over one bad
document and train them to ignore it.

### 8.7 Failure-injection suite

Ten chaos tests, adopted from the external automation review, each mapped to the control
it exercises. They run in CI against staging, and passing them is part of automation exit
(§9) rather than a separate exercise.

| # | Injection | Control exercised | Asserted outcome |
| --- | --- | --- | --- |
| 1 | HTTP 403 on the five highest-yield sources | Circuit breaker, coverage reporting | Breaker trips; accounts show **uncovered**, not quiet |
| 2 | Pagination loop — "next page" points to itself | Pagination-loop detection | Run bounded and marked `partial_success`; no duplicate evidence |
| 3 | Valid JSON with an empty array **for two expected cadence cycles** | Per-source baseline (C27) | Source flagged stale against *its own* cadence, not a fixed 14 days |
| 4 | A $50M project, then a syndicated copy citing $5M | Corrections model (§6.10) | **Both preserved with a contradiction relationship**; presented view resolved by authority and specificity — the newer value does not win |
| 5 | "Coming this Fall" and "Q4" with no year | Temporal model (§6.2) | Stored with `precision` and no fabricated year; never an exact date |
| 6 | Company A owns Facility X, then Company B acquires it | Time-bounded ownership (§7.1a) | **Both assertions retained with date bounds**; as-at-date attribution correct |
| 7 | Kill the worker mid entity-merge transaction | Outbox and transaction boundaries (§4.5) | No orphaned rows; replay is idempotent |
| 8 | Malformed JSON from the model on 10% of calls | Model gateway schema validation | Retry, then quarantine; never a silent write |
| 9 | The same release from 50 URLs at once | Evidence families (C16) | One signal, one evidence family, 50 evidence rows, one alert |
| 10 | A prompt that classifies every "water" mention as a facility | Outbound circuit breaker (C28) | Alerts quarantined before delivery; inference version pinned |

Tests 3, 4, and 6 were **modified from the versions proposed**. The originals asserted a
fixed 14-day window, that the newer value should win, and that ownership should be
overwritten — all three of which this design rejects on the record (§6.10, ADR 0012,
`14_EXTERNAL_RESEARCH_RECONCILIATION.md` §5).

---

## 9. Phased MVP backlog

Dependencies use epic IDs. Acceptance tests are written to be executable; anything
untestable is marked as a design task rather than a delivery task.

### Dependency graph

```text
E0 Platform foundation
 ├─ E1 Ontology & reference data ──┐
 ├─ E2 Import & account foundation ┤
 │        └─ E3 Entity resolution ─┤
 ├─ E4 Egress gateway & security ──┤
 │        └─ E5 Source registry ───┤
 │              └─ E6 Connectors ──┤
 │                    └─ E7 Evidence & extraction
 │                          └─ E8 Model gateway
 │                                └─ E9 Signals & clustering
 │                                      └─ E10 Opportunities & scoring
 │                                            ├─ E11 Trends
 │                                            ├─ E12 Change ledger ─ E13 Alerts & briefs
 │                                            └─ E14 Experience (Pulse → Map)
 └─ E15 Source health & Connector Care  (depends on E5, E6; feeds E14)
```

### Phase 1 — Identity and evidence foundation (3–4 weeks)

| Epic | Scope | Depends on | Acceptance test |
| --- | --- | --- | --- |
| **E0** Foundation | Schemas, migrations from empty **and** from prior release, audit events, config-as-code | — | Migration suite passes from empty DB and from v0.1 fixture; audit event written for every mutating action in an integration run |
| **E1** Ontology | Sectors, capabilities, signal families, event types, scoring config as versioned reference data (C14, C15) | E0 | Changing a scoring weight is a config version bump; recomputation reproduces prior snapshots for prior versions |
| **E2** Import | `import_batches` → `import_records` → candidates → engagement observations → facility candidates; 171 curated rows + 519 engagement rows + 397 XPress rows; `transformation_version` on every derived row; `data_sensitivity_class = confidential_internal`; conditional personal-data controls specified but dormant (C6) | E0, E1 | Re-importing the identical file creates a new batch with **zero** new organizations; every derived value traces to batch + sheet + row number + transformation version; **no event address becomes a facility without corroborating evidence**; attempting to ingest a contact-level field without a lawful basis and retention expiry fails closed |
| **E3** Resolution | Identifier → alias → domain → address ladder; durable approved mappings; unresolved is a valid outcome | E2 | Adversarial set (Mars Inc vs Mars candy brands; Nestlé Food vs Beverage rows; three Coca-Cola bottlers; "Ferrara") produces zero incorrect merges; ≥10 known XPress↔curated matches found; ambiguous cases remain unresolved |
| **E4** Egress & security | Gateway, allowlist, SSRF/IP denial, redirect policy, caps, rate limits, robots (C21) | E0 | Requests to non-allowlisted hosts, `http://`, private IP ranges, and DNS-rebind fixtures all fail closed and are logged |
| **E5** Source registry | Source contract incl. timezone (C9), license mode, retention, `evidence_mode`; dry-run gate | E4 | A source cannot be enabled without a passing dry run and a recorded terms review |

**Phase 1 exit** (from `05`, made testable): workbooks load with no duplicate targets;
every row retains provenance; parent/subsidiary/brand/facility relationships are
inspectable; reprocessing produces no duplicate evidence; ambiguous mappings remain
unresolved.

### Phase 2 — Pilot collection and processing (4–6 weeks)

| Epic | Scope | Depends on | Acceptance test |
| --- | --- | --- | --- |
| **E6** Connectors | Method-based workers: api, feed, sitemap, structured/static HTML, PDF, controlled import; checkpoints; partial success | E5 | Injected mid-run failure yields `partial_success` with usable outputs and retried failed units; duplicate scheduler fire creates one run (C8) |
| **E7** Evidence & extraction | Raw archive, hashing, native-PDF-then-OCR, locators, minimum-content validation, versioned reprocessing | E6 | Same document re-collected → one evidence row; extractor version bump reprocesses deterministically; undated evidence stays undated (C2) |
| **E8** Model gateway | Schema-locked inference, prompt registry, replay cache, full audit | E7 | Identical inputs + versions → identical outputs from cache; schema violation triggers retry-then-quarantine, never a silent write |
| **E9** Signals & clustering | Family/event classification, capability alignment, dedupe, evidence families (C16), negative signals | E8, E1 | Syndicated set of 8 copies of one release → one signal, one evidence family, 8 evidence rows; a closure announcement produces `negative_signal = true` and is retained |
| **E10** Opportunities & scoring | Promotion rules, component scores + explanation, snapshots, override with reason (C18) | E9 | **Property test: no combination of tier and engagement alone reaches the pursue band without project evidence** (G4); every opportunity has ≥1 evidence record (G2) |
| **E11** Trends | Clustering, defined velocity (C19), org-count floor | E9 | A trend never renders in an opportunity list; velocity is reproducible from stored signals |
| **E12** Change ledger | `change_events`, materiality rules, read state (C17) | E10 | Unchanged re-run emits zero change events; a stage transition emits exactly one |
| **E13** Alerts & briefs | Immediate/daily/weekly, per-user dedupe (C7), auto-generated brief | E12 | One user with three matching subscriptions receives one alert; brief generated with no human input and links to every claim |
| **E15** Source health & Care | Metrics, anomaly detection, coverage impact, bounded tasks | E6 | Injected auth expiry surfaces as `action_required` within one cycle with correct affected-accounts list; no Care task of a non-allowlisted type can be created |

**Phase 2 exit**, with the definition gap closed and the two metric families separated
(§8.5). **Both must pass; neither substitutes for the other.**

*Operational health* — ≥95% of scheduled **logical** runs end in `success`, `unchanged`,
or `partial_success`. The denominator is scheduled logical runs; retry attempts are
excluded; `unchanged` counts as success; `action_required` does not. This definition is
unstated in `05` and must be ratified at Gate G-6.

*Measurement window* — **at least two expected collection cycles for every pilot source**,
plus a production-like soak and a passing failure-injection suite (§8.7). Not a fixed
14-day run. Both `05` and v0.2 inherited a 14-day window, and an external review proposed
14 days of zero-touch operation as proof of automation. Fourteen days does not exercise a
quarterly incentive board even once, so a green result would prove only that the frequent
sources work. For the slowest pilot sources, two cycles is months — which is the honest
answer, and it means **automation exit is a rolling criterion per source, not a single
date for the whole pilot**.

*Intelligence coverage* — every pilot account reaches ≥80% expected-source coverage with
none below 50%; every account with zero signals over the window has a recorded
explanation; duplicate alert rate <2%; and 100% of displayed opportunities resolve to
retrievable evidence.

### Phase 3 — MVP interface (4–6 weeks, overlapping Phase 2)

**E14** Experience, built in this order so each screen has real data behind it:
Opportunity detail → Opportunity queue → Pulse → Accounts/Facilities → Trends →
Briefings → Map → Source Health → Ask. Acceptance: score explanation always shown with
the score; trend and opportunity visually distinct; coverage degradation visible in
context; WCAG 2.2 AA with no critical findings; map has a synchronized list; the ten-
minute daily-review target is *measured with users*, not asserted.

### Phases 4–5

Per `05`: Tier 1 expansion (49 accounts) with the constraint that connector success must
not regress; then the full curated universe, discovery, and the reusable market module.
No new capability is proposed here beyond what `05` defines.

---

## 10. Decisions requiring stakeholder input

`05` lists ten. All are restated with a recommended default, followed by fourteen surfaced
by the v0.2 design reconciliation (D11–D20) and the v0.3 external-research reconciliation
(D21–D24). Recommended default is what we will build if no other direction is given.

**`docs/design/13_GATE_1_DECISION_PACKET.md` is the stakeholder-facing version of this
table** — each decision with its alternatives, operational consequence, cost and
complexity impact, decision owner, and required timing. The table below is the index.

**Six decisions are approved:** **D15** temporal model · **D18** time-bounded ownership ·
**D21** permit build-versus-buy, with vendor evaluation before contracting · **D22**
consequence-based severity · **D23** external-research staging, as a Phase 1 requirement ·
**D24** correction and supersession relationships. Eighteen remain open. The two
corpus-wide retrofits — D15 and D18 — are settled, so Phase 1 can start without a dating or
ownership retrofit pending.

| ID | Decision | Recommended default | Consequence of deferring |
| --- | --- | --- | --- |
| D1 | Inside Haskell Hub, or separate app sharing backend services? | **Separate application, shared identity and infrastructure.** F&B ontology and cadence differ enough that coupling the UI slows both. | Blocks E0; a late reversal is a rewrite of the delivery layer, not the kernel |
| D2 | Which identity, hosting, DB, queue, search, storage, model services are approved? | Postgres + object storage + Postgres-backed queue + approved LLM provider via gateway | Blocks E0 and E8 |
| D3 | **CRM target for pursued opportunities** | Link-out first (store CRM ID on the opportunity); no write-back in MVP | Deferrable to Phase 4 |
| D4 | Immediate alerts: Teams, email, or both? | **Both**, with Teams for immediate and email for digests | Blocks E13 UI polish only |
| D5 | Which geographies get permitting/incentive coverage first? | Follow the pilot: Southeast (GA/TN/NC/SC/AL/FL), TX, Midwest (OH/IN/IA/WI), plus AZ/NV for Niagara | Blocks E6 week-3 scope |
| D6 | Which paid news/market-data subscriptions exist? | Assume none in pilot; GDELT reference-only mode (§7.4) | Determines whether trade-press reporting can ever reach `authoritative` evidence strength |
| D7 | Retention and display rights for licensed content | Per-source `license_mode` + `retention_days`; default to reference-mode when unknown | **Compliance risk if deferred past E5** |
| D8 | Who owns tier changes and manual overrides? | Market leader owns tier; BD owner owns opportunity status; both require a reason code | Blocks E10 permissions |
| D9 | What counts as a successful pilot BD outcome? | Number of opportunities that become a qualified conversation, plus daily-review time under ten minutes | Without this, Phase 2 cannot be evaluated, only demonstrated |
| D10 | Haskell design system / brand assets | Use existing Haskell web brand tokens; no new design language | Blocks E14 visual work |
| **D11** | **Scope class for the four non-core F&B accounts** — C22, §7.5 | Kimberly-Clark and P&G → *Adjacent Consumer Products*; Ecolab → *Strategic supplier or partner*; **Sherwin-Williams → Scope confirmation required**, put to the market leader as a genuine question, not treated as a list error | Wrong class produces either noise or unexplained silence in the most-watched cohort |
| **D12** | **Supplier-role account semantics** (Ecolab) | Route Ecolab signals to account intelligence and partner context; its own facility projects remain eligible, its customers' do not | Confident, wrong pursuit recommendations against a Highest Value account |
| **D13** | **Bottler, subsidiary, and co-manufacturer networks** — §7.1, `12_…MATRIX.md` | Load **Coca-Cola Consolidated (CIK 0000317540)**, Nestlé USA, Purina, Danone North America, Kellanova, and MICC as related organizations with typed, time-bounded relationships; attribute projects to the operating entity and surface them under the brand account | Systematically missed or misattributed projects — verified as a live risk for KO, Nestlé, Unilever, and Mars |
| **D14** | **Event-data governance** — C6, §6.5. *Reframed in v0.2: the supplied data is company-level, not personal* | Govern as confidential third-party business data (access-controlled, licence-bounded, retention-bounded, not redistributable); **review the event lead-retrieval agreement** for retention and use restrictions; hold the personal-data controls dormant until contact-level data actually arrives | Contractual exposure, not privacy exposure. The licence review still gates E2 |
| **D15** | **Temporal model** — C2, §6.2 | Adopt raw expression + start + end + precision + basis + inference note **before any signal is written** | Retrofitting means reprocessing the entire corpus |
| **D16** | **Confidence decomposition** — C4, §6.4 | Keep Emerging/Developing/Confirmed; split confidence into evidence strength, assessment type, and confidence level | Cheap now; expensive after the UI, briefs, and alert templates ship |
| **D17** | **Coverage measurement** — C23, §8.5 | Adopt `account_source_expectations` and report operational health and intelligence coverage as separate families with independent thresholds at every gate | Without it, a green dashboard can hide four unmonitored accounts. **This is the single most consequential new decision in v0.2** |
| **D18** | **Corporate-reorganization handling** — C24, §7.1a | Time-bounded, evidence-backed ownership; attribute to the operator as at the event date; add a reorganization watch for KDP's planned split and the pending Kimberly-Clark/Kenvue close | Four completed reorganizations in ~20 months across 15 accounts; two more in flight during the pilot |
| **D19** | **Evidence access modes and promotion rules** — C5, §7.4 | Five modes; `reference_only` and `metadata_only` capped at `indicative` and barred from independently producing a Confirmed opportunity | Sets how fast the platform is allowed to become confident, and therefore its false-positive rate |
| **D20** | **Kellanova connector retirement** — `12_…MATRIX.md` | Run the Kellanova EDGAR connector while it remains a filer, with a scheduled review at deregistration so it is retired rather than left failing | A connector that fails for a *correct* reason still degrades the health metric and consumes operator attention |
| **D21** | **Build or buy local permit coverage** — §7.3, `14` E16 | **Evaluate before building.** Run a bounded vendor track (Shovels, Industrial Info Resources, Dodge, BuildCentral/Hubexo, ConstructConnect) in parallel with 2–3 API-exposed jurisdictions, and decide on evidence. Do not commit to dozens of municipal connectors first | Municipal connectors are the highest per-source cost in the plan and do not amortize. But every vendor's F&B depth is unproven — BuildCentral's advertised verticals do not list food and beverage — so buying blind is equally wrong |
| **D22** | **Incident severity model** — `14` §5.7 | Severity by **consequence**, not by who acts: Sev-1 only when routine operation requires a human to extract documents, enter leads, re-key content, or repair source records, or when silent corruption is occurring. Business feedback, source approval, and dismissals are **not incidents** | An external review proposed classifying *any* non-engineering review state as Sev-1. That would make a business user dismissing a false positive an outage, and it contradicts `00`, which explicitly permits source approval and connector reauthorization |
| **D23** | **Research-claim staging** — ADR 0011, `14` §6 | All external structured data enters staging behind an activation gate that fails closed; nothing reaches canonical tables without evidence, date precision, controlled values, and a resolved subject | Without it, each research batch gets its own normalization script and its own silent assumptions |
| **D24** | **Corrections model** — §6.10, ADR 0012 | Immutable claims plus typed correction relationships; the presented view computed from correction status, authority, specificity, applicability, then recency | Determines whether the platform can answer "why did you tell me this last month." An overwrite model cannot |

---

## Proposed stakeholder review and approval sequence

Structured as six gates. Each gate has named inputs, a decision set, and an exit that
unblocks specific work — so approval is a decision, not a meeting. Gate G-1 is packaged
in full in `docs/design/13_GATE_1_DECISION_PACKET.md`.

| Gate | Timing | Attendees | Decides | Unblocks |
| --- | --- | --- | --- | --- |
| **G-1 Mission, users, and pilot cohort** | Week 1 | F&B market leader, BD lead, executive sponsor | §1 product statement; personas; **D11** scope classes incl. Sherwin-Williams; **D12** Ecolab semantics; **D9** success definition | Everything — the only gate that cannot run in parallel |
| **G-2 Opportunity definition and scoring** | Week 1 | Market leader, BD, SMEs | Lifecycle unchanged; **D16** confidence decomposition; **D19** evidence access modes and promotion rules; **D24** corrections model; the five dimensions and caps; negative-signal rules; **D8** ownership | E1, E10 |
| **G-3 Source coverage, licensing, and confidentiality** | Week 2 | Platform admin, legal/commercial, marketing ops | §7 source plan and revised week-1 sequencing; the EPA/permits resolution (§7.3); **D5** geographies; **D6** subscriptions; **D7** retention; **D14** event-data licence review; **D17** coverage measurement; **D20** Kellanova retirement; **D21** build-or-buy permits | E4, E5, E6 |
| **G-4 Architecture and data model** | Week 2 | Engineering, IT security, data owner | **D1**, **D2**; §4 runtimes, transaction and queue boundaries; §6 model changes incl. **D15** temporal model, **D18** time-bounded ownership, **D23** research staging, C1 ingestion tables, C25 replay-cache key | E0, E2, E3 |
| **G-5 Information architecture and visual direction** | Week 3 | Market leader, BD, design, accessibility reviewer | §5 page map; drawer-vs-page pattern; how inferred dates and coverage gaps are shown; **D10** brand; **D4** alert channels | E14 |
| **G-6 MVP backlog and implementation authorization** | Week 3 | All of the above | §9 phasing; ratification of the **two-family Phase 2 exit definition** (§8.5) and the two-cycle measurement window; **D22** severity model; the failure-injection suite (§8.7); Phase 1 start | Implementation begins |

Gates G-2 through G-5 can run in parallel after G-1. The conflict register in §2 should
be walked at whichever gate owns each row; no item should reach implementation unowned.

**Two items are timing-critical and should not wait for their natural gate.** D15 (the
temporal model) and D18 (time-bounded ownership) must be settled before the first signal
and the first facility link are written, because both are corpus-wide retrofits
afterwards. If G-4 slips, take these two out of band.

Architecture decision records for the choices made in this response are in `docs/adr/`.
Each decision above becomes a new ADR when ratified, superseding the provisional one
where the stakeholder answer differs from the recommended default.
