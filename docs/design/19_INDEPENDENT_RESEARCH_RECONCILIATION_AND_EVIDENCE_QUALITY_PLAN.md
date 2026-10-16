# 19 — Independent research reconciliation and evidence-quality plan

**Status:** Audit and plan. **Read-only analysis; no application code, schema, data, secret, deployment or connector was changed.**
**Date:** 2026-10-16 · **Repository:** `OpeniOracle/Haskell-FB-Opportunity-Radar`
**Supersedes:** nothing. **Extends:** `18_PHASE_2_ENGINEERING_AUDIT_AND_DATA_ACTIVATION_PLAN.md`
**Companion:** `19a_RECONCILIATION_APPENDICES.md` (verification detail, dataset statistics, probe table, mapping tables)

> **Where this file lives.** It is on the audit branch `claude/modest-fermi-eu1kn3`, beside doc 18. **Neither file is on `main`.**
> Everything cited below about application behaviour is cited against `main` at `72a7f63` unless it says otherwise.

---

## 0. State of the repository at the time of writing

| Item | State | Evidence |
|---|---|---|
| `main` | `72a7f638adae0475d871a446ddab83170f89397b` (merge of #16) | `git rev-parse origin/main`, 2026-10-16 |
| **PR #17** — Ingestion integrity (roadmap PR 1) | **Open. Not merged.** Head `9fa6667`. 8 check runs `success` (incl. PostgreSQL 16 and 17) and 1 `neutral` (Netlify "pages changed") | GitHub check runs, head `9fa66674…` |
| Doc 18 (engineering audit) | Only on `claude/modest-fermi-eu1kn3` @ `d73162f`; **not on `main`, not in PR #17** | `git ls-tree` on each ref |
| Production remediation SQL | Shipped inside PR #17, **never executed** | PR #17 §runbook; no hosted change was made by this work |
| Roadmap numbering | "PR 1…17" in doc 18 are **plan numbers**, not GitHub numbers. GitHub #2, #3, #4 are old, closed Phase-1 PRs | `list_pull_requests` |

Naming used below: **R1** = roadmap PR 1 = GitHub PR #17. **R2** = schema, **R3** = derivation correctness, **R4** = durable execution, as numbered in doc 18 §11.

---

## 1. Executive conclusion

1. **The bundle is a good specification of what can go wrong, and a poor source of ground truth.** Its most reusable parts are the failure-mode taxonomy (FP01–FP27), the as-of / leakage design, and the separation of *what the evidence says* from *how mature the project is* from *whether Haskell can still win work*. Its labels are single-analyst, model-assisted, unadjudicated, and 128 of 130 rows carry no source text. **Nothing in it may be imported to production, and none of it supports a precision claim.**

2. **The three assignments' central defect claims are correct, and I confirmed each in the code on `main`** (§4.1): a 420-character proximity window is treated as one assertion; two regex categories grade a match `probable`; `probable` alone creates an opportunity; a negative match is not excluded from opportunity creation; and the filing/publication date is written as the project's `event_date` with basis `stated`. I additionally ran the unmodified classifier on 17 synthetic strings I wrote (§9.1, Appendix D): it produced `probable` matches for an unrelated dollar amount, a hypothetical, an anonymous rumour and an administrative wastewater renewal, and it **missed** an ordinary closure sentence because of a comma in the place name. Those are my probes — **not** the 36 the QA report describes, which were not supplied.

3. **Gemini's architecture is useful in outline and unusable in detail.** Its decision matrix, "unresolved is valid", "a directory disappearance is not a closure" and "a headquarters is not a plant" are sound and already match ADR 0005 and migrations 0006/0007/0023. Its three "real" facilities carry patterned, unsourced identifiers; all three of its endpoints are placeholders or malformed; its numeric thresholds have no calibration data; its table, flag and status names do not exist in this schema; its NAICS filter would drop cold storage (its own Record 4); and it assumes food plants are NPDES direct dischargers when the one real permit in the dataset (Niagara Plainfield) is an **indirect pretreatment permit**. **Do not seed any identifier, UUID, coordinate, address or threshold from it** (§7).

4. **Source verification is weaker than the assignment asked for, and I am saying so plainly.** Every external host is denied by this environment's proxy (even `example.com`), so **I retrieved zero original records.** I used web-search summaries as *secondary corroboration* for 14 records (§6). Nine are corroborated at that level, two partly, one not at all, and two were not searched; **none is "verified" in the strict sense.** That is "unverified (egress)", not "invalid". The exact human/CI procedure to finish this is in §6.3.

5. **The dataset is internally consistent but structurally thin.** JSON and CSV agree on all 130 × 49 cells; counts in its metadata match; no duplicates. But its 25 "promotable" units are **12 leakage groups**, rights class is absent (and ADR 0014 covers *federal* material only — of the 43 units hosted by government or public-authority sites, 13 are SEC and **30 are state/local**), and the labels are as-of replay labels with no current-status field (Coca-Cola UNITED Birmingham was "developing" at replay and is reported to be opening in September 2026).

6. **Recommended order:** merge R1 (PR #17) when you authorize → a **tests-only synthetic regression harness** (new, R1.5) → R2 schema (smaller than doc 18, plus a handful of audit-driven columns) → a **read-truncation guard** (new, R2.5, before any backfill) → R3 derivation correctness **gated by the harness** → R4 durable execution in parallel → **SEC exhibit repair as its own PR**, then FSIS, FRS, ECHO/NPDES, later state incentives and local planning (§11). **No model API cost is required for any of the first eight PRs** (§13).

7. **PR #17 has not merged.** It is ready on the evidence I have; merging, applying its remediation SQL, and everything after is yours to authorize.

---

## 2. How this audit was performed — and what it could not see

| Capability | Result |
|---|---|
| Read repo at `main`, audit branch, PR #17 branch; read ADRs, migrations, seeds | Done (file/line citations throughout) |
| Run repository code locally, read-only (the classifier, unmodified) | Done — `node --experimental-strip-types`, no database, no network |
| Read the five input files; verify `SHA256SUMS.txt` | Done — all seven files `OK` (Appendix B) |
| Audit `gold_reference.json` / `.csv` programmatically | Done — scripts are in the session scratchpad, not committed (docs-only branch); method in Appendix C |
| Retrieve any external source (SEC, state, corporate, EPA, FSIS) | **Blocked.** Proxy returns 403 on `CONNECT` for every host; `WebFetch` returns `ENOTFOUND`. I did not route around the control, probe `sec.gov`, or reuse the account email as an SEC User-Agent |
| Web **search** summaries | Available. Treated as secondary and labeled as such: *"corroborated by search summary; original not retrieved"* |
| Query or change production (Supabase, Netlify) | **Not done.** No SQL executed, no connector enabled, no setting touched, no research record inserted, the six prior opportunities untouched |

Consequences: (a) every "what the original says" below is the **dataset's own claim** or a **search summary**, never my reading of the original; (b) endpoint status for FSIS / FRS / ECHO is *documented, not probed*, exactly as doc 18 §6.1 defines.

---

## 3. Exact missing artifacts

The handoff (`REVIEW_AND_IMPORT_GATES.md` §3) and the QA report name artifacts that **were not in the upload and are not in the repository.** I searched the bundle, `main`, the audit branch and PR #17.

| # | Missing artifact | Referenced by | Why it matters | How to recreate **without misrepresenting a source** |
|---|---|---|---|---|
| M1 | `source_catalog.json` | QA report: "Every source is identified with an exact URL in `source_catalog.json`" | The only record of *retrieval*: when, with what result, with what bytes | One row per S01–S54: `source_id`, `canonical_url`, `retrieved_at` (UTC), `http_status`, `final_url` after redirects, `content_sha256` of the **raw bytes**, `content_type`, `retrieval_agent`, `rights_class` (§5.4), `access_mode` (ADR 0006), `reproducible` (yes/no/dynamic). Hash raw bytes, never a rendering. Generate it by a **human or an allowlisted job** — not by recollection |
| M2 | The executable synthetic probe suite (36 probes) and its result sheet | QA "Diagnostic against the existing classifier" (19/36 agreed; 7 false, all `probable`; 10 missed) | The only quantitative claim about the existing classifier | Cannot be recovered from the 19/36 summary. Rebuild from the failure-mode list: probe = fictional organisation, synthetic text, expected outcome, failure-mode tag. I authored 17 as a seed (Appendix D). The 36 should be re-derived by someone who did not see the classifier's output |
| M3 | Independent annotation rubric | QA "Limits"; gold JSON `benchmark_label_status` | Without it a second annotator cannot reproduce labels | Write from the 49-field schema: decision tree per field, one worked example per class, rules for `unresolved_evidence` and for date roles |
| M4 | Blind second-label adjudication | every row: `single_analyst_draft_pending_blind_human_adjudication` | Without it labels are one analyst's opinion, and that analyst was a model (`label_author = "…prepared with ChatGPT"`, 130/130) | Two humans label **without seeing** the first label; a third adjudicates disagreements; record Cohen's κ per field |
| M5 | Frozen permitted source spans | 128/130 rows are `locator_only` | A locator without frozen text cannot be re-checked once a page changes — and the Swire page demonstrably did (§6) | After adjudication only: store `span_text` (≤ the ADR 0014 "minimum supporting excerpt"), `span_sha256`, `document_sha256`, structural locator. Mark every paraphrase as an **analyst note**, never as a quote |
| M6 | `rights_class` per source | none | Needed to decide archive vs reference | §5.4 |
| M7 | Current-status field / status history per unit | dataset has `evaluation_as_of` only | Replay labels go stale (Coca-Cola UNITED Birmingham) | Add `status_as_of_*` rows (date, status, source) — never overwrite the replay label |
| M8 | The original Perplexity/Gemini conversations' source citations | Perplexity footnotes [1]–[44]; Gemini has none | Could not tell which claims were actually retrieved | Treat footnote URLs as *leads* only |

---

## 4. Reconciliation of every substantive recommendation

**Status vocabulary:** `IMPL(main)` implemented on `main` · `IMPL(#17)` implemented in unmerged PR #17 · `DEFECT` current code contradicts the claim's premise correctly · `PROPOSED` sound, not built · `ADR-CONFLICT` contradicts an accepted ADR or the schema · `UNSUPPORTED` no evidence offered or found · `DEFERRED` correct but later.

### 4.1 The QA report — code claims re-verified on `main` @ `72a7f63`

| QA claim | Verdict | Where I confirmed it |
|---|---|---|
| Classifier uses a 420-char window of action + asset + nearby fact | **DEFECT** (confirmed) | `connectors/classify.ts:115` `WINDOW_CHARS = 420`; `:171-175` window and `ASSET_TERMS.exec(window)`; `:179-184` first hit per corroboration rule. No code binds the amount, place, action and asset to **one** assertion |
| Two fact categories ⇒ `probable` | **DEFECT** (confirmed) | `classify.ts:146-153` (`corroboration.length >= 2`). The categories are regexes (`:59-66`), so "$12 million donation … in Dayton, Ohio" is *amount + place* |
| `upsertOpportunity` promotes on `probable`/`confirmed`/≥2 sources | **DEFECT** (confirmed) | `connectors/pipeline.ts:788-792` |
| A negative match can create an opportunity | **DEFECT** (confirmed) | `upsertOpportunity` (`:776`) has no `match.negative` guard; `negative` only changes the *link role* (`opportunitySignalRole`) |
| `document.publishedAt` becomes the signal event date | **DEFECT** (confirmed) | `pipeline.ts:~1099` `const eventDate = retrieved.document.publishedAt`; `eventDateForSignal` `:250` stamps `exact_day` / `stated` |
| Existing tests check vocabulary, not outcomes | **Accepted** | `app/src/test/secOpportunityPath.test.ts` asserts admitted fields and persistence; no test feeds adversarial prose and asserts *no* opportunity |
| Independence counted per source id, not per origin | **DEFECT (latent)** | `pipeline.ts:~685-692` `distinct.has(input.sourceId)`; with only SEC + Mars enabled, cross-source reposting cannot occur yet — it will with GDELT, state releases or trade press |
| The 36-probe diagnostic (19/36; 7 false `probable`; 10 missed) | **Unverifiable** (probes absent) — **plausible**: my 17 probes show the same classes (§9.1) | — |
| "Audit dated Oct 14 vs assignment Oct 13 — future-dated" (Perplexity) | **Rejected as stated** | Commit `d73162f` is `2026-10-14T00:53:25Z` = Oct 13 20:53 EDT, as the QA report notes; the Gemini print stamp is Oct 13 10:57 PM. A one-day difference is a timezone artefact. The database clock was not checked here |

### 4.2 Perplexity — "Claude Code Plan", indicator matrix, connector priorities

| # | Recommendation | Status | Detail and citation |
|---|---|---|---|
| P1 | Stale-run recovery; a stalled run is never "skipped/healthy" | **IMPL(#17)** | `runner.ts` lease/heartbeat, compare-and-set close. Not on `main` |
| P2 | Access mode enforced end-to-end | **IMPL(#17)** · DEFECT on `main` | `main` hard-codes `accessMode: 'structured_primary'` at `pipeline.ts:1019`; the DB check `evidence_reference_only_has_no_body` (0004:94) already exists. PR #17 makes the pipeline honour it |
| P3 | Remove the hard-coded cohort | **DEFECT** → **PROPOSED** (R5) | `runner.ts:~246` `.in('entity_key', ['sec:0000077476', 'sec:0000100493', 'radar:mars-incorporated'])` |
| P4 | Separate `published_at`, `event_date`, basis, `effective_at`, `retrieved_at` | **Partly IMPL / DEFECT** | `evidence.published_at/first_seen_at/last_seen_at` exist (0021); `evidence.temporal_*` exist (0004) but **the pipeline writes none**; `effective_at` does not exist. R3 + R2 |
| P5 | Repair SEC exhibit discovery; classify by type, not filename | **DEFECT** → **PROPOSED** (R5a) | `sec.ts:92` `ANNOUNCEMENT_EXHIBIT = /^ex-?99/i` is tested against the **file name** at `:423`; filer-agent names such as `d######dex991.htm` do not match |
| P6 | Reprocess and *dismiss with a reviewed reason* the false opportunities | **PROPOSED** (R3) | `opportunity_status_history` rejects `dismissed` without a reason (0012:72-73); ADR 0012 (supersede, don't overwrite). Operator step, dry-run first |
| P7 | Time-bounded relationship graph: parent, brand owner, operator, bottler, co-manufacturer, landlord | **IMPL (schema, empty)** · partly PROPOSED | `organization_relationships` admits `parent_subsidiary, brand_owner, division, joint_venture, franchise_bottler, co_manufacturer, former_parent, minority_interest` with half-open intervals (0007); `facility_organizations` admits `owner, operator, tenant, co_manufacturer, brand_produced_here, former_owner` (0007:22). **No `landlord` / `property_owner` type** and no reviewer-state column. Tables are unpopulated |
| P8 | Facility identifier list (FRS, NPDES, FSIS, RCRA, air permit, parcel, building permit, utility id, corporate code) | **IMPL (storage)** · vocabulary PROPOSED | `facility_identifiers(identifier_system text, identifier_value text, unique(system,value))`. `identifier_system` is **unconstrained free text** — doc 18 R2 proposes the vocabulary |
| P9 | `ConnectorManifest` with `accessMode: structured_primary \| reference_only \| discovery_only` | **ADR-CONFLICT** (the enum) · rest PROPOSED | ADR 0006 defines five modes (`structured_primary, archived_full_text, licensed_full_text, reference_only, metadata_only`); `discovery_only` is not one. Discovery is a **source role**, and GDELT is "reference mode" by ADR 0006. Keep rate limit, licence note, resolution strategy as manifest fields |
| P10 | Every retrieval records URL, time, HTTP status, hash, parser version, immutable raw ref | **Partly IMPL** | `content_hash`, `first/last_seen_at`, `transformation_version` (0004), `source_runs`. **HTTP status and parser version per retrieval are not persisted.** R2 "fingerprints" |
| P11 | Change-detection pipeline: normalize → resolve → diff against previous state → typed `change_event` → rules → cluster → **review before promotion** | **PROPOSED**; **product decision** | `change_events` exists (0012:13, object types include `facility`) but **no function writes it** (`git grep change_events -- app/netlify` is empty). "Review before promotion" contradicts today's automatic opportunity creation — decision **D-R1** (§14) |
| P12 | Typed event list (`permit_applied`, `incentive_approved`, `building_permit_issued`, `utility_capacity_requested`, `project_cancelled` …) | **PROPOSED** | Seed has 27 `signal_event_types` (`db/seed/0001`); none of those listed beyond `facility_closure` and `establishment_registered`. Add as **provisional seed rows** (ADR 0008: data, not migration) |
| P13 | Store origin identity (`originating_release_url`, `syndication_group_id`) so reposts are one origin | **PROPOSED** (R2 + R3) | See §4.1 independence row; ADR 0009 axis "independent corroboration" |
| P14 | State machine `candidate / plausible / verified / pursuit_ready / in_progress / completed / cancelled / dismissed` | **ADR-CONFLICT** (names) · transition rules **PROPOSED** | Schema: `stage in (emerging, developing, confirmed)`; `status in (new, watching, pursue, assigned, on_hold, dismissed, closed_won, closed_lost, cancelled, expired)` (`schemas/database.sql`). Handoff §7: preserve taxonomy. Adopt the **evidence rules for each transition**, not the names (§8) |
| P15 | Score evidence, maturity, fit, timing, penalties separately; sector modifier for adjacent accounts | **DEFERRED** (D16) | ADR 0009 axes recorded, "no threshold"; D16 open; doc 18 R14 |
| P16 | 12 acceptance tests | **PROPOSED** | All 12 are carried into §9 / §12 with a named test each |
| P17 | Source inventory (SEC, FSIS, FRS, ECHO, RCRAInfo, openFDA, USAspending, Socrata, state incentives, CAEATFA, newsrooms, GDELT, local planning, utilities) | Mixed | §10. SEC is the only one **verified in production** (doc 18). USAspending, RCRAInfo and CAEATFA are **new** relative to doc 18 and **DEFERRED** |
| P18 | Connector priorities 1–7 | **Consistent** with doc 18 §6.4 | One difference: Perplexity separates FRS identity (3) from ECHO change events (4); doc 18 puts them in PRs 7–8. Keep Perplexity's order (§10) |
| P19 | Indicator matrix with "reliability" and "promotion rule" | **PROPOSED**; reliability words **UNSUPPORTED** | "Very strong / Strong" are unmeasured. One internal inconsistency: *"building permit … promote immediately after operator/facility match"* vs. §P11 "require review before promotion" |
| P20 | Account gaps and alias seeding | **PROPOSED** | Schema exists; seeds do not; data-use restrictions on the 15 accounts apply |
| P21 | "Highest-value next sprint" (Kroger/Project Wave, Tyson Sherman, Swire, Niagara Vernon, Nestlé Gaffney, Danone DC) | **DEFERRED** (needs egress + human) | §6 covers four of the six at secondary level |

### 4.3 Gemini — see §7 for the red-team; summary disposition

| # | Recommendation | Status |
|---|---|---|
| G1 | USDA FSIS "bulk CSV or scraped HTML", sample URL `…/sites/default/files/...` | **UNSUPPORTED** (placeholder, ellipsis) |
| G2 | EPA FRS ArcGIS `watersgeo.epa.gov/arcgis/rest/services/FRS_INT/...` | **UNSUPPORTED** (placeholder) · differs from doc 18's documented Envirofacts / legacy routes |
| G3 | ECHO `echo.epa.gov/api/echo_rest_services.get_facility_info?output=JSON&p_id=` | **UNSUPPORTED** (malformed link, empty `p_id`, host differs from the `echodata.epa.gov/echo/…get_facilities` that doc 18 and Perplexity cite) |
| G4 | Hierarchy: UUID root → FRS ID / FSIS number hard match | **IMPL (storage) + consistent** with ADR 0005 step 1 |
| G5 | Level 2: ≤ 50 m **and** Jaro-Winkler ≥ 0.92; deterministic "confidence 1.0" for address + postal + name ≥ 0.95; 0.75–0.99 candidate; < 0.75 unresolved | **ADR-CONFLICT** (auto-link on similarity; "1.0" for a fuzzy rule) · thresholds **UNSUPPORTED** |
| G6 | `pending_review` unresolved state | Concept **IMPL**; name **ADR-CONFLICT** — `facility_candidates.corroboration_status ∈ {uncorroborated, corroborated, rejected, promoted}` (0006) |
| G7 | `is_headquarters` flag; verify via "commercial real-estate lookup or land-use code" | **ADR-CONFLICT** (`facilities.facility_role` already admits `headquarters`; `organization_locations` vs `opportunity_locations` split, 0023) · lookup source **UNSUPPORTED** |
| G8 | Time-bounded `entity-link` with `valid_from/valid_to` | **IMPL** as `facility_organizations` (half-open `[from_date, to_date)`) |
| G9 | Merge duplicate FRS records at identical lat/long within 10 m + overlapping permit IDs | **Accept only as candidate generation**; coordinate accuracy varies |
| G10 | Decision matrix (new NPDES permit → "Greenfield", modification → "Capacity Expansion", routine reissue → **"Discard"**, disappearance → ambiguous) | Guardrails **accept**; class names **ADR-CONFLICT**; "discard" conflicts with ADR 0007 (record a *silent/minor* change, don't drop it) |
| G11 | Five sample records, 1–3 labelled "(Real)" | **UNSUPPORTED — do not seed** (§7.1) |
| G12 | Filter NAICS 311xxx / 312xxx | **DEFECT in design** (§7.4) |
| G13 | `src/connectors/…`, `tests/test_*.py`, `pandas` | **ADR-CONFLICT** with stack: TypeScript, `app/netlify/functions/_shared/connectors/`, vitest, 30 s scheduled / 15 min background limits |
| G14 | Risks: URL rotation, FRS > 2 GB, **90-day grace before any closure** | **Accept all three**; amends doc 18 R6 (§11.3) |

---

## 5. Data fidelity audit of `gold_reference.json` and `.csv`

Method and scripts: Appendix C. All counts below were recomputed from the bundle and checked against its own metadata.

### 5.1 Structure — clean

| Check | Result |
|---|---|
| Records / fields / URLs | 130 / 49 / **54 distinct** (S01–S54, no gaps; 1 id ↔ 1 URL ↔ 1 publisher string) |
| JSON ↔ CSV | **0 mismatching cells**, identical column order and record order |
| Metadata vs recomputed | signal and opportunity distributions **match**; publication-date-unknown = 41 **matches** |
| Duplicates | none by locator within a source; no near-duplicate paraphrases (Jaccard ≥ 0.7); no repeated org + locality + event + date |
| Dates after the 2026-10-14 retrieval date | none, except flagged forecasts |
| `event_date` vs `event_date_precision` format | 0 inconsistencies; the null pattern is all-or-nothing (78 all-null, 52 all-present) |

### 5.2 Input form — 128 locator-only, 2 short excerpts

- `input_kind = locator_only` on **128**; `short_excerpt_and_locator` on **2** (`REAL-001`, S01: a 7-word restructuring phrase; `REAL-012`, S06: an 11-word incentive-accounting clause). `text_excerpt` is null on the other 128.
- 119 locators carry *web-retrieval line numbers* ("retrieval lines 11-12") — a property of a rendering I do not have and the QA report itself calls "supplemental and can change". Eleven carry only a PDF page / table (S06, S42, S48, S12).
- **Therefore these are not 130 executable NLP tests.** At best they are 130 *labeled pointers*. A real test needs the span bytes (M5).

### 5.3 Date semantics — mostly careful, with six issues

1. **28 units have `event_date == source_publication_date`.** For an *announcement* the dateline is the event, and the dataset's choices look deliberate. But the dataset has **no `event_date_role`** (announcement / milestone / decision / effective / forecast), so a harness cannot tell "announced on" from the substitution defect (FP05, 15 rows tagged). **Add the role field** (§8).
2. **`REAL-095` — hindsight in a replay.** `event_date = 2026-01-30` (a repayment deadline) is after `evaluation_as_of = 2025-12-19`, `basis = stated`, and **not** flagged `event_date_is_forecast`. Only 2 rows carry that flag (`REAL-042`, `REAL-086`); at least this one more should.
3. **Three `basis = inferred` rows** (`REAL-038`, `-086`, `-100`) correctly carry reasons. Good — and exactly the ADR 0004 behaviour the pipeline does *not* yet implement.
4. **`document_date` is `"2026"` (year only) on 2 rows** while the rest are ISO days — mixed granularity in one field.
5. **18 units expect a signal but have `event_date = null`** (e.g. `REAL-061` "projected completion early 2027"). This is *correct* under ADR 0004 and is a valuable **negative test**: the pipeline must write `NULL`, not a date.
6. **`retrieved_date` is `2026-10-14` for all 130**, i.e. a single retrieval day for 54 documents. That is plausible for a research sweep but it means **no row proves how a page looked on its stated publication date** — the Swire page (S25) still said "break ground Q1 2026" at retrieval although the groundbreaking was on 2026-03-26 (§6).

### 5.4 Source rights — the dataset has none, and ADR 0014 does not cover most of it

ADR 0014 decides **federal** material (`archived_full_text`) and **corporate** material (`reference_only`). It says nothing about state and local government, economic-development bodies, advocacy sites or wire services. By host (heuristic; a human must confirm):

| Rights class (proposed) | Docs | Units | Examples | ADR 0014 covers? |
|---|---:|---:|---|---|
| Federal public record (SEC EDGAR) | 6 | 13 | S01–S05, S07 | **Yes** |
| **State / local public body or authority** | 12 | **30** | S14, S15, S19 (SC/KY governors); S28, S29 (Missouri DED); S37 (Groveland FL); S42 (IDEM); S43 (WA Ecology); S44, S45 (county IDA); S46 (NY governor); S54 (Kentucky) | **No** |
| Economic-development non-profit / advocacy | 2 | 5 | S16 (SEDCO), S47 (Kingston Citizens) | **No** |
| Corporate first-party | 30 | 76 | newsrooms, IR sites | Yes (`reference_only`) |
| Discovery / republication | 4 | 6 | S11, S12, S41, S53 | Partly (metadata) |

Two further points: **S06 (Tyson 10-K) and S51 (Oatly 6-K) are SEC filings hosted by the issuer's IR vendor**, not EDGAR — re-point to the accession on `sec.gov` before treating them as federal material. And `choosedelaware.com` (S22) is graded `Q1_official_statement`; whether it is a government body or an economic-development partnership is not established by the bundle.
**Recommendation:** extend D19 with an explicit rule for state/local public records (default `reference_only` until counsel decides) and add `sources.rights_class` (§11, R2).

### 5.5 Label vocabulary and consistency

- Cross-field logic is consistent: no emerging/developing row has `emit = false`; no negative-polarity row is emerging/developing; no completed or historical row is emerging/developing; `opportunity_false_positive_if_promoted` agrees with class on all 130.
- **Vocabulary gaps:** `recurring_disclosure` is used for both a corporate boilerplate and an **administrative public notice** (`REAL-102`, S42 renewal) — different failure modes (FP01 vs FP09). `closed_completed` / `closed_withdrawn` are **not** repository states (§8). `project_maturity` (a 21-value category) **collides in name** with `opportunities.project_maturity` (a 0–25 *score* column) — the mapping must rename it.
- `evidence_quality` has nine values (`Q1_official_*`, `Q1_filed_disclosure`, `Q2_first_party_*`, `Q3_*`, `Q4_*`) — it maps onto `evidence.evidence_strength` (`authoritative / corroborated / single_source / weak`) only after ADR 0006's cap is applied (note below).
- **ADR 0006 vs schema:** ADR 0006 says `reference_only` evidence caps at "**indicative**"; `evidence_strength` does not contain `indicative`. This is an existing inconsistency for D16, not an error in the bundle.

### 5.6 Leakage, independence and what the numbers can support

| Quantity | Value |
|---|---|
| Leakage groups / novelty groups / independence groups | **36 / 42 / 31** (no unit is alone in a leakage group) |
| Largest leakage group | 11 units (`pepsi_2019_productivity_disclosure`, five filings S01–S05) |
| Components when linking leakage + novelty + independence + source | 28 (largest 17: "Mars-controlled disclosures") |
| "Promotable" units (`emerging` + `developing`) | **25 units in 12 leakage groups** (13 novelty groups, 16 sources) |
| Of those 12 groups, ones that *also* contain a `closed_completed` unit | 3 (Nature's Bakery, Danone Jacksonville, Unilever Jefferson City) — the same project at two points in time |
| `none` / `closed_completed` / `emerging` / `developing` / `out_of_scope` / `closed_withdrawn` / `unresolved` / `confirmed` | 86 / 10 / 15 / 10 / 5 / 3 / 1 / **0** |
| Commercially qualified open Haskell work | **0** — `available_work_status = not_verified` on 130/130 |

**What a result can and cannot claim.** If a system produced *zero* false positives across the 12 independent promotable groups, the one-sided 95 % Clopper–Pearson upper bound on its false-positive rate is `1 − 0.025^(1/12) ≈ 26.5 %`. Across all 36 groups (the most independence the set can claim) it is `≈ 9.7 %`. These are **regression-detection** sets, not **precision** estimates; they cannot support a threshold such as "≥ 90 % precision".

---

## 6. Source evidence / verification matrix

**Legend.** *Original retrieved?* is **No** for every row — egress is blocked. *Secondary support* is what a web-search summary reported and **is not an original record**. Full per-record detail (identifier, locator, operator, dates, rights, reproducibility) is in Appendix A.

| # | Case class | Record(s) | What was checked | Secondary support (search summary) | Verdict |
|---|---|---|---|---|---|
| V1 | **Positive**, state release | `REAL-034/035`, S14, SC governor 2024-11-14 | Nestlé USA Gaffney, $150 M line + automation, 2132 Old Georgia Hwy | Date, amount and address agree; no job count in the summary | **Corroborated (secondary)** |
| V2 | **Positive + operator attribution + stale page** | `REAL-062/063/064`, S25 Swire | $475 M, 620,000 sq ft, 170 jobs, groundbreaking 2026-03-26, replaces a ~90-year-old Denver plant, site at Peak Innovation Park; **operator = Swire Coca-Cola, USA**. Original site was near Denver airport and moved | Agrees. Street address `4925 Integration Loop Parkway` **not** in any summary. The dataset's own note that the S25 page still said "break ground Q1 2026" in October is **supported by the groundbreaking having already happened** | **Corroborated (secondary)**; label caution validated |
| V3 | **Ambiguous / attributed report** | `REAL-038/039`, S16 SEDCO / Herald Democrat | Tyson Sherman $20 M plan, incentive vote | A **$600,000 SEDCO incentive** reported 2025-05-21 is corroborated. The **$20 M** appears only on SEDCO's own success page; "three lines / refrigeration" **not corroborated**. Several *other* distinct SEDCO–Tyson incentive rounds exist (2019 $1.5 M; Oct 2024 $1.01 M; $960 k automation) — a **project-duplication hazard** (FP23) | **Partly corroborated** |
| V4 | **Negative** | `REAL-087/088`, S35 Tyson network changes 2025-11-21 | Lexington beef closure; Amarillo single shift | Release and closure confirmed; **no shutdown date** in the release | **Corroborated (secondary)** |
| V5 | **Ambiguous / conditional** | `REAL-129/130`, S54 Kroger Franklin KY | $391 M, ~430 jobs, KEDFA *preliminary* approval (up to $12 M BIP + $1 M KEIA) | Agrees; "potential"; groundbreaking undisclosed; local officials say ~$400 M | **Corroborated (secondary)** — preliminary ≠ authorized |
| V6 | **Administrative** | `REAL-102…106`, S42 IDEM notice INP000601 | Niagara Plainfield IN renewal, 2026-01-26, comments to 2026-02-25 | Notice date, minor renewal, 0.198 MGD to the Plainfield South WWTP agree; **no final permit found**. The dataset itself states the receiving POTW has its own NPDES ID "distinct from Niagara's **IWP** ID" (`REAL-105`) — i.e. **an indirect pretreatment permit, not NPDES** | **Corroborated (secondary)** |
| V7 | **Completed + announcement chain** | `REAL-041…046`, S17/S18 Mars/Nature's Bakery | $237 M announced; opened 2025-07-30 at $240 M; 339,000 sq ft; 2331 N. 2200 West; Utah tax credit Jan 2024 | Agrees, including jobs "190+" → "230+". **The 2020 vs March 2021 acquisition conflict is not resolved by the summaries** — the dataset's `unresolved_evidence` label is right | **Corroborated (secondary)** |
| V8 | **Cancelled / negative** | `REAL-121…125`, S49–S51 Oatly | Singapore closure 2024-12-18; DFW and Peterborough construction discontinued, decision Q4 2023, exit through 2024 | Oatly **sold** the Ogden and DFW assets to Ya YA Foods (closed 2023-03-01), Ya YA taking on finishing DFW, and later halted its own new plants; BevNET ties the Q4 loss to cancellation. **"Cancelled" over-simplifies DFW** — it is a transfer *and* a discontinuation | **Partly corroborated**; label needs adjudication |
| V9 | **Recurring / administrative (SEC)** | `REAL-001…003`, S01 PepsiCo Q1-2025 10-Q (R10.htm) | Productivity-plan note: $6.15 B expected charges through 2030; some non-cash impairments for plant closures | Accession `0000077476-25-000019` (`pep-20250322.htm`), **$6.15 B / $5.1 B cash**, ~10 % non-cash impairments all agree; later 10-Qs (`…25-000044`, `…25-000053`) exist; that they repeat the paragraph is what the dataset's own S02–S05 labels assert, and is **not verified here** | **Corroborated (secondary)** |
| V10 | **Operator attribution + status drift** | `REAL-058…061`, S23/S24 Coca-Cola UNITED, Birmingham | $330 M, groundbreaking 2024-06-13, completion "early 2027" | Governor release (50 jobs); campus is **150,000 sq ft offices + 300,000 sq ft warehouse** (sales centre and headquarters — **not a production plant**); a September-2026 article gives a 14 Sept 2026 opening date (**scheduled; not confirmed to have happened**) — ahead of the early-2027 target | **Corroborated (secondary)**; replay label is now **stale** |
| V11 | **Historical / withdrawn** | `REAL-117/118`, S47 Kingston Citizens | Niagara withdraws Ulster NY proposal 2015-02-13 | Independent local reporting (Hudson Valley One) agrees on the date, the one-paragraph email, $54 M / 418,000 sq ft / 57-acre parcel, and ≤ 1.75 M gal/day from Cooper Lake. Reporter's reason is hearsay | **Corroborated (secondary)**, independent of the advocacy source |
| V12 | **Completed (ambiguous scope)** | `REAL-031…033`, `065…067`, S13 / S26 Hershey | Reese chocolate processing; ribbon cutting 2025-04-16 | The 2022 groundbreaking of a 250,000 sq ft plant near the Reese's site is corroborated; the **April 2025 ribbon cutting and the Reese-specific scope were not found**. Also a 2012 $300 M West Hershey plant exists — **name-collision hazard** | **Not corroborated** |
| V13 | **Historical** | `REAL-023…026`, S10 Mars "history" | Timeline entries (1958, 1959, 1962) | Not searched — a first-party timeline whose *only* correct outcome is "no signal" | **Unverified (egress)** |
| V14 | **Accounting policy / financial** | `REAL-012…015`, S06 Tyson FY2024 10-K | Note 20 incentive policy; revolver; Vienna GA sale proceeds | Not searched; filing exists at the issuer-hosted PDF | **Unverified (egress)** |

**Coverage of the requested classes:** positive (V1, V2), negative (V4, V8), administrative (V6, V9), historical (V11, V13), completed (V7, V12), ambiguous (V3, V5, V10, V12).

### 6.1 What these checks changed

1. **The dataset's date discipline held up** where I could test it (V1, V2, V4, V5, V6, V7, V11).
2. **Three label risks surfaced that the dataset does not flag:** Oatly DFW "cancelled" vs transferred (V8); Coca-Cola UNITED labeled `developing/under_construction` for a **non-production** campus and now stale (V10); Hershey's Reese scope unconfirmed (V12).
3. **A name-collision class exists:** *Kingston* is both a Birmingham, AL neighbourhood (V10) and a New York city (V11); *Hershey*, *Plainfield*, *Sherman* all have multiple facilities. A geocoder or a locality-keyed cluster key must not treat the town name as identity (FP15 / FP21).
4. **Search summaries are not a substitute for retrieval.** Of the 12 I searched they agreed with the dataset on 9, partly on 2 and not on 1 — but every number above is *their* number.

### 6.2 The pre-existing production opportunities

Not touched, not re-queried. The six are doc 18's F-1/F-2 evidence (four PepsiCo, two Tyson). Nothing here changes that finding; §4.1 only confirms the code paths that produce them.

### 6.3 How to finish verification (needs egress and a person)

For each of V1–V14, in an environment that is *allowed* to reach the host: (1) fetch once, with the operator's declared User-Agent for SEC; (2) store raw bytes + SHA-256 + HTTP status + final URL → `source_catalog.json` (M1); (3) a **human** reads the locator span and records the permitted excerpt or "locator only"; (4) the human records *what it proves* in one sentence; (5) a second human repeats V1, V6, V9, V10 blind. Budget: ≈ 14 × 15 min ≈ 3.5 reviewer-hours (my estimate). No bulk scraping is needed or proposed.

---

## 7. Red-team of Gemini's facility architecture

### 7.1 The three "real" facilities (Records 1–3) — do not seed

| Gemini field | Record 1 (Tyson) | Record 2 (Coca-Cola Consolidated) | Record 3 (Frito-Lay) | Finding |
|---|---|---|---|---|
| "Canonical Facility ID" | `fac_9a8b7c6d-1111-4444-8888-000000000001` | `…-2222-…-000000000002` | `…-3333-…-000000000003` | **Not a UUID** (`fac_` prefix), and a hand-typed sequence (`1111`, `2222`, `3333`; `…001`, `…002`, `…003`) sharing one prefix. The repo's key is `uuid primary key default gen_random_uuid()` — and Gemini's own text says the key is "generated via UUIDv4 in Supabase". A generated key cannot be "real" before generation |
| FRS Registry ID | `110000458892` | `110012345678` | `110009876543` | Format is plausible (12 digits, `110…`) but two contain keyboard runs (`12345678`, `9876543`), the same construction as the two IDs Gemini itself labels **SYNTHETIC** (`110099999999`, `110088888888`) |
| NPDES ID | `TX0001234` | `FL0054321` | `IL0098765` | `…1234`, `…54321`, `…98765` — runs again |
| FSIS | `P-589` | — | — | Format plausible; the number is **unsourced** |
| Coordinates | 32.1634, −94.3351 | 28.0752, −81.7891 | 41.9123, −87.6542 | Four decimals ≈ 10 m precision with **no source, no accuracy value, no collection method**. FRS carries those fields; Gemini quotes none |
| Address | 501 East Central Ave, Carthage TX | 200 Technology Dr, Auburndale FL | 1629 N Kingsbury St, Chicago IL | Unsourced |
| "Ownership Confidence: 1.0" | Tyson | Coca-Cola Consolidated | "PepsiCo Inc / Frito-Lay Division" | **No ownership source is cited at all**, a confidence of 1.0 has no derivation, and "Frito-Lay Division" is not a legal entity. Schema requires an interval, a precision and a basis (`facility_organizations`, ADR 0005) |
| Record 3 title | — | — | "Commercial **Bakery** / Snack Facility" with NAICS 311919 (snack) | Internally inconsistent |
| Record 2 operator | — | Consolidated at an Auburndale, FL "Production Center" | — | ADR 0005 already warns "Coca-Cola Consolidated … operates the plants" — but whether Consolidated operates *this* plant is exactly the unverified claim; my recollection is that Consolidated's territory is the Southeast / Mid-Atlantic / Midwest, **which I could not verify here and do not assert** |

Records 4–5 are labeled synthetic and are fine as **test fixtures** if given reserved, obviously non-production identifiers.

### 7.2 Endpoints — documented, malformed or unprobed

| Source | Gemini | Problem | Better-evidenced reference |
|---|---|---|---|
| FSIS MPI | `https://www.fsis.usda.gov/sites/default/files/...` | Ellipsis — not a URL. Claims "monthly path rotations"; doc 12/18 and Perplexity say **weekly editions** | Directory landing page and MPI API doc (`fsis.usda.gov/science-data/developer-resources/mpi-api`) — *documented, untested* |
| EPA FRS | `https://watersgeo.epa.gov/arcgis/rest/services/FRS_INT/...` | Ellipsis; service name not shown to exist | Envirofacts `data.epa.gov/efservice/…` and legacy `ofmpub.epa.gov/frs_public2/frs_rest_services.get_facilities` — *documented, untested* |
| ECHO | `https://echo.epa.gov/api/echo_rest_services.get_facility_info?output=JSON&p_id=` | Markdown link malformed (URL repeated with trailing `)...`), `p_id=` empty, host/path differ from the cited documented route | `echodata.epa.gov/echo/echo_rest_services.get_facilities` → `get_qid` (QIDs expire ≈ 30 min) — *documented, untested* |

**None of the three was probed by anyone.** Gemini's own heading is "*Verified* Endpoint Matrix"; its restrictions section says "never call a source verified merely because documentation exists". It then does.

### 7.3 Facility-match design

| Gemini rule | Conflict | Disposition |
|---|---|---|
| Deterministic = same FRS ID **or** (exact normalized address + exact postal + name token ≥ 0.95), "confidence = 1.0", auto-link | ADR 0005: official identifiers first; address match records geocode precision; **fuzzy scoring generates candidates, never commits**; model never commits. "1.0" for a similarity rule is a measurement of nothing. Gemini itself shows a multi-tenant park (Record 4) as the failure | Keep **FRS/FSIS identifier equality** as the only auto-link. Address+name → **candidate** |
| ≤ 50 m + Jaro-Winkler ≥ 0.92 | Jaro-Winkler rewards shared prefixes ("Coca-Cola Bottling Co United" vs "Coca-Cola Bottling Co Consolidated"). No labeled facility pairs exist to tune any of 0.92 / 0.95 / 0.75 / 50 m | **Unsupported thresholds.** Calibrate on labeled pairs from FSIS/FRS *after* they are ingested |
| Merge duplicate FRS records ≤ 10 m + overlapping permit IDs | Co-located establishments (a plant and a co-packer; tenants) share coordinates; FRS coordinates may be low-accuracy centroids | Candidate generator only; require `ACCURACY` fields and an identifier overlap |
| `is_headquarters = true` | `facilities.facility_role` already has `headquarters`; `opportunity_locations` forbids a headquarters row (0023, check on `location_type`) | **Reject the flag**; use the existing role and the location split |
| Status `pending_review` | Not in `facility_candidates.corroboration_status` | Use `uncorroborated` + a reviewer note |

### 7.4 Scope and signal logic

1. **NAICS 311xxx / 312xxx filter** drops **493120 refrigerated warehousing** (Gemini's own Record 4 — and cold-chain is a seeded Haskell capability: `refrigeration_cold_chain`, signal `cold_chain_investment`) and **3255 coatings / 3256 personal care**, which the seed sectors (`coatings`, `pet_care`, `sanitation`, `water_treatment`) and the bundle's relevance slices cover. A NAICS filter should *rank*, not exclude.
2. **Food plants are mostly indirect dischargers.** NPDES covers **direct** discharge to waters. S42's permit is `INP000601` — an **industrial wastewater pretreatment** permit to a municipal treatment plant; the dataset says so (`REAL-105`). A design keyed to NPDES IDs and ECHO's NPDES stream would **not see** most food-plant wastewater changes; coverage needs state pretreatment notices (a per-state parser, as doc 18 §6.3 already notes).
3. **Permit ⇒ project inference.** "New NPDES permit → Greenfield / Major Expansion" and "design-flow increase → Capacity Expansion" label a *regulatory event* with a *capital outcome*. The guardrails Gemini lists (zoning, withdrawal increase, building permit, reject if administrative) are the right ones, but they make the class name wrong. Record the **change** (`permitted_flow_increased`, `new_outfall`) and let a second independent fact lift it (R7 acceptance, §11).
4. **"Routine reissuance → Discard."** ADR 0007 makes the change ledger the single source of delta; a reissue with unchanged limits is a **silent** `change_event`, not a deletion.
5. **Disappearance from a directory.** Gemini: ambiguous, 90-day grace, secondary corroboration. Correct. **Doc 18 R6 says the opposite** ("a removed establishment produces a closure-family signal") — I am correcting my own doc 18 in §11.3.

### 7.5 Stack and operations

Python / pandas, `src/…`, `tests/*.py` and a "resilient landing-page scraper" do not fit a TypeScript Netlify-functions monolith with a 30 s scheduled-function limit. The FRS national file (> 2 GB by Gemini's own figure) **cannot** run in a function; it needs state-filtered REST or an off-platform job (doc 18 R17+, GitHub Actions) — Gemini's mitigation (stream-parse) is right in principle, wrong in venue.

### 7.6 What to keep from Gemini

The identifier hierarchy (as a *ladder*, not scores), the unresolved-is-valid stance, HQ ≠ plant, ownership as time-bounded edges, the 90-day disappearance rule, state-filtered bulk handling, and records 4–5 as fixtures. **Preserve unresolved facility candidates** as `facility_candidates` (`uncorroborated`), never deleted, never auto-promoted (migration 0006 already enforces that promotion names both the facility and the corroborating evidence).

---

## 8. Label → existing-taxonomy mapping

Principle: **keep the repository's vocabulary; translate the bundle's.** Add a *separate* commercial-qualification axis rather than overloading `stage`. Historical, completed, withdrawn and adjacent cases stay **visible** but **not in active pursuit lists**. Full value-by-value tables are in Appendix E; the structure is:

| Bundle axis | Repository home | Rule |
|---|---|---|
| **Evidence fact** (`expected_signal_classification`) | `signals.signal_family` / `event_type` (27 seeded types) · `signals.negative_signal` · `evidence.classification_status` | `project_signal` → signal. `negative_event` → signal with `negative_signal = true`, link role `negative`, **never** an opportunity. `new_intelligence_signal` → signal (family by content). `financial_indicator`, `historical_information`, `background_information`, `recurring_disclosure` → **evidence only** (`classification_status = not_relevant`), no signal. `unresolved_evidence` → `research_claims` (`needs_evidence`) or `facility_candidates` (`uncorroborated`). `false_positive` → regression fixture / `evaluation_corpus_entries` (`negative_control`) |
| **Source type** (`evidence_quality`, `publisher`) | `evidence.access_mode`, `evidence.evidence_strength`, `evidence.assessment_type` | Q1 filed/official → `authoritative` **only if** `structured_primary`/`archived_full_text`; `reference_only` is capped per ADR 0006 rule 1 (D16 to reconcile the word "indicative"). Q2 → `single_source`. Q3 → `single_source`/`weak`. Q4 → `weak`, `metadata_only`. Same-origin republication → **same origin key**, not corroboration |
| **Event polarity** | `signals.negative_signal` (bool), link `signal_role` | `positive`/`neutral` → false; `negative` → true; `mixed` → split into two signals (`REAL-089`) |
| **Project maturity** (bundle: 21-value category) | **Rename** to avoid the `opportunities.project_maturity` *score* column. Store as `project_lifecycle` (proposed) and derive `opportunities.stage` | `announced`, `application_submitted`, `reported_approval`, `proposed_future_phase` → `emerging`. `incentive_approved`, `site_plan_approved`, `authorized_developing`, `funding_supported`, `under_construction`, `opening_imminent` → `developing`. `confirmed` → **requires an `authoritative` + `observed_fact` signal on an archivable source (ADR 0006 rule 2)**: 0 of 130 bundle rows qualify |
| **Opportunity stage** | `opportunities.stage ∈ {emerging, developing, confirmed}` | As above. **Machine writes at most `emerging`** (as today, `pipeline.ts:840`); `developing`/`confirmed` are analyst or rule-gated moves recorded in `change_events` |
| **Available Haskell work** | **New axis**, not `stage`: `commercial_qualification ∈ {not_assessed, no_open_work, open_work_unverified, qualified}` + `qualified_by`, `qualified_at`, `basis` | All 130 bundle rows are `not_assessed`/`not_verified`. A project fact never sets it; only a human with a procurement/package source does |
| **No-opportunity reason** | `opportunity_status_history.reason` + `signals.model_metadata.suppression` (proposed enum) | `recurring_boilerplate`, `accounting_policy`, `historical`, `completed`, `negative_event`, `financial_only`, `no_site`, `administrative_permit`, `conditional`, `product_line`, `rumor`, `same_origin`, `outside_scope`, `unresolved_operator` — **recorded**, not just "none" |
| **Completed / withdrawn** | `opportunities.status`: `closed_completed` → **`expired`** (interim) with history reason `original_scope_completed`; `closed_withdrawn` → **`cancelled`** | Visible via filters, excluded from "active pursuit". The repository has no "completed" status; `closed_won/lost` mean *Haskell's* pursuit outcome and must not be reused. A `project_lifecycle` column (proposed) is the durable fix |
| **Adjacent / non-F&B** | `opportunities.sectors` + `sectors` seed; scope filter in the read model | `adjacent_non_fb`, `non_fb_industrial`, `adjacent_biopharma`, `petfood_separate_slice` are **sector slices**, excluded from core-F&B metrics by default, never silently mixed |
| **Operator vs brand** | `facility_organizations.relationship` (`operator`, `owner`, `tenant`, `co_manufacturer`, `brand_produced_here`) and `organization_relationships` (`franchise_bottler`, `brand_owner`) | See §12 attribution tests |
| **Dates** | `signals.event_date` + `_precision` + `_basis`; `evidence.temporal_*` (6 fields, ADR 0004) | Add **`event_date_role`** (§5.3). A forecast is an *interval* in `temporal_*`, never `event_date` |

---

## 9. Quality-gate harness

### 9.1 Layer 1 — synthetic regression tests (build first; zero cost; no network)

A vitest suite that feeds synthetic strings (fictional organisations) to `classifyText` / `clusterKey` and, after R3, to the derivation functions, asserting **outcomes**, not vocabulary. Each case carries a failure-mode tag from the bundle's FP list so results report per class.

I ran 17 such strings through the **unmodified** classifier on `main` (full table: Appendix D). Summary of what *already* fails — each of these should enter the suite as an expected-failing test that R3 must turn green:

| Class | Probe | Observed on `main` | Should be |
|---|---|---|---|
| FP02 amount role | revenue figure + a plant with no site | **`probable`** | no signal |
| FP12 conditional | "If approved … may consider building … $200 M" | **`probable`** | no signal / `possible` |
| rumour | "anonymous source … plans to build" | **`probable`** | no signal |
| FP09 administrative | wastewater permit **renewal**, "no operational changes" | **`probable`**, `utility_infrastructure` → stored as `energy_project` (`SIGNAL_TAXONOMY`) | no signal; if recorded, `water_project`, silent change |
| FP01/FP18 | upgrade/automate language with an amount | `possible` signal | no signal |
| FP07 history | 1958 / 1962 plant openings | 2 `possible` signals | no signal |
| FP13 polysemy | "plant-based product line" | `possible` signal (`plant` = asset) | no signal |
| Recall of negatives | "will close its Emporia, **Kansas** processing plant in January 2026 … 1,600 team members" | **no match** (the closure regex allows `\w+ ` words between verb and asset, so the comma in "Emporia, Kansas" breaks it; "team members" and "in January 2026" do not count as corroboration) | negative signal |
| Completed plants | "celebrated the opening of its new $240 M bakery … began production" | **no match** | recorded as completed/historical evidence |
| Cluster key | same statement in two quarterly filings | different keys (`2025-04` vs `2025-07`) | one key (FP11) |
| Correct | new 450,000 sq ft plant, $310 M, 280 jobs, Q1 2026 | `probable` | signal |
| Correct | cold storage / DC, $90 M | `probable` ×2 | signal |

Note P01 (my first boilerplate string) **did not** match — I could not reproduce the PepsiCo false positives without the real filing text; the real wording that triggered them is not in this environment. I report that as a non-reproduction, not as evidence either way.

**Pipeline-level cases** (need R3): filing date never becomes `event_date`; an unknown date stays `NULL`; `reference_only` never stores body text (already enforced in PR #17); a negative match creates **0** opportunities; two reposts of one release count as **1** origin; a completed project is stored and **not** active.

### 9.2 Layer 2 — real cases, only after human adjudication

1. Admit a unit only when it has: frozen span bytes + `span_sha256` + `document_sha256` (M5), a rights class (M6), and **two blind labels + adjudication** (M4).
2. Spans are stored at **≤ the ADR 0014 "minimum supporting excerpt"**; paraphrases are marked `analyst_note`.
3. The benchmark lives in the **repository as versioned fixtures** (`app/src/test/fixtures/benchmark/…`, manifest with hashes), **not** in production tables. `research_batches / research_claims` (ADR 0011) is for *claims entering staging*, and `evaluation_corpora` is too coarse (5 columns) for 49 fields.
4. **Splits by group, never by row:** train/dev/holdout assigned on `leakage_group` (36), then checked that no `novelty_group` or `independence_group` straddles a split. With 36 groups (12 promotable), use **leave-one-group-out** for development and **freeze one stratified holdout of ≥ 6 groups** that nobody looks at until a release.
5. Real-case results are reported as **"regression pass/fail by group"**, not precision, until a prevalence-matched sample of *incoming* documents is adjudicated.

### 9.3 Reporting — per class, always

For every run, output one table per failure-mode tag and per expected class:

| Metric | Definition |
|---|---|
| False positive | signal/opportunity produced where expected `none` (by FP tag) |
| Miss | expected signal not produced (by event family) |
| **Abstention** | document legitimately held as `unresolved` / `needs_review` — counted separately, **never** as a pass or a fail |
| Source failure | retrieval/parse failure per source (distinct from classification) |
| Group-level agreement | per leakage group, not per row |
| Drift | diff vs the previous run's table |

The 36-probe figure (19/36) **must not** be quoted as precision, recall or production accuracy; neither may anything from Layer 1.

### 9.4 Gate to promote a classifier change

A change merges only if (a) every previously passing synthetic case still passes, (b) the targeted failure-mode cases flip, (c) no new abstention is silently relabeled, and (d) per-class tables are attached to the PR. A model-assisted extractor (§13) is held to the same gate and additionally to a **span validator**: any output whose quoted span is not a substring of the stored document is discarded.

---

## 10. Connector priority, reconciled

Doc 18's verification legend is kept: **VERIFIED IN PRODUCTION** / **DOCUMENTED, UNTESTED** / **PROPOSED**. *Nothing below was probed in this audit.*

| Rank | Source | Status | Access / rights | Model cost | Why here |
|---:|---|---|---|---|---|
| 1 | **SEC EDGAR — repaired exhibits** | VERIFIED IN PRODUCTION (42 rows) | Federal → `archived_full_text` (ADR 0014); declared User-Agent; ≤ 10 req/s | none | Fix `sec.ts:92` to decide by the index's document **type**, keep filing-date ≠ event-date. Authoritative 8-K Items 2.05 / 7.01 / 8.01 |
| 2 | **USDA FSIS MPI directory** | DOCUMENTED, UNTESTED | Federal public; no key | none | Establishment number = durable identifier for protein accounts; disappearance **≠** closure |
| 3 | **EPA FRS** | DOCUMENTED, UNTESTED | Federal public | none | FRS Registry ID is the cross-programme key; build identity **before** change detection |
| 4 | **ECHO / NPDES change comparison** | DOCUMENTED, UNTESTED | Federal public; QIDs expire; bulk files are large | none | Compare permit versions, design flow, outfalls; **NPDES = direct dischargers only** (§7.4) |
| 5 | Mars newsroom, repaired | VERIFIED reachability | Corporate → `reference_only` | none | Article filter, dates (F-8) |
| 6 | State incentive adapters (KY, SC, OH, MO, DE, AL, MN, CA, CO first) | PROPOSED; D5 open | **State works — no rule yet** | none (HTML/PDF, per-state) | Strongest early indicator in Perplexity's matrix; needs the D19 extension (§5.4) |
| 7 | State pretreatment / NPDES public notices (e.g. IDEM) | PROPOSED | State records | none, but one parser per state | The indirect-discharge gap (§7.4) |
| 8 | Local planning / agendas / permits (jurisdiction registry; Socrata/ArcGIS/Legistar) | PROPOSED; D21 vendor track | Mixed; vendor terms | none (parsers) | Highest setup cost per source; **start with the 6 projects in Perplexity's sprint** |
| 9 | openFDA enforcement | DOCUMENTED, UNTESTED | CC0; 240/min, 1,000/day keyless (documented) | none | Context / negative only |
| 10 | GDELT discovery | DOCUMENTED, UNTESTED | Reference mode (ADR 0006) | none | Leads only; never evidence |
| — | USAspending, RCRAInfo via ECHO, CAEATFA PDFs, trade press, wires | PROPOSED / DEFERRED | Mixed | none | Not needed for the pilot |

**Public-domain vs reference-only, summarised:** federal (SEC, FSIS, EPA, FDA) → archivable; corporate newsrooms/IR → `reference_only`; **state/local public records, EDOs, wires → undecided (D19 extension)**; GDELT → reference/metadata.
**What needs no model API at all:** all ten ranks above. The expensive steps are *parsers*, *adjudication hours* and *per-jurisdiction setup*, not tokens.

---

## 11. Ordered PR roadmap

### 11.1 Principles

One concern per PR. **Schema, connectors, classifier, UI and migration are never combined.** Every PR ships its own tests; any operator step ships as a reviewed, unexecuted file. Nothing below is authorized by this document.

### 11.2 Roadmap

| Order | PR | Contents | Depends on | Size (my estimate) | Production effect on merge |
|---:|---|---|---|---|---|
| 0 | *(this document)* | Docs only | — | — | None |
| 1 | **R1 = PR #17** Ingestion integrity | Stale-run recovery, honest partial/skip health, access-mode enforcement, unexecuted remediation file | — | done | None until next scheduled run; remediation is a separate operator step |
| 2 | **R1.5 Synthetic regression harness** *(new)* | The §9.1 suite as **expected-failing** vitest cases + per-class report; **no behaviour change** | — (can proceed in parallel with #17) | S | None |
| 3 | **R2 Schema** (doc 18, trimmed + audit additions) | Fingerprints/provenance, identifier vocabulary, jobs/tasks (for R4), coverage/health views, grants **plus** `evidence.origin_key`, `signals.event_date_role` + `suppression_reason`, `sources.rights_class`, `opportunities.project_lifecycle` + `commercial_qualification` | 1 | M | Migration applied by operator on authorization |
| 4 | **R2.5 Read-truncation guard** *(new, small)* | `apiDataSource.ts`: deterministic `ORDER BY`, request `count`, and surface "showing N of M"; no behaviour beyond not lying | 1 | S | Visible notice only |
| 5 | **R3 Derivation correctness** | Span-only event dates; recurring-disclosure suppression; locality-based cluster key; negatives never open an opportunity; financial-section exclusion; origin-based independence; completed/historical handling; flip every R1.5 test green | 2, 3 | M–L | None; reprocess + dismissals are operator steps |
| 6 | **R4 Durable execution** | Dispatcher + background worker + heartbeat + re-dispatch + health sweep | 3 | L | Scheduler shape changes; dry-run first |
| 7 | **R5a SEC exhibit repair** *(split from doc 18 R5)* | Exhibit discovery by document type; fixture-based; **no cohort change, no backfill** | 5 | S | None |
| 8 | **R5b SEC cohort from data + backfill** | Remove literal entity keys, CI guard on `netlify/functions`, 12-month window (ADR 0016) | 5, 6, 4 | M | Backfill on authorization |
| 9 | Mars repair | Article filter, dates | 5 | S | Per source |
| 10 | **FSIS MPI** → `facility_candidates` / `facility_identifiers` | Establishment-change observations (not closure) | 3, 6 | M | New allowlist host |
| 11 | **EPA FRS** identity | Registry IDs, linked program IDs | 3, 6 | M | New hosts |
| 12 | **ECHO / NPDES change comparison** | Permit-version diff; `permitted_flow_increased`, `new_outfall` as change events | 11 | L | New hosts |
| 13 | Facility resolution | Deterministic ID merge; candidate review; ownership seeds | 10, 11 | M | Seed on authorization |
| 14 | UI integration (views from R2) | Pulse/Company/Health/Map on the views | 3, 8 | M | Visible change |
| 15+ | State incentives → state pretreatment notices → local planning; evidence archive; review queue; openFDA; optional extraction | per §10 | — | per source | — |

### 11.3 Relationship of PR #17 to R2, R3, R4 — and two corrections to doc 18

- **#17 → R2:** #17 deliberately has **no migration**; R2 is where provenance columns land. #17's `source_runs` checkpoint lease is the interim mechanism until R4 supplies real jobs/tasks. They do not conflict.
- **#17 → R3:** #17 stops *the wrong thing being stored and mis-reported*; it does **not** stop the six false opportunities from being re-derived. R3 is the first PR that can. Until R3 merges, **enabling more sources multiplies the defect**, so R5b must not precede it.
- **R3 → R4:** independent in code (`classify.ts`/`pipeline.ts` vs `runner.ts`/functions) — **parallelizable** after R2, which is why R4 does not wait for R3.
- **R4 → backfill:** a 12-month, ~10-filer backfill cannot run inside a 22 s scheduled budget; R5b waits for R4.
- **Correction 1 (doc 18 §11, R6 acceptance):** "a removed establishment produces a closure-family signal" → **"produces an unconfirmed directory-change observation; it does not set `facilities.closed_at`; a 90-day grace and a second independent fact are required."**
- **Correction 2 (doc 18 §11, R5):** exhibit repair is split out as R5a so it is reviewable without touching the cohort.

### 11.4 The 1,000-row truncation — why R2.5 comes before any large source

`readGraph` (`apiDataSource.ts:637-651`, `READ_LIMIT = 1000` at `:254`) issues **eight reads, each capped by `.limit(1000)` with no count requested**. Seven of them (`opportunities`, `signals`, `evidence`, `opportunity_signals`, `signal_evidence`, `sources`, `account_source_expectations`) have **no `ORDER BY`**, so beyond 1,000 rows PostgREST returns an **arbitrary** 1,000, silently, and the UI renders them as the whole. Link tables (`opportunity_signals`, `signal_evidence`) plausibly hit the limit first; a mismatch between link rows and parent rows then makes `signalsByOpportunity` / `evidenceBySignal` quietly wrong. My rough sizing (estimate, not measured): 10 filers × 12 months × (10-Q/10-K/8-K + exhibits) is a few hundred evidence rows; adding FSIS/FRS candidates and Mars history plausibly crosses 1,000 across `evidence` and `signal_evidence` **within R5b–R6**. Hence R2.5 first, and R14 (views, server-side aggregation) as the real fix.

---

## 12. Pilot acceptance and evaluation plan

A pilot reviewer signs off only when **all** of the following hold on a defined, frozen document set (Layer-1 fixtures plus the adjudicated real cases). Each row names the test that proves it.

| # | Requirement | Acceptance test | Fails today because |
|---:|---|---|---|
| 1 | **No repeats from PepsiCo recurring disclosure** | Five consecutive quarterly filings containing the same productivity-plan paragraph → **0** new signals after the first, **0** opportunities; cluster key stable across quarters | `clusterKey` buckets by month; `eventDate` is the filing date (`classify.ts:243`, `pipeline.ts:~1099`) |
| 2 | **No Tyson accounting-policy opportunity** | The incentive-accounting paragraph, revolver note and capex bullet → **0** signals of family `facility_*` | `REAL-012..014` class; my P02 yields a `possible` `facility_construction` signal |
| 3 | **No Mars historical projects** | A history/timeline page → **0** signals, 0 opportunities; page stored only as `reference_only` evidence | `mars.ts:101` `itemPathPattern` admits `stor…` paths; F-8 |
| 4 | **No false event dates** | Every signal's `event_date` is either a date **stated in a span** with role/precision/basis, or `NULL`; filing/publication date is never copied; 18 bundle rows expecting `NULL` stay `NULL` | `eventDateForSignal` stamps `stated` |
| 5 | **Correct bottler / operator attribution** | Coca-Cola UNITED (Birmingham), Swire (Colorado Springs) resolve to those organizations with `franchise_bottler` to The Coca-Cola Company; **never** operator = The Coca-Cola Company. Niagara Vernon: the operating entity (named in the CAEATFA record) is the facility operator, Niagara the sponsor/parent, with time-bounded edges | Relationship tables empty; attribution is by document filer today |
| 6 | **No automatic qualification of completed projects** | Nature's Bakery SLC, Hershey Reese, Danone line, Unilever JC → stored, **not** `new`/active; `commercial_qualification` stays `not_assessed`; a later phase (e.g., Danone DC) is a **separate** candidate | Completed events can start `emerging` today |
| 7 | **No opportunity from a negative or an administrative notice** | Tyson Lexington closure → negative signal, **0** opportunities; IDEM renewal → at most a silent change event | Defect (Q4 row); my P10 |
| 8 | **Source-health integrity** | A stalled run is abandoned within one lease; a partial run never advances `last_success_at`; the Health surface names each source's last *complete* check | **Delivered by PR #17** once merged |
| 9 | **Facility-candidate review** | Every candidate from FSIS/FRS has `uncorroborated` status, an identifier, a precision, and appears in a review queue; promotion requires facility + corroborating evidence (already a DB constraint); a conflicting name stays unresolved | No candidates exist yet |
| 10 | **Reviewer sign-off** | A named reviewer approves the frozen suite's per-class report; any change after sign-off re-opens it. Two-reviewer blind agreement ≥ the κ target set in the rubric (M3) before real cases count | No adjudication exists |

**Not part of acceptance (explicitly):** any precision/recall figure, any "early detection" claim from retrospective documents (the handoff is right — establish **prospective first-seen timestamps** and compare against a reporting feed instead), and any claim that a project has open Haskell work.

---

## 13. Model / AI recommendation

**Do not use a model for anything in R1–R9.** The failure modes in this audit — boilerplate recurrence, accounting policy, history pages, date substitution, closure-as-opportunity, administrative notices, same-origin counting, rights — are all **deterministic-gate** problems (section awareness, date-role rules, an origin key, an enum). A model adds cost and variance without addressing any of them, and the *labels themselves* are already model-assisted (130/130 "prepared with ChatGPT"), so using a model to grade a model would be circular.

**Optional, later, behind a gate:** a *structured extractor* that, for documents surviving the deterministic prefilter, returns `{actor, action, site, amount + role, date expression + role, quoted span}`. Conditions: (1) the R1.5 harness and ≥ one adjudicated real holdout exist; (2) every quoted span is validated as a substring of the stored document or the output is dropped; (3) the output **proposes** — it never sets `confirmed`, never sets `stage`, never sets `commercial_qualification` (ADR 0005 "a model may never commit a merge" generalised); (4) calls go through the model gateway with the replay cache (ADR 0003), so a rerun costs 0; (5) decision **V1** (provider, data-handling) is taken first. Doc 18 §14 prices this at low tens of dollars a month for ~50–200 documents a week; I have not re-priced it and it must be checked against the chosen provider's current sheet.

---

## 14. Test plan, risks, costs, decisions needed

### 14.1 Consolidated test plan

| Layer | What | When | Gate |
|---|---|---|---|
| Unit (vitest) | R1.5 synthetic cases, per failure-mode tag | R1.5 onward | Expected-failing until R3; then required green |
| Unit | Date-role rules; origin key; negative never opens; completed handling | R3 | per acceptance rows 1–7 |
| Contract (PG 16 / 17) | R2 forward/back/forward; column-grant test for every new view column; withheld columns stay withheld | R2 | existing CI jobs |
| Read-model | A fixture of 1,500 evidence rows renders "showing N of M" and a stable order | R2.5 | new test |
| Connector fixtures | Recorded exhibit `index.json`; recorded FSIS / FRS / ECHO payloads; **re-run on the same edition writes 0 rows** | each connector PR | per doc 18 §11.1 |
| Dry-run | Every new connector, against the declared host, before enablement | each connector PR | operator authorization |
| Human | Blind double-label + adjudication; second-reviewer blind check of V1/V6/V9/V10 | before real cases count | κ target |
| Regression of #17 | Existing 1,620 tests and CI jobs stay green | every PR | CI |

### 14.2 Risks

| Risk | Mitigation |
|---|---|
| Treating search-summary corroboration as verification | Labeled throughout; §6.3 procedure; no "verified" claims |
| Circular evaluation (model labels + model extractor) | Human blind labels first; §13 |
| 12 independent promotable groups give a 26.5 % bound | Never claim precision; leave-one-group-out; holdout; grow the corpus prospectively |
| Rights: state/local material unpriced by any ADR | D19 extension before R6-rank-6 connectors; `rights_class` field |
| Stale replay labels (UNITED, Swire page) | `status_as_of` history; never overwrite replay labels |
| Name collisions (Kingston, Plainfield, Hershey, Sherman) | Identity from identifiers/operator, never from locality text |
| Backfill before R3/R4 multiplies defects | Roadmap ordering; R5b depends on R3 and R4 |
| Silent 1,000-row truncation | R2.5 before R5b |
| A reviewer mistakes "emerging" for "open work" | Separate `commercial_qualification` axis, default `not_assessed` |

### 14.3 Costs (engineering effort is my estimate; recurring money is only where a vendor is involved)

| Item | Cost |
|---|---|
| R1.5, R2.5, R5a | ~1 PR each, small |
| R2, R3, R4, R5b, FSIS, FRS | medium PRs; R4 and ECHO/NPDES are the largest |
| Model API | **$0** through R9; optional extractor per doc 18 §14 |
| Adjudication | ~130 units × 2 reviewers × ~5 min ≈ **22 reviewer-hours**, plus ~3.5 h for §6.3 (estimate) |
| Netlify / Supabase | no new tier implied until backfill and Storage archive (R11-era) |
| Vendors | Permit-data vendors (doc 18 §6.3) are quote-only — **not** recommended before the deterministic path is measured |

### 14.4 Decisions I need from you (none blocks reading this document)

| ID | Decision | My recommendation |
|---|---|---|
| **D-R1** | Do machine-derived opportunities appear to users **before** analyst review? | Hold them as signals/candidates until an analyst accepts; only `emerging` ever auto-created |
| **D-R2** | Extend D19 to state/local public records and EDOs | `reference_only` until counsel confirms; add `sources.rights_class` |
| **D-R3** | Add `commercial_qualification` and `project_lifecycle` (new columns) or defer | Add in R2 — it is the cheapest way to keep completed/withdrawn visible and non-active |
| **D-R4** | Where does the benchmark live | Repo fixtures with a manifest, not production tables |
| **D-R5** | Reconcile ADR 0006 "indicative" with `evidence_strength` (part of D16) | Fold into D16 |
| **D-R6** | Authorize the next PR (R1.5 and/or merge of #17) | R1.5 is tests-only and independent of #17 |

---

## 15. Stop conditions and what this document does not do

- It does **not** merge, deploy, apply SQL, enable a connector, backfill, change Netlify/Supabase, insert research into production, touch the six existing opportunities, or use authenticated scraping.
- It does **not** import `gold_reference.*` anywhere, and does not copy it into the repository.
- It does **not** claim any record is verified from an original.
- **Wait for authorization before any implementation PR.** If a later step needs egress this environment lacks, the step stops and says so.
