# Design Response 01 — Haskell Food & Beverage Opportunity Radar

Prepared in response to `00_CLAUDE_MASTER_PROMPT.md`
Baseline reviewed: package version 0.1 (2026-08-12)
Response version: 0.1 · Status: **for stakeholder review**

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
rather than silently resolved. Twenty-two are listed. Each carries a proposed default;
none has been applied to the baseline files.

Severity: **B** = blocks implementation, **C** = correctness/compliance risk,
**D** = design decision that can be deferred but not ignored.

| # | Sev | Conflict or gap | Where | Proposed default |
| --- | --- | --- | --- | --- |
| C1 | B | `06` requires raw import records, organization *candidates*, engagement observations, and facility *candidates*. `database.sql` has none of these tables. There is no legal place to put an unresolved PACK EXPO row. | `06` §Required ingestion model vs `schemas/database.sql` | Add `import_batches`, `import_records`, `organization_candidates`, `engagement_observations`, `facility_candidates`. See §6.1. |
| C2 | B | "Missing dates must remain missing" vs `event_date date`. A source saying "in 2027" or "second half of next year" cannot be stored without inventing a month and day. | `README` non-negotiables vs `database.sql`, `platform.schema.json` | Add `event_date_precision` (`day`/`month`/`quarter`/`year`/`range`/`unknown`) and optional `event_date_end`. See §6.2. |
| C3 | B | `facilities.organization_id` is `not null` and singular, but `01` requires "Link multiple companies or brands to a facility when supported by evidence" (co-manufacturing, JV plants, multi-tenant cold storage). | `01` §Facility intelligence vs `database.sql` | Add `facility_organizations` (facility, org, role, evidence, dates). Keep a denormalized `primary_organization_id`. |
| C4 | C | Stage `confirmed` and confidence `confirmed` are different concepts with the same word. Users and code will conflate them; "Confirmed / Possible" is a legitimate and confusing combination. | `02` §Opportunity stages, §Confidence | Rename confidence to `single_source` / `corroborated` / `authoritative`. Keep stage labels — they are the plain-language ones users want. |
| C5 | C | Broad news discovery (GDELT) vs "allowlisted HTTPS destinations." GDELT returns arbitrary publisher URLs; fetching their bodies is by definition off-allowlist. | `00` constraints vs `03` §Initial source families | Two-tier evidence: GDELT is **discovery-only** (metadata + link, `evidence_mode = 'reference'`); full text fetched only from an allowlisted publisher set or a licensed feed. See §7.4. |
| C6 | C | The PACK EXPO email list is 519 rows of **personal contact data**. No package file addresses personal data, consent, retention, or access control for it. | `06` Workbook 1 | Ingest at organization grain only. Personal fields land in a restricted `contact_records` store, are never surfaced in the Radar UI, and carry their own retention clock. Legal review before Phase 1. See §10.D9. |
| C7 | C | `alerts` uniqueness is `(subscription_id, material_change_key)`, and `subscription_id` is nullable. In PostgreSQL, `NULL` values are distinct, so system-generated alerts can duplicate without limit. | `database.sql` | Partial unique index for `subscription_id is null`, plus a `recipient_key` column. Also dedupe per user, not per subscription — one user with three matching saved views should get one alert. |
| C8 | C | No idempotency key on `source_runs`. A scheduler retry or a duplicate worker lease produces two runs for the same slot, double-counting metrics and success rates. | `database.sql` | `unique (source_id, scheduled_for)` where `scheduled_for is not null`. |
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
| C22 | D | Four of the fifteen Highest Value accounts (Kimberly-Clark, Procter & Gamble, Sherwin-Williams, and arguably Ecolab) are not Food & Beverage manufacturers. The F&B signal ontology partially misfires on them. | `05` §Pilot cohort vs `01` §Market coverage | Confirm intent (§10.D3). Default: keep them, tag `consumer_products`, and suppress food-safety signal families for them rather than generating noise. |

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
| G12 | Stay inside licensing and privacy limits | License mode and retention per source; personal data segregated | `sources.license_notes` → `license_mode`, `retention_days`, `evidence_mode`, `contact_records` | Reference-mode evidence never stores or renders full text; retention job proven on a licensed-source fixture |

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

