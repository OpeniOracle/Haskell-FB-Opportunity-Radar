# External Research Reconciliation

Disposition of the Gemini and Perplexity research outputs against the v0.2 design.

Version 0.2 · Prepared 2026-08-13 · Status: **for stakeholder review at Gates G-2 and G-3**

**v0.2 is an attachment-recovery pass.** `pilot_accounts_6_10_graph_records.jsonl`, missing
from the original upload, was supplied and has been validated. External graph coverage is
now **accounts 6 through 15**. Accounts 1 through 5 remain absent. No other finding in
this document was reopened.

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
| `pilot_accounts_6_10_graph_records.jsonl` | **Yes — recovered in v0.2** | **26** | Parses as valid JSON Lines; Mars, Hershey, Kimberly-Clark, Unilever, P&G |

**Recomputed aggregates.** With both graph files in hand, every figure below was counted
independently rather than taken from the handoff document. **All of the handoff's
aggregates check out.**

| Measure | 6–10 | 11–15 | Total | Handoff said | Agrees |
| --- | ---: | ---: | ---: | ---: | :---: |
| Records | 26 | 27 | **53** | 53 | ✓ |
| Facility records | 11 | 8 | **19** | 19 | ✓ |
| Project records | 3 (`capital_project`) | 3 (`project`) | **6** | 6 | ✓ |
| Records with no evidence locator | 7 | 4 | **11** | 11 | ✓ |
| Entity records | 8 | 9 | 17 | — | — |
| Ownership / relationship records | 3 | 4 | 7 | — | — |

Record types in the recovered file: **8 `entity`, 3 `ownership`, 11 `facility`,
3 `capital_project`, 1 `claim` = 26** — matching the expected characteristics exactly.

**Referential integrity: clean.** All 26 records parse, and **every internal reference
resolves** — `operator_entity_id`, `from_entity_id`, `to_entity_id`, `subject_entity_id`,
`facility_id`, and the nested `historic_relationship.entity_id`. Zero dangling
identifiers. This is the strongest structural property of either file and is worth saying
plainly: the file is internally coherent. Its problems are contract problems, not
integrity problems.

External graph coverage is therefore **accounts 6 through 15**. **Accounts 1 through 5 —
PepsiCo, The Coca-Cola Company, Nestlé, Kroger, and Tyson Foods — remain absent**, and
nothing has been fabricated to fill that gap. It is recorded as V2 in §7.

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
| Industrial Info Resources IDB API | **Verified (existence)**; version **externally observed, not reproduced in-session** | `api.industrialinfo.com/idb/` — REST, OpenAPI 3.0, JWT auth, add-on to a subscription. The official documentation portal reports **v2.7, released 28 July 2026**. That page is **blocked by this session's egress proxy**, so the version was not reproduced here; search results reviewed in-session surfaced only an older v2.6 reference, which is **stale, not authoritative**. Treat v2.7 as current |
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
OpenAPI 3.0, JWT. The official documentation portal reports **v2.7, released 28 July
2026**; `api.industrialinfo.com/idb/` is blocked by this session's egress proxy, so that
version is **externally observed but not reproduced in-session**. An in-session search
surfaced an older v2.6 reference — that is a stale secondary result, not evidence that
v2.6 is current, and it should not be cited as such.

The modification that stands is a different one: the portal presents the service as access
to **IIR Energy's** market-intelligence database. IIR's F&B and process depth is a
vendor-demo question, not an established fact.

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

**E26 — Staging only.** All 53 records across both files are not import-ready.

**Schema divergence, now confirmed from both sides rather than inferred.** The two files
were produced against different implicit schemas, and the incompatibility runs deeper than
the handoff document's field table showed — it reaches the record-type vocabulary itself:

