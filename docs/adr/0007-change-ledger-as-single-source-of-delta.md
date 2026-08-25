# ADR 0007 — One change ledger powers Pulse, alerts, and briefs

**Status:** Proposed · **Ratified at:** Gate G-4 · **Relates to:** C7, C17

## Context

Four requirements in the package are the same requirement wearing different clothes:

- `04` §Pulse — "Changes since the user's last visit."
- `04` §Opportunity card — "Material change summary."
- `04` §Alerts — "The same signal should not generate repeated alerts unless a material
  change occurs."
- `04` §Briefings — daily and weekly briefs generated automatically from stored data.

The v0.1 model offers only `opportunities.last_material_change_at`, a timestamp. A
timestamp says *when* something changed, never *what*. Built independently, these four
features grow four separate diffing implementations that disagree about materiality —
and the disagreement surfaces to users as an alert for something Pulse does not show.

## Decision

A single append-only `change_events` ledger is the source of truth for every delta:

```
change_events(object_type, object_id, change_type, from_state, to_state,
              materiality, dedupe_key, occurred_at)
unique (object_type, object_id, dedupe_key)
```

Only the scoring and promotion engine and the classification pipeline write to it.
Everything downstream reads it: Pulse renders material events since `user_read_state`,
the card summary renders the latest material event, alerts fire from material events
and dedupe on `dedupe_key`, and briefs aggregate a window of them.

**Materiality is defined in one place**, versioned with the scoring config: stage
promotion or demotion, confidence change, status change, crossing a score band, first
facility resolution, a new independent evidence family, and negative-signal arrival are
material. Score drift within a band, re-observation of known evidence, and cosmetic
re-summarization are not.

Alert deduplication moves to the **recipient**, not the subscription (C7), on a key that
is non-null and self-sufficient:

```text
alert_dedupe_key = hash(recipient_key, delivery_channel, target_type, target_id,
                        material_change_fingerprint)

material_change_fingerprint = hash(change_type, from_state_digest, to_state_digest,
                                   scoring_version)
```

Each component earns its place. **Recipient** rather than subscription, so one user
matching an event through three saved views is told once. **Channel**, because an
immediate in-app notice now and an appearance in tomorrow's email digest are not
duplicates. (D4 as corrected: in-app in Phase 1, Openi-delivered email in a later
authorized phase, **Teams deferred and outside the pilot** — see ADR 0013.) **Scoring
version**, so a deliberate rescoring run may legitimately re-notify while an unchanged
recomputation may not.

The v0.1 schema keyed on `(subscription_id, material_change_key)` with `subscription_id`
nullable — and because `NULL` values are distinct in PostgreSQL, system-generated alerts
could duplicate without bound. Making the key non-null removes the hole rather than
patching it with a partial index.

## Alternatives considered

- **Per-feature diffing against timestamps.** Rejected: four implementations, four
  definitions of material, guaranteed drift.
- **Full row-version history and diff on read.** Rejected: heavier, and it still leaves
  materiality undefined — the hard part is deciding what counts, not storing versions.
- **Event sourcing the whole domain.** Rejected: far more machinery than the problem
  needs; the ledger records *decisions about change*, not every state transition.

## Consequences

Good: one definition of material, one dedupe key, cheap Pulse and brief queries, and an
auditable "why was I told about this" trail per alert.

Bad: the ledger grows monotonically and needs a retention or rollup policy. A bug in
materiality classification is felt in four surfaces at once — which is also the point:
it is fixed once.

## Revisit when

Ledger volume requires partitioning, or a surface needs a delta the materiality
vocabulary cannot express.
