# 20 — Phase 2 decisions and implementation-plan update

**Status:** Decision record. **Date:** 2026-10-16.
**Records:** decisions D-R1 to D-R6, taken by the repository owner after reviewing the Phase 2 audit and the research reconciliation.
**Changes no accepted ADR.** Where a decision touches one, §4 says how and asks for approval rather than assuming it.

---

## 1. Where the plan lives, and which branch is which

| Branch | Holds | Carries application code? | On `main`? |
|---|---|---|---|
| `claude/modest-fermi-eu1kn3` (**documentation branch**), head `a279d17` | Doc 18 (Phase 2 engineering audit and data-activation plan), doc 19 (research reconciliation and evidence-quality plan), doc 19a (appendices) | **Never** | **No** |
| `claude/phase2-pr1-ingestion-integrity` | Roadmap PR 1 (ingestion integrity) | Yes | **Merged** as PR #17, merge commit `689eb56` |
| `claude/phase2-r1-5-synthetic-regression-harness` (**implementation branch**) | This document and the synthetic regression harness (roadmap R1.5) | Tests only | No (open PR) |

Docs 18, 19 and 19a are **preserved unchanged** on the documentation branch and are cited here by commit, not copied:
`https://github.com/OpeniOracle/Haskell-FB-Opportunity-Radar/tree/a279d1756cd8cc6dc5cd82d8d1981d0e9966392a/docs/design`.
Getting them onto `main` is a separate, docs-only change that has not been made. Roadmap numbering ("R1, R2 …") follows doc 18 §11 and doc 19 §11; it is **not** GitHub PR numbering.

---

## 2. The six decisions

### D-R1 — Machine-derived opportunities
Automated discovery stays a central requirement. Machine-detected evidence **may** create unreviewed candidates, visible in an **explicitly labelled research / emerging-intelligence area** with their evidence, their uncertainty and their review state.

* An unreviewed candidate is **never** shown as confirmed, commercially qualified or pursuit-ready.
* An analyst is **not** required to enter every discovery.
* The existing `stage` / `status` conventions are preserved.

**Minimum additional attribute proposed** (not built here): `opportunities.review_state ∈ {unreviewed, accepted, rejected}`, default `unreviewed` for any pipeline-derived row. Who reviewed and when is already recorded by `opportunity_status_history` and `audit_events`, so no reviewer columns are proposed. Uncertainty is already carried by `confidence`, the linked signals' `independent_source_count`, and the evidence's `access_mode` / `evidence_strength`. "Why not an opportunity" belongs in `signals.model_metadata` (JSON), so no column is proposed for it either.

**Display rule the read model must enforce (R2/R9, not this PR):** a row appears in the pursuit workspace only if `review_state = 'accepted'` **and** `stage` is `developing` or `confirmed` **and** `status` is an active status **and** `commercial_qualification` says so. Everything else with `review_state = 'unreviewed'` appears only in the labelled research area.

### D-R2 — State and local records
The source-rights framework is extended to state and local government records, economic-development organisations and municipal publications. They default to **`reference_only`** until their specific retention and reuse permissions are established, and are **never silently reclassified** as federal public-domain material.

Today's code already fails closed in this direction — `evidenceAccessPolicy` downgrades an unrecognised or unlicensed source to `reference_only` — so the decision is consistent with the pipeline. What is missing is the *recorded class*: proposed `sources.rights_class` (R2) and an ADR (§4).

### D-R3 — Lifecycle and commercial qualification
Approved, **subject to compatibility checks in the schema PR**: add `project_lifecycle` and `commercial_qualification` to `opportunities`.

* `commercial_qualification` defaults to **`not_assessed`**.
* Completed, cancelled, withdrawn and historical projects stay **searchable** but never appear as active pursuit solely because a project was once announced.

Proposed vocabularies (to be settled in the schema PR, not here): `project_lifecycle ∈ {announced, approved, under_construction, completed, cancelled, withdrawn, historical, unknown}`; `commercial_qualification ∈ {not_assessed, no_open_work, open_work_unverified, qualified}`. The bundle's `closed_completed` / `closed_withdrawn` map to `status = expired` / `cancelled` in the interim (doc 19 §8), which is why the durable fix is the lifecycle column.

### D-R4 — Benchmark location
Version-controlled repository fixtures with a **checksum manifest**; synthetic regression examples **separate** from sourced evidence. The 130 provisional research labels are not verified ground truth and are **not** imported to production. Implemented by this PR: `app/src/test/regression/` (`synthetic/`, a reserved empty `sourced/`, `MANIFEST.json`).

### D-R5 — Scoring
Combined scoring and terminology reconciliation are **deferred to D16**. Nothing here computes, ranks or compares a score.

### D-R6 — Implementation authorisation
Authorised: the tests-only synthetic regression harness (R1.5). **Not** authorised in this task: the schema PR, any classifier rewrite, source expansion, or database remediation.

---

## 3. Plan of record after these decisions

This replaces the ordering in doc 18 §11 and doc 19 §11 without editing either.

