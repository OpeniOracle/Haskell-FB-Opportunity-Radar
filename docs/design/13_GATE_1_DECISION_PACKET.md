# Gate 1 Decision Packet

Haskell Food & Beverage Opportunity Radar · Version 0.4 · **For stakeholder decision**

**Decision state as recorded.** Eight decisions are approved in full — D15, D18, D21, D22,
D23, D24, **D1**, and the **D9 framework**. Two are approved in part: **D2a** (architecture)
with **D2b** (vendor selections) open, and the **D14 handling model** with the licence and
import permission externally blocked. **D11 is approved provisionally**, pending F&B
market-leader confirmation. **Thirteen remain open** — D3, D4, D5, D6, D7, D8, D10, D12,
D13, D16, D17, D19, D20 — and **D2b** is a fourteenth open row as a sub-item of D2.

Approved decisions keep their full entry below so the reasoning stays on the record; each
carries its status at its heading.

Companion to `10_DESIGN_RESPONSE.md` §10 and `12_PILOT_SOURCE_COVERAGE_MATRIX.md`.

---

## How to use this packet

Twenty-four decisions are tracked — twenty from the v0.2 design reconciliation and four
added by the v0.3 external-research reconciliation (D21–D24). **Eight are approved, two
are approved in part, one is provisional, and thirteen remain open**, with D2b a
fourteenth open row as a sub-item of D2. Each is presented with a **recommended default**, the
**alternatives** actually considered, the **operational consequence** of choosing it, the
**cost and complexity impact**, a proposed **decision owner**, and the **required
timing**.

Four things are worth saying plainly before the list:

1. **Silence is a decision.** Each recommended default is what will be built if no other
   direction is given. Nothing here blocks on a meeting; the packet exists so that
   defaults are chosen deliberately rather than by drift.
2. **The two urgent decisions are settled.** D15 (temporal model) and D18 (time-bounded
   ownership) were the corpus-wide retrofits, and both are **Approved**. Phase 1 can now
   begin without a dating or ownership retrofit hanging over it. Everything still open can
   be reversed at moderate cost.
3. **Nothing has been implemented.** No migration has been applied, no connector built,
   no code written. The schema delta in `11_SCHEMA_DELTA_PROPOSAL.sql` is a proposal.
4. **Three approvals are partial, and the boundary matters.** D2a is approved while the
   four vendor selections behind it are not. The D9 framework is approved while its numeric
   targets are deliberately deferred to a week-4 checkpoint. The D14 handling model is
   approved while the licence review and permission to import are not. Reading any of
   these as a full approval would authorize work that has not been authorized.

**Cost scale.** S = under a week of one engineer · M = one to three weeks · L = more than
three weeks or a recurring commercial cost.

---

## Decision index

| ID | Decision | Status | Owner | Required by | Cost | Gate |
| --- | --- | --- | --- | --- | --- | --- |
| **D15** | Temporal model | **Approved** | Platform engineering lead | **Before the first signal is written** | M | G-4 |
| **D18** | Corporate-reorganization handling | **Approved** | Platform engineering lead | **Before the first facility link is written** | M | G-4 |
| **D1** | Hub-embedded or separate application | **Approved** | Executive sponsor + engineering | Before Phase 1 start | L if reversed late | G-4 |
| **D2a** | Platform architecture | **Approved** | Executive sponsor on engineering's recommendation | Before Phase 1 start | S | G-4 |
| **D2b** | Vendor selections (AI provider, identity provider, PostgreSQL hosting, object storage) | **Open — IT selection required** | IT | Each blocks the capability that depends on it | S to select, L to change | G-4 |
| **D9** | Pilot acceptance framework | **Approved** | Executive sponsor + market leader | Before Phase 1 start | S | G-1 |
| **D9-T** | Numeric acceptance targets | **Deferred to the week-4 checkpoint** | Executive sponsor + market leader | Week 4 of the measurement window | S | G-1 |
| **D11** | Scope class for four non-core accounts | **Approved provisionally** | F&B market leader | Confirmation before pilot metrics are finalized | S | G-1 |
| D12 | Ecolab account semantics | Open | BD lead | Before Phase 2 scoring | S | G-1 |
| D13 | Bottler and subsidiary networks | Open | Market leader + engineering | Before connector enablement | M | G-3 |
| **D14** | Event-data handling model | **Approved** | Legal / commercial + marketing ops | Before Phase 1 import | S | G-3 |
| **D14-L** | Event-data licence review and import permission | **Blocked — external review** | Legal / commercial contracts | Before any PACK EXPO import | S (review), M if restrictive | G-3 |
| D17 | Coverage measurement model | Open | Market leader + engineering | Before Phase 2 exit review | M | G-3 |
| D19 | Evidence access modes and promotion | Open | Market leader + BD | Before Phase 2 scoring | M | G-2 |
| D16 | Confidence decomposition | Open | Market leader + SMEs | Before Phase 3 UI build | S now, L later | G-2 |
| D5 | Priority permitting geographies | Open | Market leader + BD | Before week 2 of Phase 2 | M | G-3 |
| D6 | Paid news / market-data subscriptions | Open | Executive sponsor | Before Phase 2 | L (recurring) | G-3 |
| D7 | Licensed-content retention and display | Open | Legal / commercial | Before source enablement | S | G-3 |
| D20 | Kellanova connector retirement | Open | Platform admin | Before Phase 4 | S | G-3 |
| D8 | Ownership of tier changes and overrides | Open | Market leader | Before Phase 3 | S | G-2 |
| D4 | Alert channels | Open | BD lead + IT | Before Phase 3 | S | G-5 |
| D10 | Design system and brand assets | Open | Design lead | Before Phase 3 | S | G-5 |
| D3 | CRM linkage | Open | BD lead + IT | Phase 4 | M | G-1 (informational) |
| **D21** | Build or buy local permit coverage | **Approved** | Market leader + engineering | Before week 3 of Phase 2 | M–L | G-3 |
| **D22** | Incident severity model | **Approved** | Engineering + executive sponsor | Before Phase 2 | S | G-6 |
| **D23** | Research-claim staging | **Approved** | Platform engineering lead | Before any external batch is imported | M | G-4 |
| **D24** | Corrections model | **Approved** | Market leader + engineering | Before Phase 2 scoring | M | G-2 |

