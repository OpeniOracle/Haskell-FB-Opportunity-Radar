# Architecture Decision Record

`00_CLAUDE_MASTER_PROMPT.md` requires that an architecture decision record be preserved.
This directory holds it.

## Status vocabulary

- **Proposed** — recommended default from the design response; not yet ratified.
- **Accepted** — ratified at a stakeholder gate.
- **Superseded** — replaced by a later ADR, which is named in the record.

Every ADR below is **Proposed**. Each becomes Accepted at the gate named in its header,
or is superseded by a new ADR if the stakeholder answer differs from the recommendation.
Nothing here is implemented.

## Index

| ADR | Title | Status | Ratified at |
| --- | --- | --- | --- |
| [0001](0001-modular-monolith-deployment-shape.md) | Modular monolith over microservices for the pilot | Proposed | G-4 |
| [0002](0002-egress-gateway-as-sole-network-path.md) | A single egress gateway is the only outbound network path | Proposed | G-3 / G-4 |
| [0003](0003-model-gateway-and-replay-cache.md) | All model calls go through a gateway with a replay cache | Proposed · **revised** | G-4 |
| [0004](0004-temporal-model-precision-and-basis.md) | Dates are intervals with precision and basis | Proposed · **revised** | G-4 |
| [0005](0005-conservative-entity-resolution.md) | Unresolved is a valid terminal state for entity resolution | Proposed · **revised** | G-4 |
| [0006](0006-evidence-access-modes.md) | Five evidence access modes, with promotion rules | Proposed · **revised** | G-2 / G-3 |
| [0007](0007-change-ledger-as-single-source-of-delta.md) | One change ledger powers Pulse, alerts, and briefs | Proposed · **revised** | G-4 |
| [0008](0008-ontology-and-scoring-as-versioned-config.md) | Ontology and scoring live in versioned config, not constraints | Proposed | G-2 / G-4 |
| [0009](0009-three-axis-confidence.md) | Confidence is three questions, not one | Proposed | G-2 |
| [0010](0010-health-and-coverage-are-separate-metrics.md) | Operational health and intelligence coverage are separate metrics | Proposed · **revised** | G-3 / G-6 |
| [0011](0011-external-research-enters-staging-only.md) | External research enters staging, never canonical tables | Proposed | G-4 |
| [0012](0012-corrections-supersede-they-do-not-overwrite.md) | Corrections supersede; they do not overwrite | Proposed | G-2 |

Records marked **revised** were changed by a later reconciliation pass.

- **v0.2 design reconciliation** revised 0003, 0005, 0007 and rewrote-and-renamed 0004
  and 0006, whose scope widened; each states what it supersedes.
- **v0.3 external-research reconciliation** added 0011 and 0012, extended 0010 with
  per-source cadence baselines, the staleness-must-not-mutate-evidence invariant, and an
  outbound-alert circuit breaker; added `season` to 0004's precision enum; and recorded in
  0005 why a proposed 95%-automatic-conflict-resolution target was rejected.

No record has yet been ratified, so nothing here was superseded by a stakeholder
decision — the revisions are self-corrections and reconciled external input.

## Format

Each record states context, the decision, alternatives that were genuinely considered,
consequences (including the bad ones), and what would cause the decision to be revisited.
A decision with no stated reversal trigger is not a decision, it is a preference.
