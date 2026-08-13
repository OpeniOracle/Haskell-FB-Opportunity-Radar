# Pilot Source Coverage Matrix — 15 Highest Value Accounts

Companion to `docs/design/10_DESIGN_RESPONSE.md` §7. Supersedes the unsupported
"five of fifteen file nothing with the SEC" count in the first design response.

Version 0.3 · Status: **for stakeholder review at Gate G-3**

**v0.3** incorporates the external-research reconciliation: Nestlé's CIK is upgraded to
**Verified**, three corporate-event dates are made precise, the FSIS MPI establishment API
and EPA FRS are added to the pilot stack, a permanently-unavailable source is recorded,
and a vendor-evaluation track replaces the assumption that local permit coverage must be
built connector by connector. Dispositions are in `14_EXTERNAL_RESEARCH_RECONCILIATION.md`.

---

## Verification method and its limits

Read this before relying on any cell below.

**What was verified.** SEC Central Index Keys were confirmed from SEC-controlled
artifacts returned by search: either a `https://www.sec.gov/Archives/edgar/data/<CIK>/…`
document URL, or an accession number whose filer prefix is the CIK (`0000047111-25-…`
is filer CIK 47111). Corporate-structure events were confirmed against company IR
releases and SEC filing URLs.

**What could not be verified in this environment.** `www.sec.gov` and `data.sec.gov` are
blocked by this session's network egress policy, as are corporate domains — a direct
fetch of `www.pepsico.com` was refused by the proxy. That means **no filing-history
inventory was pulled from EDGAR directly**, and **no newsroom, IR, or feed URL was
fetched to confirm it resolves or serves a feed**.

**Confidence labels used below:**

| Label | Meaning |
| --- | --- |
| **Verified** | Confirmed from an SEC-controlled URL or accession number |
| **Corroborated** | The endpoint appeared as a live result URL during research, so the host and path pattern are real, but the page was not fetched |
| **Unverified** | Expected from general knowledge of the company. Must be confirmed by connector dry run before enablement |

Every **Unverified** endpoint is a Phase 1 dry-run task, not a fact. The source registry
already gates this with `require_dry_run_before_enable`, so the matrix is written to feed
that gate rather than to bypass it. Filing-coverage classifications marked *(inferred
from filer status)* follow from whether the entity is a domestic reporting company, a
foreign private issuer, or unregistered — they are not per-form counts from EDGAR.

**Filing-coverage vocabulary.** The master prompt requires that incidental mentions not
be counted as company coverage:

- **Operational periodic coverage** — the company itself files 10-K / 10-Q / 8-K, or 20-F
  / 6-K, on a schedule. Usable as a scheduled connector against a known CIK.
- **Ownership-only coverage** — the company appears in EDGAR solely as a filer of
  beneficial-ownership or transaction documents (SC 13D/G, Forms 3/4/5, Form D) against
  *other* registrants. Episodic and event-driven. **Not** a coverage substitute.
- **Incidental coverage** — the company's name appears inside another registrant's
  filing (customer lists, supplier discussion, merger documents). Full-text discovery
  only. **Never counted as company coverage.**
- **No SEC coverage** — no usable EDGAR presence.

---

## Summary

| # | Account | Status | CIK | SEC coverage class | Pilot source center of gravity |
| --- | --- | --- | --- | --- | --- |
| 1 | PepsiCo, Inc. | Public (US) | **0000077476** (Verified) | Operational periodic | EDGAR + newsroom + state incentives |
| 2 | The Coca-Cola Company | Public (US) | **0000021344** (Verified) | Operational periodic — **brand owner, not plant operator** | Bottler newsrooms + bottler filings |
| 3 | Nestlé S.A. | Public (SIX; US OTC ADR) | **0000792990** (Verified) | **Ownership-only** — verified identity, no operational periodic coverage | US subsidiary newsrooms + state/local |
| 4 | The Kroger Co. | Public (US) | **0000056873** (Verified) | Operational periodic | Newsroom + DC/plant announcements + local planning |
| 5 | Tyson Foods, Inc. | Public (US) | **0000100493** (Verified) | Operational periodic | **FSIS** + EDGAR + closures |
| 6 | Mars, Incorporated | **Private** | None (operating co.) | Ownership-only, via targets | Newsroom + **Kellanova legacy footprint** + state/local |
| 7 | The Hershey Company | Public (US) | **0000047111** (Verified) | Operational periodic | EDGAR + newsroom + PA/regional |
| 8 | Kimberly-Clark Corp. | Public (US) | **0000055785** (Verified) | Operational periodic | EDGAR + newsroom (non-food ontology) |
| 9 | Unilever PLC | Public (LSE/NYSE ADR) | **0000217410** (Verified) | Operational periodic (20-F/6-K) | Newsroom + US subsidiary + local |
| 10 | Procter & Gamble Co. | Public (US) | **0000080424** (Verified) | Operational periodic | EDGAR + newsroom (non-food ontology) |
| 11 | The Sherwin-Williams Co. | Public (US) | **0000089800** (Verified) | Operational periodic | EDGAR + newsroom — **scope confirmation required** |
| 12 | Ecolab Inc. | Public (US) | **0000031462** (Verified) | Operational periodic | EDGAR + newsroom — **supplier semantics** |
| 13 | Danone S.A. | Public (Euronext; US OTC ADR) | 0001048515 (Verified, **historical**) | No current periodic coverage | Danone North America newsroom + state/local |
| 14 | Keurig Dr Pepper Inc. | Public (US) | **0001418135** (Verified) | Operational periodic — **mid-reorganization** | EDGAR + newsroom + separation tracking |
| 15 | Niagara Bottling, LLC | **Private** | None found | No SEC coverage | **State incentives + local permits + water** |

**Corrected headline finding.** Eleven of fifteen accounts have operational periodic SEC
coverage under a verified CIK. Four do not: **Nestlé, Mars, Danone, and Niagara
Bottling**. A fifth, **The Coca-Cola Company**, has excellent periodic coverage that is
largely the wrong coverage — KO files as a brand owner and concentrate producer, while
the US bottling plants that generate Haskell-shaped capital projects sit with
independent bottlers that file separately or not at all.