---

## The two urgent decisions

### D15 — Temporal model

> **Status: Approved.** The entry below is retained as the decision record.

**Recommended default.** Store six fields wherever a date can come from source text —
raw expression, start, end, precision (`exact_day` / `month` / `quarter` / `season` /
`half_year` / `year` / `range` / `relative` / `unknown`), basis (`stated` / `inferred`), and an
inference note required when basis is `inferred`. "Production begins in 2027" is stored
as the interval 2027-01-01 → 2027-12-31 at `year` precision with basis `stated`, and is
rendered as "expected 2027."

**Alternatives.**
- *Keep a single `date` column.* Cheapest, and it violates a stated non-negotiable: the
  only ways to store "in 2027" are to invent January 1 or to discard the signal.
- *Store the raw string alongside a parsed date.* Preserves evidence, but every consumer
  re-parses, and scoring still reads the fabricated day.
- *A numeric date-confidence score.* A number cannot tell the interface how to render,
  and cannot be inverted back into "H2 2027."

**Operational consequence.** Forward-looking timing is the earliest and most valuable
signal in capital projects, and it is almost always imprecise. With the default, those
signals are capturable and queryable; the interface can distinguish a stated date from
one we inferred; and timing scores stop being falsely precise. Without it, the platform
either fabricates dates or is blind to early-stage projects.

**Cost and complexity.** M. Six columns instead of one, plus interval-aware queries and
render logic. The real cost is discipline: every date comparison must consider precision.

**Validated against a real case.** An external research record stored Unilever's
"expected to be fully operational by **spring 2029**" as `2029-03-31` — a fabricated month
and day. Storing it correctly required adding `season` to the precision enum, which the
v0.2 design had missed. The external record was wrong and improved the schema anyway.

**Owner.** Platform engineering lead, ratified at G-4.

**Timing. Before the first signal is written.** Retrofitting means reprocessing the
entire evidence corpus and re-running every classification.

### D18 — Corporate-reorganization handling

> **Status: Approved.** The entry below is retained as the decision record.

**Recommended default.** Ownership relationships — facility-to-organization and
organization-to-organization — carry `from_date`, `to_date`, and `evidence_id`. Projects
are attributed to the operator **as at the event date**, not as at query time. Add an
explicit reorganization watch for KDP's planned separation and the pending
Kimberly-Clark / Kenvue close.