### 6.1 Group 1 — Missing tables that block Phase 1 (C1, C3, C11, C17, C18)

`06` specifies an ingestion model the SQL cannot express. Phase 1 cannot start without
these.

```text
import_batches(id, source_filename, file_hash, imported_at, imported_by, row_count)
import_records(id, batch_id, sheet_name, source_row_number, original_values jsonb,
               record_hash)                                     -- raw row, never edited
organization_candidates(id, import_record_id, original_string, normalized_string,
               resolved_organization_id NULL, resolution_confidence,
               resolution_method, resolved_at, resolved_by)     -- may stay unresolved forever
engagement_observations(id, organization_candidate_id, organization_id NULL,
               event_name, event_year, declared_interests text[], industry_response,
               company_role_response, address_candidate jsonb, repeat_count,
               import_record_id)
facility_candidates(id, address jsonb, organization_candidate_id, source_kind,
               corroboration_status, promoted_facility_id NULL)
facility_organizations(facility_id, organization_id, role, evidence_id, from_date,
               to_date)                                          -- C3: multi-tenant sites
change_events(id, object_type, object_id, change_type, from_state jsonb, to_state jsonb,
              materiality, dedupe_key, occurred_at)              -- C17: powers Pulse+alerts
user_read_state(user_id, surface, last_seen_at)
opportunity_status_history(id, opportunity_id, from_status, to_status, actor_type,
              actor_id, reason_code, reason_text, occurred_at)   -- C18
evidence_families(id, family_key, origin_evidence_id, method)    -- C16: syndication
contact_records(...)  -- C6, restricted schema, separate access control and retention
```

`change_events` deserves emphasis: it is one table that simultaneously satisfies "what
changed since my last visit" (Pulse), "material change summary" (card), alert
deduplication, and the daily brief. Without it, three features each grow their own
half-correct diffing logic.

### 6.2 Group 2 — Correctness changes (C2, C7, C8, C9, C10, C12, C15, C16)

The most important is **C2, date precision**, because it is a stated non-negotiable that
the current schema cannot honor:

```sql
-- current: event_date date            -- forces "2027" to become 2027-01-01
-- proposed:
event_date            date,
event_date_end        date,
event_date_precision  text not null default 'unknown'
  check (event_date_precision in ('day','month','quarter','year','range','unknown')),
check (event_date is null or event_date_precision <> 'unknown')
```

The UI then renders "expected 2027" rather than "January 1, 2027," and the timing score
uses the precision to widen its uncertainty instead of pretending to a day. A model that
cannot represent "sometime in 2027" will either fabricate a date or drop the signal;
both are failures of the stated requirement.

The remaining items are one-line fixes with real consequences: the alert uniqueness hole
(C7) causes duplicate notifications, which is the fastest way to lose daily users; the
missing run idempotency key (C8) silently corrupts the 95%-success acceptance metric
that Phase 2 exit depends on.

### 6.3 Group 3 — Ontology and configuration (C4, C13, C14, C19, C22)

Move sectors, capabilities, signal families, event types, and scoring configuration out
of `check` constraints and into versioned reference tables with FK enforcement. Three
reasons: `05` requires a reusable market module for other Haskell departments (G11), and
an ontology welded into `check` constraints cannot be reconfigured; `event_type` is
currently free text with no vocabulary at all, which will produce dozens of spellings of
"plant expansion" within a month; and scoring weights will change during the pilot —
that must be a config version bump with recomputable snapshots, not a migration.

### 6.4 What I recommend keeping unchanged

Named explicitly, because `README` asks that defined requirements not be silently
replaced: the seven run statuses, the three-stage lifecycle, the five scoring dimensions
and their caps, the confidence multipliers (0.60 / 0.80 / 1.00), the ten opportunity
statuses, the nine signal families, and the eighteen organization roles are all
sensible. My only change to any of them is the C4 *renaming* of confidence values — the
semantics stay exactly as written in `02`.

---

## 7. Source-coverage strategy for the pilot cohort

### 7.1 The finding that should drive the plan

SEC EDGAR is listed first in every source discussion in the package. Against the actual
15-account pilot cohort, **EDGAR covers at most two-thirds of it**:

