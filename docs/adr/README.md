# Architecture Decision Record

`00_CLAUDE_MASTER_PROMPT.md` requires that an architecture decision record be preserved.
This directory holds it.

## Status vocabulary

- **Proposed** — recommended default from the design response; not yet ratified.
- **Accepted** — ratified at a stakeholder gate.
- **Superseded** — replaced by a later ADR, which is named in the record.

Six records are **Accepted** and the rest remain **Proposed**; each header names the
decision that approved it, or the gate at which it will be ratified. **Nothing here is
implemented** — acceptance records an approved design, not built software, and no ADR
acceptance selects a vendor.

## Index

| ADR | Title | Status | Ratified at |
| --- | --- | --- | --- |
| [0001](0001-modular-monolith-deployment-shape.md) | Modular monolith over microservices for the pilot | **Accepted** (D1, D2a) | — |
| [0002](0002-egress-gateway-as-sole-network-path.md) | A single egress gateway is the only outbound network path | Proposed | G-3 / G-4 |
| [0003](0003-model-gateway-and-replay-cache.md) | All model calls go through a gateway with a replay cache | **Accepted** (D2a) · **revised** | — |
| [0004](0004-temporal-model-precision-and-basis.md) | Dates are intervals with precision and basis | **Accepted** (D15) | — |
| [0005](0005-conservative-entity-resolution.md) | Unresolved is a valid terminal state for entity resolution | **Accepted in part** (D18) | G-4 for the remainder |
| [0006](0006-evidence-access-modes.md) | Five evidence access modes, with promotion rules | Proposed · **revised** | G-2 / G-3 |
| [0007](0007-change-ledger-as-single-source-of-delta.md) | One change ledger powers Pulse, alerts, and briefs | Proposed · **revised** | G-4 |
| [0008](0008-ontology-and-scoring-as-versioned-config.md) | Ontology and scoring live in versioned config, not constraints | Proposed | G-2 / G-4 |
| [0009](0009-three-axis-confidence.md) | Confidence is three questions, not one | Proposed | G-2 |
| [0010](0010-health-and-coverage-are-separate-metrics.md) | Operational health and intelligence coverage are separate metrics | Proposed · **revised** | G-3 / G-6 |
| [0011](0011-external-research-enters-staging-only.md) | External research enters staging, never canonical tables | **Accepted** (D23) | — |
| [0012](0012-corrections-supersede-they-do-not-overwrite.md) | Corrections supersede; they do not overwrite | **Accepted** (D24) | — |

Records marked **revised** were changed by a later reconciliation pass.

- **v0.2 design reconciliation** revised 0003, 0005, 0007 and rewrote-and-renamed 0004
  and 0006, whose scope widened; each states what it supersedes.
- **v0.3 external-research reconciliation** added 0011 and 0012, extended 0010 with
  per-source cadence baselines, the staleness-must-not-mutate-evidence invariant, and an
  outbound-alert circuit breaker; added `season` to 0004's precision enum; and recorded in
  0005 why a proposed 95%-automatic-conflict-resolution target was rejected.

**Six records are now Accepted** — 0001 via D1 and D2a, 0003 via D2a, 0004 via D15,
0011 via D23, 0012 via D24, and 0005 in part via D18 (its time-bounded-ownership corollary;
the conservative-resolution ladder still awaits Gate G-4). The remaining records are
Proposed.

Two acceptances are bounded. ADR 0001 and ADR 0003 are approved as **architecture**; the
vendor selections they depend on — AI provider, identity provider, PostgreSQL hosting,
object storage — are **D2b and remain open with IT**. Accepting the architecture does not
select a vendor.

Earlier revisions were self-corrections and reconciled external input, not stakeholder
supersessions.

## Format

Each record states context, the decision, alternatives that were genuinely considered,
consequences (including the bad ones), and what would cause the decision to be revisited.
A decision with no stated reversal trigger is not a decision, it is a preference.
