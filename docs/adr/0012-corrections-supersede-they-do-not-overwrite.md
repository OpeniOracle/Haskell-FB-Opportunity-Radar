# ADR 0012 — Corrections supersede; they do not overwrite

**Status: Accepted** · **Approved via:** D24 · **Relates to:** E11, E19, D24

## Context

Sources correct themselves. A press release is reissued attributing a plant expansion to
an independent bottler rather than the brand owner. A recall notice is expanded. A project
announced for 2027 is delayed, then cancelled. A syndicated copy repeats a figure the
originating publisher has already retracted.

The v0.2 design handles *negative signals* — closures, layoffs, cancellations reduce
momentum and can close an opportunity — but it has no way to record that **the evidence
itself** was corrected, retracted, or withdrawn. That is a genuine gap, and an adversarial
automation review found it.

The review's proposed remedy was that "newer source documents with explicit correction
markers, or higher source-authority weights, automatically overwrite older conflicting
edge properties," with a `temporal_weight` and `superseded_by_node_id` on the graph.

The problem is real. **The remedy is backwards**, in two ways. Evidence is immutable by
design: it records what a source said at a retrieval time, and a later document does not
make an earlier one un-said. Overwriting destroys the audit trail that the evidence-first
principle exists to protect — the moment a user asks "why did you tell me this last
month," the answer would be gone. And recency is not authority: a syndicated aggregator
publishing on Thursday is newer and less authoritative than the company's own Tuesday
release.

## Decision

**Claims are immutable. Relationships between them carry the correction.** A typed
relationship set connects evidence and the signals derived from it:

`corrects` · `retracts` · `withdraws` · `contradicts` · `supersedes` · `delays` ·
`cancels`

Project and opportunity state gains the matching lifecycle values, so a delayed or
cancelled project is a state, not a deletion.

**The current view is computed, not stored.** Resolution order, applied in sequence:

1. **Correction status** — an explicitly retracted or withdrawn claim is excluded from the
   presented view while remaining readable in the record.
2. **Source authority** — primary over official secondary over secondary. A company's own
   release outranks a syndicated copy regardless of publication time.
3. **Specificity** — a claim naming a facility outranks one naming only a region.
4. **Temporal applicability** — which claim applies to the event date in question
   (ADR 0005's as-at-date attribution).
5. **Recency** — the final tiebreak, not the first test.

`superseded_by` survives as a **relationship**, never as a mutation. Nothing is deleted;
what changes is which claim the presented view selects, and every card can show why.

The review's own acceptance test still passes: inject a press release, then a retraction,
and the opportunity moves to a withdrawn state automatically with no human tagging — while
both documents remain retrievable.

## Alternatives considered

- **Overwrite on recency (as proposed).** Rejected: destroys the audit trail and gets
  authority backwards.
- **Keep only the computed current view and discard superseded claims after a window.**
  Rejected: the window would always be shorter than someone's memory of the alert they
  received.
- **Materialize the current view into the canonical row on write.** Rejected as a first
  step — it makes the resolution order invisible and un-auditable. A materialized
  projection for query performance is fine later, provided it is derived and rebuildable.

## Consequences

Good: the audit trail survives corrections; "why did this change" is answerable from
stored data; syndicated copies cannot overturn primary sources by being newer; and delay
and cancellation become first-class states rather than silence.

Bad: the presented view costs a computation on every read, so it will need a materialized
projection sooner than a simple overwrite would. Contradictions can persist unresolved
when two sources of equal authority and specificity disagree — the interface must show
that state honestly rather than picking one, which is more UI work than showing a single
value.

## Revisit when

Read-path cost forces materialization, or a class of correction proves impossible to
express with the seven relationship types.