| Concept | Accounts 6–10 | Accounts 11–15 |
| --- | --- | --- |
| Record identifier | `entity_id`, `facility_id`, `project_id`, `claim_id` | `id` |
| Entity type | `entity_class` | `entity_type` |
| SEC data | nested `sec: {cik, coverage}` | flat `cik`, `sec_coverage` |
| Project record type | `capital_project` | `project` |
| Ownership record type | `ownership` (`from_entity_id`/`to_entity_id`) | `relationship` (`subject_id`/`predicate`/`object_id`) |
| Evidence | `evidence_url` (single string) | `sources` (array) |
| Locality | `locality`, `county`, `state` | `city`, optional `county`, `state` |
| Money | `amount_usd`, `capex_usd` | `capital_usd_m` |
| Area | `size_sqft` | `square_feet` |
| Scope | free-text `sector` | `fnb_scope` |
| Facility types | `facility_types` (array) | `facility_type` (string) |
| **Record types unique to the file** | `capital_project`, `ownership`, `claim` | `project`, `relationship`, `alias`, `network_assertion` |

**22 field names appear only in the 6–10 file and 37 only in the 11–15 file.** Neither file
can be read by a parser written for the other. This confirms and strengthens the v0.1
finding rather than reopening it: staging normalization is not optional tidying, it is the
only way both files can coexist.

Everything below applies to both files unless stated:
- **Uncontrolled status values, in both files.** The 11–15 file's `evidence_status` carries
  seven distinct values; the 6–10 file carries **six more, none of which overlap**:
  `confirmed`, `confirmed_adjacent`, `confirmed_nonfood`,
  `confirmed_company_level_not_site_roster`, `corroborated`, `historic_only_for_unilever`.
  Four of those six fuse provenance with *scope* — "adjacent," "nonfood,"
  "company_level_not_site_roster," and an entity name embedded in a status value. Thirteen
  distinct evidence-status values across 53 records, one of which
  (`requires_closing_release_for_graph_activation`) is not an evidence status at all but an
  activation gate.

  The same mixing runs through `operational_status`, where the 6–10 file has six values
  including three compounds — `operating_upgrading`,
  `plant_operating_distribution_center_planned`, and
  `operating_historic_unilever_relationship`. The middle one encodes **two facilities'
  states in one string**: an operating plant and a planned distribution centre.
  `sector` is free text with five spellings across eight entities.
- **Missing provenance.** **11 of 53 records carry no evidence reference** — 4 in the 11–15
  file (two aliases, the `danone_sa → whitewave` relationship, the `ghost_lifestyle`
  entity) and **7 in the 6–10 file, all of them `entity` records**: Kellanova, Hershey,
  LesserEvil, Kimberly-Clark, Unilever, MICC, and P&G. Every one is marked `confirmed`
  with nothing to confirm it against. Note the pattern: in the 6–10 file the *unevidenced*
  records are precisely the entity records, while every facility, project, and ownership
  record carries a URL. Entity existence was treated as self-evident. For Hershey or P&G
  that is defensible; as a contract rule it is not, and CIK-bearing entities have an
  obvious evidence locator available.
- **Raw URLs as evidence.** Graph assertions embed publisher URLs directly. A URL is
  evidence *metadata*; assertions must reference normalized evidence IDs.
- **Date strings without precision.** `2017-04`, `2024-Q3`, `2025`, `2024-early`,
  `announced_construction_expected_early_2025` — five different temporal grains in
  ordinary strings, exactly what ADR 0004 exists to prevent.
- **No pilot-account mapping.** No record in either file carries the Highest Value row it
  belongs to, so subsidiaries and acquired companies could silently become separate pilot
  accounts. The 6–10 file makes the risk concrete: Kellanova, LesserEvil, and The Magnum
  Ice Cream Company are all first-class entities with no marker tying them to Mars,
  Hershey, and Unilever respectively.
- **Facilities attributed to absent entities.** `fac:natures_bakery_salt_lake_city_ut` and
  `fac:royal_canin_lewisburg_oh` are operated by `org:mars_incorporated`, which is
  referentially valid but flattens Nature's Bakery and Royal Canin — real operating
  entities — into their parent. Two Mars facility assertions also cite
  `mars.com/about/history`, a corporate history page, which is weak provenance for a
  facility claim regardless of whether the claim is true.