**Alternatives.**
- *Single current-owner pointer (today's schema).* Simple, and wrong within months.
- *Snapshot the whole graph periodically.* Storage-heavy, and still cannot answer "who
  operated this plant when the permit was filed."
- *Handle reorganizations manually as they occur.* Contradicts the no-analyst
  requirement, and assumes someone notices.

**Operational consequence.** Verification found **four completed reorganizations across
the fifteen pilot accounts in roughly twenty months, with two more in flight**: Mars
acquired Kellanova (Dec 2025); Nestlé Waters North America became BlueTriton and then
Primo Brands (Nov 2024); Unilever demerged its ice cream business as The Magnum Ice
Cream Company (Dec 2025); KDP acquired JDE Peet's and plans to split in two;
Kimberly-Clark's Kenvue acquisition is pending. Under the default, a 2023 Poland Spring
project stays correctly attributed to Nestlé Waters and a 2026 one to Primo Brands.
Without it, every one of these silently corrupts an account timeline — against Highest
Value accounts, which are the ones people will check.

**Cost and complexity.** M. Two join tables with date bounds, and resolution logic that
takes an as-at date.

**Owner.** Platform engineering lead, ratified at G-4.

**Timing. Before the first facility-to-organization link is written.**

---

## Gate 1 decisions — mission, cohort, and scope

### D9 — Pilot acceptance framework

> **Status: Approved (framework).** The definitions, denominators, measurement window, and
> responsibilities below are approved. **Numeric acceptance targets are deferred to the
> week-4 target-setting checkpoint (D9-T).**

**Why targets are deferred rather than set.** There is no historical conversion data from
the current ChatGPT-and-spreadsheet process. Any number chosen today would be either
trivially met or arbitrarily missed, and neither outcome tells anyone whether the platform
works.

#### Approved definitions

**Qualified business-development conversation** — the primary outcome. All five conditions
must hold:

1. A two-way exchange with a **named individual** at the target account, or at its named
   operator, bottler, or subsidiary.
2. Initiated **within 30 days** of the opportunity being surfaced by the platform.
3. The **specific development the Radar surfaced** is discussed — not a general
   relationship check-in.
4. The BD owner records the outcome in the platform as **advancing to a scoped follow-up**
   or **closed with a reason**.
5. Attribution recorded honestly: conversations Haskell would have had regardless are
   marked **"would have found independently"** and excluded from the numerator.

Excluded: outbound with no reply, conference small talk, internal discussions, and any
conversation not linked to a specific opportunity record.

**Daily review time under ten minutes** — as a statistic:

> **Median active session duration per user per day**, measured from first to last
> interaction on the Pulse and Opportunities surfaces, with idle gaps over two minutes
> excluded, computed only across days on which the user opened the product.

Targets **median ≤ 10 minutes** and **90th percentile ≤ 20 minutes**, reported alongside an
adoption denominator — **days opened ÷ working days per user** — because a fast median
across two sessions a month is not success.

#### Approved denominators

| Metric | Denominator | Numerator |
| --- | --- | --- |
| Relevance / dismissal rate | Opportunities **presented** to a user in the window, counted once per opportunity per user | Those dismissed with a reason code |
| Action rate | The same presented set | Distinct opportunities receiving Pursue, Watch, or Assign |
| Conversion to qualified conversation | Opportunities marked **Pursue** | Those meeting all five conditions within 30 days |

With three to five pilot users, all three are reported **both pooled and per user** — a
pooled rate can hide one enthusiastic user carrying the result.

#### Measurement window

- **12 weeks** from first production-like daily use. The roadmap's 4–6 week Phase 2
  estimate is build time, not measurement time.
- **Weeks 1–4: a measured baseline period that is not evaluated against acceptance
  targets.** **Every approved D9 metric is collected during this period** — conversations,
  action rate, dismissal rate, session duration, adoption, coverage completeness. The
  period is unevaluated, not unmeasured; its entire purpose is to produce the data the
  targets will be set from. In parallel, BD reconstructs the current manual process's
  output over a comparable prior period, which is the most valuable comparison the pilot
  can produce and does not exist today.
- **Week 4: target-setting checkpoint (D9-T).** Sponsor and market leader set week 5–12
  targets from observed baseline plus a stated improvement, recorded in writing.
- **Weeks 5–12: measured against those targets.**

#### Leading indicators vs. primary outcome

| Class | Measure | Role |
| --- | --- | --- |
| **Primary outcome** | Qualified conversations originated by the Radar | The pilot's success measure |
| **Leading** | Action rate; median review time; adoption rate; dismissal-rate trend; expected-coverage completeness | Predict the primary outcome; move first |
| **Guardrail** | Evidence-link availability (100%, invariant); duplicate alert rate | Must hold regardless of outcome |
| **Lagging, beyond the pilot** | Won work attributable to the platform | The honest measure; capital-project cycles outrun the pilot |
| **Explicitly not counted** | Number of opportunities generated | Rewards noise |

#### Responsibility for recording outcomes

The **assigned BD owner** records every outcome **in the platform** — status plus reason
code — not in a spreadsheet. The **F&B market leader** reviews completeness weekly and is
accountable for the data existing. This is a process commitment, not engineering work, and
unrecorded outcomes make the pilot unevaluable.

**Cost and complexity.** S in engineering; the recording commitment is the real cost.
**Owner.** Executive sponsor with the F&B market leader; BD lead for recording.
**Timing.** Framework before Phase 1; targets at the week-4 checkpoint.

### D11 — Scope class for the four non-core accounts

> **Status: Approved provisionally.** **All four classifications below are provisional
> market classifications**, pending confirmation by the F&B market leader. They are not
> permanently approved, and Kimberly-Clark, Procter & Gamble, and Ecolab are **not**
> settled as a side effect of the Sherwin-Williams decision — each is its own commercial
> judgement. Confirmation is due **before pilot metrics are finalized at the week-4
> checkpoint**, because these classifications change the relevance denominator.

**Recommended default.**

| Account | Provisional class | Effect while provisional | Confirmation owner |
| --- | --- | --- | --- |
| Kimberly-Clark | `fnb_adjacent` *(provisional)* | Full facility/process/packaging/automation/utilities ontology; food-safety families suppressed | F&B market leader |
| Procter & Gamble | `fnb_adjacent` *(provisional)* | Same | F&B market leader |
| Ecolab | `fnb_adjacent`, supplier routing *(provisional)* | See D12, which remains open in its own right | F&B market leader, with BD lead |
| **Sherwin-Williams** | **`non_fnb`** *(provisional)* | Out of Food & Beverage scope; excluded from the pursuit queue and from F&B relevance metrics — **and the commercial question stands** | F&B market leader |

The four-value vocabulary — `fnb_core`, `fnb_adjacent`, `non_fnb`, `unknown` — comes from
the external research and replaces v0.2's longer prose labels. `unknown` is a transient
state, not a resting place.

**Alternatives.** *Treat all four as core F&B* — food-safety connectors fire never,
which is indistinguishable from a broken connector without D17. *Remove them from the
pilot* — discards accounts the business deliberately prioritized. *Build a separate
coatings/consumer-products ontology now* — real work, premature before the pilot proves
the core.

**Operational consequence.** Sherwin-Williams is the live question, and v0.3 changes the
recommended default rather than settling it. On the evidence, `non_fnb` is right: coatings
manufacturing and a paint-store distribution network share no vocabulary with the F&B
signal ontology, and FDA and FSIS produce nothing for the account. The external research
reached the same conclusion independently.

What does not change is that Haskell adjacency is real — process systems, automation,
material handling, industrial water and wastewater, and large distribution facilities are
all genuine Sherwin-Williams needs. **This is a question about commercial intent, not a
data-quality defect**, and the market leader is the only person who can answer it. If the
account is confirmed in scope, a coatings vocabulary is required, and that is real work.

**Cost and complexity.** S for classification. M if Sherwin-Williams is confirmed in
scope *and* a coatings vocabulary is required.

**Owner.** F&B market leader. **Timing.** Before Phase 1 import, so accounts are
classified as they are created.

### D12 — Ecolab account semantics

**Recommended default.** Classify as *Strategic supplier or partner*. Ecolab's own plant
projects remain eligible opportunities; signals about Ecolab's **customers'** plants route
to account intelligence and partner context rather than the pursuit queue.

**Alternatives.** *Treat as a normal pursuit target* — generates confident, wrong
recommendations against a Highest Value account. *Remove from monitoring* — discards
genuine market intelligence, since Ecolab sells into exactly the plants Haskell designs.

**Operational consequence.** Determines whether the BD team sees Ecolab as a prospect or
as a lens on the market. Getting this wrong is more damaging than it looks: a
plausible-sounding but commercially confused recommendation erodes trust in the whole
queue.

**Cost and complexity.** S. **Owner.** BD lead. **Timing.** Before Phase 2 scoring.

### D3 — CRM linkage

**Recommended default.** Link-out only in the MVP: store a CRM identifier on the
opportunity and deep-link. No write-back, no sync.

**Alternatives.** *Two-way sync* — the largest single integration in the roadmap, and it
makes the Radar a system of record it was explicitly not meant to be. *No linkage* —
forces manual re-keying, which contradicts the automation-first principle at the one
point where a human is already acting.

**Operational consequence.** Link-out gets the workflow benefit at a fraction of the
cost and keeps `01`'s "not a CRM replacement" boundary intact.

**Cost and complexity.** M for link-out; L for sync. **Owner.** BD lead with IT.
**Timing.** Phase 4. Listed at G-1 for awareness only.

---

## Source, licensing, and coverage decisions

### D13 — Bottler, subsidiary, and co-manufacturer networks

**Recommended default.** Load the operating entities as first-class organizations with
typed, time-bounded relationships to the brand account: **Coca-Cola Consolidated
(CIK 0000317540)**, Nestlé USA, Nestlé Purina PetCare, Danone North America, Kellanova,
and The Magnum Ice Cream Company. Attribute projects to the operating entity; surface them
under the brand account.

**Alternatives.** *Treat operators as aliases of the parent* — collapses distinct legal
entities and produces exactly the bad merges ADR 0005 exists to prevent. *Monitor only
the named 15* — verified to miss most Coca-Cola plant activity, since KO files as a brand
owner and concentrate producer while the plants sit with independent bottlers.

**Operational consequence.** Coca-Cola Consolidated alone is the largest US Coca-Cola
bottler, operating across fourteen states and DC, and files its own 10-K. Without this
decision, the Coca-Cola account produces brand news and almost no capital projects.

**Cost and complexity.** M — roughly 8–12 additional organizations and their newsroom
connectors.

**Owner.** Market leader (which entities matter commercially) with engineering (how they
are modeled). **Timing.** Before connector enablement in Phase 2.

### D14 — Event-data licence and governance

> **Status: Handling model approved. Licence review and permission to import remain
> blocked pending Legal/Commercial Contracts.** Approving the handling model is **not**
> approval of the underlying licence and is **not** permission to import. The licence
> review is **not** marked complete.

**Recommended default.** Govern the PACK EXPO workbooks as **confidential third-party
business data**: access-controlled, licence-bounded, retention-bounded, not
redistributable, and never included in any briefing that can leave Haskell. Review the
event lead-retrieval agreement for retention, resale, and use restrictions before Phase 1
import. Hold the personal-data control set specified in `10_DESIGN_RESPONSE.md` §6.5
**dormant** until contact-level data actually arrives.

**What the inspection found, stated to its actual scope.** The first design response
described this data as "519 rows of personal data." That was wrong, and a later flat
assertion that it *is not* personal data was also overstated. The accurate statement:

> **Based on inspection of the two workbooks supplied, neither contains populated
> individual contact fields.** The "Pack Expo 2025 Email List" sheet holds a Company column
> only — 519 populated rows, 183 unique company strings — and the XPressLeads export's
> person-oriented columns (`UserAccount`, `DeviceLabel`) are empty.

That is a finding about **these two files as inspected**. It is not a determination about
the dataset as a whole, about other exports from the same event, or about what a future
export may contain, and it does not substitute for Legal's own conclusion. On the evidence
inspected the obligation is contractual and confidentiality-based rather than a privacy
matter, and it should not be raised internally as a privacy incident — but **the
personal-data controls remain specified and dormant**, activating automatically before the
first row is stored if any future export carries contact-level information.

**Alternatives.** *Treat as ordinary internal data* — ignores the event organizer's
contractual terms and the strategic sensitivity of Haskell's own targeting list.
*Apply full personal-data controls now* — cost and process burden with no subject to
protect; also dulls the response if real personal data arrives later.

**Operational consequence.** The licence review is the gating item. If the agreement
restricts retention or derived use, the engagement layer's design changes — which is
cheap to accommodate before import and expensive afterwards.

**Cost and complexity.** S for the review; M if terms prove restrictive.

**Owner.** Legal or commercial contracts, with marketing operations. **Timing.** Before
the PACK EXPO data is imported or used.

**Scope of the block.** D14 gates **activation and use of the event data in Phase 1** —
the import, the engagement layer, and anything derived from it. It does not gate Phase 1
generally, and it does not gate review, approval, or merge of the design-only pull request
carrying this packet. Design review and the licence review can run in parallel.

**Conditional trigger.** If contact names, email addresses, phone numbers, badge-holder
or scan records, individual job titles, or person-level campaign engagement are ever
ingested, the dormant control set activates *before* the first such row is stored:
restricted storage classification, encryption at rest, recorded lawful basis and
retention expiry with fail-closed ingestion, no exposure through any Radar surface or
model prompt, and deletion and subject-access paths in place beforehand.

### D17 — Coverage measurement model

**Recommended default.** Adopt `account_source_expectations` — a declared, per-account
statement of which source families should produce signal — and report **operational
health** and **intelligence coverage** as two independent metric families with
independent thresholds at every gate. Phase 2 exit requires both.

**Alternatives.** *Keep the single acceptance-metric block from `05`* — allows a 95%
connector-success rate to be read as market coverage. *Measure coverage only
qualitatively* — unfalsifiable, and it degrades under delivery pressure.

**Operational consequence.** This is the decision that prevents the pilot's most likely
silent failure. For Nestlé, Mars, Danone, and Niagara Bottling — the four accounts with
no periodic SEC coverage — every enabled connector can be green while the account is
effectively unmonitored, because the sources that would carry their signals were never
built. An expectation model makes that state **visible and reportable as "uncovered"**
rather than as "quiet." It also fixes the inverse: FDA enforcement is declared *not
expected* for Adjacent Consumer Products accounts, so its silence is correct and the
account is not penalized for a source that was never going to fire.

**Cost and complexity.** M. One reference table seeded from the coverage matrix, plus
metric computation and two dashboard panels.

**Owner.** Market leader (what coverage *should* exist) with engineering (measurement).
**Timing.** Before the Phase 2 exit review; ideally before Phase 2 begins, so the baseline
is captured.

### D19 — Evidence access modes and promotion rules

**Recommended default.** Five access modes — structured primary, archived full text,
licensed full text, reference-only, metadata-only. Reference-only and metadata-only
evidence cannot exceed `indicative` evidence strength regardless of volume, and an
opportunity cannot reach the **Confirmed** stage without at least one supporting signal
that is `authoritative` + `observed_fact`. Enforced in the schema and at the egress
gateway, not by convention.

**Alternatives.** *Fetch and store every discovered article* — violates the destination
allowlist and creates copyright and retention exposure. *Drop broad news discovery* —
loses the regional and trade reporting where four pilot accounts are visible at all.
*Allow reference-only evidence to corroborate* — cheap confidence, and the fastest route
to a false Confirmed in front of a client.

**Operational consequence.** Sets how quickly the platform is permitted to become
confident, and therefore its false-positive rate. Under the default, GDELT makes us aware
of a project within hours and can raise an Emerging lead; promotion waits for the company,
the regulator, or the permit office. Some genuinely real projects will sit at lower
confidence than a human reader would assign — the correct direction to be wrong in, and
D6 is the remedy if it proves too conservative.

**Cost and complexity.** M. **Owner.** Market leader with BD (they carry the
consequence of both false positives and slow confidence). **Timing.** Before Phase 2
scoring.

### D5 — Priority permitting and incentive geographies

**Recommended default.** Southeast (GA, TN, NC, SC, AL, FL), Texas, Midwest (OH, IN, IA,
WI), plus **AZ and NV for Niagara Bottling**. Confirm against Haskell's own delivery
geography before building.

**Alternatives.** *National coverage* — out of scope per `01`. *Follow only Haskell's
existing delivery footprint* — reasonable, and may miss where target accounts are actually
expanding. *Defer until Phase 4* — leaves Niagara Bottling, which has no filings and
limited press cadence, effectively unmonitored for the whole pilot.

**Operational consequence.** Permit and incentive connectors are the highest per-source
setup cost in the plan and the earliest signal available. Choosing the wrong three states
wastes the most expensive connector work in Phase 2.

**Cost and complexity.** M per state, and it does not amortize — each jurisdiction is its
own format.

**Owner.** Market leader with BD. **Timing.** Before week 2 of Phase 2.

### D6 — Paid news and market-data subscriptions

**Recommended default.** Assume none for the pilot. Operate GDELT in reference mode and
measure how often a project stalls at `indicative` for want of full text. Revisit with
evidence.

**Alternatives.** *Buy a licensed business-news feed now* — removes the reference-mode
ceiling for a recurring cost, before we know the size of the gap. *Approve individual
trade publications for full-text archiving* — a middle path, and the one most likely to
be right; each promotion is a reviewed source-registry change.

**Operational consequence.** Determines whether trade-press reporting can ever support
authoritative evidence. The pilot is designed to produce the number that makes this
decision answerable.

**Cost and complexity.** L, recurring. **Owner.** Executive sponsor. **Timing.** Before
Phase 2 if a subscription already exists; otherwise revisit at Phase 4.

### D7 — Licensed-content retention and display rights

**Recommended default.** Per-source `license_mode` and `retention_days`; default to
reference-only when licensing is unknown; enforce retention in the `maintain` queue.

**Alternatives.** *Retain everything indefinitely* — a compliance exposure that grows
silently. *Manual review per source without schema enforcement* — depends on memory.

**Operational consequence.** Fail-closed defaults mean an unreviewed source degrades
capability rather than creating exposure.

**Cost and complexity.** S. **Owner.** Legal or commercial contracts. **Timing.** Before
any source is enabled — this gates E5.

### D20 — Kellanova connector retirement

**Recommended default.** Run the Kellanova EDGAR connector (CIK 0000055067) while it
remains a filer following the Mars acquisition, with a scheduled review at deregistration
so it is retired deliberately.

**Alternatives.** *Do not build it* — forgoes real coverage of a large newly acquired US
plant footprint during the window it exists. *Leave it running until it fails* — a
connector failing for a correct reason still degrades the health metric and consumes
operator attention, which is exactly the noise Connector Care is meant to eliminate.

**Operational consequence.** Mars is otherwise a filing-free account; Kellanova's
remaining filings are a time-boxed window into its US footprint.

**Cost and complexity.** S. **Owner.** Platform administrator. **Timing.** Review before
Phase 4.

---

## Architecture and platform decisions

### D1 — Hub-embedded or separate application

> **Status: Approved.** The Radar will be built as a separate internal application sharing
> identity and infrastructure with the Haskell Hub. The entry below is retained as the
> decision record.

**Recommended default.** A separate application sharing identity and infrastructure with
the Haskell Hub, not embedded in it.

**Alternatives.** *Embed in the Hub* — one surface for users, at the cost of coupling
release cadence and forcing the F&B ontology into a shared model. *Fully standalone
including identity* — maximum autonomy, duplicate user administration and a second
security review.

**Operational consequence.** The F&B ontology, daily cadence, and page model differ
enough from the Hub's that coupling slows both. Shared identity keeps administration
single-source.

**Cost and complexity.** L if reversed after Phase 3 — a rewrite of the delivery layer,
though the ingestion and evidence kernel survives either way.

**Owner.** Executive sponsor with engineering. **Timing.** Before Phase 1 start.

### D2a — Platform architecture

> **Status: Approved.** The architectural shape below is approved. The vendor selections it
> depends on are **D2b, and remain open**.

**Approved architecture.** Five structural choices, independent of which vendors supply
them:

1. **PostgreSQL as both system of record and job queue.**
2. **Object storage for original source documents**, separate from the database.
3. **All AI model access through a single controlled gateway** — no component calls a
   model directly.
4. **One identity source.** The Radar does not maintain its own user directory.
5. **No managed search or vector service, and no external message broker, in the pilot.**

**Why these, on the record.** Using PostgreSQL for the queue is what allows a source
document and its follow-on processing work to commit in one transaction — the property
that prevents records existing with no processing behind them (§4.5). The single model
gateway is what makes classifications reproducible, auditable, and cost-bounded (ADR 0003).
Deferring search, vector, and broker services follows the note already recorded in
`schemas/database.sql`, which defers them until retrieval requirements are approved.

The case rests on those properties. No claim is made about the components' familiarity to
Haskell IT; nothing in this package documents that.

**Alternatives.** *A managed search or vector service* — deferred, as above. *An external
message broker* — unnecessary at pilot volume and adds an operational surface.

**Cost and complexity.** S. **Owner.** Executive sponsor on engineering's recommendation.
**Timing.** Before Phase 1 start.

### D2b — Vendor selections

> **Status: Open.** Four selections are required before D2 is complete. **These are IT's to
> make; they are not made here and must not be assumed.**

**The package names no vendors.** The only provider references anywhere in it are the
placeholders `approved_model_provider` and `approved_extraction_model` in
`schemas/sample-opportunity.json`.

| # | Selection required | Blocks |
| --- | --- | --- |
| **V1** | AI provider and model tier, plus data-processing terms confirming Haskell content is not used for provider model training | First AI-assisted classification |
| **V2** | Identity provider and SSO standard | First user login |
| **V3** | PostgreSQL hosting — managed service or self-hosted, and in which environment | Phase 1 infrastructure |
| **V4** | Object storage service, with retention and access controls | First source document archived |

**Operational consequence.** Each unmade selection blocks only the capability that depends
on it. Phase 1 groundwork proceeds on D2a alone. V1 may involve procurement as well as IT,
since data-processing terms are contractual.

**Cost and complexity.** S to select, L to change after Phase 2. **Owner.** IT, with
engineering; procurement for V1 terms. **Timing.** Each before the capability it gates.

### D16 — Confidence decomposition

**Recommended default.** Keep the lifecycle **Emerging / Developing / Confirmed**
unchanged. Replace the single confidence enum with three fields: evidence strength
(`indicative` / `corroborated` / `authoritative`), assessment type (`observed_fact` /
`inference` / `hypothesis`), and confidence level (`low` / `moderate` / `high`).

**Alternatives.** *Keep the single enum* — leaves stage `confirmed` and confidence
`confirmed` colliding, and hides the difference between an unimpeachable document and an
unimpeachable reading of it. *Rename the enum only* — fixes the collision, not the
conflation.

**Operational consequence.** The combination that matters is *authoritative source +
inference + moderate confidence*: the filing is beyond question, our reading of it is
not. That is the most common route to a false Confirmed, and a single enum cannot express
it. Confidence level is capped at `moderate` for inferences and `low` for hypotheses,
so a strong source cannot launder a weak claim.

**Cost and complexity.** S now — three columns and derivation rules. L after the UI,
briefing templates, and alert copy ship.

**Owner.** Market leader with SMEs. **Timing.** Before Phase 3 UI build; ideally at G-2.

### D8 — Ownership of tier changes and manual overrides

**Recommended default.** The market leader owns account tier and Highest Value status;
the assigned BD owner owns opportunity status; both require a reason code; computed
values are preserved beneath every override.

**Alternatives.** *Anyone may change anything* — tier drift makes the account-strategy
score meaningless. *Admin-only* — creates a bottleneck on the most common daily action.

**Operational consequence.** Tier feeds scoring. Uncontrolled tier editing is the easiest
way to quietly turn the platform back into a priority list.

**Cost and complexity.** S. **Owner.** Market leader. **Timing.** Before Phase 3.

### D4 — Alert channels

**Recommended default.** Both: Microsoft Teams for immediate critical alerts, email for
daily and weekly digests, in-app for everything.

**Alternatives.** *Email only* — simplest, and immediate alerts lose their urgency.
*Teams only* — misses executive viewers who live in email.

**Operational consequence.** Channel is part of the alert dedupe key, so supporting both
is a design input rather than a late addition.

**Cost and complexity.** S. **Owner.** BD lead with IT. **Timing.** Before Phase 3.

### D10 — Design system and brand assets

**Recommended default.** Use existing Haskell web brand tokens — colour, type, spacing —
with no new design language.

**Alternatives.** *A bespoke product design system* — better long-term fit for a dense
product surface, at a cost the pilot cannot carry. *An off-the-shelf component library
unstyled* — fastest, and it will not look like Haskell.

**Operational consequence.** `04` requires restrained colour, generous white space, and
colour-independent status indicators; existing tokens must be checked against WCAG 2.2 AA
contrast before they are adopted wholesale.

**Cost and complexity.** S, assuming tokens exist and are accessible. **Owner.** Design
lead. **Timing.** Before Phase 3.


### D21 — Build or buy local permit coverage

> **Status: Approved, with vendor evaluation completed before any contract is signed.** The entry below is retained as the decision record.

**Recommended default.** Evaluate before building. Run a bounded vendor track — Shovels,
Industrial Info Resources, Dodge, BuildCentral/Hubexo, ConstructConnect — in parallel with
two or three API-exposed jurisdictions, and decide on evidence at the end of Phase 2.

**Alternatives.** *Build municipal connectors now* — the highest per-source cost in the
plan, and it does not amortize: each jurisdiction is its own format. *Buy a subscription
now* — faster, and none of the five vendors has demonstrated F&B project coverage.
*Neither* — leaves Niagara Bottling, which has no filings and limited press cadence,
effectively unmonitored.

**Operational consequence.** The v0.3 research pass corrected three vendor findings — the
BuildCentral and ConstructConnect APIs do exist, and IIR's is real — so access is no longer
the open question. **Coverage depth is.** ConstructionWire's advertised verticals are
retail/CRE, hotels, multi-family and single-family residential, medical, and energy and
mining; food and beverage is not among them. A vendor that does not cover F&B plants is
worse than no vendor, because it looks like coverage.

**Cost and complexity.** M for the evaluation; L either way for the decision — a vendor
subscription is recurring, and a municipal build is multi-week per jurisdiction.

**Owner.** Market leader (which geographies matter) with engineering (integration cost).
**Timing.** Before week 3 of Phase 2, so the evaluation runs alongside the first
jurisdictions rather than after them.

### D22 — Incident severity model

> **Status: Approved.** The entry below is retained as the decision record.

**Recommended default.** Severity by **consequence**, not by who acts:

| Severity | Condition |
| --- | --- |
| **Sev-1** | Routine operation requires a human to extract documents, enter leads, re-key content, or repair source records; or silent data corruption is occurring |
| **Sev-2** | A high-priority account's expected coverage is degraded beyond one cycle, or alerts are materially wrong |
| **Sev-3** | A bounded Connector Care action is pending within SLA |
| **Not an incident** | Business feedback, source approval, tier changes, dismissals with reason |

**Alternatives.** *Treat any non-engineering review state as Sev-1* — proposed by the
external automation review as a Gate 1 amendment, and rejected. It would make a business
user dismissing a false positive an outage, and it contradicts `00`, which explicitly
permits source approval, connector reauthorization, and operator-assisted CAPTCHA. *No
severity model* — everything becomes urgent, which means nothing is.

**Operational consequence.** The non-negotiable is preserved exactly — routine operation
cannot depend on analysts — while business decisions are correctly treated as the product
working rather than as an outage. Getting this wrong in the proposed direction would
create pressure to remove the feedback controls `01` requires.

**Cost and complexity.** S. **Owner.** Engineering with the executive sponsor.
**Timing.** Before Phase 2, so on-call expectations are set before there is an on-call.

### D23 — Research-claim staging

> **Status: Approved as a Phase 1 requirement.** The entry below is retained as the decision record.

**Recommended default.** All externally sourced structured data enters a staging layer
behind an activation gate that fails closed. Nothing reaches a canonical table without
resolvable evidence, date precision, controlled values, a resolved subject, a definite
scope classification, and a pilot-account reference where one applies.

**Alternatives.** *Normalize with a one-off script per batch* — each batch gets its own
silent assumptions, and the link back to the research artifact is lost. *Reject external
research entirely* — wasteful; this batch surfaced a facility-registry API we had missed
and a real gap in our own date model.

**Operational consequence.** Research can be ingested enthusiastically because ingestion
stops being commitment. The cost is honest: of the 27 external graph records received,
perhaps half would activate as-is — four carry no evidence reference at all, and the
status vocabulary mixes provenance with workflow state.

**Cost and complexity.** M. **Owner.** Platform engineering lead. **Timing.** Before any
external batch is imported, which means before the pilot graph records are used at all.

### D24 — Corrections model

> **Status: Approved.** The entry below is retained as the decision record.

**Recommended default.** Claims are immutable; corrections are typed relationships
(`corrects`, `retracts`, `withdraws`, `contradicts`, `supersedes`, `delays`, `cancels`);
the presented view is computed from correction status, source authority, specificity,
temporal applicability, then recency.

**Alternatives.** *Overwrite on recency* — proposed by the external review and rejected:
it destroys the audit trail, and a syndicated copy published Thursday would overturn the
company's own Tuesday release. *Keep only the current view* — the retention window would
always be shorter than someone's memory of the alert they received.

**Operational consequence.** This decides whether the platform can answer "why did you
tell me this last month." An overwrite model cannot. It also makes delay and cancellation
first-class states rather than silence, which matters because a cancelled project is
information, not an absence.

**Cost and complexity.** M, plus a read-path cost that will eventually need a
materialized projection. **Owner.** Market leader with engineering. **Timing.** Before
Phase 2 scoring.

---

## What we are asking for at Gate 1

Most of this section is now closed. What remains is listed last.

**Settled.**

1. ~~**D9**~~ — the acceptance **framework** is approved. Numeric targets are deferred to
   the week-4 checkpoint (D9-T) by decision, not by omission.
2. ~~**D11**~~ — approved **provisionally**. All four classifications await F&B
   market-leader confirmation before pilot metrics are finalized.
3. ~~**D15 and D18**~~ — approved, ahead of their natural gate.
4. ~~**D23**~~ — approved; the staging layer is a Phase 1 requirement.
5. ~~**D14 handling model**~~ — approved.
6. ~~**D1 and D2a**~~ — approved. Together with the D9 framework they constitute
   implementation authorization for Phase 1.

**Still outstanding.**

| Item | Who | What is needed |
| --- | --- | --- |
| **D2b** — vendor selections V1–V4 | IT, procurement for V1 terms | AI provider and data-processing terms, identity provider, PostgreSQL hosting, object storage. **Not selected here** |
| **D9-T** — numeric targets | Executive sponsor + market leader | Four weeks of measured baseline, then the week-4 checkpoint |
| **D11 confirmation** | F&B market leader | Confirm or overturn all four provisional classifications |
| **D12** — Ecolab semantics | BD lead | Pursuit target or partner lens; related to D11 but decided separately |
| **D14-L** — licence and import | Legal / commercial contracts | Review of the event lead-retrieval agreement. **Not complete** |

**Scope of the D14 block, stated precisely.** The licence review blocks **activation and
use of the PACK EXPO data in Phase 1** — the import itself, the engagement layer built on
it, and anything derived from it. It does **not** block Phase 1 as a whole, and it does
**not** block review, approval, or merge of the design-only pull request that carries this
packet. Phase 1 work that does not touch the event data may proceed while the review is
outstanding.
