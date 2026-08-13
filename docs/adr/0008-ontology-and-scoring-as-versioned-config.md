# ADR 0008 — Ontology and scoring live in versioned config, not constraints

**Status:** Proposed · **Ratified at:** Gates G-2 and G-4 · **Relates to:** C14, C15, C19

## Context

`schemas/database.sql` encodes the domain vocabulary in `check` constraints: sectors and
capabilities as unconstrained `text[]`, signal families as a check, confidence
multipliers pinned to `(0.60, 0.80, 1.00)`. `schemas/platform.schema.json` encodes the
same vocabulary again as JSON Schema enums. The two already disagree — the JSON Schema
requires at least one capability on an opportunity; the SQL does not.

`signals.event_type` is free text with no vocabulary at all. Within a month that column
will hold "plant expansion," "plant_expansion," "Plant Expansion," and "expansion," and
every downstream count will be wrong.

Meanwhile `05` requires a reusable market module for other Haskell departments (G11), and
`opportunity_score_snapshots.calculation_version` already implies the scoring formula is
versioned — yet changing a confidence multiplier currently requires a schema migration.

## Decision

Move the ontology and the scoring configuration into **versioned reference data**:

- `signal_event_types(code, signal_family, display_name, negative_by_default, retired_at)`
  with an FK from `signals.event_type`. Retirement, not deletion, so historical rows stay
  valid.
- Sector and capability reference tables with FK-backed membership, replacing bare
  `text[]`.
- `scoring_configs(version, dimension_caps, confidence_multipliers,
  promotion_thresholds, effective_from, retired_at)`. `opportunities` records the
  `scoring_version` used. The multiplier column keeps a range check only.
- `market_trends` records `velocity_method`, `window_days`, and `baseline_days`, so the
  number in `04`'s trend card is reproducible (C19).

One vocabulary is generated from the other in CI — SQL enums and JSON Schema enums must
not be independently maintained.

Two things deliberately do **not** become configurable: the five scoring dimensions
themselves and their caps in the current version. In particular `account_strategy` is
capped at 10 of 100 because `02` says Tier 1 status must not turn weak project evidence
into a high-readiness opportunity. Versioning the cap is fine; raising it is a product
decision that goes through Gate G-2, not a config edit.

## Alternatives considered

- **Keep constraints, migrate when the ontology changes.** Rejected: scoring weights
  will change several times during a pilot, and a migration per tuning round makes the
  team stop tuning.
- **Ontology entirely in application code.** Rejected: no referential integrity, and
  `event_type` stays free text.
- **Fully user-editable taxonomy in the admin UI.** Rejected for MVP: an ontology that
  anyone can edit is one nobody can trust in a score explanation. Versioned config
  changed through review is the middle ground.

## Consequences

Good: score tuning is a config version bump with recomputable snapshots; a second market
is configuration rather than a migration; `event_type` gets a real vocabulary;
historical scores remain explainable because their version is recorded.

Bad: FK-backed arrays are more work than `text[]`; reference data needs seeding and its
own review path; and a stale `scoring_version` on an un-recomputed opportunity must be
visible in the UI rather than silently mixed with current ones.

## Revisit when

A second Haskell market goes live and reveals vocabulary that the shared reference model
cannot express without contortion.