- **One internal contradiction — now resolved, see §4.4b.** The Unilever→MICC ownership
  record sets `valid_to: 2025-12-07` while its own `evidence_quote` says "demerged 8 Dec
  2025." Neither is right, and the disagreement turned out to be diagnostic rather than
  sloppy: the record was collapsing **three distinct events** into one date field. It also
  has `valid_from: null`, so the interval is open at the start.

### 4.4b Unilever → MICC: three events, not three conflicting dates (V16, closed)

The apparent contradiction resolves cleanly against primary sources. The record was not
wrong about *a* date; it was trying to store a sequence in a single field.

| Date | Event | What it is |
| --- | --- | --- |
| **1 July 2025** | The Magnum Ice Cream Company began standalone operations | **Operational separation.** Not an ownership change |
| **6 December 2025** | Unilever completed the legal demerger of its Ice Cream business | **The control event.** This is what ends the parent relationship |
| **8 December 2025** | MICC listing and trading commenced | **The market event.** Not a control event |

And the fact that changes the shape of the record: **Unilever retained a minority interest
of approximately 19.85%**, to be sold down over time. This was not a clean break.

**Interval convention, stated explicitly.** `from_date`/`to_date` pairs in this schema are
**half-open `[from_date, to_date)`** — `from_date` inclusive, `to_date` exclusive, so
`to_date` is the first day on which the relationship no longer holds. Consecutive intervals
are then adjacent with no gap and no overlap, and as-at-date resolution is
`from_date <= :as_at and (to_date is null or to_date > :as_at)`.

Under that convention the controlling relationship ends at **`to_date = 2025-12-06`** — the
legal demerger, not the listing. Unilever controlled MICC through 5 December inclusive. Had
the convention been inclusive, the correct value would have been 2025-12-05; it is stated
in `11_SCHEMA_DELTA_PROPOSAL.sql` so the two can never be silently confused.

```text
organization_relationships
  (unilever_plc, micc, 'parent_subsidiary', pct NULL,  from …,          to 2025-12-06)
  (unilever_plc, micc, 'minority_interest', pct 19.85, from 2025-12-06, to NULL)
```

**Two edges, not one ended edge.** Recording only the terminated parent relationship would
assert a complete separation that did not occur, and would drop a stake large enough to
matter commercially. `minority_interest` and `ownership_percent` were added to the schema
for exactly this case; a demerger with a retained stake is common enough that the model has
to express it.

The 1 July 2025 operational separation is **not an ownership edge at all**. It belongs on
the facility and operational timeline — and it is the date that explains why a mid-2025
plant record might already name MICC as operator while Unilever still legally controlled the
business. That is directly relevant to V17, which stays open: the Sikeston evidence is a
Unilever page describing an ice cream factory, and it does not by itself establish who
operates that plant today.

Sources: Unilever's demerger page and its 2026 performance release, and MICC's own investor
demerger-information page (all three listed in §9).

### 4.4a Staging dry run — accounts 6–10

The recovered file was run against the activation gate in §6.3. **Not one record reaches
`validated`**, because every record in the file lacks a scope classification, a
pilot-account reference, and any temporal precision or basis field.

| Verdict | Count | Cause |
| --- | ---: | --- |
| `rejected` | **1** | `proj:unilever_new_haven_2026` — unsupported exactness (see below) |
| `needs_evidence` | **9** | 7 entity records with no evidence locator; the Unilever→MICC ownership record with no `valid_from`; `fac:sikeston_ice_cream_mo` with an unresolved operator |
| `staged` | 16 | Structurally sound, still blocked on scope, account mapping, and temporal precision |
| `validated` | **0** | — |

