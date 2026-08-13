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
| [0003](0003-model-gateway-and-replay-cache.md) | All model calls go through a gateway with a replay cache | Proposed | G-4 |
| [0004](0004-date-precision-is-first-class.md) | Dates carry explicit precision | Proposed | G-4 |
| [0005](0005-conservative-entity-resolution.md) | Unresolved is a valid terminal state for entity resolution | Proposed | G-4 |
| [0006](0006-two-tier-evidence-for-broad-news.md) | Two-tier evidence resolves broad news discovery against the allowlist | Proposed | G-3 |
| [0007](0007-change-ledger-as-single-source-of-delta.md) | One change ledger powers Pulse, alerts, and briefs | Proposed | G-4 |
| [0008](0008-ontology-and-scoring-as-versioned-config.md) | Ontology and scoring live in versioned config, not constraints | Proposed | G-2 / G-4 |

## Format

Each record states context, the decision, alternatives that were genuinely considered,
consequences (including the bad ones), and what would cause the decision to be revisited.
A decision with no stated reversal trigger is not a decision, it is a preference.
