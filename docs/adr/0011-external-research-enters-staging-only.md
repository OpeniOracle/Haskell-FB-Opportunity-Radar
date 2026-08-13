# ADR 0011 — External research enters staging, never canonical tables

**Status:** Proposed · **Ratified at:** Gate G-4 · **Relates to:** E26, D23

## Context

The pilot account graph, source catalog, signal backtest, and automation review were
produced by external research tools. They are useful and they are not trustworthy in the
specific sense that matters here: they carry claims without uniform provenance, mix
controlled and free-text status values, embed raw URLs as if they were evidence, and
express dates at four different grains inside ordinary strings.

Both graph files demonstrate every one of these, and between them they carry **thirteen
distinct `evidence_status` values with no overlap between the files** — mixing provenance,
confidence, currency, scope, and workflow state. One of them,
`requires_closing_release_for_graph_activation`, is not an evidence status at all but an
activation gate. **11 of 53 records carry no evidence reference.** The two files also use
incompatible field names and even incompatible *record-type vocabularies* for the same
concepts, so cross-file consistency is absent by construction.

The tempting shortcut is a one-off normalization script. That is a mistake, because more
research will arrive — from these tools, from vendors during evaluation, from Haskell's
own teams — and each batch would get its own script and its own silent assumptions.

## Decision

All externally sourced structured data enters a **staging layer** with a fixed claim
contract, and reaches canonical tables only through an activation gate that **fails
closed**.

Every staged claim carries: a stable claim ID; its source file and record locator; claim
type; subject, predicate, object; valid time as interval plus precision plus basis;
observation date; evidence URLs; `verification_status`; `source_authority`;
`scope_classification`; `activation_status`; a rejection reason when rejected; and a
canonical target ID only after successful validation. Full contract in
`14_EXTERNAL_RESEARCH_RECONCILIATION.md` §6, DDL proposal in `11_SCHEMA_DELTA_PROPOSAL.sql`.

**Activation requires all of**: resolvable evidence under an access mode supporting the
claimed authority; date precision present whenever a date is asserted, with an inference
note whenever the basis is inferred; controlled values from their enums with no free text;
a subject that resolves canonically or through ADR 0005's ladder; a definite scope
classification; a pilot-account reference for any claim about a Highest Value account or
its subsidiaries; and date-bounded ownership on any operator or facility claim.

**Unresolved is a valid outcome that blocks activation without being an error** (ADR
0005). A claim may sit in `staged` or `needs_evidence` indefinitely.

## Alternatives considered

- **Import directly with a normalization script.** Rejected: one script per batch, each
  encoding its own assumptions, none reviewable. It also destroys the link back to the
  research artifact that produced a claim.
- **Reject external research entirely and re-derive everything internally.** Rejected as
  wasteful — the research surfaced a real facility-registry API we had missed and a real
  date-precision gap in our own schema.
- **Stage in a document store and validate at read time.** Rejected: read-time validation
  means invalid claims are already in circulation, and every consumer re-implements the
  gate.

## Consequences

Good: research can be ingested enthusiastically because ingestion is not commitment; every
canonical row traces to a research artifact and locator; the same contract serves vendor
trials; and disagreements between research batches become visible rows rather than
overwrites.

Bad: a staging layer is real schema and real code for data that may never activate. There
is a standing queue of `needs_evidence` claims that will not clear itself, and someone
must decide periodically whether an unactivatable claim is worth pursuing.

The staged-to-activated ratio is not merely low — a dry run of the accounts 6–10 file
against the gate produced **0 validated, 16 staged, 9 needs_evidence, and 1 rejected**.
Nothing activates, because no record in either file carries a scope classification, a
pilot-account reference, or temporal precision. That is the gate working, not the gate
misconfigured, but it means **external research is a starting point for enrichment rather
than a shortcut to a populated graph**, and the plan should say so before anyone budgets
against it.

## Revisit when

Two or more external batches have been processed and the activation gate has produced no
rejections — which would suggest the gate is checking nothing.
