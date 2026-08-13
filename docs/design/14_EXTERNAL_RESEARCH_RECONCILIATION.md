# External Research Reconciliation

Disposition of the Gemini and Perplexity research outputs against the v0.2 design.

Version 0.1 · Prepared 2026-08-13 · Status: **for stakeholder review at Gates G-2 and G-3**

Companion to `10_DESIGN_RESPONSE.md`, `12_PILOT_SOURCE_COVERAGE_MATRIX.md`, and
`Haskell_FB_External_Research_Reconciliation.md` (the handoff document).

---

## 1. How external research was treated

Every returned record was treated as an **external research claim requiring
reconciliation**, never as canonical data. No record from any research file has been
written into a canonical table, and no migration has been created or applied.

Disposition vocabulary, used on every finding in §4:

| Disposition | Meaning |
| --- | --- |
| **Accepted** | Adopted as stated; a design delta was made |
| **Accepted with modification** | The underlying concern is real; the proposed remedy was changed |
| **Already addressed** | The v0.1/v0.2 design already contains an equivalent control |
| **Rejected** | Conflicts with primary evidence, or with the platform's automation, licensing, or evidence-preservation requirements |
| **Verification required** | Plausible and material, but not confirmed; recorded as a task, not a fact |

### 1.1 Inputs actually received

| File | Received | Records | Note |
| --- | --- | --- | --- |
| `Haskell_FB_External_Research_Reconciliation.md` | Yes | — | The handoff document |
| `sources.jsonl` | Yes | 21 | Parses as valid JSON Lines |
| `FB_Capital_Project_Signal_Backtest.md` | Yes | 20 projects, 10 negative controls | — |
| `Adversarial_Automation_Review_Findings.md` | Yes | 4 findings, 10 tests | — |
| `pilot_accounts_11_15_graph_records.jsonl` | Yes | **27** | Parses as valid JSON Lines |
| `pilot_accounts_6_10_graph_records.jsonl` | **No — not supplied** | — | Referenced by the handoff document as 26 records for Mars, Hershey, Kimberly-Clark, Unilever, and P&G, but **it was not among the attached files** |

**Consequence.** The handoff document's aggregate figures — 53 pilot records, 19 facility
records, six project records, eleven records lacking evidence — **could not be verified**,
because they span a file that was not received. What was verified, from the one graph file
in hand:

- 27 records: 9 `entity`, 8 `facility`, 4 `relationship`, 3 `project`, 2 `alias`,
  1 `network_assertion`.
- **4 records carry neither `sources` nor `evidence_url`** (lines 2, 4, 10, 16).

External graph coverage is therefore **accounts 11–15 only** as received, not 6–15.
Accounts 1–5 (PepsiCo, The Coca-Cola Company, Nestlé, Kroger, Tyson Foods) and 6–10 (Mars,
Hershey, Kimberly-Clark, Unilever, Procter & Gamble) have **no external graph records
available to this pass**. Nothing has been fabricated to fill either gap; both are
recorded as verification tasks in §7.

### 1.2 One epistemic caution about `sources.jsonl`

Several records in `sources.jsonl` cite this design package back at itself — record 1
states "11 of 15 pilot accounts have verified operational periodic coverage; Nestlé, Mars,
Danone, Niagara have none; Coca-Cola files but not at plant level," references
`account_source_expectations`, and cites "per design response §Aggregate connector
portfolio." Record 2 quotes the coverage matrix's own *Unverified* labels.

**The source catalog was produced with the v0.2 design response as an input.** It is
therefore a useful normalization and enrichment of our own work — and it is **not
independent corroboration of it**. Where `sources.jsonl` agrees with the coverage matrix,
that agreement carries no additional evidentiary weight. Only the genuinely new material
(vendor capabilities, rate limits, licensing posture) is treated as a new claim.

---

## 2. Disposition summary