| Account | Role for our purposes | US SEC filer? | Where the capital-project evidence actually lives |
| --- | --- | --- | --- |
| PepsiCo | Manufacturer, owns bottling | Yes (10-K/8-K) | Filings, newsroom, state incentives, FDA |
| The Coca-Cola Company | Brand owner; **plants sit with independent bottlers** | Yes | Bottler newsrooms + bottler filings, state incentives — *not primarily KO's own filings* |
| Nestlé | Manufacturer | **No** (Swiss listed) | Nestlé USA / Purina newsrooms, state incentives, local permits |
| Kroger | **Retailer** with ~30+ owned food plants and DCs | Yes | Newsroom, DC announcements, local planning, FDA |
| Tyson Foods | Protein manufacturer | Yes | **FSIS** (primary), filings, closures/layoffs, EPA ECHO |
| Mars | Manufacturer | **No** (private) | Newsroom, state incentives, local permits, FDA |
| The Hershey Company | Manufacturer | Yes | Filings (capex guidance), newsroom |
| Kimberly-Clark | Consumer products (non-food) | Yes | Filings, newsroom — food-safety families N/A |
| Unilever | Manufacturer | Yes (20-F, ADR) | 20-F is thin on US plants; newsroom + local sources carry it |
| Procter & Gamble | Consumer products (non-food) | Yes | Filings, newsroom |
| Sherwin-Williams | Coatings — **scope question, see C22/D3** | Yes | Filings, newsroom |
| Ecolab | **Supplier to F&B**, not an F&B producer | Yes | Filings, newsroom — different opportunity semantics |
| Danone | Manufacturer | **No** (deregistered from SEC) | Danone North America newsroom, state incentives, FDA |
| Keurig Dr Pepper | Manufacturer | Yes | Filings, newsroom, state incentives |
| Niagara Bottling | Manufacturer | **No** (private) | **State incentives + local permits + water/wastewater** — the best pilot test case |

Five of fifteen file nothing with the SEC. For those five — including two (Mars,
Niagara) with heavy US plant activity — coverage depends entirely on company newsrooms,
state incentive awards, and local permitting. **Recommendation: treat company newsrooms
and state/local incentive sources as Tier-A pilot sources alongside EDGAR, not as a
later phase.** A pilot built on EDGAR first would show good connector health and near-
zero opportunities for a third of the cohort.

The Coca-Cola bottler point is the same problem in a different shape: the account is the
brand owner, but the plant is owned by Coca-Cola Consolidated or Coca-Cola Europacific.
Unless bottlers are loaded as related organizations with an explicit relationship type,
the system will either miss those projects or attribute them to the wrong entity. This
generalizes to co-manufacturers across the cohort and is the strongest argument for the
C3 `facility_organizations` change.

### 7.2 Coverage matrix

Priority: **A** = enable in pilot week 1, **B** = pilot week 3, **C** = Phase 4.

| Source family | Method | Cohort coverage | Priority | Expected yield | Main risk |
| --- | --- | --- | --- | --- | --- |
| SEC EDGAR submissions + filing docs | API + PDF/HTML | 10 of 15 | A | Capex guidance, acquisitions, facility mentions; low volume, high authority | Fair-access rate limits; filing text is long — extraction cost |
| Company newsroom / IR | Feed → sitemap → structured HTML | 15 of 15 (~25 endpoints incl. bottlers, Nestlé USA, Purina, Danone NA) | A | **Highest-value source for the pilot**; primary announcements support Confirmed directly | Highest breakage rate; each is a bespoke selector — budget for this |
| State & local incentives / economic development | API, feed, or approved adapter | Strong for Mars, Niagara, Tyson, KDP, Nestlé | A (3–5 states) | Site selection + Developing-stage evidence months before press | Fragmented, per-state formats |
| FDA food enforcement (openFDA) | API | ~9 of 15 | A | Facility-level, named firms; negative + food-safety signals | Firm names need alias resolution; recalls ≠ opportunities |
| USDA FSIS | API + feeds | Tyson primarily | A | Plant-level, authoritative | Narrow applicability |
| Broad news discovery (GDELT) | API, **discovery-only** | All | A | Regional/trade reporting EDGAR never sees | Licensing + allowlist conflict — see §7.4 |
| Permits & planning (ArcGIS / Socrata / Legistar) | API | Geography-dependent | B (2–3 metros) | Earliest credible project formation | Highest per-source setup cost; sparse hit rate |
| EPA ECHO | Web services | Facility enrichment across cohort | B | Facility identifiers, permits, discharge — feeds water/wastewater capability | Weekly cadence; join keys are messy |
| PACK EXPO / marketing import | Controlled import | Engagement only | A (one-time) | Account strategy dimension only | Never raises project maturity (`02`) |
| Regulations.gov | API | Sector-wide | C | Regulatory-change trends | Deferred (C20) |
| Licensed business news | Licensed feed | All | C | Full text under license | Cost + retention terms (D6) |