So the operative number is not "five file nothing." It is: **four accounts have no
periodic SEC coverage, and a fifth has periodic coverage that does not reach the
facilities.** For those five, company newsrooms and state/local incentive and permit
sources are not a later phase — they are the only pilot coverage that exists.

---

## Cross-cutting finding: corporate structure moved under four of fifteen accounts

Verified during this pass, and material to entity modeling:

| Event | Date | Effect on the radar |
| --- | --- | --- |
| Mars completes acquisition of **Kellanova** ($36B) | **11 Dec 2025** | Mars — a private company with no SEC coverage — absorbs a large US plant footprint (Pringles, Cheez-It, Pop-Tarts). Kellanova's periodic filings (CIK 0000055067) end as a coverage source at deregistration |
| **Nestlé Waters NA** → BlueTriton (2021) → merged with Primo Water into **Primo Brands** (PRMB, CIK 0002042694) | merger closed **8 Nov 2024** | Poland Spring, Deer Park, Ozarka, Ice Mountain, Pure Life plant activity is **not Nestlé**. Attributing it to Nestlé would be a resolution error against a Highest Value account |
| Unilever demerges ice cream as **The Magnum Ice Cream Company** (MICC) | trading from **8 Dec 2025** | Ben & Jerry's, Magnum, Cornetto, Wall's plants leave Unilever |
| **KDP completes the JDE Peet's acquisition** (96.22%), then plans a tax-free split into two US-listed companies | completed **1 Apr 2026**; separation date **undetermined** | KDP will likely become two accounts *during the pilot* |
| **Kimberly-Clark / Kenvue** merger pending (shareholders approved 29 Jan 2026; HSR expired 4 Feb 2026) | expected **Q4 2026** | A sixth structural change is likely to land inside the pilot window |

Four completed reorganizations in roughly twenty months, plus two more in flight. This
is not an edge case to handle later. **The entity model must treat ownership as
time-bounded and evidence-backed** — which is exactly what `facility_organizations` with
`from_date` / `to_date` provides (C3), and why `organization_relationships` needs the
same treatment. A model that stores "who owns this plant" as a single current pointer
will silently misattribute projects every time one of these closes.

---

## Per-account detail

### 1. PepsiCo, Inc.

- **Canonical company:** PepsiCo, Inc. · **Status:** Public (Nasdaq: PEP)
- **SEC CIK:** 0000077476 — **Verified** (`/Archives/edgar/data/77476/…`, FY2025 10-K
  `pep-20251227.htm`)
- **Useful periodic filing coverage:** 10-K, 10-Q, 8-K *(inferred from filer status)*.
  Capex discussion, segment capacity commentary, restructuring
- **Ownership-only / incidental:** Forms 3/4/5 for insiders — no collection value
- **Newsroom:** `pepsico.com` press releases — **Unverified** (domain blocked here)
- **IR:** `pepsico.com/investors` — **Unverified**
- **Subsidiaries / operators:** Frito-Lay North America, Quaker Oats, PepsiCo Beverages
  North America, Gatorade, Tropicana JV interest, Sabra JV. Bottling is largely in-house
  post-2010, so unlike KO the parent *is* the plant operator
- **Priority state / permit / regulatory / utility:** TX, IL, NY, CA, GA, OH for known
  concentrations; FDA food enforcement (Quaker); EPA ECHO for plant-level permits
- **Coverage gaps:** Facility-level detail is thin in filings; plant projects usually
  surface first in regional press and local permitting
- **Recommended pilot connectors:** EDGAR (A) · newsroom (A) · FDA enforcement (A) ·
  GDELT reference-mode (A) · EPA ECHO (B) · state incentives (B)

### 2. The Coca-Cola Company

- **Canonical company:** The Coca-Cola Company · **Status:** Public (NYSE: KO)
- **SEC CIK:** 0000021344 — **Verified** (`/Archives/edgar/data/21344/…`, SIC 2080)
- **Useful periodic filing coverage:** 10-K, 10-Q, 8-K *(inferred)*. Useful for
  refranchising and system strategy; **weak for US plant projects**
- **Ownership-only / incidental:** Bottler relationships appear as related-party
  discussion — incidental, not coverage
- **Newsroom:** `coca-colacompany.com/media-center` — **Unverified**
- **IR:** `investors.coca-colacompany.com` — **Unverified**
- **Subsidiaries / bottlers / operators — the critical row:**
  - **Coca-Cola Consolidated, Inc.** (NASDAQ: COKE), **CIK 0000317540 — Verified**
    (`/Archives/edgar/data/317540/…`, FY2025 10-K `coke-20251231.htm`). Largest US
    Coca-Cola bottler; territories across **14 states and DC**. Files its own 10-K —
    **this is the highest-value KO-adjacent connector in the pilot**
  - Coca-Cola Europacific Partners (US listing) — files as a foreign private issuer;
    relevant only for non-US assets — **Unverified**
  - Coca-Cola FEMSA — Mexico/LatAm — **Unverified**
  - Swire Coca-Cola USA, Coca-Cola Beverages Florida, Coca-Cola Bottling Co. of Northern
    New England, Great Lakes Coca-Cola (Reyes) — private US bottlers, newsroom and local
    permitting only — **Unverified**
- **Priority state / permit / regulatory / utility:** GA (HQ + concentrate), and the
  bottlers' footprints — NC, SC, TN, AL, VA, WV, FL, TX, UT/West (Swire); water
  withdrawal and wastewater permits are unusually relevant for beverage
- **Coverage gaps:** **The account-to-facility path runs through third parties.** KO
  coverage alone will produce brand news and almost no capital projects
- **Recommended pilot connectors:** **Coca-Cola Consolidated EDGAR + newsroom (A)** ·
  KO EDGAR (A, low yield expected) · KO newsroom (A) · private bottler newsrooms (B) ·
  state incentives in bottler states (B) · water/wastewater permits (B)

### 3. Nestlé S.A.