| # | External finding | Disposition | Destination |
| --- | --- | --- | --- |
| E1 | BuildCentral does offer an API | **Accepted** | `12` §Vendor track |
| E2 | ConstructConnect has an official developer portal | **Accepted** | `12` §Vendor track |
| E3 | Industrial Info Resources has an official OpenAPI service | **Accepted with modification** | `12` §Vendor track |
| E4 | FSIS MPI establishment API is missing from the catalog | **Accepted** | `12`, `10` §7.2–7.3 |
| E5 | FDA Food Facility Registration list is not publicly disclosable | **Accepted** | `12` §Permanently unavailable |
| E6 | EPA/permits sequencing conflict must be resolved | **Accepted with modification** | `10` §7.3, `12` |
| E7 | Outbound-alert circuit breaker | **Accepted** | `10` §8.6, `11`, ADR 0010 |
| E8 | Separate coverage degradation from evidence confidence | **Already addressed**, strengthened | ADR 0010, `10` §8.5 |
| E9 | Source-specific cadence and yield baselines | **Accepted** | `10` §8.6, `11` |
| E10 | Poison-message isolation, bounded retries, parked queues | **Accepted** | `10` §8.6, `11` |
| E11 | Correction, retraction, withdrawal, supersession states | **Accepted** | `10` §6.10, `11`, ADR 0012 |
| E12 | Ten failure-injection tests | **Accepted with modification** | `10` §9, §8.7 |
| E13 | Provisional signal subtypes | **Accepted as hypotheses only** | `11`, `10` §6.8 |
| E14 | Signal-combination ranking hypotheses | **Accepted as hypotheses only** | `10` §6.8 |
| E15 | Negative controls in a future evaluation corpus | **Accepted** | `10` §9, `13` D9 |
| E16 | Vendor-evaluation track before building municipal connectors | **Accepted** | `13` D21 |
| E17 | Scope classification for the four non-core accounts | **Accepted with modification** | `10` §7.5, `11`, `13` D11 |
| E18 | Proxy rotation to bypass Cloudflare/paywalls/403s | **Rejected** | §5.1 |
| E19 | Recency-based evidence overwrite / "evidence decay" | **Rejected** | §5.2, ADR 0012 |
| E20 | 95% forced automatic conflict resolution | **Rejected** | §5.3, ADR 0005 |
| E21 | Generic P99 novelty threshold | **Rejected** | §5.4 |
| E22 | `DLQ > 0` as universally critical | **Rejected** | §5.5 |
| E23 | 14-day zero-touch run as sole automation proof | **Rejected** | §5.6, `10` §9 |
| E24 | Every non-engineering review state is a Sev-1 outage | **Rejected** | §5.7, `13` |
| E25 | Water-volume, funding-stage, job-title, SPE thresholds as rules | **Rejected as production rules** | §5.8 |
| E26 | Pilot graph JSONL records | **Accepted only into staging** | §6, `11` |
| E27 | Unilever New Haven `2029-03-31` | **Rejected and corrected** | §4.4, `12` |
| E28 | The "Ghost Update" silent-staleness finding | **Already addressed**, strengthened | ADR 0010 |
| E29 | Model/prompt version provenance on every fact | **Already addressed** | ADR 0003 |
| E30 | Time-bounded ownership through reorganizations | **Already addressed** | ADR 0005, C24 |

Counts: 12 accepted, 5 accepted with modification, 4 already addressed, 8 rejected,
1 staging-only. Verification tasks are listed separately in §7.

---

## 3. Verification performed in this pass

`www.sec.gov`, `data.sec.gov`, and corporate domains remain blocked by this session's
egress policy, so verification again ran through search results and their
SEC-controlled URLs. Every item below states what was actually checked.

| Claim | Result | Evidence |
| --- | --- | --- |
| Nestlé S.A. CIK 0000792990 | **Verified — upgraded from Unverified in v0.2** | Two SEC-controlled URLs under `/Archives/edgar/data/792990/`: accessions `0001209191-15-057775` and `0000950170-24-111110`. Coverage class **unchanged**: ownership/transaction filings, not operational periodic coverage |
| KDP completed JDE Peet's on 1 April 2026 | **Verified**, and made more precise | Offer declared unconditional 27 Mar 2026; settled 1 Apr 2026 at €31.85/share for 466,712,270 shares — **96.22%**, ~€14.86bn. Separation into two US-listed companies follows an interim operating period; **no date fixed** |
| Kimberly-Clark / Kenvue expected Q4 2026 | **Verified**, tightened from "2H 2026" | Kenvue Q2 2026 results state the combination is targeted for Q4 2026; shareholder approvals 29 Jan 2026; HSR expired 4 Feb 2026; transaction value reported ~$48.7bn |
| Nestlé Waters NA sale completed 31 March 2021 | **Accepted**; consistent with the BlueTriton/Primo chain already recorded | Handoff document; prior pass verified the 8 Nov 2024 Primo Brands combination |
| FSIS MPI establishment API exists | **Verified** | `fsis.usda.gov/science-data/developer-resources/mpi-api` — JSON, attribute-based querying, establishment directory updated weekly |
| FDA food facility registration list is FOIA-exempt | **Verified** | FDA guidance: the list of registered facilities and registration documents are not subject to FOIA, nor is derived information identifying a registered person — **21 U.S.C. 350d(a)(5)**. (One third-party index cites §350d(a)(4); the citation differs, the effect does not) |
| BuildCentral offers an API | **Verified** | A published datasheet, "BuildCentral API — Power your business and digital assets with real-time access," at `constructionwire.com/Content/pdf/buildcentral_api.pdf`. The external research's "no genuine machine-callable API" finding is **wrong** |
| ConstructConnect official developer portal | **Verified** | `developer.io.constructconnect.com/overview` — REST, `x-api-key` auth, project and company search. Access appears gated to authorized subscribers |
| Industrial Info Resources IDB API | **Verified (existence)**; version claim **not confirmed** | `api.industrialinfo.com/idb/` — REST, OpenAPI 3.0, JWT auth, add-on to a subscription. Sources reviewed describe **v2.6, released 17 Mar 2026**; the handoff document's "v2.7, released 28 July 2026" was not confirmed |
| Unilever New Haven timing | **Handoff document is correct; the JSONL is wrong** | Announced 28 May 2026; $270M; 2 College Street, New Haven; **"slated to open by spring 2029"**; replaces the Trumbull R&D campus; ~300 employees |

