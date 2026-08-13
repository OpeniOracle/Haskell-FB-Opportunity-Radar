# ADR 0003 — All model calls go through a gateway with a replay cache

**Status:** Proposed · **Ratified at:** Gate G-4 · **Relates to:** D2

## Context

`03` §Language-model boundary requires that every model output record provider, model,
prompt version, schema version, timestamp, and confidence, and that important
classifications be **reproducible from stored evidence**. `03` §Extraction also requires
deterministic reprocessing, and `00` requires that a second run against unchanged
content produce no duplicate alerts.

Language models are not deterministic. Temperature zero narrows the distribution but
does not guarantee identical output, and provider-side model updates change behavior
without notice. Reproducibility therefore cannot be a property of the model. It has to
be a property of the system around it.

## Decision

Every model call goes through a **model gateway**, which is the only component holding
provider credentials. It enforces schema-constrained output, resolves prompts from a
versioned registry, applies cost and rate limits, redacts before send, and records the
full call.

Critically, it maintains a **replay cache keyed by
`(content_hash, task, prompt_version, model, schema_version)`**. A cache hit returns the
stored output verbatim.

Consequences of that key: reprocessing unchanged evidence returns byte-identical
classifications at near-zero cost; a prompt or model version bump becomes an explicit,
budgeted, auditable reprocessing event rather than silent drift; and any classification
in the system can be replayed and explained months later.

The gateway never performs retrieval and never receives a URL to fetch. Retrieval is
ADR 0002's job. This keeps `03`'s "models may not serve as the primary retrieval
mechanism" true structurally rather than by convention.

## Alternatives considered

- **Direct provider SDK calls from each processing module.** Rejected: no central audit,
  no reproducibility, credentials spread across modules, and no way to bound cost.
- **Determinism through temperature 0 alone.** Rejected: not actually deterministic
  across provider-side updates, which is precisely the case that matters.
- **Caching keyed on prompt text.** Rejected: a whitespace edit invalidates the world.
  Versioned prompt identity is the stable key.

## Consequences

Good: reproducibility, cost control, one place to swap providers, and a schema-violation
rate that acts as an early warning when provider behavior changes.

Bad: cache storage grows with the evidence corpus; a prompt-version bump can trigger a
large reprocessing bill that must be planned; and the cache must be invalidated
correctly when a schema changes, or stale-shaped outputs leak forward.

## Revisit when

A task genuinely requires non-deterministic sampling (none in the current design does),
or cache storage cost exceeds the inference cost it avoids.