### 7.3 Rollout sequence

Weeks 1–2: EDGAR, openFDA, FSIS, PACK EXPO import, plus five newsrooms as pathfinders
(PepsiCo, Tyson, Hershey, KDP, Niagara) chosen to exercise feed, sitemap, structured
HTML, and PDF paths. Weeks 3–4: remaining newsrooms including bottlers and NA
subsidiaries, GDELT discovery, three state incentive sources. Weeks 5–6: EPA ECHO,
two-to-three metro permit portals in the geographies the first four weeks actually
surface. Every source goes through **dry run → sample review → enable**, per the
`require_dry_run_before_enable` default already in the config.

### 7.4 The GDELT / allowlist resolution (C5)

Broad news discovery and strict destination allowlisting are in direct tension. Proposed
two-tier evidence model:

- **`evidence_mode = 'reference'`** — GDELT metadata only: URL, title, publisher,
  publication time, and GDELT's own extracted snippet. No fetch of the publisher, no
  stored body. Displayed as a link with attribution. Can trigger a *lead* for review and
  can contribute to trend velocity, but **cannot alone support Probable or Confirmed
  confidence**.
- **`evidence_mode = 'full'`** — full text stored, from an allowlisted publisher set
  (trade publications reviewed and approved), a licensed feed, or a primary source.

This preserves discovery breadth without either fetching arbitrary hosts or storing text
we lack rights to. It also matches `02`'s corroboration rule: syndicated copies of one
release collapse to one evidence family regardless of how many GDELT rows point at them.

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
- **Idempotency** at three levels: run `(source_id, scheduled_for)`; evidence
  `(source_id, content_hash)`; alert `dedupe_key`. Together these deliver "a second run
  against unchanged content produces no duplicate alerts" structurally.
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
| **E2** Import | `import_batches` → `import_records` → candidates; 171 curated rows + 519 email rows + 397 XPress rows; PII segregation (C6) | E0, E1 | Re-importing the identical file creates a new batch with **zero** new organizations; every derived value traces to a row number; no personal field is reachable from any Radar endpoint |
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

**Phase 2 exit** (from `05`, with the definition gap closed): ≥95% of scheduled runs end
in `success`, `unchanged`, or `partial_success` over 14 days — *the denominator is
scheduled runs; `unchanged` counts as success; `action_required` does not* (this
definition is currently unstated in `05` and must be ratified).

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

`05` lists ten. All are restated with a recommended default, followed by six new ones
this review surfaced. Recommended default is what we will build if no other direction is
given.