---

## 4. Dispositions in detail

### 4.1 Source-catalog corrections (E1–E6)

**E1 — BuildCentral. Accepted.** A published API datasheet exists. The external
research's claim of no machine-callable API is corrected. Two caveats survive, and both
matter more than the correction:

- The vendor's own materials describe data collection by **human researchers calling and
  emailing developers**. That is a signal-quality strength and not an obstacle for us —
  what matters is whether *delivery to Haskell* is a machine-callable API, which the
  datasheet indicates it is.
- **ConstructionWire's advertised verticals are retail/CRE, hotels, multi-family and
  single-family residential, medical, and energy & mining.** Food and beverage
  manufacturing does not appear in that list. API existence is now settled; **F&B project
  coverage is the open question**, and it is the one that decides suitability.

**E2 — ConstructConnect. Accepted.** The official developer portal exists, with REST
endpoints and `x-api-key` authentication. The unofficial third-party scraper wrapper
remains **rejected** on terms-of-service grounds — that part of the external research was
right and is unchanged. Entitlement, coverage, and licensing require a vendor conversation.

**E3 — Industrial Info Resources. Accepted with modification.** The API is real: REST,
OpenAPI 3.0, JWT. Two modifications: the **version claim is unconfirmed** (sources
reviewed describe v2.6 of March 2026, not v2.7 of July 2026), and the portal presents the
service as access to **IIR Energy's** market-intelligence database. IIR's F&B/process
depth is a vendor-demo question, not an established fact.

**E4 — FSIS MPI establishment API. Accepted.** This is the most valuable single addition
from the external research. The catalog carried FSIS *recalls* but omitted the
**establishment directory API**, which gives:

- Facility-grade identity for meat, poultry, and egg establishments, keyed by
  **establishment number** — a durable, cross-recall facility identifier.
- A weekly-updated directory, i.e. a genuine facility registry rather than an event feed.

It goes into the pilot stack as an **A-priority facility-identity source**, primarily for
Tyson. It also partially compensates for E5.

**E5 — FDA Food Facility Registration. Accepted, and recorded permanently.** The
registration list and registration documents are FOIA-exempt under 21 U.S.C. 350d(a)(5),
as is derived information identifying a registered person. There is no lawful connector
to build. This is recorded in the coverage matrix under a new heading — **sources that are
permanently unavailable and why** — precisely so a future implementer does not rediscover
the same dead end. openFDA food enforcement remains useful for recalls and is explicitly
**not** a facility registry.

**E6 — EPA and permits sequencing. Accepted with modification.** The external research
and the v0.2 design did conflict: `sources.jsonl` places EPA ECHO at B-priority while the
backtest argues water, wastewater, utility, incentive, and local-approval signals are
among the earliest indicators. Resolution adopted:

1. **EPA ECHO moves into the pilot stack** for facility identity and FRS ID resolution —
   not for its enforcement signal, which is a lagging indicator, but because the
   **Facility Registry Service ID is a stable cross-program facility key**, and facility
   identity is the load-bearing problem for the whole platform.
2. **FSIS MPI joins it** for the same reason (E4).
3. **Local permit and planning connectors stay narrow** — only jurisdictions around
   *verified* pilot facilities and priority expansion geographies, and only where a
   structured API (Legistar, Socrata, ArcGIS) is confirmed. Jurisdictions without one are
   **out of scope** rather than candidates for scraping.
4. **A commercial permit feed is evaluated in parallel** (E16, D21).
5. **No promise of comprehensive national industrial-permit coverage from public
   sources.** That promise cannot be kept and would set a false expectation at Gate G-3.

The backtest's underlying insight survives intact even though its examples are uncited:
sub-municipal actions genuinely do precede press releases. What changes is only *how* we
propose to reach them — a bounded set of API-exposed jurisdictions plus a vendor
evaluation, rather than dozens of bespoke connectors.

### 4.2 Automation and operability findings (E7–E12, E28–E30)

**E7 — Outbound-alert circuit breaker. Accepted.** Genuinely novel relative to v0.2. The
change ledger and dedupe key prevent *duplicate* alerts; neither prevents a *legitimate-
looking flood* after a classifier regression. A global outbound breaker quarantines the
notification queue when volume exceeds a multiple of its moving average, before delivery.
The v0.2 design would have sent the storm and deduplicated it perfectly.

