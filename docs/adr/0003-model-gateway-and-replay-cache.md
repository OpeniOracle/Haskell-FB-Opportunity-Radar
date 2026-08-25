# ADR 0003 — All model calls go through a gateway with a replay cache

**Status: Accepted** · **Approved via:** D2a — all AI model access routes through a single
controlled gateway. **The provider and model tier are not selected**; that is D2b/V1, open
by Openi platform engineering, with Openi commercial for data-processing terms
(see **ADR 0013**). · **Relates to:** D2a, D2b, ADR 0013

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

Critically, it maintains a **replay cache keyed by every effective input**. A cache hit
returns the stored output verbatim.

```text
replay_key = hash(
    content_hash,                -- the evidence bytes
    preprocessing_version,       -- extractor / OCR version that produced the text
    task,                        -- extract | classify | align | summarize | cluster
    provider, model,             -- provider-side identity
    model_parameters,            -- temperature, top_p, max_tokens, seed, tool config
    system_instructions_hash,    -- the system prompt itself, not just its label
    prompt_version,              -- the task prompt template version
    schema_version,              -- the output contract
    taxonomy_version,            -- sectors, capabilities, families, event types
    structured_context_digest    -- injected account / facility / prior-signal context
)
```

**An incomplete key is worse than no cache**, because it serves stale output as if it
were fresh. The v0.1 formulation of this ADR omitted preprocessing version, taxonomy
version, model parameters, system instructions, and injected context — all of which
change the output while leaving that narrower key unchanged.

`structured_context_digest` is the component most easily forgotten and the most
dangerous. Classification prompts include resolved account and facility context, so the
same article legitimately classifies differently once a facility resolves. Without it in
the key, the cache would pin the pre-resolution answer forever.

Each row stores the components as well as the hash, so a version bump can be scoped
precisely — "reprocess everything affected by taxonomy v3" is a query, not a full
recompute.

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
  Versioned prompt identity is the stable key — with the system prompt hashed separately,
  because it changes independently of the task template.
- **A narrower key (content + prompt version + model + schema version).** Rejected in the
  reconciliation pass: five further inputs change the output while leaving that key
  unchanged.

## Consequences

Good: reproducibility, cost control, one place to swap providers, and a schema-violation
rate that acts as an early warning when provider behavior changes.

Bad: cache storage grows with the evidence corpus; a prompt-version bump can trigger a
large reprocessing bill that must be planned; and the cache must be invalidated
correctly when a schema changes, or stale-shaped outputs leak forward.

## Revisit when

A task genuinely requires non-deterministic sampling (none in the current design does),
or cache storage cost exceeds the inference cost it avoids.