| Order | PR | State | Contents | Depends on |
|---:|---|---|---|---|
| 1 | R1 — ingestion integrity | **Merged** (#17, `689eb56`) | Stale-run recovery, honest skips/partials, access-mode enforcement, unexecuted remediation SQL | — |
| 2 | **R1.5 — synthetic regression harness** | **This PR** (open, not merged) | Tests and a diagnostic report only; **no behaviour change** | — |
| 3 | R2 — schema | Needs authorisation | Provenance/fingerprints, identifier vocabulary, jobs/tasks, **plus** `review_state` (D-R1), `project_lifecycle` + `commercial_qualification` (D-R3), `sources.rights_class` (D-R2), `evidence.origin_key`, `signals.event_date_role` | 1 |
| 4 | R2.5 — read-truncation guard | Needs authorisation | Deterministic order and a visible "showing N of M" on the 1,000-row reads — **before** any large source | 1 |
| 5 | R3 — derivation correctness | Needs authorisation | Repairs the defects R1.5 pins; each repair retires its markers | 2, 3 |
| 6 | R4 — durable execution | Needs authorisation | Dispatcher, worker, heartbeat, re-dispatch | 3 |
| 7 | R5a — SEC exhibit repair | Needs authorisation | Exhibit discovery by document type, fixture-based, no cohort change | 5 |
| 8 | R5b — SEC cohort from data and backfill | Needs authorisation | After R3 **and** R4 | 5, 6 |
| 9+ | Mars repair, FSIS, FRS, ECHO/NPDES, facility resolution, state incentives, local planning | Later | Unchanged from doc 19 §10–11 | per row |

Two corrections to doc 18 carried from doc 19 §11.3: a removed FSIS establishment yields an **unconfirmed directory-change observation, not a closure**; and SEC exhibit repair is **split** from the cohort change.

---

## 4. ADR touchpoints — identified, none changed, approval requested

No ADR file is edited by this PR. For each, the decision's relationship and what approval is needed:

| ADR | Status | Relationship to the decisions | Needs your approval |
|---|---|---|---|
| **0014** — pilot evidence-access rule | Accepted for the pilot | D-R2 **extends** it. 0014 decides *federal* material (`archived_full_text`) and *corporate* material (`reference_only`) and is silent on state/local, EDO and municipal sources. No existing sentence is contradicted | A **new ADR** ("source-rights classes beyond the pilot rule", status *Proposed*) that records the D-R2 default and the rights-class vocabulary. Until approved, the fail-closed code default is the operative behaviour |
| **0006** — evidence access modes | Proposed | D-R1: a candidate resting on `reference_only` evidence is capped at "indicative" by rule 1 and cannot reach `confirmed` (rule 2). **Consistent** with showing it only as an unreviewed candidate. Open point: 0006 says "indicative"; `evidence.evidence_strength` has no such value | Fold into **D16** (see D-R5). No change now |
| **0009** — three-axis confidence | Proposed; D16 open | D-R5 defers. `review_state` is **not** a confidence axis and does not compute one | None (deferral recorded) |
| **0011** — external research enters staging only | Accepted | D-R4 keeps the 130 research labels out of every canonical table. D-R1 concerns *connector-derived* candidates, which already live in `opportunities`; it does not move research into canonical tables | None — consistent. Stated so the two are never conflated |
| **0012** — corrections supersede | Accepted | Review rejection and later dismissals go through `opportunity_status_history` (reason required for `dismissed`) | None |
| **0004** — dates are intervals with precision and basis | Accepted | The harness **encodes** it (a forecast is an interval, not an `event_date`; a missing date stays missing). It changes nothing | None |
| **0005** — conservative entity resolution | Accepted in part | The harness encodes "do not credit a franchise bottler's plant to its brand owner" | None |

**Schema compatibility notes for the R2 PR** (read-only survey of `main` @ `689eb56`; nothing applied):

* **Stages and statuses.** `opportunities.stage ∈ {emerging, developing, confirmed}` and `status ∈ {new, watching, pursue, assigned, on_hold, dismissed, closed_won, closed_lost, cancelled, expired}` are preserved. There is no `completed` status; `closed_won` / `closed_lost` mean *Haskell's* pursuit outcome and must not be reused for "project completed". `expired` and `cancelled` are the interim homes.
* **Name collision.** `opportunities.project_maturity` is an existing **0–25 score** column. The proposed column is therefore `project_lifecycle`, never `project_maturity`.
* **Constraints.** `opportunity_status_history` rejects `dismissed`, `closed_lost` and `on_hold` without a reason. New columns need `NOT NULL DEFAULT` values and `CHECK` vocabularies so existing rows (derived and analyst-created) stay valid; `review_state` should default to `accepted` for rows with `derived_by IS NULL`.
* **Grants.** Browser reads use an explicit **column grant** on `opportunities` (0015), extended by 0022 for later columns. Every new column the UI reads needs its own grant, or **the whole read fails** with 42501 — this has happened once already (0021).
* **Views.** There are none today; doc 18's R2 views, if added, must expose only granted columns.
* **Read model.** `apiDataSource.ts` selects an explicit `OPPORTUNITY_COLUMNS` list and `domain.ts` types stage and status; both change with the columns.
* **Idempotence.** Derived rows are keyed by `(organization_id, opportunity_key)`; backfilling the new columns must not alter that key.

---

## 5. What R1.5 delivers, and what it deliberately does not

**Delivers:** 36 synthetic cases in ten requirement families, asserted on separate dimensions (signal, promotion, event date, independence, cardinality, attribution, location); a defect catalogue; a checksum manifest; a committed machine-readable report; and guards that keep the harness fictional, offline, credential-free and out of the production bundle. Open defects are **pinned**, so CI stays green while they are visible, and a repair turns its cases red until their markers are retired.

**Does not:** change the classifier, the pipeline, the schema, any connector, any configuration or any data; read production; call a model; or report a precision figure. See `app/src/test/regression/README.md`.

**Retiring a pinned defect** is the first act of R3: repair the behaviour, watch the named cases turn red, retire the markers, regenerate the report, and review the diff. That diff is the evidence the repair worked.