**E8 — Coverage degradation must not rewrite evidence confidence. Already addressed,
and strengthened.** ADR 0010 separates operational health from intelligence coverage.
The external research's own proposed remedy — "pause downstream confidence scoring for
entities relying on this source" — is the thing to avoid: a stale *source* says nothing
about evidence already preserved. A document retrieved and hashed six months ago is
exactly as true today. Staleness reduces **coverage assurance**; it must never mutate
`evidence_strength`. This is now stated as an explicit invariant rather than left implicit.

**E9 — Source-specific cadence and yield baselines. Accepted.** v0.2 anchored anomaly
detection on trailing-run comparison, which is directionally right but too coarse for
sparse sources. Each source now declares `expected_cadence` and an observed
`baseline_yield`, and novelty anomalies are evaluated against *that source's* history.
A state incentive board that posts twice a quarter must not be judged against a news feed.

**E10 — Poison-message isolation, bounded retries, parked queues. Accepted.** v0.2
specified retries with jitter and per-document isolation but never named the terminal
state for a message that can never succeed. Added: bounded retries → parked queue →
circuit-breaker state recorded on the source, with the parked queue drained by a
deliberate replay rather than by automatic redelivery.

**E11 — Correction, retraction, withdrawal, cancellation, delay, supersession. Accepted.**
A genuine gap. v0.2 had `negative_signal` and opportunity statuses, but no way to record
that *the evidence itself* was corrected or withdrawn. Added as explicit evidence
relationships and project states. See §5.2 for what was rejected alongside it.

**E12 — Ten failure-injection tests. Accepted with modification.** The strongest part of
the automation review. All ten are adopted into the test plan, each mapped to an existing
control and an acceptance criterion, with three modified:

| Test | Modification |
| --- | --- |
| "The Silent Null" (empty array for 14 days) | Duration becomes **two expected source cycles**, not a fixed 14 days — for a weekly source that is 14 days, for a quarterly board it is six months |
| "The Reorg" | Asserted outcome changes: the system must produce **time-bounded ownership with both assertions preserved**, not a single overwritten current owner |
| "The Contradiction" ($50M then $5M) | Asserted outcome changes: **both values preserved with a contradiction relationship**, and the presented view derived from source authority and specificity — not the newer value winning |

**E28 — "Ghost Update" silent staleness. Already addressed, strengthened.** v0.2's
`last-new-record` metric and zero-result anomaly detection cover it; E9's per-source
baselines make the detection sound for sparse sources.

**E29 — Model and prompt version provenance. Already addressed.** ADR 0003 requires
provider, model, prompt version, schema version, and taxonomy version on every inference,
and the replay cache keys on all of them.

**E30 — Time-bounded ownership. Already addressed.** ADR 0005 and register item C24,
derived independently from the Mars/Kellanova, Nestlé Waters/Primo, Unilever/MICC, and
KDP transitions.

### 4.3 Backtest material (E13–E15)

**E13 and E14 — Signal subtypes and combinations. Accepted as hypotheses only.** The
backtest is a set of worked examples, not a backtest: one summarized row per project
rather than a 6–36-month timeline, no defined outcome date despite a reported
`Days_Before_Outcome`, most rows citing `Public Domain [C]` or a bare domain instead of a
URL, four source links for the entire report, and uncited negative controls. No detection
rate, false-positive rate, lead-time distribution, or per-source performance is computed.

The **vocabulary** is nonetheless useful and is adopted into
`signal_event_types` as **provisional, non-scoring** subtypes: incentive approval, zoning
variance, environmental permit, utility load study, capacity guidance, plant-specific
hiring, supplier equipment announcement, and special-purpose-entity formation. They are
recorded with `evaluation_status = 'hypothesis'` and **carry no scoring weight** until an
evaluation corpus exists.

The **combinations** — "SPE + utility load study + incentive approval," "debt covenant +
plant hiring" — are recorded as **ranking hypotheses in the scoring config**, disabled,
for evaluation. They are plausible and they are unevaluated; both facts are recorded.

**E15 — Negative controls. Accepted.** The ten negative controls (Upside Foods, Beyond
Meat, AppHarvest, Do Good Foods, and the lost-bid sites) are exactly what a scoring
evaluation corpus needs, and the lost-bid cases are especially valuable: a site-selection
evaluation legitimately produces signals at *several* locations, only one of which becomes
a project. They are staged as evaluation-corpus candidates requiring citation before use.

### 4.4 Pilot graph records (E26, E27)

**E26 — Staging only.** The 27 records received are not import-ready, for the reasons the
handoff document gives and this pass confirmed:

- **Schema divergence.** The received file uses `id`, `entity_type`, `project`,
  `relationship`, `sources`, `city`; the handoff document reports the unreceived 6–10 file
  uses `entity_id`/`facility_id`/`project_id`, `entity_class`, `capital_project`,
  `ownership`, `evidence_url`, `locality`. Two incompatible shapes.
