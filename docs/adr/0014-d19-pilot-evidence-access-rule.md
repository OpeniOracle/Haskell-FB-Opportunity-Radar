# ADR 0014 — The pilot evidence-access rule (D19)

**Status:** Accepted for the pilot
**Date:** 2026-08-26
**Supersedes:** nothing. **Relates to:** ADR 0006 (evidence access modes, Proposed)

## Context

ADR 0006 proposes five evidence access modes and remains **Proposed**; D19 — which
mode applies to which source — was **Open**. That is a blocking gap for live
collection, because "preserve the raw source content" and "retain a reference
only" are different legal postures, and the difference is decided per source
before a single byte is stored, not afterwards.

The general question stays open. What is decided here is narrower: the rule the
**pilot** operates under, for the sources the pilot actually collects.

## Decision

**U.S. government material — SEC EDGAR, FSIS MPI, and other eligible federal
works — is `archived_full_text`.** The complete retrieved content is preserved in
the private evidence bucket. These are U.S. government works; preservation
carries no licensing exposure, and the whole value of a filing is in its text.

**Corporate newsroom and investor-relations material is `reference_only`.** It is
copyrighted by its publisher and we have no licence to reproduce it. For each
such record the Radar retains:

- the URL
- the title
- the publisher
- the publication date, **when the source states one**
- the retrieval time
- the content hash
- the structured extracted claims
- the minimum supporting excerpt

and **not** the complete page body.

**Reference-only evidence cannot, by itself, promote a signal to high
confidence.** A claim whose only support is material we could not preserve is a
claim we cannot re-examine later, and confidence that cannot be re-examined is
not confidence.

## Why the content hash is kept for reference-only evidence

It is the one piece of the discarded body we are entitled to keep, and it is what
makes a correction detectable. Without it, a silently edited press release is
indistinguishable from the one we read, and the platform would keep asserting a
claim its source no longer makes. With it, re-retrieval produces a different hash
and the change becomes a `corrects` relationship under ADR 0012 rather than an
invisible drift.

## What this does not decide

- **D16 (confidence axes)** stays Open, and ADR 0009 stays Proposed. The three
  axes are **recorded** on every evidence row. No threshold, no promotion rule
  and no automated confidence decision is implemented, and the one rule stated
  above is a **ceiling** — "reference-only alone cannot reach high" — not a
  formula for reaching any level.
- **D17 (health versus coverage)** stays Open, and ADR 0010 stays Proposed.
  Coverage expectations are recorded with rationales; no threshold and no alarm
  is derived from them.
- The general access-mode question in ADR 0006 stays Proposed. This ADR binds the
  pilot's three source families and nothing else.

## Consequences

The schema already enforces the mechanical half of this rule.
`evidence_reference_only_has_no_body` rejects a reference-only or metadata-only
row that carries `body_text` or `archive_uri`, so the posture cannot be violated
by a connector bug, a careless backfill, or a well-meaning change to a
transformation. Migration 0015 adds the second half: `body_text`, `archive_uri`
and the storage paths are excluded from what an authenticated browser session can
read at all, so preserved government text is served only through a signed URL
minted by a server-side function that checks the access mode first.

The cost is real and accepted: for corporate sources the Radar will hold an
excerpt and a set of extracted claims rather than the article. A reviewer who
wants the full text follows the link to the publisher, which is the correct
outcome — the publisher gets the visit, and we do not hold a copy we have no
right to.