- **Canonical company:** Nestlé S.A. · **Status:** Public, SIX Swiss Exchange; US
  presence is an unsponsored/Level-1 ADR (NSRGY), not a US listing
- **SEC CIK:** 0000792990 — **Verified** (SEC-controlled URLs under
  `/Archives/edgar/data/792990/`, accessions `0001209191-15-057775` and
  `0000950170-24-111110`). Upgraded from Unverified in v0.2. **The coverage class does not
  change**: these are ownership and transaction filings against other registrants, not
  operational periodic coverage of Nestlé's F&B business
- **Useful periodic filing coverage:** **None.** Not a US reporting company; no 10-K and
  no 20-F obligation as an OTC Level-1 ADR
- **Ownership-only / incidental:** SC 13D/G-type filings against US registrants, spanning
  at least 2015 and 2024. Episodic and genuinely useful as an M&A signal; **must not be
  treated as company coverage**
- **Newsroom:** `nestle.com/media/pressreleases` (global) and `nestleusa.com/media` —
  both **Unverified**; **Purina** (`purina.com` / Nestlé Purina newsroom) matters
  independently for pet food
- **IR:** `nestle.com/investors` — **Unverified**
- **Subsidiaries / operators:** Nestlé USA, **Nestlé Purina PetCare** (major US plant
  footprint), Nestlé Health Science, Nespresso. **Nestlé Waters North America is no
  longer Nestlé** — divested 2021 to One Rock/Metropoulos as BlueTriton, merged into
  **Primo Brands** (CIK 0002042694) on 8 Nov 2024
- **Priority state / permit / regulatory / utility:** MO, IA, OH, CA, VA, AZ for known
  Purina/Nestlé USA concentrations; FDA food enforcement; EPA ECHO; state incentive
  announcements are historically the earliest signal for Purina plant investment
- **Coverage gaps:** **No periodic filing coverage at all.** Everything depends on
  newsroom and state/local sources. Highest risk of a silent-coverage failure looking
  like a quiet account
- **Recommended pilot connectors:** Nestlé USA + Purina newsrooms (A) · global newsroom
  (A) · state incentives MO/IA/OH (A) · FDA enforcement (A) · EPA ECHO (B) · **explicit
  negative rule: do not attribute Poland Spring / Deer Park / Ozarka / Ice Mountain /
  Pure Life activity to Nestlé**

### 4. The Kroger Co.

- **Canonical company:** The Kroger Co. · **Status:** Public (NYSE: KR)
- **SEC CIK:** 0000056873 — **Verified** (`/Archives/edgar/data/56873/…`)
- **Useful periodic filing coverage:** 10-K, 10-Q, 8-K *(inferred)*. Capex guidance and
  supply-chain investment commentary
- **Ownership-only / incidental:** —
- **Newsroom:** `thekrogerco.com/newsroom` — **Unverified**
- **IR:** `ir.kroger.com` — **Unverified**
- **Subsidiaries / operators:** **Kroger Manufacturing** — the account's F&B opportunity
  surface is its own dairies, bakeries, and deli/meat plants, plus distribution centers
  and automated fulfillment. Banner subsidiaries (Fred Meyer, King Soopers, Ralphs) are
  retail, not plants
- **Priority state / permit / regulatory / utility:** OH (HQ + plants), TX, GA, IN, MI,
  CO; **local planning and zoning is the primary early source for DC and fulfillment
  projects**; FDA enforcement for own-brand recalls
- **Coverage gaps:** Retail-heavy news volume will swamp plant signals unless
  organization role and facility type are used as filters. Role is `retailer`, but the
  opportunity semantics are manufacturing and cold chain
- **Recommended pilot connectors:** EDGAR (A) · newsroom (A) · FDA enforcement (A) ·
  local planning portals in OH/TX/GA (B) · EPA ECHO (B)

### 5. Tyson Foods, Inc.

- **Canonical company:** Tyson Foods, Inc. · **Status:** Public (NYSE: TSN)
- **SEC CIK:** 0000100493 — **Verified** (`/edgar/browse/?CIK=100493`, `/edgar/data/100493/…`)
- **Useful periodic filing coverage:** 10-K, 10-Q, 8-K *(inferred)*. Unusually
  informative on plant closures, consolidation, and capacity
- **Ownership-only / incidental:** —
- **Newsroom:** `tysonfoods.com/news` — **Unverified**
- **IR:** `ir.tyson.com` — **Unverified**
- **Subsidiaries / operators:** Tyson Fresh Meats, Hillshire Brands, Jimmy Dean, Ball
  Park, Aidells; numerous named plants
- **Priority state / permit / regulatory / utility:** AR (HQ), IA, NE, KS, TX, GA, AL,
  MO, TN. **USDA FSIS is the authoritative facility-level source for this account** —
  recalls and public-health alerts name establishments. EPA ECHO is unusually relevant
  (wastewater at protein plants). State incentives for new-build
- **Coverage gaps:** FSIS covers meat and poultry only; prepared-foods plants fall to FDA
  and local sources
- **Recommended pilot connectors:** **FSIS (A)** · EDGAR (A) · newsroom (A) · FDA
  enforcement (A) · EPA ECHO (B) · state incentives AR/IA/NE (B). **This is the account
  that will most exercise negative-signal handling** — closures and layoffs must reduce
  pursuit priority without being discarded

### 6. Mars, Incorporated

- **Canonical company:** Mars, Incorporated · **Status:** **Private** (family-owned)
- **SEC CIK:** none for the operating company. Mars appears in EDGAR as a filer of
  beneficial-ownership documents against targets — e.g. the SC 13D on **Kellanova**
  (`/Archives/edgar/data/55067/…/sc13d.htm`, Kellanova CIK 0000055067 — **Verified**)
- **Useful periodic filing coverage:** **None**
- **Ownership-only / incidental:** SC 13D/G on acquisition targets. Event-driven and
  genuinely useful as an M&A signal, but **not** company coverage
- **Newsroom:** `mars.com/news-and-stories/press-releases-statements` — **Corroborated**
  (appeared as a live result URL). Also `newsroom.kellanova.com` — **Corroborated**