- **Uncontrolled status values.** `evidence_status` alone carries seven distinct values
  mixing provenance, confidence, currency, and workflow state:
  `verified`, `verified_primary`, `verified_primary_corporate`,
  `verified_primary_government`, `corroborated`, `primary_historical_not_current`,
  `requires_closing_release_for_graph_activation`. The last is not an evidence status at
  all — it is an activation gate. Similar mixing appears in `operational_status`,
  `status`, `relationship_status`, `sec_coverage`, and `tenure`
  (`owned_historical_2021` fuses tenure, currency, and a year).
- **Missing provenance.** 4 of 27 records carry no evidence reference: two aliases, the
  `danone_sa → whitewave` relationship, and the `ghost_lifestyle` entity — the last marked
  `verified` with nothing to verify against.
- **Raw URLs as evidence.** Graph assertions embed publisher URLs directly. A URL is
  evidence *metadata*; assertions must reference normalized evidence IDs.
- **Date strings without precision.** `2017-04`, `2024-Q3`, `2025`, `2024-early`,
  `announced_construction_expected_early_2025` — five different temporal grains in
  ordinary strings, exactly what ADR 0004 exists to prevent.
- **No pilot-account mapping.** No record carries the Highest Value row it belongs to, so
  subsidiaries and acquired companies could silently become separate pilot accounts.

**E27 — Unilever New Haven. Rejected and corrected.** The unreceived 6–10 file reportedly
stores `2029-03-31` for a source that says **"by spring 2029."** That is a fabricated day
and a fabricated month, and it is the exact failure ADR 0004 was written to prevent. Under
the temporal model it is stored as:

```text
temporal_raw_expression : "expected to be fully operational by spring 2029"
temporal_start          : 2029-03-01
temporal_end            : 2029-05-31
temporal_precision      : season          -- see below
temporal_basis          : stated
```

**This surfaces a real gap in ADR 0004.** The precision enum has `half_year` but no
`season`, and "spring" is neither a half-year nor a quarter — it is a named period whose
calendar boundaries are conventional and hemisphere-dependent. `season` is therefore added
to `temporal_precision`, with the raw expression always preserved so a reader sees
"spring 2029" rather than an interval we chose. **An external record's error improved the
schema** — worth noting, since that is the value of an adversarial input even when the
record itself is wrong.

A second point on the same record, which the external research did not raise: the New
Haven facility is a **$270M R&D innovation centre for personal care, beauty, and
wellbeing**, replacing the Trumbull campus. It is not F&B production. Its Haskell
alignment is architecture, facility design, and construction — not process or packaging
systems. Under §7.5 it is `fnb_adjacent` at most, and it is a useful test that the scope
classification actually changes what a card recommends.

---

## 5. Rejected recommendations, with reasons

### 5.1 Proxy rotation to bypass Cloudflare, paywalls, 403s (E18) — **Rejected**

The automation review proposes, as a permissible operator action, that "a platform
engineer updates the crawler configuration (e.g., adding proxy rotation or
Playwright/headless browser support)."

Proxy rotation to defeat bot protection is an evasion technique. It conflicts directly
with `00`'s prohibition on unauthorized access and with ADR 0002's allowlist model, and it
converts a licensing question into a technical arms race we would be on the wrong side of.

**Permitted ladder when a source blocks us**, in order: an authorized API; a licensed
feed; an approved constrained-browser profile for that specific source; reference-only
discovery; retire the connector and record the coverage gap. A blocked source becomes a
**declared coverage gap**, which is a supported, visible state (ADR 0010) — not a problem
to route around. Headless rendering for an *approved* source is already permitted and is
unaffected.

### 5.2 Recency-based evidence overwrite / "evidence decay" (E19) — **Rejected**

The review proposes that "newer source documents ... automatically overwrite older
conflicting edge properties," with `temporal_weight` and `superseded_by_node_id`.

The **problem** is real and the **remedy is backwards**. Evidence is immutable: it records
what a source said at a retrieval time, and a later document does not make an earlier one
un-said. Overwriting destroys the audit trail that `01`'s evidence-first principle exists
to protect — and it is wrong on the merits, since a syndicated aggregator publishing after
a primary source is newer and less authoritative.

**Adopted instead:** claims are preserved immutably and connected by typed relationships —
`corrects`, `retracts`, `withdraws`, `contradicts`, `supersedes`, `delays`, `cancels`. The
**current view is computed**, not stored, from source authority, specificity, temporal
applicability, and correction status, in that order. `superseded_by` survives as a
*relationship*, never as a mutation. The review's own acceptance test still passes: a
retraction moves the opportunity to a withdrawn state automatically — while both documents
remain readable.

### 5.3 Forced 95% automatic conflict resolution (E20) — **Rejected**

Proposed pilot exit criterion: "95% of conflicting entity data is automatically resolved
using confidence scoring/temporal decay without requiring a human review queue."

This makes a **wrong merge cheaper than an honest unresolved record**, inverting ADR 0005.
The cost is asymmetric: a missed match costs one opportunity, a bad merge corrupts an
account timeline and every score computed from it. A target expressed as a resolution
*percentage* can always be met by lowering the threshold.

