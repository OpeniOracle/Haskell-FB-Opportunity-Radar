# 19a — Reconciliation appendices

**Companion to** `19_INDEPENDENT_RESEARCH_RECONCILIATION_AND_EVIDENCE_QUALITY_PLAN.md` · **Date:** 2026-10-16 · **Docs only; nothing here is executable or imported anywhere.**

Contents: **A** per-record verification detail · **B** input file hashes · **C** dataset-audit method · **D** synthetic probes run against the unmodified classifier · **E** value-by-value label mapping · **F** adjudication queue.

> **Quoting policy.** No source passage is reproduced in this file. "Dataset claim" is the bundle's own **paraphrase** (an analyst note, not a quote). "Secondary support" is what a web-search summary reported (not an original). Where I could not retrieve a record I say so. Synthetic strings in Appendix D are **mine**, use fictional organisations, and are not derived from any source text.

---

## A. Per-record verification detail

Every row: **Original retrieved from this environment? — No** (all external hosts denied by the egress proxy). That is *unverified (egress)*, not *invalid*. Identifiers are the dataset's, not independently confirmed unless the "secondary support" column says so.

Fields: **URL** · **Record/identifier** · **Locator (dataset)** · **What it proves (best reading)** · **Operator / dates** · **Licence** · **Reproducibility**.

### V1 — Nestlé USA, Gaffney SC (positive; state release)
- **URL:** `https://governor.sc.gov/news/2024-11/nestle-usa-expands-cherokee-county-operations` (S14)
- **Records:** `REAL-034` (project), `REAL-035` (plant history)
- **Locator:** "main announcement paragraph and scope paragraph; retrieval lines 15 and 17" — *web-rendering line numbers*
- **Proves:** Nestlé USA announced a ~$150 M line-and-automation investment at 2132 Old Georgia Highway, Gaffney, on 2024-11-14. It does **not** prove authorization, construction start, completion or procurement (dataset ambiguity note agrees).
- **Operator / dates:** Nestlé USA (operating entity), announcement 2024-11-14 (dateline = event; an *announcement* role).
- **Licence:** state government release — **no ADR rule** (§5.4 of doc 19).
- **Reproducibility:** stable URL; page date is a visible dateline. Locator should become a heading + paragraph index, not a line number.
- **Secondary support:** date, amount, address agree; no job count. → **Corroborated (secondary).**

### V2 — Swire Coca-Cola, USA, Colorado Springs (positive; operator attribution; stale first-party page)
- **URL:** `https://www.swirecc.com/coloradospringsmanufacturing` (S25); the handoff also cites `…/Swire-Coca-Cola-New-Manufacturing-Facility-in-Colorado-Springs`
- **Records:** `REAL-062` (project, `emerging/announced`), `-063` (manufacturing site ≠ existing DC), `-064` (`unresolved_evidence`: page still says "break ground Q1 2026"; copyright 2017)
- **Proves:** a site-specific manufacturing project of $475 M / 620,000 sq ft. The **page text lagged reality**: groundbreaking occurred on **2026-03-26** (secondary), yet the dataset retrieved the page on 2026-10-14 still showing a Q1-2026 forecast.
- **Operator / dates:** **Swire Coca-Cola, USA** (bottler/manufacturer; replaces a ~90-year-old Denver plant; 170 jobs; site at Peak Innovation Park, near the airport — originally planned near Denver International). **Not** The Coca-Cola Company (`franchise_bottler` edge).
- **Licence:** corporate → `reference_only`.
- **Reproducibility:** **poor** — undated, mutable page; frozen bytes + hash are essential (M1/M5).
- **Secondary support:** all headline figures agree. Street address `4925 Integration Loop Parkway` is **not** in any summary I saw. → **Corroborated (secondary); dataset's `unresolved_evidence` caution is validated.**

### V3 — Tyson Foods, Sherman TX (ambiguous; attributed report; duplicate-project hazard)
- **URL:** `https://www.sedco.org/news-and-media/p/item/63267/sedco-awards-600k-incentive-for-tyson-expansion` (S16)
- **Records:** `REAL-038` (incentive vote reported; `event_date 2025-05-20 inferred`), `-039` (lines + refrigeration), `-040` (`false_positive`: related-content cards)
- **Proves (best reading):** an attributed news report (via a local newspaper) of a $600 k incentive vote. The $20 M scope and the "moved and new production lines plus refrigeration" detail rest on the SEDCO page.
- **Operator / dates:** Tyson Foods; vote on a Tuesday before the 2025-05-21 publication → `2025-05-20` **inferred** (dataset correctly marks `basis = inferred` with a note).
- **Licence:** a non-profit EDC's page republishing a newspaper item — rights **undecided** (§5.4).
- **Reproducibility:** moderate; "related cards" (GlobalWafers, water demand) prove the page carries unrelated items — a mixed-document case (FP20).
- **Secondary support:** $600,000 SEDCO incentive reported 2025-05-21 (Herald Democrat) — corroborated. $20 M: SEDCO page only. Three lines / refrigeration: **not** corroborated. **Other, distinct** SEDCO–Tyson incentive rounds exist (2019 $1.5 M; Oct 2024 $1.01 M; a $960 k automation award) → **FP23 project-duplicate hazard**: a naive cluster would fuse them. → **Partly corroborated.**

