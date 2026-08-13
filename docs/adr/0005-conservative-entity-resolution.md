# ADR 0005 — Unresolved is a valid terminal state for entity resolution

**Status:** Proposed · **Ratified at:** Gate G-4 · **Relates to:** C1, C12, C13, D13

## Context

`03` §Entity resolution: "Ambiguous matches should remain unresolved or low confidence.
They should not be silently assigned to the highest-profile company with a similar
name." `06` §Data-quality rules: "Do not merge organizations solely because their
normalized names are similar."

The source data makes this concrete. Only 10 of 171 curated targets have an exact
normalized match in the XPress export, and only 5 of the 15 Highest Value accounts do.
The gap is not noise — it is brands, subsidiaries, punctuation, abbreviations, and
ownership relationships. The temptation to close that gap with aggressive fuzzy matching
is exactly the failure mode both documents warn against, and the cost of a wrong merge
is asymmetric: a missed match costs one opportunity, a bad merge corrupts an account
timeline and every score computed from it.

## Decision

Resolution proceeds as an ordered ladder, and stops at the first confident answer:

1. **Official identifiers** — SEC CIK, regulatory facility IDs, official domains.
2. **Curated aliases** — including human-approved mappings, retained as durable rules.
3. **Domain and website match.**
4. **Address match** for facilities, with geocode precision recorded.
5. **Blocked fuzzy scoring** — candidate generation within a blocking key, never a
   global similarity sweep.
6. **Model-assisted candidate generation** — proposes candidates only. A model may never
   commit a merge.

If no step produces a confident answer, the mention stays **unresolved**, and that is
recorded as a successful outcome rather than an error. Unresolved candidates accumulate
in `organization_candidates` and surface in an admin queue, where a human approval
becomes a durable rule that improves every future run.

Two corollaries. The global unique index on `lower(canonical_name)` is dropped (C12):
two legitimately distinct entities may share a name, and forcing a merge at the storage
layer is the failure this ADR exists to prevent. And related-entity structure is modeled
explicitly (D13) — bottlers, co-manufacturers, and NA subsidiaries are separate
organizations with typed relationships, not aliases of the brand owner.

## Alternatives considered

- **Threshold-based auto-merge on normalized name similarity.** Rejected: directly
  contradicts `06`, and the pilot cohort is full of traps — "Mars" the company versus
  Mars brands, Nestlé appearing on two sheets, three distinct Coca-Cola bottlers.
- **Require every mention to resolve before creating a signal.** Rejected: discards real
  evidence about companies not yet in the graph, which is the discovery path in Phase 5.

## Consequences

Good: account timelines stay trustworthy; wrong merges — the expensive error — are rare;
human effort compounds into durable rules rather than being spent repeatedly.

Bad: coverage looks lower early on, and the unresolved queue is real work in Phase 1.
That work is bounded and front-loaded, and it is the honest version of the number.

## Revisit when

Measured resolution accuracy on the adversarial set exceeds the approved threshold with
margin, and the unresolved queue is dominated by a mechanical pattern that a new
deterministic rule can absorb.