**Adopted instead:** the metric is **zero incorrect merges** on the adversarial set, with
unresolved rate reported but not targeted, and competing hypotheses retained. Note the
review's own scenario proves the point — its "Schrödinger's Facility" case, where a
correction reattributes a project from PepsiCo to an independent bottler, is one where the
*correct* automated behavior is to hold both hypotheses until the correction is processed.

### 5.4 Generic P99 novelty threshold (E21) — **Rejected**

"An alert fires when `new_entities_extracted_7d` drops below the historical P99 confidence
interval." Two flaws: a fixed 7-day window is meaningless for a source that publishes
quarterly, and a P99 band on a low-count series is dominated by noise. Replaced by E9's
per-source declared cadence, baseline yield, minimum-content checks, and change detection.

### 5.5 `DLQ > 0` as universally critical (E22) — **Rejected**

A single permanently-malformed PDF would page someone forever, which trains operators to
ignore the alert — the failure mode the whole observability design is meant to avoid.
Replaced by: oldest-message age, retry-exhaustion rate, depth relative to source volume,
and an SLO weighted by source priority.

### 5.6 14-day zero-touch run as sole proof (E23) — **Rejected as sufficient**

Adopted as *necessary, not sufficient*. Fourteen days does not exercise a quarterly
incentive board even once. Automation exit now requires: **at least two expected
collection cycles for every pilot source** (which for some sources is months), a
production-like soak, and a passing fault-injection suite (E12). This also corrects the
v0.2 Phase 2 exit criterion, which inherited the 14-day window from `05`.

### 5.7 Every non-engineering review state is a Sev-1 outage (E24) — **Rejected**

The proposed Gate 1 amendment would classify any state requiring a non-engineering user to
act as a Sev-1 blocking further development. It over-reaches in a way that would damage
the product: `00` explicitly *permits* source approval, connector reauthorization, and
operator-assisted CAPTCHA, and `01` requires Pursue/Watch/Assign/Dismiss feedback. Under
the proposed rule, a business user dismissing a false positive is a Sev-1.

**Adopted instead** — severity by consequence, not by who acts:

| Severity | Condition |
| --- | --- |
| **Sev-1** | Routine operation requires a human to extract documents, enter leads, re-key content, or repair source records; or silent data corruption is occurring |
| **Sev-2** | A high-priority account's expected coverage is degraded beyond one cycle, or alerts are materially wrong |
| **Sev-3** | A bounded Connector Care action is pending within SLA |
| **Not an incident** | Business feedback, source approval, tier changes, dismissals with reason |

The non-negotiable is preserved exactly: **routine operation cannot depend on analysts.**
Business decisions are the product working, not an outage.

### 5.8 Backtest thresholds as production rules (E25) — **Rejected as rules**

The 500,000 gallons/day water threshold, the SPE-implies->$100M correlation, the Series C
funding cut-off, and the plant-manager job-title filter are **not supported by the
returned sample** — twenty uncited examples cannot establish a threshold. Retained as
hypotheses with `evaluation_status = 'hypothesis'` and no weight, pending a cited corpus.

---

## 6. Research-claim staging contract

External research enters a staging layer and never the canonical tables. The full DDL
proposal is in `11_SCHEMA_DELTA_PROPOSAL.sql`; the interchange contract is below.