- **IR:** none (private). Mars publishes limited financial communications
- **Subsidiaries / operators:** Mars Wrigley, Mars Petcare, **Royal Canin**, Mars Food &
  Nutrition, VCA (veterinary), and — since **11 Dec 2025** — **Kellanova**
- **Priority state / permit / regulatory / utility:** TX (Waco), TN, IL, KS, NJ, plus the
  inherited Kellanova footprint (notably **Jackson, TN** for Pringles and Kellanova's
  other US snack plants). State incentives and local permits are the primary early
  signals for a private company; FDA enforcement applies
- **Coverage gaps:** **Largest structural gap in the cohort after Niagara.** No periodic
  filings, and the Kellanova acquisition both enlarged the US footprint and will remove
  Kellanova's own filings from EDGAR once deregistration completes
- **Recommended pilot connectors:** Mars newsroom (A) · **Kellanova newsroom (A)** ·
  Kellanova EDGAR while it remains a filer (A, time-boxed) · state incentives TN/TX/KS
  (A) · FDA enforcement (A) · local permits in Kellanova plant counties (B)

### 7. The Hershey Company

- **Canonical company:** The Hershey Company · **Status:** Public (NYSE: HSY)
- **SEC CIK:** 0000047111 — **Verified** (accession `0000047111-25-000014`; FY2025 10-K
  filed Feb 2026 under accession `0001628280-26-008586`)
- **Useful periodic filing coverage:** 10-K, 10-Q, 8-K *(inferred)*. FY2025 10-K
  discusses commodity and **manufacturing cost pressure** and segment performance —
  directly relevant to modernization and automation opportunity theses