`fac:sikeston_ice_cream_mo` deserves a note as a case the gate handles *well*. Its
`relationship_type` is literally `current_operator_unverified`, its `operator_entity_id`
points at MICC, its `historic_relationship` points at Unilever with a `valid_to`, and its
evidence URL is a Unilever page. The research tool was being honest about not knowing who
operates the plant post-demerger. Under ADR 0005 that is a **correct terminal state**, not
a defect — the record sits in `needs_evidence` and nothing is guessed.

**E27 — Unilever New Haven. Rejected and corrected. Now confirmed from the file itself.**
`proj:unilever_new_haven_2026` line 24 carries
`"expected_operational_date": "2029-03-31"` against a source that says the centre is
**"expected to be fully operational by spring 2029."** That is a fabricated day *and* a
fabricated month, and it is the exact failure ADR 0004 was written to prevent.

**The staging gate rejects it** — this is the one `rejected` verdict in the dry run above.
It is not silently repaired: a rejected claim carries a `rejection_reason`, and the
normalized form below must be re-staged as a new claim with its own evidence. Under the
temporal model that form is:

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
  "source_record_locator": "line 24",
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
| ~~V1~~ | **Closed in v0.2.** `pilot_accounts_6_10_graph_records.jsonl` was supplied and validated: 26 records, all references resolving. Accounts 6–10 now have external graph records | — |
| V2 | **No external graph records exist for accounts 1–5** — PepsiCo, The Coca-Cola Company, Nestlé, Kroger, Tyson Foods. **Still open.** Not fabricated | Staging import for accounts 1–5 |
| ~~V3~~ | **Closed in v0.2.** All handoff aggregates independently recomputed and confirmed: 53 records, 19 facilities, 6 projects, 11 without evidence | — |
| V15 | 11 of 53 records need an evidence locator before activation; 7 are CIK-bearing entity records where one is readily available | Staging activation |
| ~~V16~~ | **Closed.** Not conflicting dates but three distinct events — operational separation 1 Jul 2025, legal demerger 6 Dec 2025, listing 8 Dec 2025 — plus a retained ~19.85% minority interest. Modeled as two edges under a stated half-open interval convention. See §4.4b | — |
| V17 | **Still open.** The operator of `fac:sikeston_ice_cream_mo` after the separation is not established by the supplied evidence, which is a Unilever page. The 1 Jul 2025 operational-separation date makes the ambiguity explicable but does not resolve it | Staging activation |
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
| All four JSONL inputs parse as JSON Lines | Pass — 21 + 27 + 26 records |
| Recovered 6–10 file matches expected characteristics | Pass — 26 records: 8 entity, 3 ownership, 11 facility, 3 capital_project, 1 claim |
| Referential integrity of the 6–10 file | Pass — **0 dangling references** across `operator_entity_id`, `from_entity_id`, `to_entity_id`, `subject_entity_id`, `facility_id`, `historic_relationship.entity_id` |
| Aggregates recomputed from both graph files rather than taken from the handoff | Pass — 53 / 19 / 6 / 11, all matching |
| Staging dry run of the 6–10 file against §6.3 | Pass — 0 validated, 16 staged, 9 needs_evidence, 1 rejected |
| Unilever `2029-03-31` is rejected, not silently normalized | Pass |
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

---

## 10. Primary sources for the V16 resolution

- [Unilever — The Magnum Ice Cream Company demerger](https://www.unilever.com/investors/the-magnum-ice-cream-company-demerger/)
- [The Magnum Ice Cream Company — demerger information](https://corporate.magnumicecream.com/en/investors/demerger-information.html)
- [Unilever — Sharper focus and disciplined execution driving competitive performance (2026)](https://www.unilever.com/news/press-and-media/press-releases/2026/sharper-focus-and-disciplined-execution-driving-competitive-performance/)

These were supplied as primary sources with the correction. Consistent with the
verification limits stated in §3, **they were not fetched in-session** — this
environment's egress proxy blocks corporate domains — so the three-event sequence and the
~19.85% retained interest are recorded as **stated by primary sources, not reproduced
here**. They should be re-confirmed at connector dry-run time along with the other
Unverified endpoints.