### 6.1 Claim record (JSON Schema, draft 2020-12)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://haskell.com/schemas/fb-radar/research-claim.schema.json",
  "title": "External research claim",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "research_claim_id", "source_file", "source_record_locator", "claim_type",
    "subject_ref", "predicate", "object_value", "observed_at",
    "verification_status", "source_authority", "scope_classification",
    "activation_status"
  ],
  "properties": {
    "research_claim_id": { "type": "string", "minLength": 1 },
    "source_file": { "type": "string", "minLength": 1 },
    "source_record_locator": { "type": "string", "minLength": 1 },
    "claim_type": {
      "type": "string",
      "enum": ["entity", "alias", "facility", "relationship", "project", "source", "hypothesis"]
    },
    "subject_ref": { "type": "string", "minLength": 1 },
    "predicate": { "type": "string", "minLength": 1 },
    "object_value": {},
    "valid_time": {
      "type": ["object", "null"],
      "additionalProperties": false,
      "properties": {
        "raw_expression": { "type": ["string", "null"] },
        "start": { "type": ["string", "null"], "format": "date" },
        "end": { "type": ["string", "null"], "format": "date" },
        "precision": {
          "type": "string",
          "enum": ["exact_day", "month", "quarter", "season", "half_year",
                   "year", "range", "relative", "unknown"]
        },
        "basis": { "type": "string", "enum": ["stated", "inferred", "unknown"] },
        "inference_note": { "type": ["string", "null"] }
      },
      "required": ["precision", "basis"]
    },
    "observed_at": { "type": "string", "format": "date" },
    "evidence_urls": {
      "type": "array",
      "items": { "type": "string", "format": "uri" },
      "uniqueItems": true
    },
    "verification_status": {
      "type": "string",
      "enum": ["unverified", "corroborated", "verified"]
    },
    "source_authority": {
      "type": "string",
      "enum": ["primary", "official_secondary", "secondary", "unknown"]
    },
    "scope_classification": {
      "type": "string",
      "enum": ["fnb_core", "fnb_adjacent", "non_fnb", "unknown"]
    },
    "activation_status": {
      "type": "string",
      "enum": ["staged", "validated", "rejected", "superseded", "needs_evidence"]
    },
    "rejection_reason": { "type": ["string", "null"] },
    "pilot_account_ref": { "type": ["string", "null"] },
    "normalized_target_id": { "type": ["string", "null"] }
  },
  "allOf": [
    {
      "if": {
        "required": ["activation_status"],
        "properties": { "activation_status": { "const": "rejected" } }
      },
      "then": {
        "required": ["rejection_reason"],
        "properties": { "rejection_reason": { "type": "string", "minLength": 1 } }
      }
    },
    {
      "if": {
        "required": ["activation_status"],
        "properties": { "activation_status": { "const": "validated" } }
      },
      "then": {
        "required": ["normalized_target_id", "evidence_urls"],
        "properties": {
          "normalized_target_id": { "type": "string", "minLength": 1 },
          "evidence_urls": { "type": "array", "minItems": 1 }
        }
      }
    }
  ]
}
```

The two conditional blocks are written to constrain the **type** of the required field,
not merely its presence. `required` alone is satisfied by an explicit `null`, which would
let a rejected claim carry no reason — a negative test caught exactly that during
validation of this document (§8).

### 6.2 Worked example — the Unilever record, corrected

```json
{
  "research_claim_id": "rc_2026_08_13_unilever_new_haven_timing",
  "source_file": "pilot_accounts_6_10_graph_records.jsonl",
  "source_record_locator": "not received; claim taken from handoff document §4.4",
  "claim_type": "project",
  "subject_ref": "Unilever New Haven Global Innovation Centre",
  "predicate": "expected_operational_date",
  "object_value": { "amount_usd_m": 270, "site": "2 College Street, New Haven, CT" },
  "valid_time": {
    "raw_expression": "expected to be fully operational by spring 2029",
    "start": "2029-03-01",
    "end": "2029-05-31",
    "precision": "season",
    "basis": "stated",
    "inference_note": null
  },
  "observed_at": "2026-08-13",
  "evidence_urls": [
    "https://www.unilever.com/news/news-search/2026/unilever-unveils-plans-for-270-million-usbased-global-innovation-centre/"
  ],
  "verification_status": "verified",
  "source_authority": "primary",
  "scope_classification": "fnb_adjacent",
  "activation_status": "staged",
  "rejection_reason": null,
  "pilot_account_ref": "hv_09_unilever",
  "normalized_target_id": null
}
```

Both documents above were validated: the schema parses as JSON and the example validates
against it (§8).

### 6.3 Activation gate — fails closed

A staged claim may only reach `validated` when **all** hold. Any failure leaves it
`needs_evidence` or `rejected` with a reason; nothing partially activates.

1. At least one `evidence_urls` entry, resolvable and archived under an access mode that
   supports the claimed authority.
2. `valid_time.precision` is not `unknown` whenever any date is asserted, and `basis` is
   `inferred` only with an `inference_note`.
3. Every controlled field holds a value from its enum — no free-text status.
4. `subject_ref` resolves to an existing canonical entity, or to a candidate that itself
   passes ADR 0005's resolution ladder. **Unresolved is a valid outcome and blocks
   activation without being an error.**
5. `scope_classification` is not `unknown`.
6. `pilot_account_ref` is set for any claim about a Highest Value account or its
   subsidiaries, so acquired and adjacent entities cannot silently become new accounts.
7. Ownership and facility-operator claims carry `from_date`/`to_date` (ADR 0005, C24).

---

## 7. Verification gaps and open tasks

Named, not filled. None is a blocker for design approval; each blocks a specific build step.

| # | Gap | Blocks |
| --- | --- | --- |
| V1 | **`pilot_accounts_6_10_graph_records.jsonl` was not supplied.** Mars, Hershey, Kimberly-Clark, Unilever, and P&G have no external graph records in hand | Staging import for accounts 6–10 |
| V2 | **No external graph records exist for accounts 1–5** — PepsiCo, Coca-Cola, Nestlé, Kroger, Tyson. Not fabricated | Staging import for accounts 1–5 |
| V3 | Handoff aggregates (53 records, 19 facilities, 6 projects, 11 without evidence) unverifiable without V1 | Nothing; recorded for accuracy |
| V4 | BuildCentral **F&B/industrial coverage depth** — advertised verticals do not list food and beverage | Vendor decision D21 |
| V5 | ConstructConnect API entitlement, coverage, pricing, licensing | Vendor decision D21 |
| V6 | IIR IDB API version, F&B depth (portal presents an energy-oriented database), pricing, redistribution and model-processing rights | Vendor decision D21 |
| V7 | Shovels Decisions API jurisdictional overlap with pilot geographies; redistribution rights | Vendor decision D21 |
| V8 | FSIS MPI API schema, rate limits, establishment-to-organization join quality | Phase 1 connector build |
| V9 | EPA FRS ID coverage for pilot facilities | Phase 1 facility resolution |
| V10 | All 25–30 newsroom endpoints remain **Unverified** (corporate domains blocked here) | Connector enablement |
| V11 | Backtest source URLs — most rows cite `Public Domain [C]` or a bare domain | Evaluation corpus |
| V12 | Negative-control citations | Evaluation corpus |
| V13 | Direct EDGAR re-confirmation of all 15 CIKs and per-form inventories from an unblocked environment | Connector enablement |
| V14 | Nestlé CIK 792990 **filing-type inventory** — identity now verified; the ownership-only classification is inferred from filer status | Coverage classification |

---

## 8. Validation performed

| Check | Result |
| --- | --- |
| All three JSONL inputs parse as JSON Lines | Pass — 21 + 27 records; the 6–10 file was absent, not malformed |
| Markdown tables in all changed files: column-count consistency | Pass — 0 mismatches |
| Code fences balanced in all changed files | Pass |
| JSON Schema in §6.1 parses | Pass |
| Example in §6.2 validates against §6.1 | Pass |
| Negative tests against the contract (rejected-with-null-reason, rejected-without-reason, validated-without-target, validated-with-empty-evidence, out-of-enum scope, out-of-enum precision) | Pass — all six correctly rejected. The first negative test initially **failed**, revealing that `required` alone permits an explicit `null`; the conditional blocks were tightened to constrain type and re-tested |
| Internal document references (`10`–`14`) resolve | Pass |
| ADR filenames referenced exist on disk | Pass |
| No canonical table receives an external record | Pass — staging only |
| No migration created or applied | Pass |

---

## 9. Change register

Each external claim that changed the design, its supporting source, and where it landed.
Claim class: **F** = verified fact, **V** = vendor claim, **H** = hypothesis, **T** = task.

| Claim | Class | Supporting source | Destination |
| --- | --- | --- | --- |
| FSIS MPI establishment API exists | F | `fsis.usda.gov/science-data/developer-resources/mpi-api` | `12` pilot stack; `10` §7.2–7.3 |
| FDA registration list FOIA-exempt (21 U.S.C. 350d(a)(5)) | F | FDA guidance on food facility registration | `12` §Permanently unavailable |
| BuildCentral publishes an API datasheet | V | `constructionwire.com/Content/pdf/buildcentral_api.pdf` | `12` vendor track; `13` D21 |
| ConstructConnect official developer portal | V | `developer.io.constructconnect.com/overview` | `12` vendor track; `13` D21 |
| IIR IDB API — REST, OpenAPI 3.0, JWT | V | `api.industrialinfo.com/idb/` | `12` vendor track; `13` D21 |
| Nestlé CIK 0000792990 | F | `sec.gov/Archives/edgar/data/792990/…` | `12` §3 — Unverified → **Verified** |
| KDP closed JDE Peet's 1 Apr 2026, 96.22% | F | KDP 8-K; company release | `12` §14; `10` §7.1a |
| K-C/Kenvue expected Q4 2026 | F | Kenvue Q2 2026 results | `12` §8; `10` §7.1a |
| Unilever New Haven "by spring 2029" | F | Unilever press release, 28 May 2026 | ADR 0004 (`season` added); `14` §4.4 |
| Outbound-alert circuit breaker | H→control | Automation review §I.4 | `10` §8.6; ADR 0010 |
| Correction/retraction/supersession states | H→control | Automation review §I.2 | `10` §6.10; `11`; ADR 0012 |
| Poison-message isolation, parked queues | H→control | Automation review §I.3 | `10` §8.6; `11` |
| Per-source cadence and yield baselines | H→control | Automation review §I.1 | `10` §8.6; `11` |
| Ten failure-injection tests | T | Automation review §II | `10` §8.7, §9 |
| Signal subtypes (8) | H | Backtest §4 | `11` `signal_event_types`, non-scoring |
| Signal combinations (2) | H | Backtest §5 | `11` `scoring_configs`, disabled |
| Ten negative controls | H | Backtest §3 | Evaluation corpus, citation required |
| Vendor track before municipal connectors | T | Handoff §6.10 | `13` D21 |
| Four-value scope vocabulary | F→design | Handoff §6.11 | `10` §7.5; `11`; `13` D11 |
| Research-claim staging contract | F→design | Handoff §8 | `11`; `14` §6; ADR 0011 |