### V4 — Tyson Foods network changes (negative)
- **URL:** `https://www.tysonfoods.com/news/news-releases/2025/11/tyson-foods-announces-network-changes-strength` (S35)
- **Records:** `REAL-087` (Lexington NE closure), `-088` (Amarillo single shift), `-089` (production up elsewhere; `mixed`)
- **Proves:** a corporate decision to end operations at Lexington; the release gives **no closure date**. `event_date` correctly null; `closure_announced`; opportunity `none`.
- **Operator / dates:** Tyson; release 2025-11-21.
- **Licence:** corporate → `reference_only`. **Reproducibility:** good (dated release).
- **Secondary support:** closure and Amarillo change agree; no shutdown date. → **Corroborated (secondary).**
- **Use:** the canonical *negative-must-not-open-an-opportunity* test. Note `REAL-089` `mixed` polarity → split into two signals.

### V5 — Kroger, Franklin KY (ambiguous; conditional state action)
- **URL:** `https://newkentuckyhome.ky.gov/Newsroom/NewsPage/20251211_Kroger` (S54)
- **Records:** `REAL-129` ($391 M DC; `emerging`), `-130` (KEDFA preliminary approval; `developing`, tagged FP24)
- **Proves:** a **preliminary, conditional** state incentive approval (up to ~$12 M Business Investment + ~$1 M KEIA). It is not project expenditure, a construction start or a procurement.
- **Operator / dates:** Kroger; 2025-12-11. Exact site and schedule undisclosed.
- **Licence:** state government — undecided. **Reproducibility:** good.
- **Secondary support:** $391 M, ~430 jobs, preliminary approval, "potential", groundbreaking undisclosed; local officials cite ~$400 M. → **Corroborated (secondary).**

### V6 — Niagara Bottling, Plainfield IN (administrative notice; identifier role)
- **URL:** `https://www.in.gov/idem/files/notice_20260225_npdes_inp000601.pdf` (S42)
- **Records:** `REAL-102…106`
- **Proves:** IDEM public notice dated **2026-01-26** of a **minor renewal** of an existing **industrial wastewater pretreatment (IWP) permit `INP000601`**, 1250 Whitaker Road, flowing to a municipal plant that has its **own** NPDES ID (`REAL-105`). *No operational changes since the last renewal* (`REAL-103`). **It proves nothing about construction.** `2026-02-25` in the filename is the comment deadline, not a date of the permit.
- **Operator / dates:** applicant address is in California; the facility is in Indiana (`REAL-104`) — an entity/address trap. Application 2025-10-31; the memo cover says January 2025 (internal inconsistency, `REAL-106`).
- **Licence:** state agency record — undecided. **Reproducibility:** good (PDF, physical page numbers).
- **Secondary support:** notice date, 0.198 MGD, receiving WWTP, comment period agree; no final permit found. → **Corroborated (secondary).**
- **Implication for Gemini:** an NPDES-ID-centred design does not see this permit class (doc 19 §7.4).

### V7 — Mars / Nature's Bakery, Salt Lake City (completed; announcement chain; conflicting ownership date)
- **URLs:** S17 `…/mars-announces-natures-bakery-salt-lake`, S18 `…/mars-opens-new-240m-natures-bakery-facility-salt-lake`
- **Records:** `REAL-041…043` (announced 2024-01-12, $237 M, July-2025 forecast), `REAL-044…046` (opened 2025-07-30, $240 M, 230+ jobs)
- **Proves:** one project at three points in time: announcement, forecast, opening. The **acquisition year differs** (2020 in S17 vs March 2021 in S18) → both `unresolved_evidence` (correct).
- **Operator / dates:** Mars / Nature's Bakery. 339,000 sq ft, 2331 N. 2200 West (secondary). A Utah tax credit approved Jan 2024.
- **Licence:** corporate → `reference_only`. **Reproducibility:** good (dated releases).
- **Secondary support:** all headline numbers agree; the ownership-year conflict is **not** resolved by the summaries. → **Corroborated (secondary).**
- **Use:** the canonical *three-milestone, one-project* fixture, and a leakage case (the early state of a now-completed project).

