# ADR 0004 — Dates carry explicit precision

**Status:** Proposed · **Ratified at:** Gate G-4 · **Relates to:** C2, D15

## Context

`README.md` lists as non-negotiable: "Missing dates must remain missing. The platform
cannot invent dates." `00` repeats it: "Never infer a precise date where the source
provides none."

`schemas/database.sql` types `evidence.event_date` and `signals.event_date` as `date`,
and `facilities.opened_at` / `closed_at` likewise. A source that says "production is
expected to begin in 2027" or "in the second half of next year" cannot be stored. An
implementer facing that row has exactly two options: write `2027-01-01`, which
fabricates a date the source never gave, or drop the signal, which discards real
evidence. Both violate a stated non-negotiable.

This is not a hypothetical. Capital-project reporting is dominated by imprecise
forward-looking timing, which is exactly the timing the product exists to detect early.

## Decision

Every date field that can originate from source text carries a precision:

```
event_date            date        -- start of the stated period
event_date_end        date        -- for ranges
event_date_precision  text        -- day | month | quarter | year | range | unknown
check (event_date is null or event_date_precision <> 'unknown')
```

Applied to `evidence`, `signals`, and facility open/close dates.

Downstream rules follow from it. The UI renders "expected 2027," never "January 1,
2027." The timing-and-momentum score consumes precision and widens its uncertainty
rather than treating a year-precision date as a day-precision one. Forecast-horizon
assignment uses the range, not the start. Extraction prompts are required to return
precision alongside any date, and a date without a precision fails schema validation at
the model gateway.

## Alternatives considered

- **Store the raw date string alongside the parsed date.** Rejected as insufficient
  alone: it preserves the evidence but leaves every consumer to re-parse, and scoring
  would still read the fabricated day.
- **Store only what parses to a full date, drop the rest.** Rejected: discards the
  earliest and most valuable signals, which are the imprecise ones.
- **A single `date_confidence` numeric.** Rejected: a number cannot tell the UI how to
  render, and a renderer cannot invert it back into "Q3 2027."

## Consequences

Good: the non-negotiable becomes structurally true; early forward-looking signals are
capturable; horizon and timing scores stop being falsely precise.

Bad: every date comparison in queries and scoring must consider precision, which is more
code than `where event_date > x`. Retrofitting after signals exist means reprocessing
the corpus — which is why this belongs in Phase 1, before the first signal is written.

## Revisit when

Not expected. If revisited, the reversal must explain how a year-precision source
statement is stored without inventing a day.