- **Ownership-only / incidental:** —
- **Newsroom:** `thehersheycompany.com/en_us/newsroom` — **Unverified**
- **IR:** `investors.thehersheycompany.com` — **Unverified**
- **Subsidiaries / operators:** North America Confectionery and **North America Salty
  Snacks** (Dot's Pretzels, SkinnyPop); **LesserEvil acquired Nov 2025 ($815.2M)** —
  acquisitions of this size usually precede capacity integration projects
- **Priority state / permit / regulatory / utility:** PA (HQ and core plants), VA, IL,
  ND (Dot's), TX; PA state and Dauphin/Derry Township local planning; FDA enforcement
- **Coverage gaps:** Salty-snacks integration projects may surface first at acquired-
  company sites that are not yet in the account graph under Hershey
- **Recommended pilot connectors:** EDGAR (A) · newsroom (A) · FDA enforcement (A) ·
  PA state/local incentives and planning (B) · GDELT reference-mode (A)

### 8. Kimberly-Clark Corporation

- **Canonical company:** Kimberly-Clark Corporation · **Status:** Public (Nasdaq: KMB)
- **SEC CIK:** 0000055785 — **Verified** (FY2025 10-K exhibit-21 and FY2026 10-Q
  `kmb-20260630.htm` under `/Archives/edgar/data/55785/…`)
- **Useful periodic filing coverage:** 10-K, 10-Q, 8-K. **Exhibit 21 subsidiary lists are
  directly useful for entity resolution** and appear in the verified URLs
- **Ownership-only / incidental:** —
- **Newsroom / IR:** `investor.kimberly-clark.com/news-releases` — **Corroborated**
- **Subsidiaries / operators:** Kimberly-Clark North America; **Kenvue acquisition pending, expected Q4
  2026** per Kenvue's Q2 2026 results (shareholders approved 29 Jan 2026; HSR expired
  4 Feb 2026; reported at ~$48.7bn). **Not completed — do not represent it as closed**
- **Priority state / permit / regulatory / utility:** WI, GA, AL, TX, PA, CT; EPA ECHO is
  highly relevant (tissue and nonwovens are water- and energy-intensive); **industrial
  water and wastewater is the strongest Haskell capability match for this account**
- **Coverage gaps:** **Food-safety signal families do not apply.** FDA food enforcement
  and FSIS produce no useful signal; leaving them enabled produces silence that is
  indistinguishable from a broken connector unless expected-coverage is modeled per
  account (see §11 of the design response)
- **Classification:** **Adjacent Consumer Products**
- **Recommended pilot connectors:** EDGAR (A) · newsroom (A) · EPA ECHO (A — unusually
  high value here) · state incentives WI/GA/AL (B). **Suppress food-safety families**

### 9. Unilever PLC

- **Canonical company:** Unilever PLC · **Status:** Public (LSE; NYSE ADR: UL)
- **SEC CIK:** 0000217410 — **Verified** (FY2025 Form 20-F, accession
  `0000217410-26-000007`, filed and accepted 12 Mar 2026)
- **Useful periodic filing coverage:** **20-F annually, plus 6-K** — real but low-
  frequency. A 20-F is thin on individual US plants
- **Ownership-only / incidental:** —
- **Newsroom:** `unilever.com/news/press-and-media/press-releases` — **Corroborated**
- **IR:** `unilever.com/investors` — **Corroborated**
- **Subsidiaries / operators:** Unilever United States; Ben & Jerry's, Breyers, Hellmann's,
  Knorr historically. **The Magnum Ice Cream Company (MICC) demerged 8 Dec 2025**, taking
  Magnum, Ben & Jerry's, Cornetto, and Wall's — `corporate.magnumicecream.com` is
  **Corroborated** and should be registered as a separate organization and source
- **Priority state / permit / regulatory / utility:** NJ, CT, MO, IA, VA, NC; FDA
  enforcement; local permitting
- **Coverage gaps:** Annual-only periodic cadence means EDGAR will rarely be the first
  signal. **Ice cream plant activity now belongs to MICC** — misattribution risk
  identical to the Nestlé Waters case
- **Recommended pilot connectors:** Newsroom (A) · EDGAR 20-F/6-K (B, low cadence) ·
  **MICC newsroom as a separate org (A)** · FDA enforcement (A) · state/local (B)

### 10. The Procter & Gamble Company

- **Canonical company:** The Procter & Gamble Company · **Status:** Public (NYSE: PG)
- **SEC CIK:** 0000080424 — **Verified** (accession `0000080424-25-000076`, FY2025 10-K
  for the year ended 30 Jun 2025)
- **Useful periodic filing coverage:** 10-K (June fiscal year), 10-Q, 8-K *(inferred)*
- **Ownership-only / incidental:** —
- **Newsroom / IR:** `pginvestor.com` and `us.pg.com/annualreport2025` — both
  **Corroborated**
- **Subsidiaries / operators:** Fabric & Home Care, Baby/Feminine/Family Care, Beauty,
  Grooming, Health Care — extensive US plant network
- **Priority state / permit / regulatory / utility:** OH (HQ), WV, PA, GA, LA, UT, IA,
  MO; EPA ECHO; state incentives — P&G site expansions are frequently incentive-announced
- **Coverage gaps:** **Not a food or beverage manufacturer.** Same expected-coverage
  problem as Kimberly-Clark
- **Classification:** **Adjacent Consumer Products**
- **Recommended pilot connectors:** EDGAR (A) · newsroom (A) · state incentives (A —
  historically the earliest P&G site signal) · EPA ECHO (B). **Suppress food-safety
  families**

### 11. The Sherwin-Williams Company

- **Canonical company:** The Sherwin-Williams Company · **Status:** Public (NYSE: SHW)
- **SEC CIK:** 0000089800 — **Verified** (FY2025 10-K, accession `0000089800-26-000008`,
  filed 19 Feb 2026)
- **Useful periodic filing coverage:** 10-K, 10-Q, 8-K *(inferred)*. FY2025 net sales
  $23.57B; Paint Stores, Consumer Brands, Performance Coatings groups; Suvinil acquisition
- **Ownership-only / incidental:** —
- **Newsroom / IR:** `investors.sherwin-williams.com` — **Unverified**
- **Subsidiaries / operators:** Paint Stores Group (4,853 locations), Consumer Brands,
  Performance Coatings (317 branches). Manufacturing is **paint and coatings**, plus a
  very large distribution network
- **Priority state / permit / regulatory / utility:** OH (HQ), TX, IL, CA, NC; EPA ECHO
  and air-emissions permitting are the relevant regulatory surface — **not FDA or FSIS**
- **Coverage gaps:** The entire F&B signal ontology misfires. Coatings manufacturing and
  retail distribution have their own vocabulary that the pilot taxonomy does not contain
- **Classification:** **Scope confirmation required.** Haskell has genuine adjacency here
  — process systems, automation, material handling, industrial water and wastewater, and
  large distribution facilities are all real Sherwin-Williams needs, and the account may
  be on the Highest Value list for sound commercial reasons that are simply not
  Food & Beverage reasons. **This is a question for the market leader, not a data error**
- **Recommended pilot connectors:** *Pending scope confirmation.* If in scope: EDGAR (A),
  newsroom (A), EPA ECHO (A), state incentives (B), and a decision on whether to extend
  the sector vocabulary or run the account under a `consumer_products` fallback

### 12. Ecolab Inc.

- **Canonical company:** Ecolab Inc. · **Status:** Public (NYSE: ECL)
- **SEC CIK:** 0000031462 — **Verified** (`/Archives/edgar/data/31462/…`, FY2025 10-K
  `ecl-20251231x10k.htm`)
- **Useful periodic filing coverage:** 10-K, 10-Q, 8-K — several verified directly
- **Ownership-only / incidental:** —
- **Newsroom / IR:** `ecolab.com/news`, `investor.ecolab.com` — **Unverified**
- **Subsidiaries / operators:** Global Institutional & Specialty, Industrial, Healthcare
  & Life Sciences, Pest Elimination, Nalco Water
- **Priority state / permit / regulatory / utility:** MN (HQ), TX, IL, GA; EPA ECHO
- **Coverage gaps:** Ecolab's own plant capital projects are a legitimate but small
  opportunity surface. **The larger issue is directional**: Ecolab sells water, hygiene,
  and sanitation programs *into* the same F&B plants Haskell designs. It is plausibly a
  channel partner, a co-seller, or a source of market intelligence rather than a pursuit
  target
- **Classification:** **Strategic supplier or partner**
- **Recommended pilot connectors:** EDGAR (A) · newsroom (A) · EPA ECHO (B). **Route
  Ecolab signals to account intelligence and partner context rather than the pursuit
  queue** until BD confirms otherwise (decision D12)

### 13. Danone S.A.

- **Canonical company:** Danone S.A. (formerly Groupe Danone) · **Status:** Public
  (Euronext Paris); US presence is a **sponsored Level-1 ADR on OTCQX (DANOY)**, one ADR
  representing one-fifth of a Danone share
- **SEC CIK:** 0001048515 — **Verified but historical** (20-F filings visible for FY2003
  and FY2006 at `/Archives/edgar/data/0001048515/…`). A Level-1 OTC ADR does not carry a
  periodic reporting obligation
- **Useful periodic filing coverage:** **None currently.** Historical 20-Fs only
- **Ownership-only / incidental:** WhiteWave Foods (CIK 0001555365) filed a 10-K through
  FY2016 and ceased after Danone completed the acquisition in **April 2017** — historical
  reference value for facility identification, no ongoing coverage
- **Newsroom:** `danone.com/media/press-releases` — **Corroborated**;
  `danonenorthamerica.com` — **Unverified**
- **IR:** `danone.com/investors` — **Corroborated**
- **Subsidiaries / operators:** **Danone North America** (formerly WhiteWave /
  DanoneWave) — Horizon Organic history, Silk, International Delight, Oikos, Dannon;
  Danone Waters North America (evian, Volvic import/distribution)
- **Priority state / permit / regulatory / utility:** CO (Broomfield / Danone NA), TX,
  UT, OH, PA, ID, NY; FDA food enforcement (dairy recalls); EPA ECHO (dairy processing is
  wastewater-intensive); state incentives
- **Coverage gaps:** **No periodic filing coverage.** Same silent-coverage risk profile as
  Nestlé. The WhiteWave-era filings are a useful one-time facility seed but not a feed
- **Recommended pilot connectors:** Danone North America newsroom (A) · Danone global
  newsroom (A) · FDA enforcement (A) · state incentives CO/TX/UT (B) · EPA ECHO (B) ·
  one-time WhiteWave 10-K facility extraction as a Phase 1 seeding task

### 14. Keurig Dr Pepper Inc.

- **Canonical company:** Keurig Dr Pepper Inc. · **Status:** Public (Nasdaq: KDP)
- **SEC CIK:** 0001418135 — **Verified** (`/edgar/browse/?CIK=1418135`,
  `/Archives/edgar/data/1418135/…`, including an FY2026 8-K)
- **Useful periodic filing coverage:** 10-K, 10-Q, 8-K. **Currently the richest filer in
  the cohort** because of ongoing transaction disclosure
- **Ownership-only / incidental:** —
- **Newsroom:** `news.keurigdrpepper.com` — **Corroborated** (multiple live release URLs)
- **IR:** `investors.keurigdrpepper.com` — **Unverified**; `keurigdrpepper.com` corporate
  releases — **Corroborated**
- **Subsidiaries / operators:** Dr Pepper, Snapple, Canada Dry, Core, Bai, Keurig coffee
  systems; **JDE Peet's acquisition completed 1 April 2026** — the offer was declared
  unconditional on 27 March 2026 and settled on 1 April at €31.85 per share for
  466,712,270 shares, **96.22%** of JDE Peet's, roughly €14.86bn. **A tax-free spin into
  two independent US-listed companies follows an interim operating period; no separation
  date is fixed** (operational readiness was targeted for year-end 2026, which is a
  target, not a date)
- **Priority state / permit / regulatory / utility:** TX (Frisco/Plano HQ), VT (Keurig),
  PA, MA, CA, GA; state incentives; water and wastewater permits for bottling
- **Coverage gaps:** **The account will likely become two accounts inside the pilot
  window.** Opportunities attached to KDP today may belong to a different legal entity by
  Phase 4. Separation also tends to *generate* capital projects — network splits, duplicated
  utilities, new distribution — so this is an opportunity-rich account, not just a
  modeling nuisance
- **Recommended pilot connectors:** EDGAR (A — high yield right now) · newsroom (A) ·
  state incentives TX/VT/PA (B) · FDA enforcement (B) · **plus an explicit
  organization-reorganization watch** so the split is modeled rather than discovered

### 15. Niagara Bottling, LLC

- **Canonical company:** Niagara Bottling, LLC · **Status:** **Private** (family-owned;
  founded 1963, Diamond Bar / Irvine, California)
- **SEC CIK:** none found. Searches surfaced only unrelated entities with "Niagara" in
  the name — a good illustration of why name-similarity matching is dangerous (ADR 0005)
- **Useful periodic filing coverage:** **None**
- **Ownership-only / incidental:** None found
- **Newsroom:** `niagarawater.com` news — **Unverified**
- **IR:** none (private)
- **Subsidiaries / operators:** Operates a large North American bottling network —
  reported as **more than 50 plants** across the US and Mexico. Major private-label
  bottled water supplier
- **Priority state / permit / regulatory / utility:** **The most source-dependent account
  in the cohort.** CA, TX, AZ, NV, FL, GA, IN, PA, NC and others. The decisive sources
  are: **state and local economic-development incentive awards**, **county and municipal
  planning and permitting**, and — distinctively — **water withdrawal, groundwater, and
  wastewater permits**, which are frequently the earliest public artifact of a Niagara
  site decision and are often contested locally, which makes them well covered
- **Coverage gaps:** Zero filing coverage, limited press-release cadence. If the permit
  and incentive connectors are not built, this account is effectively unmonitored
- **Recommended pilot connectors:** **State incentives (A)** · **local permits and
  planning via ArcGIS / Socrata / Legistar in priority counties (A — promote from
  Phase B for this account)** · **water and wastewater permit sources (A)** · newsroom
  (B) · GDELT reference-mode for local reporting (A) · EPA ECHO (B)
- **Why this account matters to the pilot design:** it is the cleanest test of whether the
  platform can find a project with no filings, no analyst, and no press release — which
  is the actual product thesis

---

## Aggregate connector portfolio for the pilot

Counts are of *accounts served*, not endpoints.

| Connector family | Priority | Accounts served | Notes |
| --- | --- | --- | --- |
| SEC EDGAR (11 verified CIKs + Coca-Cola Consolidated + Kellanova while filing) | A | 11 + 2 | Highest authority, lowest facility detail |
| Company and subsidiary newsrooms | A | 15 | **~25–30 endpoints**, incl. Purina, Nestlé USA, Danone NA, Kellanova, MICC, Coca-Cola Consolidated. Highest breakage rate — budget accordingly |
| State / local incentive and economic development | A | ≥9, decisive for 4 | The only early source for Mars, Nestlé, Danone, Niagara |
| Local permits and planning | A for Niagara, B otherwise | ≥6 | Highest setup cost per source |
| FDA food enforcement | A | ~9 | Not applicable to KMB, PG, SHW |
| USDA FSIS | A | 1–2 | Narrow but authoritative; Tyson-critical |
| GDELT reference-mode discovery | A | 15 | Discovery only — see ADR 0006 |
| EPA ECHO | B | ~12 | Facility identifiers; unusually valuable for KMB, Tyson, dairy |
| Water / wastewater permits | A for Niagara and beverage, B otherwise | ~5 | Distinctive early signal for bottling |
| PACK EXPO / marketing import | A (one-time) | all | Account strategy only; never raises project maturity |

**Sequencing consequence.** The first design response sequenced newsrooms and incentives
as pilot week 3. That is wrong for this cohort. **Nestlé, Mars, Danone, and Niagara have
no periodic filing coverage at all**, and Coca-Cola's filings do not reach its plants.
Newsrooms and state incentive sources must be enabled in **week 1** alongside EDGAR, or
five of fifteen accounts will show green connector health and produce nothing — the exact
failure mode the platform exists to prevent.

---

## Sources added or corrected by the external-research pass

### USDA FSIS MPI establishment directory API — **added to the pilot stack**

The v0.2 matrix carried FSIS *recalls* and missed the **establishment directory API**,
which is a different and more valuable thing: a weekly-updated registry of meat, poultry,
and egg establishments, queryable in JSON, keyed by **establishment number**.

That establishment number is a durable facility identifier that persists across recalls.
For a platform whose load-bearing problem is facility identity, a government-maintained
facility registry with a stable key is worth more than the recall feed built on top of it.

- Documentation: `fsis.usda.gov/science-data/developer-resources/mpi-api` — **Verified**
- Directory: `fsis.usda.gov/inspection/establishments/meat-poultry-and-egg-product-inspection-directory`
- Priority: **A**, Tyson-critical, also relevant to any protein or prepared-foods account
- Open questions (V8): schema, rate limits, and the quality of the
  establishment-to-organization join

### EPA ECHO / FRS — **promoted from B to A**, for identity rather than signal

Promoted not for enforcement content, which lags, but because the **Facility Registry
Service ID is a stable cross-program facility key**. Together with FSIS establishment
numbers it gives two independent government-maintained identifiers to resolve facilities
against — which is exactly what the entity-resolution ladder in ADR 0005 needs at its
deterministic top end.

### FDA Food Facility Registration — **permanently unavailable, recorded so it is not re-attempted**

The FDA's list of registered food facilities and the registration documents themselves are
**not subject to disclosure under FOIA**, and neither is derived information that would
identify a registered person — **21 U.S.C. 350d(a)(5)**. There is no lawful connector to
build here.

This is recorded deliberately. A food-facility registry is such an obvious thing to want
that, without a written record of why it does not exist, an implementer will rediscover the
same dead end. openFDA food enforcement remains useful for recalls and is **not** a
facility registry.

### Commercial project and permit vendors — evaluation track, not a purchase

The external research assessed five vendors. Three of its conclusions were wrong and are
corrected here; all five remain **unverified on the question that actually decides
suitability**, which is F&B coverage depth.

| Vendor | External research said | Corrected finding | Status |
| --- | --- | --- | --- |
| **BuildCentral / Hubexo** | No genuine machine-callable API | **Wrong.** A published API datasheet exists (`constructionwire.com/Content/pdf/buildcentral_api.pdf`) | API exists. **But ConstructionWire's advertised verticals are retail/CRE, hotels, multi-family and single-family residential, medical, and energy & mining — food and beverage is not among them.** Coverage is now the open question, not access |
| **ConstructConnect** | No credible official API documentation | **Wrong.** An official developer portal exists (`developer.io.constructconnect.com/overview`), REST with `x-api-key` | Access appears gated to subscribers. The unofficial third-party scraper wrapper remains **rejected** on ToS grounds — that part was right |
| **Industrial Info Resources** | Vendor marketing claims only | **Partly wrong.** A real API exists: REST, OpenAPI 3.0, JWT (`api.industrialinfo.com/idb/`) | Official documentation reports **v2.7, released 28 July 2026** — externally observed, **not reproduced in-session** (the portal is blocked by this environment's egress proxy). The portal presents an **energy-oriented** database; F&B depth is a demo question |
| **Dodge Construction Network** | Vendor marketing claims only | Unchanged | Quote-only; F&B depth unverified |
| **Shovels.ai** | Corroborated; best build-vs-buy alternative | Unchanged | Free tier exists (250 requests); jurisdictional overlap with pilot geographies unverified |

**Recommendation (D21).** Run a bounded vendor track in parallel with two or three
API-exposed jurisdictions, and decide on evidence. Building dozens of municipal connectors
before knowing whether one vendor covers the same ground is the expensive mistake; buying
a subscription before knowing whether it contains any F&B projects is the other one.

---

## Staged facility geographies from the recovered accounts 6–10 records

The recovered `pilot_accounts_6_10_graph_records.jsonl` contributes 11 facility records and
3 capital-project records for accounts 6–10. **These are staged research claims, not
verified coverage findings** — none has passed the activation gate — but several name
states that this matrix's priority-geography lists did not, and D5 (priority permitting and
incentive geographies) should be decided with them visible.

| Account | Staged facility locations | Already in the matrix's priority list? |
| --- | --- | --- |
| Mars | Hackettstown NJ ($70M, 2024); Salt Lake City UT (Nature's Bakery, $240M); Topeka KS; Lewisburg OH (Royal Canin) | NJ, KS yes · **UT, OH new** |
| Hershey | Hershey PA — Reese Chocolate Processing (250,000 sq ft, opened 2025) and West Hershey | PA yes |
| Kimberly-Clark | Warren OH (advanced manufacturing, planned/under construction); Beech Island SC (automated distribution centre planned at an operating plant) | **OH, SC both new** |
| Unilever | Kilbourn IL (Knorr/Hellmann's); Sikeston MO (ice cream — **operator unresolved post-demerger**); New Haven CT (R&D, planned) | MO, CT yes · **IL new** |
| Procter & Gamble | **None.** The file carries a company-level claim — "24 manufacturing plants in 18 states" — and no site roster | — |

Five states appear that no priority list contained: **UT and OH for Mars, OH and SC for
Kimberly-Clark, IL for Unilever.** Two of them are Kimberly-Clark sites, which matters
because that account's strongest Haskell match is industrial water and wastewater, and both
records describe capital activity — a facility under construction and a planned automated
distribution centre.

The P&G row is the informative negative. The strongest external-research signal for that
account is a count with no sites attached, which is precisely why `network_assertion`
exists as a staged claim type: "24 plants in 18 states" is true, useful for expected-coverage
modelling, and must not be allowed to invent 24 facility records.

---

## Open verification tasks for Phase 1

None of the following blocks design approval; all block connector enablement.

1. Re-confirm all 15 CIKs directly against EDGAR from an environment with `sec.gov`
   access, and pull an actual form-type inventory per CIK rather than the inferred
   classifications used here.
2. Confirm the Nestlé S.A. CIK (792990) or establish that no usable EDGAR presence
   exists.
3. Dry-run every newsroom and IR endpoint marked **Unverified**; capture whether each
   offers RSS/Atom, JSON Feed, sitemap, or structured HTML, and record the answer in the
   source registry.
4. Confirm Kellanova's deregistration timing so the EDGAR connector for CIK 0000055067
   is retired rather than left to fail.
5. Identify the specific state and county portals for the priority geographies, and
   confirm each exposes an API (ArcGIS / Socrata / Legistar) rather than requiring a
   browser worker.
6. Confirm Niagara Bottling's current plant-state list from a public source so permit and
   incentive connectors are pointed at the right jurisdictions.

## Sources

- [PepsiCo FY2025 10-K (CIK 77476)](https://www.sec.gov/Archives/edgar/data/77476/000007747626000007/pep-20251227.htm)
- [The Coca-Cola Company FY2023 10-K (CIK 21344)](https://www.sec.gov/Archives/edgar/data/21344/000002134424000009/ko-20231231.htm)
- [Coca-Cola Consolidated FY2025 10-K (CIK 317540)](https://www.sec.gov/Archives/edgar/data/317540/000162828026009057/coke-20251231.htm)
- [Kroger FY2021 10-K (CIK 56873)](https://www.sec.gov/Archives/edgar/data/56873/000155837021003706/kr-20210130x10k.htm)
- [Tyson Foods EDGAR entity page (CIK 100493)](https://www.sec.gov/edgar/browse/?CIK=0000100493)
- [Hershey FY2024 10-K accession 0000047111-25-000014](https://last10k.com/sec-filings/hsy/0000047111-25-000014.htm)
- [Kimberly-Clark FY2025 10-K exhibit (CIK 55785)](https://www.sec.gov/Archives/edgar/data/55785/000162828026007567/kmb10k2025exhibit21.htm)
- [Kimberly-Clark FY2026 Q2 10-Q (CIK 55785)](https://www.sec.gov/Archives/edgar/data/0000055785/000162828026052348/kmb-20260630.htm)
- [Unilever PLC FY2025 20-F (CIK 217410)](https://www.sec.gov/Archives/edgar/data/217410/000021741026000007/ul-20251231.htm)
- [Unilever: Filing of Annual Report on Form 20-F](https://www.unilever.com/news/press-and-media/press-releases/2026/filing-of-annual-report-on-form-20f-2026/)
- [Procter & Gamble FY2025 10-K accession 0000080424-25-000076](https://last10k.com/sec-filings/pg/0000080424-25-000076.htm)
- [Sherwin-Williams FY2025 10-K accession 0000089800-26-000008](https://companiesmarketcap.com/sherwin-williams/sec-reports-10k/0000089800-26-000008/)
- [Ecolab FY2025 10-K (CIK 31462)](https://www.sec.gov/Archives/edgar/data/31462/000110465926018357/ecl-20251231x10k.htm)
- [Groupe Danone FY2006 20-F (CIK 1048515)](https://www.sec.gov/Archives/edgar/data/0001048515/000119312507071783/dex131.htm)
- [Danone stock and ADR information](https://www.danone.com/investors/understanding-danone/danone-stock.html)
- [WhiteWave Foods FY2016 10-K (CIK 1555365)](https://www.sec.gov/Archives/edgar/data/1555365/000155536517000007/wwav-20161231x10k.htm)
- [Keurig Dr Pepper EDGAR entity page (CIK 1418135)](https://www.sec.gov/edgar/browse/?CIK=1418135&owner=exclude)
- [KDP to acquire JDE Peet's and separate into two companies](https://news.keurigdrpepper.com/2025-08-25-Keurig-Dr-Pepper-to-Acquire-JDE-Peets-and-Subsequently-Separate-into-Two-Independent-Companies-a-Leading-Refreshment-Beverage-Player-and-a-Global-Coffee-Champion)
- [KDP acquires JDE Peet's and names Global Coffee Co. CEO](https://www.keurigdrpepper.com/keurig-dr-pepper-acquires-jde-peets-and-announces-rafael-oliveira-as-ceo-of-future-global-coffee-co/)
- [Mars completes acquisition of Kellanova](https://www.mars.com/news-and-stories/press-releases-statements/mars-completes-acquisition-of-kellanova)
- [Mars receives final regulatory approval for Kellanova](https://newsroom.kellanova.com/2025-12-8-MARS-RECEIVES-FINAL-REGULATORY-APPROVAL-AND-MOVES-TO-CLOSE-ACQUISITION-OF-KELLANOVA)
- [Kellanova SC 13D (CIK 55067)](https://www.sec.gov/Archives/edgar/data/55067/000134100424000139/sc13d.htm)
- [Primo Brands Form 8-K12G3 (CIK 2042694)](https://www.sec.gov/Archives/edgar/data/2042694/000119312524254259/d805110dex991.htm)
- [Primo Water and BlueTriton agree to merge](https://ir.primobrands.com/press-releases/news-details/2024/Primo-Water-and-BlueTriton-Agree-to-Merge-Creating-a-Leading-North-American-Pure-Play-Healthy-Hydration-Company/default.aspx)
- [BlueTriton (formerly Nestlé Waters) to merge with Primo](https://www.foodprocessing.com/business-of-food-beverage/news/55089743/bluetriton-formerly-nestle-waters-to-merge-with-primo-office-waters)
- [Kimberly-Clark and Kenvue shareholders approve acquisition](https://www.investor.kimberly-clark.com/news-releases/news-release-details/kimberly-clark-and-kenvue-shareholders-overwhelmingly-approve)
- [The Magnum Ice Cream Company demerger information](https://corporate.magnumicecream.com/en/investors/demerger-information.html)
- [Magnum Ice Cream Company demerger complete](https://www.foodnavigator.com/Article/2025/12/08/magnum-ice-cream-company-unilever-demerger-complete-a-history/)
- [Niagara Bottling company profile](https://en.wikipedia.org/wiki/Niagara_Bottling)