### V8 — Oatly (cancelled / negative; scope nuance)
- **URLs:** S49 (2024-12-18 Singapore closure), S50 (FY2024 results 2025-02-12), S51 (6-K filed 2025-04-30)
- **Records:** `REAL-121…125`
- **Proves (dataset):** Singapore closure announced; construction of DFW and Peterborough discontinued with the decision in Q4 2023 and exit activity through 2024; cost-reporting date ≠ decision date (`REAL-123` ambiguity note).
- **Secondary support:** Oatly **sold** its Ogden and Dallas-Fort Worth assets to Ya YA Foods (closed 2023-03-01; Ya YA taking on completion at Fort Worth), and later halted new plants in the UK/US/China (BevNET ties the Q4-2023 loss to the cancellations). So for DFW the true picture is **a transfer of a site plus a discontinuation of Oatly's own build** — "cancelled" is an over-simplification (FP22 conflict / FP14 ownership).
- **Licence:** S49–S50 corporate IR (`reference_only`); **S51 is an SEC 6-K hosted on the issuer's IR site** — re-point to EDGAR.
- **→ Partly corroborated; label needs adjudication** (§F).

### V9 — PepsiCo, SEC 10-Q (recurring disclosure)
- **URL:** `https://www.sec.gov/Archives/edgar/data/77476/000007747625000019/R10.htm` (S01); accession `0000077476-25-000019` (Q1 FY2025, quarter ended 2025-03-22, document `pep-20250322.htm`)
- **Records:** `REAL-001` (standing 2019 plan), `-002` ($6.15 B projected charges), `-003` (impairments for unspecified plant closures; `negative`)
- **Proves:** a standing, company-wide programme with an updated charge total — **a financial indicator and a recurring disclosure**, no site, no project. The dataset's `publication date not established` and `document_date 2025-03-22` correctly refuse to substitute the period end.
- **Licence:** US federal record → `archived_full_text` (ADR 0014). **Reproducibility:** excellent *if* retrieved from EDGAR by accession (the `R10.htm` is an XBRL rendering page).
- **Secondary support:** accession, $6.15 B total / ~$5.1 B cash, ~10 % non-cash impairments all agree. Later 10-Qs for Q2 and Q3 exist; that they repeat the paragraph is **asserted by S02–S05 and not verified here**. → **Corroborated (secondary).**

### V10 — Coca-Cola UNITED, Birmingham AL (operator attribution; non-production campus; stale replay label)
- **URLs:** S23 (2024-05-23), S24 (2024-06-13) on `cocacolaunited.com`
- **Records:** `REAL-058…061` (`emerging` → `developing/under_construction`, tagged FP15)
- **Proves:** a **$330 M** project, groundbreaking 2024-06-13, "early 2027" completion. Per the Alabama governor's release and later reporting it is a **150,000 sq ft office complex plus 300,000 sq ft warehouse**, a sales centre and headquarters, **50 new jobs**. It is **not a beverage production plant.**
- **Operator / dates:** **Coca-Cola Bottling Company United** — a franchise partner, not The Coca-Cola Company (`REAL-058` ambiguity note says so). "Kingston" here is a Birmingham neighbourhood.
- **Secondary support:** a September-2026 article gives a 14 Sept 2026 opening date (**scheduled, not confirmed**) — **ahead of the early-2027 target the replay label carries.**
- **Open question:** `haskell_relevance = core_fb` for an office/warehouse campus — adjudicate scope (§F). → **Corroborated (secondary); replay label stale.**

### V11 — Niagara Bottling, Ulster NY (historical; withdrawn; independent corroboration)
- **URL:** `https://www.kingstoncitizens.org/2015/02/22/` (S47; advocacy group)
- **Records:** `REAL-117` (withdrawal 2015-02-13), `-118` (site / water seller / reservoir in different municipalities)
- **Proves:** an interested-party report of a withdrawal. **Independent local reporting** (Hudson Valley One) corroborates: a one-paragraph email on Friday 2015-02-13; $54 M, 418,000 sq ft, 57-acre former-IBM parcel; ≤ 1.75 M gal/day from Cooper Lake; no reason given. No original withdrawal instrument.
- **Licence:** advocacy site — `reference_only`; the news outlet is also third-party copyright. **Reproducibility:** moderate.
- **→ Corroborated (secondary); strength upgraded from Q3 interested-party to "corroborated by independent reporting" only after those outlets are retrieved.**