| ID | Decision | Recommended default | Consequence of deferring |
| --- | --- | --- | --- |
| D1 | Inside Haskell Hub, or separate app sharing backend services? | **Separate application, shared identity and infrastructure.** F&B ontology and cadence differ enough that coupling the UI slows both. | Blocks E0; a late reversal is a rewrite of the delivery layer, not the kernel |
| D2 | Which identity, hosting, DB, queue, search, storage, model services are approved? | Postgres + object storage + Postgres-backed queue + approved LLM provider via gateway | Blocks E0 and E8 |
| D3 | **CRM target for pursued opportunities** | Link-out first (store CRM ID on the opportunity); no write-back in MVP | Deferrable to Phase 4 |
| D4 | Immediate alerts: Teams, email, or both? | **Both**, with Teams for immediate and email for digests | Blocks E13 UI polish only |
| D5 | Which geographies get permitting/incentive coverage first? | Follow the pilot: Southeast (GA/TN/NC/SC/AL/FL), TX, Midwest (OH/IN/IA/WI), plus AZ/NV for Niagara | Blocks E6 week-3 scope |
| D6 | Which paid news/market-data subscriptions exist? | Assume none in pilot; GDELT reference-mode only (§7.4) | Determines whether Confirmed confidence is reachable from trade press |
| D7 | Retention and display rights for licensed content | Per-source `license_mode` + `retention_days`; default to reference-mode when unknown | **Compliance risk if deferred past E5** |
| D8 | Who owns tier changes and manual overrides? | Market leader owns tier; BD owner owns opportunity status; both require a reason code | Blocks E10 permissions |
| D9 | What counts as a successful pilot BD outcome? | Number of opportunities that become a qualified conversation, plus daily-review time under ten minutes | Without this, Phase 2 cannot be evaluated, only demonstrated |
| D10 | Haskell design system / brand assets | Use existing Haskell web brand tokens; no new design language | Blocks E14 visual work |
| **D11** | **Scope of non-F&B Highest Value accounts** (Kimberly-Clark, P&G, Sherwin-Williams, Ecolab) — C22 | Keep, tag `consumer_products`, suppress food-safety families; **explicitly confirm Sherwin-Williams is intended** rather than a campaign-list artifact | Noise in the pilot's most-watched cohort |
| **D12** | **Supplier-role accounts** (Ecolab) — the opportunity semantics differ; Ecolab is plausibly a partner or channel, not a pursuit target | Model role as `ingredient_supplier`; surface as account intelligence, not as pursuit opportunities, until BD confirms | Mis-scored opportunities against a Highest Value account |
| **D13** | **Bottler and co-manufacturer networks** (Coca-Cola Consolidated, Coca-Cola Europacific, contract manufacturers) — §7.1 | Load as related organizations with explicit relationship types; attribute projects to the operating entity, surface under the brand account | Systematically missed or misattributed Coca-Cola projects |
| **D14** | **Personal data in PACK EXPO exports** — C6 | Organization-grain ingestion; personal fields in a restricted store, never in the Radar UI; legal review before Phase 1 | **Privacy exposure; must not be deferred** |
| **D15** | **Date-precision model** — C2 | Adopt `event_date_precision` before any signal is written | Retrofitting means reprocessing all evidence |
| **D16** | Confidence-value rename — C4 | `single_source` / `corroborated` / `authoritative` | Cheap now, expensive after the UI and briefs ship |

---

## Proposed stakeholder review and approval sequence

Structured as six gates. Each gate has named inputs, a decision set, and an exit that
unblocks specific work — so approval is a decision, not a meeting.

| Gate | Timing | Attendees | Decides | Unblocks |
| --- | --- | --- | --- | --- |
| **G-1 Mission, users, and pilot cohort** | Week 1 | F&B market leader, BD lead, executive sponsor | §1 product statement; personas; D11, D12 (non-F&B and supplier accounts); D9 success definition | Everything — this is the only gate that cannot be run in parallel |
| **G-2 Opportunity definition and scoring** | Week 1 | Market leader, BD, SMEs | Stages, confidence (D16 rename), the five dimensions and caps, promotion and negative-signal rules, D8 ownership | E1, E10 |
| **G-3 Source coverage, licensing, and privacy** | Week 2 | Platform admin, legal/compliance, marketing ops | §7 source plan, D5 geographies, D6 subscriptions, D7 retention, **D14 personal data**, §7.4 GDELT posture | E4, E5, E6 |
| **G-4 Architecture and data model** | Week 2 | Engineering, IT security, data owner | D1, D2; §4 boundaries; §6 model changes incl. **D15 date precision**, C1 missing tables, C3 multi-org facilities | E0, E2, E3 |
| **G-5 Information architecture and visual direction** | Week 3 | Market leader, BD, design, accessibility reviewer | §5 page map, drawer-vs-page pattern, coverage-honesty treatment, D10 brand, D4 alert channels | E14 |
| **G-6 MVP backlog and implementation authorization** | Week 3 | All of the above | §9 phasing, the Phase 2 95% metric definition, acceptance tests, Phase 1 start | Implementation begins |

Gates G-2 through G-5 can run in parallel after G-1. The conflict register in §2 should
be walked at whichever gate owns each row — every item has an owner column implied by
its gate, and no item should reach implementation unowned.

Architecture decision records for the choices already made in this response are in
`docs/adr/`. Each decision above becomes a new ADR when ratified, superseding the
provisional one where the stakeholder answer differs from the recommended default.
