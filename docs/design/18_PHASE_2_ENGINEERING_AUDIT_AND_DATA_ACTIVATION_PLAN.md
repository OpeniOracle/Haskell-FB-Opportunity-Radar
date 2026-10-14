# 18 — Phase 2 Engineering Audit and Data Activation Plan

**Status:** Audit and proposal. **No implementation has been authorized.**
**Date:** 2026-10-14
**Scope:** Current-state audit of `main`, production data readiness, source activation
programme, Agent-Reach feasibility, intelligence pipeline design, ordered PR plan
**Documentation only.** No application code, schema, migration, seed, secret, Netlify
setting, or Supabase row was changed in producing this document.

---

## 0. How this audit was performed, and what it could not see

| Evidence | What was done | Limits |
|---|---|---|
| Repository | `main` at `72a7f63` (PR #16, 2026-09-14), all 303 tracked files inventoried; design docs 10–17, all 16 ADRs, all migrations, connectors, pipeline, runner, read model, CI read | — |
| Test suite | `npm ci`, `npm run typecheck`, `vitest run` in this environment | **1,552 tests / 53 files pass; typecheck clean.** `db/verify.sh` (PostgreSQL contracts) and the browser-layout job were not run here |
| Production database | Project `dutmdlbangsthclgtkhy` (named `haskell-fb-radar-dev`, but it is the one `netlify.toml:35` points production at). **Read-only `SELECT`s only**, aggregates and pipeline tables; no `auth.*` or allowlist rows read | Point-in-time snapshot, 2026-10-14 |
| External endpoints | Probed SEC, FSIS, EPA, openFDA, GDELT, Census, state, permit and trade-press hosts | **Every data-source host (43) was refused by this environment's egress proxy (403 on CONNECT).** No endpoint was verified from here. "Verified working" below means *proven by production rows*, not by this audit's probes |
| Agent-Reach | Read-only shallow clone of `Panniantong/Agent-Reach` at `94f06c1` (2026-10-08); nothing installed or executed | Star count unavailable |
| Wastewater Project Monitor | Read-only clone of `OpeniOracle/Haskell-Wastewater-Project-Monitor` at `b9ca1cd` (2026-10-13) for the patterns this plan reuses | — |
| Netlify | Not inspected. `EGRESS_ALLOWLIST`, function logs, plan tier and deployed environment variables are **unverified** | — |

Every external claim in §6 is labelled with its verification state. Nothing unverified
is presented as confirmed.

---

## 1. Executive summary

**The application is real and the pipeline is real. The pipeline's output is not yet
trustworthy.** That distinction drives everything below.

What works, verified:

- 23 migrations (0001–0024, 0019 intentionally absent) are applied in production. RLS is
  on for all 63 public tables. Invite-only auth, the Microsoft identity guard, column
  grants and the evidence session guard are in place.
- **SEC EDGAR has run unattended every day from 2026-09-14 to 2026-10-13 (30 successful
  runs).** Idempotency holds: unchanged filings produce no new rows.
- Production holds **95 evidence records, 19 signals, 6 opportunities, 15 organizations,
  60 coverage expectations** — all from real sources. No fixture reaches the production
  bundle, and CI enforces that.

What does not work, verified from production rows:

1. **The opportunities are all false positives on inspection.** The 4 PepsiCo "Facility
   Expansion" opportunities come from the same boilerplate sentence ("optimizes our
   manufacturing and supply chain footprint") repeated in each quarterly 10-Q. The
   cluster key buckets by filing month, so each quarter forks a new opportunity. The 2
   Tyson "Closure" opportunities come from an accounting-policy paragraph ("When
   constructing new facilities or making major enhancements…"). All 4 Mars signals come
   from the corporate *Our History* page, about events in 1958.
2. **Mars has been silently down for 30 days.** Its only run (2026-09-14 05:23) wrote 53
   rows over about 45 seconds, then died without closing. Every later run collides with
   `source_runs_single_active_uidx`. The runner reports that as `skipped` / `healthy` and
   persists nothing, so `sources.health_status` still reads `healthy` with
   `last_success_at = null`. This breaks the non-negotiable "collection failures cannot
   silently appear successful."
3. **ADR 0014 is being violated.** Mars is `reference_only`, but `pipeline.ts:1019`
   hard-codes `accessMode: 'structured_primary'` for every connector. As a result, 53
   copyrighted Mars pages are stored as full `body_text`. The database guard
   (`evidence_reference_only_has_no_body`) never fires, because the row never claims to
   be reference-only.
4. **Coverage is 3 of 15 accounts, by construction.** `runner.ts:249` hard-codes
   `['sec:0000077476','sec:0000100493','radar:mars-incorporated']`. Eight more verified
   CIKs are seeded and never collected. The CI step "The pilot cohort is seeded, not
   hard-coded in the application" only scans `app/src/data/fixtures/`, so it cannot see
   this.
5. **8-K press releases are never read.** No EX-99 exhibit has ever been stored. The
   probable cause is that `ANNOUNCEMENT_EXHIBIT = /^ex-?99/i` (`sec.ts:92`) is tested
   against EDGAR file *names*, which rarely begin with `ex99`. 8-K Items 7.01 and 8.01,
   where plant announcements live, are stored as the 3–8 KB cover form only.
6. **A filing date is being recorded as a project date.** `pipeline.ts:1112` passes
   `document.publishedAt` as the signal `event_date` with basis `stated`. This is the
   ADR 0004 failure the platform exists to prevent.
7. **No facilities, no entity links, no change ledger, no scoring, no alerts, no audit
   trail.** The tables `facilities`, `facility_candidates`, `facility_identifiers`,
   `evidence_entity_links`, `change_events`, `alerts`, `audit_events`,
   `scoring_configs` and `opportunity_score_snapshots` all have 0 rows.

**Recommendation.** Do not add surfaces and do not add sources yet. First make the
existing two connectors honest (PR 1), make derivation defensible (PRs 2–3), and make
execution durable (PR 4). Then widen SEC to the full cohort and add FSIS MPI and EPA
FRS/ECHO as the pilot's second and third connectors. Both are facility-identity
sources, and facility identity is the thing the platform currently has none of.

**Recommended first PR:** §12 — *Ingestion integrity: stale runs, access mode, and
honest health.* Code only, no migration, no production change on merge.

---

## 2. Current-state engineering audit

Status vocabulary: **Implemented** (code exists and is exercised by production data or
tests), **Partial**, **Planned** (designed, not built), **Unverified** (claimed, cannot
be confirmed).

### 2.1 Frontend and application surfaces

The brief refers to seven surfaces. **The inventory changed in PR #15.** Saved Pursuits &
Watches was removed because nothing could write to it. Spyglass and Map were added. There
are now **eight routed surfaces plus two reserved positions** (`app/src/routes.ts`).

| Surface | Route | Status | Evidence |
|---|---|---|---|
| Daily Pulse | `/` | **Partial** | Live. Derives figures from the shared graph read (`apiDataSource.ts` `readGraph`). The `change_events` ledger it was designed on (ADR 0007) is empty in production |
| Opportunities | `/opportunities`, `/:id` | **Implemented (UI)** / content false-positive | Renders the 6 live opportunities. All are unscored (`final_score` null) |
| Company | `/accounts`, `/:id` | **Implemented** | 15 seeded organizations; counts derive from signals |
| Facility | `/facilities/:id` | **Implemented (UI)** / **no data** | `facilities` has 0 rows, so every facility link is unreachable |
| Evidence detail | `/evidence/:id` | **Implemented** | Live provenance. The full-text proxy (`netlify/functions/evidence.ts`) reads Storage, but **no object has ever been archived** (`archive_uri` is null on 95/95) |
| Source Health & Coverage | `/admin/health` | **Partial** | Reads `sources.health_status`, which is wrong for Mars (§1 item 2). Coverage is computed client-side from signals, so accounts whose evidence carries no signal read as uncovered even when collected |
| Spyglass | `/spyglass` | **Implemented** | Zignal iframe snapshots. **Not evidence** — the page says so |
| Map | `/map` | **Implemented** | 3 opportunity locations and 3 HQ addresses geocoded via Stadia; `geocode_cache` 4 rows |
| Market Trends, Briefings | reserved | **Planned** | Rendered as explicitly unavailable |

**Read model risk.** `readGraph` loads organizations, opportunities, signals, evidence and
both link tables into the browser, with `READ_LIMIT = 1000` (`apiDataSource.ts:254`).
Evidence passes 1,000 rows within weeks of adding FSIS or ECHO. PostgREST then truncates
silently, and every count on Pulse, Company and Map becomes wrong without an error.

### 2.2 Supabase integration, schema, RLS

| Capability | Status | Evidence |
|---|---|---|
| Migration harness with checksummed ledger | **Implemented** | `db/migrate.mjs`, `schema_migrations` (23 rows in production) |
| Operator files for SQL-editor application | **Implemented** | `db/operator/0021–0024`, generated, CI-diffed, single `DO` block |
| Canonical organizations | **Implemented** | 15 rows; 13 `sec_cik` identifiers. Mars and Niagara correctly have none |
| Organization relationships / time-bounded ownership | **Schema only** | `organization_relationships` 0 rows. Kellanova→Mars, Nestlé Waters→Primo, Unilever→MICC and KDP/JDE Peet's (doc 12) are not recorded |
| Facilities, candidates, identifiers, ownership intervals | **Schema only** | 0 rows in all four tables |
| Evidence ↔ entity links | **Schema only** | `evidence_entity_links` 0 rows. Evidence reaches an account only through a signal, so 76 of 95 evidence rows are attributable to no account |
| RLS | **Implemented** | `relrowsecurity = true` on all 63 public tables; column-level grants (0015, 0022) |
| Invite-only auth, Microsoft Entra | **Implemented**; Haskell tenant **Unverified** | Merge message of PR #13: no Haskell account was available to test |
| Tenant boundary | **Implemented (single tenant)** | One Supabase project dedicated to the Radar (ADR 0013). No multi-tenant model; none is required for the pilot |
| Research staging (ADR 0011) | **Schema only** | `research_claims` 0 rows |

### 2.3 Connectors, schedules, ingestion

| Capability | Status | Evidence |
|---|---|---|
| Egress gateway (allowlist, no userinfo/IP/ports, retry budget, Retry-After, pacer, conditional GET) | **Implemented** | `_shared/egress.ts`; ADR 0002 |
| SEC EDGAR connector | **Implemented, defective** | 30 daily successes. CIK resolved against `company_tickers.json`. Exhibits never followed (§1 item 5). Cohort limited to 2 filers |
| Mars newsroom connector | **Implemented, defective, stalled** | Robots → feed → sitemap → index walk works. Stores category and index pages as evidence (38 rows titled "News & Stories"); `published_at` null on 53/53; run stuck since 2026-09-14 |
| FSIS MPI | **Registered only** | `sources` row, `enabled = false`, `connector_id = null` |
| openFDA, EPA FRS/ECHO, GDELT, state, permits | **Planned** | Doc 12, doc 15 PR 5 |
| Schedule | **Implemented, fragile** | One scheduled function at `0 6 * * *` runs every source **sequentially inside one invocation** (`scheduled-ingest.ts`). Netlify documents a short execution limit for scheduled functions. The Mars run's death at about 45 s is consistent with that (probable; logs not inspected) |
| Retry | **Partial** | Per-request retry in the gateway. No run-level retry, no stale-run recovery, no backoff on `consecutive_failures` |
| Operator run (`admin-run`) | **Implemented** | Bounded window (≤400 days), dry run, source filter |

### 2.4 Evidence storage, provenance, dedup, entity resolution

| Capability | Status | Evidence |
|---|---|---|
| Document identity separate from content; supersession | **Implemented** | `evidence_current_document_uidx`; ADR 0012 |
| Content hash, ETag/Last-Modified cache, 304 handling | **Implemented** | `source_document_cache` 58 rows |
| `published_at` / `retrieved_at` kept apart | **Implemented** for SEC; **absent** for Mars | Mars `published_at` null on all rows |
| Government material archived to the private bucket (ADR 0014) | **Not implemented** | Text lives in `evidence.body_text`; raw bytes are not archived |
| Corporate material reference-only (ADR 0014) | **Violated** | §1 item 3 |
| Organization resolution | **Partial** | Deterministic CIK cross-check only |
| Facility resolution (ADR 0005 ladder) | **Planned** | No code path writes `facility_candidates` |

### 2.5 Scoring, classification, AI, alerting

| Capability | Status | Evidence |
|---|---|---|
| Signal classification | **Implemented, low precision** | `connectors/classify.ts`: regex; action + asset + one corroborator in a 420-char window. In a 10-Q almost any window contains a `$` amount, so the corroboration gate is ineffective on financial filings |
| Taxonomy mapping to the seeded vocabulary | **Implemented** | `SIGNAL_TAXONOMY`, exhaustive by type |
| Opportunity derivation | **Implemented, unsound** | `upsertOpportunity` creates an opportunity from one `probable` match. That includes **negative** matches, so a closure creates an `emerging` opportunity |
| Three-axis confidence (ADR 0009) | **Recorded only** | D16 open |
| Scoring | **Not implemented** | `scoring_configs` 0, snapshots 0, `final_score` null on all |
| Model gateway + replay cache (ADR 0003) | **Implemented, unused** | Only `status.ts` imports it (asserted by `modelDependency.test.ts`). V1 provider open |
| Change ledger, alerts, briefs | **Not implemented** | `change_events`, `alerts` 0 rows |

### 2.6 Tests, CI, deployment, documentation

- **CI** (`.github/workflows/ci.yml`): app checks, about 30 boundary guards, Windows
  PowerShell 5.1 operator-script job, Chromium layout job. Rigorous on security and
  provenance boundaries; **it has no test of output quality.** No corpus asserts that a
  boilerplate paragraph does not become an opportunity, which is how six reached
  production.
- **Deployment**: Netlify (frontend + 6 functions), Supabase. Runtime env lives in the
  Netlify UI, not `netlify.toml` (correctly; see `runtimeConfiguration.test.ts`).
- **Documentation drift** (claims that are stale or contradicted by the code):

| Document | Claim | Reality |
|---|---|---|
| `docs/design/16` header | "All seven Phase 1 surfaces implemented against fixtures" | Live data since PR #10; Saved Pursuits removed; Spyglass and Map added |
| `docs/adr/README.md` | "**Nothing here is implemented**" | ADRs 0002, 0004, 0012, 0013, 0014, 0015, 0016 are substantially implemented |
| PR #15 message | "39 evidence records, 13 signals and 5 opportunities" | Now 95 / 19 / 6; reconcile in doc 16 |
| `sources.health_status` for Mars | `healthy` | No successful run ever (`last_success_at` null) |
| Doc 15 §1.5, Phase 1 completion | Criteria 2, 5, 6 | **Not met.** One connector runs unattended (needs three). No injected-failure → alert path. No D9 instrumentation |

### 2.7 Remaining fixtures and synthetic data

- **Runtime: none.** The production bundle aliases `@/data/fixtureDataSource` to
  `fixtureDataSource.production-stub.ts` (`vite.config.ts:30`). CI asserts that no
  illustrative record or fixture chunk ships.
- **Tests: by design.** `app/src/data/fixtures/*` (9 files), `db/tests/fixtures.sql`,
  recorded connector fixtures in `liveConnectors.test.ts`.
- **Design artefacts:** `schemas/sample-opportunity.json` (fabricated "Example…" record).
- **Seeds are real, not synthetic:** `db/seed/0003_pilot_cohort.sql`,
  `0006_live_cohort_sources.sql`, `0007_cohort_headquarters.sql`.

The risk is no longer fixtures leaking into production. The risk is **real records that
say false things**, which no fixture guard can catch.

---

## 3. Production data readiness

| Question | Answer | Basis |
|---|---|---|
| Can it ingest real records? | **Yes** — SEC daily; Mars once | `source_runs` 32 rows |
| Persist? | **Yes**, with correct identity, hashing and supersession | Constraints armed; idempotent re-runs observed (`unchanged`) |
| Retrieve and display? | **Yes**, through RLS and column grants | Surfaces render live rows |
| Are the records *correct*? | **Evidence: yes. Signals and opportunities: no.** | §1 items 1, 6 |
| Migration readiness | **Ready.** Ledger current at 0024 | `schema_migrations` |
| Canonical orgs / facilities | Orgs **ready**; facilities **empty** | |
| Source registry / connector health | Registry **ready**; health **untrustworthy** | Mars |
| Evidence extraction | SEC HTML **works**; exhibits **broken**; PDF/OCR **absent**; Mars article detection **broken** | |
| Scheduled refresh / retry | **Fragile** — single sequential invocation, no stale-run recovery | §2.3 |
| Entity resolution / temporal ownership | Model **ready**, data **absent** | 0 relationships, 0 facilities |
| Read models | **Will not scale** past about 1,000 evidence rows | §2.1 |
| Access controls / tenant boundary | **Strong** | RLS, column grants, evidence proxy, session guard |

**Remains unverified from this audit:** Netlify `EGRESS_ALLOWLIST` contents, function
logs (the Mars failure cause), Netlify plan support for background functions, Haskell
tenant sign-in, Storage bucket contents beyond `archive_uri`, and every external
endpoint not already proven by production rows.

---

## 4. Defect register

Severity is about harm to the product promise, not code size.

| # | Defect | Where | Severity | Production impact |
|---|---|---|---|---|
| F-1 | Boilerplate in periodic filings becomes a new signal and opportunity every quarter | `classify.ts` corroboration; `clusterKey` month bucket | **Critical** | 4 PepsiCo false opportunities |
| F-2 | Negative (closure) matches create opportunities | `upsertOpportunity` | **Critical** | 2 Tyson false opportunities |
| F-3 | Filing date written as project `event_date`, basis `stated` | `pipeline.ts:1112`, `eventDateForSignal` | **Critical** (ADR 0004) | 15 SEC signals |
| F-4 | Access mode hard-coded `structured_primary` | `pipeline.ts:1019` | **Critical** (ADR 0014, licensing) | 53 Mars rows hold full page text |
| F-5 | Stalled run never recovered; skip reported `healthy` and not persisted | `runner.ts` `openRun` and catch | **High** | Mars silent 30 days |
| F-6 | Cohort hard-coded; CI guard blind to it | `runner.ts:249`; `ci.yml:213` | **High** | 12 of 15 accounts uncovered |
| F-7 | EX-99 exhibits never discovered | `sec.ts:92` (probable) | **High** | 8-K announcements invisible |
| F-8 | Mars stores navigation/category pages as evidence; no dates | `mars.ts` `itemPathPattern` | **High** | 52 not-relevant rows, *Our History* signals |
| F-9 | Gov material not archived to Storage | pipeline | Medium (ADR 0014) | Evidence proxy has nothing to serve |
| F-10 | Whole-graph client read capped at 1,000 | `apiDataSource.ts:254` | Medium (latent) | Silent truncation on growth |
| F-11 | `closeRun` ignores write errors on `sources` / `source_health_events` | `runner.ts` | Medium | Health history incomplete (SEC recovery event missing) |
| F-12 | Evidence not linked to organizations unless a signal exists | pipeline | Medium | Coverage under-reported |

---

## 5. Gap analysis against the operating model

| Operating-model requirement | Today | Gap |
|---|---|---|
| Routine operation needs no analyst data entry | True | — |
| Failures never silently appear successful | **False** (F-5, F-11) | Stale-run recovery, persisted skips, health sweep |
| Every opportunity is supported by retrievable evidence | Linked: true. *Supported*: false | Derivation gate, boilerplate suppression |
| Trends, signals and opportunities are separate | Schema yes; trends unused | Fine for pilot |
| Company and facility identity are separate | Schema yes; no facility data | FSIS + FRS connectors, resolution ladder |
| Publication, event and retrieval times are separate | Columns yes; event date wrong | F-3 |
| No invented dates | Violated (F-3) | |
| ≥3 connectors, two cadence cycles unattended | 1 | SEC cohort, FSIS, EPA |
| Coverage report names under-covered accounts | Partial, signal-derived | Evidence→org links, SQL coverage view |
| Visible health/freshness within one cycle | False for Mars | Health sweep |
| Human review and corrections | Columns exist; no workflow | Review queue |
| Auditability | `audit_events` empty | Wire mutations |

---

## 6. Source programme

### 6.1 Verification legend

- **VERIFIED IN PRODUCTION** — real rows in the production database prove the endpoint
  works from Netlify.
- **DOCUMENTED, UNTESTED** — official documentation located, but no request succeeded
  from any environment this audit could observe. The audit environment's proxy blocked all
  43 hosts; that is a property of this environment, not of the sources.
- **PROPOSED** — inferred from prior knowledge; must pass a connector dry run first.

### 6.2 Priority sources

| Source | Endpoint(s) | State | Access / licence | Cadence | Key fields | Entity matching | Reliability risks | BD value |
|---|---|---|---|---|---|---|---|---|
| **SEC EDGAR** | `data.sec.gov/submissions/CIK##########.json`; `www.sec.gov/Archives/edgar/data/<cik>/<acc>/index.json` + documents; `www.sec.gov/files/company_tickers.json` | **VERIFIED IN PRODUCTION** (42 rows, 30 runs) | No key; declared User-Agent with contact required; fair access ≤10 req/s; US government work | Daily | form, filingDate, acceptanceDateTime, items, primaryDocument, accession; EX-99 text | CIK (deterministic) → `organizations` | UA misconfiguration → 403; exhibit naming varies (F-7) | Authoritative 8-K Items 2.05 (exits, a **negative** signal) and 7.01/8.01 (announcements via EX-99), 10-K Item 2 Properties |
| SEC XBRL `companyfacts` / `companyconcept` (`PaymentsToAcquirePropertyPlantAndEquipment`) | `data.sec.gov/api/xbrl/...` | **DOCUMENTED, UNTESTED** (same host as verified) | as above | Quarterly | Capex by period | CIK | Concept naming varies by filer | Capex trend is account context (raises *account* priority), **never** a project |
| SEC full-text search | `efts.sec.gov/LATEST/search-index` | **PROPOSED** — undocumented endpoint | as above | Daily | Hits by phrase/CIK | CIK; incidental mentions must not count as coverage (doc 12) | Undocumented; may change | Discovers bottler and co-manufacturer mentions (D13) |
| **USDA FSIS MPI directory** | Directory landing page `fsis.usda.gov/inspection/establishments/meat-poultry-and-egg-product-inspection-directory` (CSV/XLSX) and the MPI API documented at `fsis.usda.gov/science-data/developer-resources/mpi-api` (doc 12 "Verified" documentation) | **DOCUMENTED, UNTESTED** | No key; public data (Data.gov lists it as public domain — confirm) | Weekly (FSIS states weekly editions) | establishment number, establishment ID, name/DBA, address, county, activities, size, grant date | Establishment number → `facility_identifiers`; name/address → org via ladder | File URLs change per edition; closures appear as disappearance | **Facility identity spine for Tyson** and any protein account. New establishment number, new activity, or new grant date at a known operator is a **site-level signal** |
| **EPA FRS** | Envirofacts `data.epa.gov/efservice/...` (preferred); legacy `ofmpub.epa.gov/frs_public2/frs_rest_services.get_facilities` | **DOCUMENTED, UNTESTED** | No key; public domain | Monthly | FRS Registry ID, program IDs (NPDES, ICIS, TRI, RCRA), NAICS, lat/long, address | **FRS Registry ID** = cross-program facility key | Legacy host age; name variants | Facility identity across programmes; NAICS 311/312 food & beverage sites |
| **EPA ECHO (CWA / NPDES / DMR)** | `echodata.epa.gov/echo/echo_rest_services.get_facilities` → `get_qid`; CWA service; bulk ECHO Exporter and ICIS-NPDES downloads | **DOCUMENTED, UNTESTED** | No key; unpublished throttling | Weekly | NPDES permit ID, permit issue/effective/expiry, design flow, DMR flow and violations | FRS ID, NPDES ID | QID expiry (~30 min); bulk files 100s of MB | **Highest Haskell-specific value.** Permit reissue or modification, rising DMR flow against limits, and new outfalls at a food plant are wastewater-pretreatment project precursors. This is the Wastewater Monitor's proven domain |
| **FDA openFDA food enforcement** | `api.fda.gov/food/enforcement.json` | **DOCUMENTED, UNTESTED** | Key optional (free); without key 240/min, 1,000/day per IP (documented); CC0 | Weekly | recalling_firm, address, classification, report_date, recall_number | Name + address → org; low facility precision | Firm names inconsistent | **Context and negative signal only.** Never an opportunity (master prompt) |
| FDA Food Facility Registration | — | **Permanently unavailable** | 21 U.S.C. 350d(a)(5); doc 12 | — | — | — | — | Recorded so it is not re-attempted |
| FDA Data Dashboard (inspections) | Credentialed API | **DOCUMENTED, UNTESTED**; credentials required | Registration | — | FEI, inspection outcomes | FEI | Credentialed | Low pilot value; defer |
| **Corporate newsrooms / IR** | Mars (`www.mars.com/sitemap.xml`, `/news-and-stories`) | Mars: **VERIFIED IN PRODUCTION** (reachability). Others: **PROPOSED** (doc 12 lists 25–30 endpoints, mostly Unverified) | Copyrighted: **reference_only** (ADR 0014) | Daily | title, URL, published date, excerpt | Publisher = org; facility via place extraction | Redesigns, WAFs; Mars publishes no feed (5 candidates retired) | The only early source for Mars, Nestlé, Danone, Niagara (doc 12) |
| Wire services (GlobeNewswire, PR Newswire, Business Wire) | Organization or search RSS | **PROPOSED** | Terms review required (D7) | Hourly–daily | headline, dateline, URL | Issuer name | Feed paths per issuer unconfirmed | Many issuers publish plant announcements through wires first |
| **GDELT DOC 2.0** | `api.gdeltproject.org/api/v2/doc/doc?mode=artlist&format=json` | **DOCUMENTED, UNTESTED** | No key; rate-limited (GDELT states it protects the backend; ~1 req / 5 s commonly reported, **unverified**) | 15–60 min | URL, title, domain, seendate, language | Query by org name; resolve to publisher's article | 429s, rolling window, noisy | **Discovery only, reference mode** (ADR 0006): leads to a primary source, never evidence by itself |

### 6.3 Secondary sources

| Source | State | Notes and value |
|---|---|---|
| State economic-development incentives (governor and EDO press releases; incentive board agendas) | **PROPOSED**; D5 open | Decisive for Mars, Nestlé, Danone, Niagara (doc 12). Mostly HTML; per-state adapters. Good Jobs First Subsidy Tracker: licence for commercial use **unconfirmed** — legal review before use |
| Local planning, zoning, building permits | **PROPOSED**; D21 approved as a bounded vendor track | Socrata, ArcGIS and Legistar where they exist. Shovels.ai has a free tier (250 requests, doc 12). Paid tiers and other vendors (ConstructConnect, Dodge, IIR, BuildCentral) are quote-only; F&B depth **unverified**. Highest setup cost per source |
| USDA NASS Quick Stats / ERS; Census CBP and Economic Census | **DOCUMENTED, UNTESTED** | Aggregate counts, no facility IDs, 1–5 year lag. **Market-trend context only** (`market_trends`); never account evidence |
| Industrial water/wastewater indicators | **PROPOSED**; ECHO above is the structured core | State NPDES public notices (e.g. Arkansas posts per-permit PDFs) are a strong expansion lead for food processors. Unstructured PDFs need one parser per state. Reuse the Wastewater Monitor's document-evidence and OCR layer (`docs/document-evidence.md`) |
| Trade publications (Food Engineering, Food Processing, Meat+Poultry, Food Dive, Beverage Industry, Dairy Foods) | **PROPOSED** | RSS mostly available (unconfirmed per title). Store headline, link and excerpt only (reference). Discovery, not evidence |

### 6.4 Recommended activation sequence

1. **SEC EDGAR, repaired and widened** to all verified CIKs for which an
   `account_source_expectations` row says `required` or `optional`: PepsiCo, Coca-Cola,
   Kroger, Tyson, Hershey, Kimberly-Clark, Unilever (20-F/6-K), P&G, Sherwin-Williams,
   Ecolab, KDP, and optionally Nestlé. Danone is historical only. **Exhibits fixed.**
2. **USDA FSIS MPI** — facility identity for Tyson and protein operators.
3. **EPA FRS + ECHO/NPDES** — facility identity for every US manufacturing account plus
   wastewater-permit signals.
4. **Mars newsroom, repaired** (article filtering, dates, reference-only), then other
   newsrooms one dry-run-verified endpoint at a time.
5. **openFDA enforcement** — cheap context and negative signals.
6. **GDELT discovery** (reference mode), **state incentives** (after D5), **permits**
   (after the D21 vendor track), **trade press**.

Before enabling each connector, an operator adds its exact hosts to `EGRESS_ALLOWLIST` in
the Netlify UI. The runner already fails the source by name if a host is missing.

---

## 7. Agent-Reach feasibility

**Inspected:** `Panniantong/Agent-Reach` `main` at `94f06c1` (2026-10-08). Python ≥3.10,
MIT, actively maintained, PyPI `agent-reach` v1.5.0. Read only; not installed or executed.

**What it is.** `agent_reach/core.py` describes itself as an "installer, doctor, and
configuration tool… After installation, agents call the upstream tools directly." Most
channel classes only probe health. Real fetching happens in Markdown recipes
(`agent_reach/skill/SKILL.md`) that a coding agent executes. The MCP server exposes one
tool, `get_status`.

| Question | Finding |
|---|---|
| 1. Usable unattended | Web reading via Jina Reader (`r.jina.ai`); RSS via feedparser; Exa search via `mcporter` → `mcp.exa.ai`; GitHub; possibly YouTube transcripts |
| 2. Needs interactive sessions or credentials | X/Twitter (cookies), Reddit (logged-in session), LinkedIn (`--login`), Facebook/Instagram (reuses Chrome login), Xiaohongshu, Xueqiu, Boss (Chrome remote debugging). `cookie_extract.py` pulls browser cookies. **All incompatible with the master prompt's ban on unauthorized authenticated scraping** |
| 3. Pinned dependency, worker, or gateway | **Not a pinned dependency.** It is Python while the Radar is TypeScript on Netlify Functions. `install --system` runs apt/brew, `npm -g`, pipx, and writes skill files into `~/.claude/skills` and other agent directories. Several upstream tools are unpinned (`@latest`). If used at all: **(c) a separate collection gateway** in an isolated container, pinned to `v1.5.0` or a SHA, cookie channels disabled, writing **only** to `research_claims` (ADR 0011) |
| 4. Normalization into the evidence schema | It records **no provenance**: `WebChannel.read()` returns Markdown with no URL metadata, status, time or hash. Every provenance field would have to be added by our code, and the page would have passed through a third-party rewriter (Jina) first, so the stored hash would not be of the publisher's bytes |
| 5. Isolation, permissions, secrets, rate limits | Container with egress allowlist of `r.jina.ai` and `api.exa.ai` only; no home-directory credential store; staging-only writes with a service key scoped to one table; per-run caps. Jina and Exa see every URL and query we send |
| 6. Proof of concept without touching production | **Yes**, but it proves little. A PoC can run entirely outside the application against a disposable database. **Recommended instead:** call the two useful backends directly from the existing egress gateway — RSS with a TS parser, direct newsroom fetch with readability extraction, and optionally Exa's REST search API (key required) for discovery. That preserves publisher-byte hashes and the ADR 0002 egress posture |

**Verdict: do not integrate Agent-Reach.** Use it as a catalogue of which public tools
exist. If discovery beyond GDELT is wanted, add an Exa (or equivalent) **discovery-only**
adapter behind the egress gateway, writing reference-mode leads that must resolve to a
primary source before they can support a signal. That requires a V1-style vendor
decision and a D6 (paid news/discovery) decision.

---

## 8. Opportunity intelligence pipeline

The existing lifecycle is preserved: stage `emerging → developing → confirmed`; status
`new / watching / pursue / assigned / on_hold / dismissed / …`; confidence
`possible / probable / confirmed`; three recorded axes (ADR 0009, Proposed). The proposal
below changes **what qualifies for each state**, not the states.

```
collect ─► validate ─► store evidence ─► link entities ─► extract facts ─► classify
   │          │             │                 │                │              │
 egress    schema +     access mode       deterministic    span-cited     versioned
 gateway   content      honoured          IDs first,       facts only     ontology
           checks       (ADR 0014)        then ladder                     (ADR 0008)
                                              │
      correlate ◄──────────────────────────────┘
          │
          ├─► signal (one extracted event, always kept, incl. negatives)
          ├─► emerging opportunity (site-specific, non-recurring, positive)
          └─► qualified opportunity = stage 'developing' (independent corroboration
              or reviewer approval) ─► 'confirmed' (authoritative primary + review)
                          │
             three axes recorded separately ─► cited summary ─► BD action
                          │
                  review queue ─► corrections supersede (ADR 0012) ─► audit_events
```

1. **Collect and validate.** Every fetch records requested URL, final URL, status,
   `retrieved_at`, SHA-256 of the publisher's bytes, connector id and version. Structural
   validation per source rejects a response whose shape moved, so the source fails
   loudly instead of storing garbage (the Wastewater Monitor's canary pattern).
   Government bytes go to the private bucket (`archive_uri`). Corporate material stores
   hash, title, date, excerpt and claims only.
2. **Resolve.** Deterministic first: CIK, FSIS establishment number, FRS Registry ID,
   NPDES ID. Then name + address ladder (ADR 0005). `unresolved` is a valid terminal
   state. Ownership is evaluated **as at the event date** using
   `organization_relationships` intervals (Kellanova→Mars from 2025-12-11; Nestlé
   Waters≠Nestlé; MICC≠Unilever after 2025-12-06). Every evidence row gets an
   `evidence_entity_links` row naming the organization **it was collected for**, even
   when no signal follows (fixes F-12).
3. **Extract.** Facts are extracted only with a character span into the stored text:
   action, asset, place, amount, capacity, jobs, timeline. Structured sources produce
   facts without NLP (a new FSIS establishment, an NPDES reissue). An optional model
   pass (after V1) goes through the model gateway and replay cache, and **a validator
   drops any fact whose value does not appear verbatim in its cited span.**
4. **Classify.** Project type (greenfield, expansion, modernization, closure/exit,
   distribution/cold-chain, utility/wastewater) × Haskell market segment (README list),
   from versioned config (`scoring_configs`, ADR 0008), not code constants.
5. **Correlate.** Cluster on `(organization, facility-or-locality, project type)`,
   **not filing month**. Independence is by **publisher family** (SEC, a federal
   registry, the company, a state agency, the press), not by document count; an 8-K and
   its EX-99 are one family. **Recurring-disclosure suppression:** a normalized-sentence
   fingerprint already seen in an earlier filing by the same filer marks the match
   `recurring_disclosure`. It updates `last_observed_at` and creates nothing new.
6. **Signal vs emerging vs qualified.**
   - **Signal:** any extracted event, positive or negative, kept forever.
   - **Emerging opportunity** (`stage = emerging`): a positive signal that is
     site-specific (named place, facility identifier, or resolved facility), not
     recurring, and not from a financial-statement or accounting-policy section.
     **Negative signals never create opportunities.** They attach to an existing
     opportunity as `negative` or `closing`, or to a facility as context.
   - **Qualified opportunity** (`stage = developing`): two or more independent publisher
     families, at least one authoritative primary, **or** a reviewer's approval.
   - **Confirmed:** an authoritative primary states the project, plus reviewer approval.
     Never machine-assigned (already true for signals).
7. **Score three axes separately, recorded and not combined.**
   - **Evidence strength**: authority × independence × access mode, under the ADR 0014
     ceiling.
   - **Project maturity**: rumour → announced → permitted → funded → under construction.
   - **Capability fit**: project type × Haskell market.
   `final_score` stays null until D16 decides a combination. A deterministic sort
   (stage, strength, recency) orders the list meanwhile.
8. **Summaries and actions.** Compose from structured fields (already done in the UI
   since PR #15). An optional model summary may only paraphrase cited spans, with
   footnote markers, and a post-validator rejects any sentence carrying a number or date
   not present in its citation. Recommended BD action comes from a rule table keyed on
   (project type, maturity, segment), e.g. *NPDES modification at a resolved Tyson plant
   → wastewater pretreatment conversation with plant engineering.*
9. **Review, corrections, audit.** A review queue over `review_status`
   (approve / reject / merge / split / re-attribute). Every action writes
   `audit_events`. Corrections supersede (ADR 0012). Reprocessing reads stored text
   under a new `transformation_version`; it never refetches to fix our own defects.
10. **Guards against unsupported claims.**
    - No `event_date` without a span; the filing date stays in `published_at` only.
    - No amount without a verbatim span and its qualifier ("up to", "approximately").
    - `forecast_horizon` stays `unknown` unless the source states it.
    - No valuation is ever estimated.
    - A regression corpus, seeded with **the 6 current false positives and the *Our
      History* page**, must produce zero opportunities in CI.

---

## 9. Database and connector changes required

**DDL (one schema-only PR, per the repository's own separation rule):**

- `evidence_text_fingerprints (organization_id, source_id, fingerprint, first_evidence_id, first_seen_at)`
  for recurring-disclosure suppression.
- `ingestion_jobs` / `ingestion_tasks` with `status`, `claimed_at`, `last_heartbeat`,
  `attempt`, `retry_after` (the Wastewater `_jobs.mts` model). `source_runs` gains
  `abandoned` in its status vocabulary.
- `facility_identifiers.identifier_system` vocabulary: `fsis_establishment`,
  `fsis_establishment_id`, `frs_registry_id`, `npdes_permit` (verify what 0006 already
  admits).
- Signal columns: `event_date_source` (`text_span` / `structured_field` / `none`) and
  `recurrence_status`.
- Security-invoker read views: `account_source_coverage_v` (expectation × observed
  evidence per account and source family, with last observation),
  `opportunity_card_v`, `source_health_v` (derived freshness against
  `expected_cadence_hours`), all paginated. These replace the 1,000-row whole-graph read.
- Column grants for any new client-read columns, in the same migration. Lesson of
  0021/0022: a column-level grant does not extend to columns added later.

**Connector and runtime changes:**

- Runner: cohort from data, not code; stale-run lease and recovery; persisted skips;
  checked writes; access mode from `sources.access_mode`.
- Execution: scheduled dispatcher (no route) → `*-background` worker per source task
  with heartbeat; separate `health-sweep` scheduled function; per-invocation time budget
  and keyset cursors. This is the pattern the Wastewater Monitor arrived at for the same
  failure (`poll-sources.mts`: "DISPATCH, don't process"). **Gate:** confirm that the
  Netlify plan supports background functions.
- Bulk sources (ECHO Exporter, ICIS-NPDES): a GitHub Actions workflow with a
  credential-free canary that acquires and validates, then a protected publish job. This
  is the pattern of the Wastewater Monitor's `texas-capacity-refresh.yml`. It is
  disabled until an operator sets a repository variable.
- SEC: exhibit discovery from the filing index regardless of filename prefix; XBRL
  concept fetch for capex context.
- Mars: article filter (JSON-LD `@type` NewsArticle or Article, plus an exclusion list
  for category and index paths); `datePublished` required for a signal.

---

## 10. Classification and scoring architecture

| Layer | Owner | Form | Decision status |
|---|---|---|---|
| Ontology (signal families, event types, project types, segments) | Config table + seed | Versioned rows (ADR 0008) | ADR 0008 Proposed |
| Deterministic extractors | Code, per source | Pure functions `text → facts with spans` | — |
| Model-assisted extraction | Model gateway | Structured output, span-validated, replay-cached | **V1 open** |
| Derivation rules (signal → emerging → developing) | Code + config thresholds | §8.6 | Proposed here; ratify at G-2 |
| Three axes | Code, recorded on signal and opportunity | Ordinal values plus the reason recorded | ADR 0009 Proposed, **D16 open** |
| Combined priority score | — | **Not computed** | Blocked on D16 |
| Account priority (tiers, PACK EXPO) | — | `UnavailableAttribute` | **Blocked on D14-L** |

Quality is measured, not asserted. Every opportunity in the pilot window is reviewed by
a person, and precision is reported per connector and per rule. D9-T numeric targets are
set at the week-4 checkpoint.

---

## 11. Ordered PR plan

Repository conventions are kept: schema PRs are DDL only, connectors are never mixed with
UI integration, operator data changes ship as reviewed, generated, CI-tested files and
are **applied only on explicit authorization**.

| # | PR | Depends on | Production change on merge |
|---|---|---|---|
| **1** | **Ingestion integrity: stale runs, access mode, honest health** (§12) | — | None until next scheduled run. Operator remediation file shipped, **not applied** |
| 2 | Schema: fingerprints, jobs/tasks, identifier vocabulary, signal provenance columns, coverage/health/card views, grants | 1 | Migration 0025, applied by operator on authorization |
| 3 | Derivation correctness: span-only event dates; recurring-disclosure suppression; locality-based cluster key; negatives never create opportunities; financial-section exclusion; regression corpus; `admin-run` reprocess mode (from stored text, dry-run first) | 2 | None. Reprocess and the dismissal of 6 opportunities are **operator steps on authorization** |
| 4 | Durable execution: dispatcher + background worker + heartbeat + stale re-dispatch + health sweep | 2 | Scheduler shape changes; dry-run first |
| 5 | SEC cohort from data + exhibit discovery fix + evidence→organization links + CI guard extended to `netlify/functions` | 3, 4 | Backfill of 9–10 new filers, 12-month window (ADR 0016), on authorization |
| 6 | FSIS MPI connector → `facility_candidates` / `facility_identifiers`, establishment-change signals | 2, 4 | New host `www.fsis.usda.gov` in the allowlist; enable on authorization |
| 7 | EPA FRS + ECHO/NPDES connector (targeted REST for cohort names and states) → facility identity + permit signals | 2, 4 | New hosts; enable on authorization |
| 8 | Facility resolution: deterministic ID merge across FSIS/FRS; candidate review; ownership relationships seeded for the four doc-12 reorganizations (seed, not migration) | 6, 7 | Seed applied on authorization |
| 9 | UI integration: switch Pulse/Company/Health/Map to the views from PR 2; account coverage report; derived freshness | 2, 5 | Visible change for users |
| 10 | Mars repaired (article filter, dates, reference-only) + one additional dry-run-verified newsroom per account where doc 12 marks one | 1, 4 | Per source |
| 11 | Government evidence archive to the private bucket (ADR 0014 completion); evidence proxy serves it | 4 | Storage writes |
| 12 | Review queue + `audit_events` wiring + corrections UI | 3 | UI |
| 13 | openFDA enforcement (context/negative only) | 4 | New host |
| 14 | Three-axis recording + versioned scoring config (no combined score) | 3; **D16** for combination | — |
| 15 | Model-assisted extraction behind the gateway with span validator | **V1 decision** | Recurring model cost |
| 16 | GDELT reference-mode discovery | 4; D6 | — |
| 17+ | State incentives (D5), permits (D21 vendor track), trade press, bulk ECHO via GitHub Actions | various | — |

### 11.1 Acceptance tests per PR

| PR | Acceptance tests (each must fail before the change and pass after) |
|---|---|
| 1 | (a) A `running` row older than the lease is closed `failure` with error `abandoned`, a health event is written, and the new run proceeds. (b) A run inside the lease is skipped **and** the skip is persisted with health not `healthy`. (c) A `reference_only` source writes `body_text = null`, `archive_uri = null`, keeps hash and excerpt. A database test proves the constraint now fires if the pipeline lies. (d) `closeRun` surfaces a failed `sources` update. (e) The operator remediation file is generated, byte-checked in CI, applies on PG 16/17 from a 0024 database, refuses a second run, and leaves non-Mars rows byte-identical |
| 2 | Migration contract forward/back/forward on PG 16 and 17; client-column-grant test covers every new view column; withheld columns stay withheld; no DML |
| 3 | The regression corpus (4 PepsiCo 10-Q windows, 2 Tyson 10-Q windows, *Our History*) yields 0 opportunities. A real-shaped plant announcement with place + amount yields 1 emerging opportunity. A closure yields a signal and 0 opportunities. `event_date` is null unless a timeline span exists. Reprocess is idempotent (second run writes nothing) |
| 4 | Killing the worker mid-task leaves a stale heartbeat. The next dispatch re-claims within one cycle. Two overlapping dispatches create one job. Health sweep flags a source with no success in 2× cadence |
| 5 | Every org with a `sec_cik` identifier and an SEC expectation of `required` or `optional` is collected, with no literal entity key in `netlify/functions` (CI grep). A recorded index.json with `d######dex991.htm` yields an exhibit document. Every SEC evidence row has an `evidence_entity_links` row |
| 6 | Recorded FSIS file → N candidates with establishment numbers. Re-run on the same edition writes 0 rows. A removed establishment produces a `closure`-family signal, not a deletion |
| 7 | Recorded ECHO response → FRS IDs and NPDES IDs on candidates. A permit reissue produces a utility/wastewater signal with the permit's own dates (span/field-sourced) |
| 8 | Two identifiers for one site merge deterministically. A conflicting name stays `unresolved`. An as-at query on 2025-12-10 vs 2025-12-11 attributes a Kellanova site differently |
| 9 | Coverage report lists all 15 accounts and names the four without periodic SEC coverage. Counts are identical between Pulse, Company and Health. No surface issues an unbounded select |
| 10 | Mars category/index URLs are rejected. Every stored Mars row has `published_at` or a recorded reason. Rows are `reference_only` |
| 11 | An SEC row has `archive_uri`. The evidence proxy streams it for a valid session and refuses a revoked one |
| 12 | Approve/reject writes `audit_events` and `opportunity_status_history`. Rejected items are superseded, not deleted |
| 13 | A recall produces a context signal, 0 opportunities |
| 14 | Axes recorded with reasons. `final_score` remains null |
| 15 | A model output citing a span that lacks the value is dropped. Replay cache makes a re-run cost 0 calls |

---

## 12. Recommended first PR (exact)

**Title:** *Ingestion integrity: recover stalled runs, honour each source's access mode,
and stop reporting a skipped source as healthy*

**Branch:** a new branch from `main` (not this audit branch).

**Why first.** It is the smallest change that stops the live system from asserting
things that are false: a healthy Mars, and full copies of copyrighted pages. It needs no
migration, so it can merge independently. Every later connector depends on run
recovery.

**Changes (code only):**

1. `app/netlify/functions/_shared/connectors/runner.ts`
   - Before `openRun`, look up any `run_status = 'running'` row for the source with
     `started_at` older than a lease (`RUN_LEASE_MS`, default 15 minutes, environment
     override with a cap). Close it via `closeRun` as `failure` with
     `error_code = 'abandoned'` and a note naming the original start time. This writes
     a `source_health_events` row and increments `consecutive_failures`.
   - `RunAlreadyActiveError` inside the lease: report `runStatus: 'skipped'`,
     `healthStatus: 'degraded'`, and **persist** a `source_health_events` row
     (`event_type: 'skipped_overlap'`).
   - `closeRun`: check the `error` on every write and include failures in the returned
     result (F-11).
   - **No migration is needed, checked against the constraints.** Abandoned runs use
     `status = 'failed'` / `run_status = 'failure'`, which `source_runs` admits.
     `degraded` is in `sources_health_status_check` (0021).
     `source_health_events.event_type` is unconstrained. Legacy `source_runs.status`
     does **not** admit `skipped`, which is why a skip is persisted as a health event
     and never as a run row.
2. `app/netlify/functions/_shared/connectors/pipeline.ts`
   - Read `access_mode` (and `license_mode`) from the `sources` row passed by the runner
     instead of the literal at line 1019.
   - For `reference_only`: write `body_text = null` and `archive_uri = null`; keep
     `content_hash`, title, publisher, `published_at`, locator and the matched excerpt
     (bounded). Classification still runs on the in-memory text and the text is
     discarded afterwards. The 304 resume-from-storage path is unavailable for these
     rows by design, so they re-fetch.
3. `db/operator/remediate_2026_10_ingestion_integrity.operator.sql` (**shipped, not
   applied**) — one `DO` block with preconditions and postconditions, in the existing
   operator style:
   - close the stalled Mars run (`2026-09-14 05:23:06Z`) as `abandoned`;
   - set `access_mode = 'reference_only'`, `body_text = null` on the 53 Mars evidence
     rows, preserving hash, URL, excerpt and timestamps;
   - recompute `sources.health_status` for `mars-newsroom` from its runs.

   A `db/tests` script proves it on PG 16/17 against a 0024-shaped database: non-Mars
   rows are byte-identical, a second run refuses, and an injected failure leaves the
   database unchanged.
4. Tests: `runner.stalledRun.test.ts`, `pipeline.accessMode.test.ts`, and extensions to
   `db/tests/evidence-payload.sh` proving `evidence_reference_only_has_no_body` now
   guards the real write path.
5. Docs: correct `docs/design/16` header and the `docs/adr/README.md` "nothing is
   implemented" line; add a runbook section for applying the remediation file.

**Explicitly out of scope for PR 1:** derivation rules, the cohort, exhibits, schema,
UI, and the 6 false opportunities (PR 3 handles those through reprocessing, with a
reviewed dismissal).

**Merge does not change production data.** The remediation file is applied by an
operator only after separate authorization. Until then the next scheduled run will,
by itself, close the stalled Mars run as abandoned and mark Mars unhealthy. That is the
intended, honest outcome while Mars stays defective.

---

## 13. Pilot definition

**Cohort:** the existing 15 Highest Value accounts (`db/seed/0003_pilot_cohort.sql`),
unchanged.

**Data-use restrictions honoured:**

- **D14-L:** no PACK EXPO or engagement data; tier and account-strategy stay
  `UnavailableAttribute`.
- Real account names only in `db/seed/` and the two exempted connector tests.
- **ADR 0014:** corporate material reference-only.
- **D11:** Kimberly-Clark, P&G and Ecolab (`fnb_adjacent`) and Sherwin-Williams
  (`non_fnb`) are collected but **excluded from relevance metrics** while provisional.
- **D12:** Ecolab is read with supplier semantics.
- Reorganizations (doc 12) are applied as time-bounded relationships, never as renames.

**Connectors (minimum three, target four):** SEC EDGAR (repaired, ~11 filers), FSIS MPI,
EPA FRS/ECHO-NPDES, plus the repaired Mars newsroom.

**Duration:** six weeks after PR 7 is enabled. Two full cadence cycles for weekly
sources need at least two weeks; the remainder is the D9 measurement window.

**Exit criteria:**

1. Each pilot connector completes **two full expected cadence cycles unattended**
   (doc 15 §1.5 criterion 2).
2. Re-running any connector on unchanged content writes **0 evidence rows and 0 change
   events**.
3. 100% of evidence rows carry URL, `retrieved_at`, SHA-256, connector id and version,
   and an organization link. 100% of government rows carry `archive_uri` (after PR 11).
4. The **account coverage report** lists all 15 accounts per source family against
   their expectations and names every gap, including the four without periodic SEC
   coverage.
5. An injected connector failure is visible on Source Health within one cycle with no
   human detection (criterion 5).
6. At least one resolved facility record with a government identifier for every account
   that has US manufacturing appearing in FSIS or FRS. The count is reported, not
   targeted.
7. **Every** opportunity raised in the window is reviewed. Precision is reported by
   connector and rule. Zero opportunities from the regression corpus.
8. A documented path to genuine opportunities: the share of emerging opportunities that
   reviewers mark relevant, against the D9-T target set at week 4.

---

## 14. Operational costs and recurring expenses

Third-party prices change and were **not verified** in this audit. Figures are planning
estimates to be confirmed before each decision.

| Item | Recurring cost driver | Estimate |
|---|---|---|
| SEC, FSIS, EPA FRS/ECHO, openFDA, Census, NASS, GDELT | Public APIs | **$0**; openFDA and NASS keys free |
| Netlify | Existing site; background functions need a plan that supports them | Existing plan, **verify tier** |
| Supabase | Existing dedicated project; storage growth for archived gov text (SEC ~tens of MB/year for 11 filers; FSIS weekly CSV a few MB) | Existing plan; storage negligible at pilot scale |
| GitHub Actions | Bulk ECHO refresh (later) | Within typical private-repo minute allowances; verify |
| Stadia Maps geocoding | Already in use | Free/low tier at pilot volume; verify limits |
| AI provider (V1, PR 15) | Only documents passing the deterministic prefilter, ~50–200/week × a few thousand tokens | Low tens of dollars per month at mid-tier model pricing. **Price against the chosen provider's current sheet at the V1 decision** |
| Discovery API (Exa or similar), Jina Reader | Optional (D6) | Usage-based; quote at decision |
| Commercial permit/project data (D21) | Optional | Shovels.ai has a free tier; paid tiers and ConstructConnect, Dodge and IIR are quote-only and typically far above every other line here |
| Operator time | Enabling sources, reviewing opportunities | Opportunity review is the dominant real cost of the pilot; budget hours, not dollars |

---

## 15. Risks, open decisions, deployment gates

**Risks**

| Risk | Mitigation |
|---|---|
| Users have already seen 6 false opportunities | PR 3 reprocess and a reviewed dismissal; tell users which records were withdrawn and why (ADR 0012 keeps them inspectable) |
| Netlify plan lacks background functions | Fallback: GitHub Actions scheduled worker writing through the service role (the Wastewater pattern) |
| Newsroom breakage rate (doc 12: "highest breakage") | Dry-run per endpoint; health sweep; reference-only |
| SEC exhibit fix cannot be validated from this audit environment (sec.gov blocked) | Validate against a recorded index.json captured by the production connector or an operator machine |
| Haskell tenant Microsoft sign-in untested | Recovery-code fallback exists (PR #13) |
| Precision of a regex classifier on prose | Measured from day one; model-assisted extraction (PR 15) only behind the span validator |

**Open decisions blocking specific PRs:**

- **V1** blocks PR 15.
- **D16** blocks the combined score in PR 14.
- **D5** blocks state incentives.
- **D21** vendor track blocks permits.
- **D6** blocks paid discovery and news.
- **D7** blocks wire and trade-press retention.
- **D13** governs bottler and co-manufacturer scope (Coca-Cola).
- **D20** governs Kellanova connector retirement.
- **D14-L** keeps blocking PACK EXPO.

**Deployment gates (each requires explicit authorization):**

1. Apply the PR 1 remediation file to production.
2. Apply migration 0025 (PR 2) via its operator file.
3. Run reprocessing and dismissals (PR 3), dry run first.
4. Enable each new source: allowlist hosts in Netlify, dry run, then `enabled = true`.
5. Backfill each new SEC filer (ADR 0016 window).
6. Switch UI to the new views (PR 9).
7. Any model call (V1).

---

## 16. What this document does not do

It changes no code, schema, seed, setting, or production row. It does not ratify any
Proposed ADR or Open decision. It does not mark any external endpoint as working that
production rows do not already prove. Implementation waits for authorization.