### V12 — Hershey, Reese chocolate processing (completed; scope unconfirmed; name collision)
- **URLs:** S13 plant-locations page; S26 `…/new-reese-chocolate-processing-facility-fuels-growth-and-hometown-pride.html` (2025-04-30)
- **Records:** `REAL-031…033`, `REAL-065…067`
- **Dataset claim:** a ribbon cutting on 2025-04-16; "opened 2025"; a $1 B network programme that must not be assigned as the plant budget (`REAL-066`).
- **Secondary support:** a 2022 groundbreaking of a 250,000 sq ft processing plant near the Reese's site is corroborated; a $300 M 2012 West Hershey plant also exists. **The April-2025 ribbon cutting and the Reese-specific scope were not found.** → **Not corroborated.** Treat as an *unverified-by-search* record; do not conclude it is wrong.

### V13 — Mars "history" (historical)
- **URL:** `https://www.mars.com/about/history` (S10); `REAL-023…026` (1958 Hackettstown plant, 1959 HQ move, 1962 European expansion, 1958 Whiskas) — all `historical_information`, `opportunity none`.
- **Not searched.** A first-party timeline whose only correct pipeline outcome is *no signal*. The page shows no publication date (`retrieval_review`). → **Unverified (egress).** Highest value as a **negative regression fixture**; matches production's *Our History* signals (doc 18 F-8).

### V14 — Tyson FY2024 Form 10-K (accounting / financial)
- **URL:** `https://s203.q4cdn.com/483587180/files/doc_financials/2024/q4/TSN-FY2024-10K.pdf` (S06) — **issuer-hosted copy**; the canonical record is the EDGAR accession.
- **Records:** `REAL-012` (incentive accounting policy, PDF p.81 / printed 80), `-013` (capex bullets), `-014` (revolver; `false_positive`), `-015` (Vienna GA sale proceeds; `transaction_completed`).
- **Not searched.** → **Unverified (egress).** Fixes the "financial instrument is not a plant" and "conditional accounting policy" classes (FP12).

---

## B. Input file hashes (from `SHA256SUMS.txt`; re-verified `OK`)

```
ed6c505e54559575899e8c2394edbd4ea6049e2f295e2fab69df344fc78abe0d  guidance/CLAUDE_CODE_PROMPT.md
8a6f30642327e979508f7baa25bbf6b5d2be6f9c51afddc2b08bebfe2a2d3855  guidance/REVIEW_AND_IMPORT_GATES.md
08b0e69bb6137810dd185b4da68103e1c45d4b7998ae5da8105e2a3a304f4a1c  inputs/Gemini_Facility_Intelligence_Architecture.pdf
aced3eda4eb829a2a7a4045c9fbf0ead016e650471c7adfcc70fc656c5f667f2  inputs/Independent_QA_review_report.md
5e61d1268bbbdebe4bc9a14e1963e50bbcd2a1aa9071a8cdb6a838806a5e7f97  inputs/Perplexity_Opportunity_Source_Research.pdf
4862627581f3280c8843ef210065e03a9c2dfe76506a56baedce1cf33fdb5625  inputs/gold_reference.csv
e4eb9e068047f25ea4ef484c87b78bcca9d3ee10b19958856beb32bfaf2373b2  inputs/gold_reference.json
```

The Gemini PDF is an **image-only** PDF (no text layer); I read its five pages visually. `tesseract` was not available, so no OCR text exists to quote or diff.

---

## C. Dataset-audit method

Checks were run by seven small read-only Python scripts (`python3 -I`, standard library only, run from a directory other than the bundle's) against the JSON and CSV. They are in the session scratchpad and **not committed** (this branch is docs-only); each is ≤ 60 lines and can be recreated from the list below.

| Script | Checks |
|---|---|
| inventory / vocab | key sets identical across records; mixed types/nulls; distinct-value tables for every categorical field |
| JSON↔CSV parity | row/column counts, column order, cell-by-cell equality after JSON-decoding list cells; record order |
| metadata | recompute signal and opportunity distributions, publication-date-unknown count, source-document count vs the file's own metadata |
| ids and URLs | `REAL-nnn` contiguity; `S01…S54` contiguity; 1 id ↔ 1 URL ↔ 1 publisher; canonical-URL collisions; dangling references in list fields |
| date semantics | event-date format vs precision; null-pattern all-or-nothing; `inferred` rows carry notes; publication = event date; event after `evaluation_as_of` without forecast flag; dates after retrieval date |
| cross-field logic | emit vs opportunity class; polarity vs stage; maturity vs stage; false-positive-if-promoted vs class; counts of the "promotable" 25 |
| leakage | group sizes; union-find over leakage + novelty + independence + source; promotable units per group; completed-and-early-state overlap |
| rights / duplicates | host → proposed rights class; near-duplicate (Jaccard ≥ 0.7) over paraphrase, reason and locator; org + locality + event duplicates |

**To reproduce**, a reviewer needs only the two input files and the field list in doc 19 §5. No script reads any network resource.

---

## D. Synthetic probes run against the unmodified classifier

**What this is.** I imported `classifyText` and `clusterKey` from `app/netlify/functions/_shared/connectors/classify.ts` on `main` (unmodified; no database; no network; Node 22 `--experimental-strip-types`) and ran strings I wrote. **These are not the QA report's 36 probes** (not supplied). Organisations are fictional. The result column is the classifier's output verbatim: `family / confidence [corroboration kinds]`.

| ID | Class | Synthetic text (fictional) | Expected | Observed on `main` |
|---|---|---|---|---|
| P01 | FP01 boilerplate | "In connection with the productivity plan we optimize our manufacturing and supply chain footprint, including plant closures in several locations. We expect total pre-tax charges of approximately $6.15 billion through 2030, in North America and EMEA." | none | **No match** (no action term) — *does not reproduce a false positive* |
| P01b | FP01 / FP18 | "The plan includes upgrading our manufacturing facilities and automating our production lines in North America, with pre-tax charges of approximately $2.5 billion through 2025." | none | **`facility_modernization / possible [investment_amount]`** |
| P02 | FP12 accounting policy | "When constructing new facilities or making major enhancements to existing facilities, we may receive incentives from state and local governments, which are recorded as a reduction of the cost of the facility in 2024." | none | **`facility_construction / possible [timeline]`** |
| P03 | FP07 history | "In 1958 the company opened a new plant in Springfield, Ohio, and in 1962 it expanded manufacturing in Leeds, England, employing 400 people." | none | **`facility_construction / possible`** and **`facility_expansion / possible`** (`named_place`) |
| P04 | negative | "The company will close its Emporia, Kansas processing plant in January 2026, affecting 1,600 team members." | negative signal; **no** opportunity | **No match** |
| P04b | negative | same, but "Emporia processing plant" (no comma) | negative signal | **No match** — action + asset found, but "in January 2026" and "team members" are not corroboration |
| P04c | negative | "The company announced it is closing the Emporia, Kansas plant in January 2026, affecting 1,600 team members." | negative signal | **No match** — the closure regex allows `\w+ ` words between verb and asset, so "Emporia," (comma) breaks it |
| P05 | FP02 amount role | "Revenue grew to $4.2 billion in 2025. Separately, management discussed a new plant at an unspecified future location." | none | **`facility_construction / probable [investment_amount+timeline]`** |
| P06 | FP12 conditional | "If approved by the board, the company may consider building a new facility in Fresno, California with up to $200 million in investment." | none or `possible` | **`facility_construction / probable [investment_amount+named_place]`** |
| P07 | FP13 polysemy / FP18 | "The company expanded its plant-based product line with three new flavors, available in 2,000 stores in 2026." | none | **`facility_expansion / possible [timeline]`** (`plant` matched as an asset) |
| P08 | rumour | "According to an anonymous source, the company is planning to build a new plant in Reno, Nevada worth $300 million." | none or `possible` | **`facility_construction / probable [investment_amount+named_place]`** |
| P09 | true positive | "Acme Foods will build a new 450,000 square-foot manufacturing facility in Lebanon, Tennessee, a $310 million investment creating 280 jobs, with construction beginning in the first quarter of 2026." | signal | `facility_construction / probable [investment_amount+job_count+named_place+timeline]` ✔ |
| P10 | FP09 administrative | "The state issued public notice of a renewal of an industrial wastewater permit for the bottling facility in Plainfield, Indiana. The permit authorizes 198,000 gallons per day to the municipal wastewater treatment plant. No operational changes are proposed." | none | **`utility_infrastructure / probable [capacity+named_place]`** — would be stored as family `utilities_sustainability` / event `energy_project` (`SIGNAL_TAXONOMY`), not `water_project` |
| P11 | true positive | "The company will build a new cold storage and distribution center in Omaha, Nebraska, a $90 million project opening in 2027." | signal | `facility_construction / probable` **and** `distribution_logistics / probable` ✔ |
| P12 | FP19 completed | "The company celebrated the opening of its new $240 million bakery in Salt Lake City, Utah, which began production in July 2025 and employs 230 people." | stored as completed/historical | **No match** ("opening **of** its new" ≠ "opening **a** new") |
| P12b | FP19 completed | "The new $240 million bakery in Salt Lake City, Utah began production in July 2025 and employs 230 people." | stored as completed | **No match** |
| P13 | FP21 cross-entity | "Zeta Corp said it is closing its plant in Dayton, Ohio. Meanwhile Acme Foods reported a $12 million donation to a local school in Dayton, Ohio." | closure for Zeta only | **`closure_consolidation (neg) / probable [investment_amount+named_place]`** — the donation amount is the "corroboration" |

`clusterKey` for the *same* statement in two quarterly filings: `x:1|facility_modernization|2025-04|plant` vs `…|2025-07|plant` — **different keys** (FP11).

**Reading it correctly.** 14 of 17 results disagree with my expectation: `probable` false matches on P05, P06, P08, P10, and P13 (where the "corroboration" is an unrelated donation); `possible` false matches on P01b, P02, P03, P07; **misses** on P04, P04b, P04c, P12, P12b; **as expected** on P01 (no match — so no false positive was reproduced), P09 and P11. This is a **mechanism demonstration on author-written text**, not an error rate. It shows which *code paths* admit which *failure classes*, and it supplies the first seed for the Layer-1 suite. I did not tune any probe after seeing a result except to add P01b/P04b/P04c/P12b to test *why* P01/P04/P12 behaved as they did.

---

## E. Value-by-value label mapping

Rule of thumb: **evidence ≠ signal ≠ opportunity ≠ qualification.** "→ stored" means *recorded and visible*; "no signal / no opportunity" never means "discarded".

### E.1 `expected_signal_classification` (9 values)

| Bundle value | Units | Repository destination | Notes |
|---|---:|---|---|
| `project_signal` | 36 | `signals` (family/event per content; `negative_signal = false`) | Event types: `new_facility_announced`, `facility_expansion`, `production_line_added`, `distribution_centre_project`, `cold_chain_investment`, `process_upgrade` … |
| `new_intelligence_signal` | 7 | `signals` (e.g. `acquisition_completed`, `automation_investment`, `capacity_guidance` [provisional]) | Not necessarily an opportunity |
| `negative_event` | 7 | `signals`, `negative_signal = true`, link role `negative` (`facility_closure`, `restructuring_announced`) | **Never** opens an opportunity; a *separate* decommissioning/redevelopment candidate only with separately evidenced physical work |
| `financial_indicator` | 22 | `evidence` only (`classification_status = not_relevant`) | Account-priority context at most; `capital_expenditure_plan` is *account* context, never a project |
| `recurring_disclosure` | 10 | `evidence` only + recurrence fingerprint (R2) | Includes an *administrative public notice* (`REAL-102`) — consider a distinct value (§F) |
| `historical_information` | 18 | `evidence` only | |
| `background_information` | 16 | `evidence` only | |
| `unresolved_evidence` | 10 | `research_claims` (`needs_evidence`) / `facility_candidates` (`uncorroborated`) | Abstention class — report separately |
| `false_positive` | 4 | regression fixture; `evaluation_corpus_entries.entry_kind = 'negative_control'` | |

### E.2 `expected_opportunity_classification` (7 values)

| Bundle value | Units | `opportunities.stage` | `opportunities.status` | `commercial_qualification` (proposed) |
|---|---:|---|---|---|
| `none` | 86 | — (no row) | — | — · record **suppression reason** |
| `emerging` | 15 | `emerging` | `new` | `not_assessed` |
| `developing` | 10 | `developing` (analyst/rule-gated; machine writes `emerging` only) | `new` / `watching` | `not_assessed` |
| `closed_completed` | 10 | last stage kept | **`expired`** (interim) + history reason `original_scope_completed` | `no_open_work` *only after a human says so*; default `not_assessed` |
| `closed_withdrawn` | 3 | last stage kept | **`cancelled`** | `no_open_work` |
| `out_of_scope` | 5 | — | — | sector slice via `sectors` (adjacent / non-F&B); excluded from core-F&B metrics |
| `unresolved` | 1 | — | — | review queue |
| *(none observed)* `confirmed` | **0** | `confirmed` requires an `authoritative` + `observed_fact` signal (ADR 0006 rule 2) | — | `qualified` is a human act |

### E.3 `project_maturity` (21 values — **rename** to `project_lifecycle`; the repo's `opportunities.project_maturity` is a 0–25 score)

| Bundle value | Units | Maps to stage | Notes |
|---|---:|---|---|
| `not_applicable` | 61 | — | |
| `announced` | 15 | `emerging` | |
| `application_submitted` | 1 | `emerging` | |
| `reported_approval` | 2 | `emerging` | attributed report, not authoritative |
| `proposed_future_phase` | 1 | `emerging` | needs a **new** authorization/permit to move |
| `incentive_approved` | 2 | `developing` | |
| `preliminary_incentive_approved` | 1 | `developing` *(see §F — tagged FP24)* | conditional |
| `incentive_supported`, `funding_supported` | 1 + 1 | `developing` | |
| `site_plan_approved`, `authorized_developing` | 1 + 1 | `developing` | |
| `under_construction`, `opening_imminent` | 2 + 1 | `developing` | |
| `completed` | 14 | lifecycle `completed` → status `expired` | stays searchable |
| `historical` | 13 | evidence only | |
| `cancelled`, `withdrawal_reported` | 2 + 1 | status `cancelled` | reported withdrawal by an interested party is `weak` |
| `closure_announced` | 4 | negative signal | |
| `operating_change_announced` | 1 | negative / mixed signal | |
| `transaction_pending`, `transaction_completed` | 3 + 2 | `corporate_capital` signal; ownership edge in `facility_organizations` on completion | not a project |

### E.4 `evidence_quality` (9 values) → `evidence.evidence_strength`, `access_mode`

| Bundle | Units | `evidence_strength` | `access_mode` | Caveat |
|---|---:|---|---|---|
| `Q1_filed_disclosure` | 18 | `authoritative` | `archived_full_text` if EDGAR copy | issuer-hosted copy (S06, S51) → re-point to EDGAR |
| `Q1_official_statement` | 20 | `single_source` (until D-R2) | `reference_only` (until D-R2) | state/local: **no rule** |
| `Q1_official_record` | 13 | `single_source` (until D-R2) | `reference_only` | |
| `Q2_first_party_statement` | 56 | `single_source` | `reference_only` | ADR 0014 |
| `Q2_first_party_reference` | 12 | `single_source` / `weak` (undated pages) | `reference_only` | |
| `Q3_attributed_reporting` | 3 | `single_source` | `reference_only` | |
| `Q3_interested_party_report` | 2 | `weak` | `reference_only` | |
| `Q4_discovery_index` | 4 | `weak` | `metadata_only` | |
| `Q4_same_origin_republication` | 2 | **not independent** — joins the origin's `origin_key` | `metadata_only` | |

### E.5 Other fields

| Bundle field / value | Repository destination |
|---|---|
| `event_polarity`: positive / neutral | `negative_signal = false` |
| `event_polarity`: negative | `negative_signal = true` |
| `event_polarity`: mixed (1) | split into two signals |
| `event_date`, `_precision`, `_basis` | `signals.event_date`, `event_date_precision`, `event_date_basis` (same vocabulary: `exact_day … unknown` / `stated, inferred, unknown`) |
| `event_time_expression` + forecast | `evidence.temporal_raw_expression/start/end/precision/basis` (interval, **never** `event_date`) |
| *(new)* `event_date_role` | `announcement / milestone / decision / effective / forecast` — proposed `signals` column (R2) |
| `evaluation_mode`: `publication_replay` (84) | replay as of `published_at` |
| `evaluation_mode`: `retrieval_review` (40) | as of `first_seen_at`/retrieval; page may be stale (Swire) |
| `evaluation_mode`: `document_date_replay` (6) | **public availability unverified** (meeting date ≠ posting date); keep out of "early detection" claims |
| `independent_corroboration_status` | `evidence.evidence_strength = corroborated` only for genuinely separate origins; the three `same_origin_*` / `separate_*` values record *why not* |
| `human_review_required` (56 true) | `evidence.review_status = manual_review_required` |
| `haskell_relevance` | `opportunities.sectors` + scope filter: `core_fb` (112), `core_fb_outside_pilot` (3), `non_us_fb` (2), `adjacent_non_fb` (5), `non_fb_industrial` (4), `adjacent_biopharma` (2), `petfood_separate_slice` (2) |
| `available_work_status = not_verified` (130) | `commercial_qualification = not_assessed` |
| `live_promotion_authorized = false` (130) | **no row may be promoted**; keep as a hard import gate |
| `benchmark_label_status` | must read `adjudicated` before any real case counts |

### E.6 Failure-mode tags → suppression reason / regression family

`FP10` is **absent** from the data (26 distinct tags; FP01–FP27 less FP10). Counts are rows tagged.

| Tag | Rows | Suppression reason / test family | Layer-1 probe |
|---|---:|---|---|
| FP01 BOILERPLATE | 4 | `recurring_boilerplate` | P01b |
| FP02 AMOUNT_ROLE | 27 | `amount_not_project_scope` | P05 |
| FP03 NO_SITE | 13 | `no_site` | P05 |
| FP04 POLARITY | 9 | `negative_event` | P04 |
| FP05 DATE_SUBSTITUTION | 15 | date-role test | pipeline |
| FP06 DEPENDENT_SOURCES | 4 | `same_origin` | — |
| FP07 HISTORY | 16 | `historical` | P03 |
| FP08 INDEX_PAGE | 5 | `index_or_navigation` | — |
| FP09 ADMINISTRATIVE_PERMIT | 3 | `administrative_permit` | P10 |
| FP11 RECURRENCE | 5 | `recurring_boilerplate` (cluster key) | clusterKey |
| FP12 CONDITIONAL | 2 | `conditional` | P02, P06 |
| FP13 ASSET_POLYSEMY | 1 | `asset_polysemy` | P07 |
| FP14 OWNERSHIP | 11 | `ownership_transfer` | — |
| FP15 ENTITY_RESOLUTION | 10 | `unresolved_operator` | — |
| FP16 HEADQUARTERS | 4 | `headquarters_not_plant` | — |
| FP17 RELEVANCE | 10 | `outside_scope` | — |
| FP18 PRODUCT_LINE | 3 | `product_line` | P07 |
| FP19 COMPLETED | 12 | `completed` | P12 |
| FP20 MIXED_DOCUMENT | 7 | `mixed_document` | — |
| FP21 CROSS_ENTITY_WINDOW | 4 | `cross_entity_window` | P13 |
| FP22 CONFLICT | 6 | `conflict_unresolved` | — |
| FP23 PROJECT_DUPLICATE | 3 | `duplicate_project` | — |
| FP24 STAGE_INFLATION | 3 | `stage_inflation` | — |
| FP25 IDENTIFIER_ROLE | 1 | `identifier_role` (IWP ≠ NPDES) | — |
| FP26 UNCORROBORATED | 1 | `uncorroborated` | — |
| FP27 REDIRECT_SUPERSESSION | 1 | `redirect` (ADR 0012) | — |

---

## F. Adjudication queue (items I noticed; for the human second-label pass)

1. **`REAL-095`** — `event_date 2026-01-30` (stated repayment deadline) after `evaluation_as_of 2025-12-19` and not flagged forecast. Flag it, or move the date to `temporal_*`.
2. **`REAL-130` / `REAL-048` / `REAL-112`** — labeled `developing` *and* tagged `FP24_STAGE_INFLATION`. Is the tag "this tests inflation" (label correct) or "this label is inflated"? Conditional preliminary incentive approval (`REAL-130`) is the clearest case.
3. **`REAL-102`** — an administrative public notice labeled `recurring_disclosure`; consider a separate class (`administrative_notice`).
4. **`REAL-119/120` (S48)** — `document_date = "2026"` (year only) in a field otherwise ISO-day.
5. **Oatly DFW** (`REAL-123`, `-125`) — `closed_withdrawn / cancelled` vs a site **transfer** to Ya YA plus Oatly's own discontinuation. Candidate for two units.
6. **Coca-Cola UNITED** (`REAL-058…061`) — `core_fb` and `developing/under_construction` for an **office + warehouse** campus; and the replay label is now stale (reported opening Sept 2026).
7. **Swire** (`REAL-062…064`) — label is right *as of the page*; add a `status_as_of` row for the 2026-03-26 groundbreaking.
8. **Hershey** (`REAL-033`, `-065`) — Reese-specific scope and the 2025-04-16 ceremony unconfirmed by search; verify from the original.
9. **Tyson Sherman** (`REAL-038`) — one of several distinct SEDCO–Tyson rounds; make the project key explicit so they cannot cluster.
10. **Nature's Bakery** (`REAL-043` vs `-046`) — acquisition 2020 vs March 2021: leave `unresolved` until a third source decides.
11. **Rights** — S06 and S51 are filings hosted off EDGAR; S22 (`choosedelaware.com`) graded `Q1_official_statement` without a stated public-body status; S16/S47 are non-government.
12. **`document_date_replay` rows** (`REAL-109…114`, S44/S45 county IDA agendas) — "meeting date ≠ date the agenda was public" (the dataset says so); exclude from any early-detection claim.
