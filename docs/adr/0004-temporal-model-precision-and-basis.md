# ADR 0004 — Dates are intervals with precision and basis

**Status: Accepted** · **Approved via:** D15 (ahead of Gate G-4) · **Relates to:** C2, D15
**Supersedes:** the narrower "date precision" formulation in response v0.1

## Context

`README.md` lists as non-negotiable: "Missing dates must remain missing. The platform
cannot invent dates." `00` repeats it: "Never infer a precise date where the source
provides none."

`schemas/database.sql` types `evidence.event_date` and `signals.event_date` as `date`,
and `facilities.opened_at` / `closed_at` likewise. A source that says "production is
expected to begin in 2027" or "in the second half of next year" cannot be stored. The
implementer facing that row has two options: write `2027-01-01`, fabricating a date the
source never gave, or drop the signal, discarding real evidence. Both violate a stated
non-negotiable.

This is not hypothetical. Capital-project reporting is dominated by imprecise
forward-looking timing, which is exactly the timing the product exists to detect early.

The v0.1 version of this ADR proposed a precision label alongside a single date. That is
still not enough, for two reasons. A point plus a label still tempts every consumer to
read the point. And it cannot record *who decided* the timing — the source, or us.

## Decision

Six fields replace one, on `evidence`, `signals`, and facility open/close dates:

```
temporal_raw_expression  text   -- verbatim: "in the second half of 2027"
temporal_start           date   -- interval start, not "the date"
temporal_end             date   -- interval end
temporal_precision       enum   -- exact_day | month | quarter | season
                                -- | half_year | year | range | relative | unknown
temporal_basis           enum   -- stated | inferred | unknown
temporal_inference_note  text   -- REQUIRED when basis = 'inferred'
```

**Storing an interval is the part that does the work.** "In 2027" becomes
2027-01-01 → 2027-12-31 at `year` precision. The query "what might start in 2027?" is an
interval overlap, and the record answers it without ever claiming January 1.

**`season` was added by the external-research pass.** An external record stored
Unilever's "expected to be fully operational by **spring 2029**" as `2029-03-31` — a
fabricated month *and* day, and precisely the failure this ADR exists to prevent. Working
out how to store it correctly showed the enum was incomplete: "spring" is neither a
quarter nor a half-year, but a named period whose calendar boundaries are conventional and
hemisphere-dependent. It is stored as an interval with `precision = 'season'` and the raw
expression preserved, so the reader sees "spring 2029" rather than a boundary we chose.
See `14_EXTERNAL_RESEARCH_RECONCILIATION.md` §4.4.

**`relative` handles anchored timing** — "within eighteen months of closing" — where the
anchor is another event rather than a calendar position. The raw expression is preserved;
the interval is computed only once the anchor resolves.

**Basis makes inference visible.** Inference is permitted: deriving "H2 2027" from an
announced eighteen-month build starting mid-2026 is legitimate analysis. *Silent*
inference is not. When basis is `inferred`, the explanation is mandatory, and the
interface labels the date as an inference rather than a source fact.

Downstream rules follow. The UI renders "expected 2027", never "1 January 2027". Timing
and momentum scoring consumes interval width and basis, so a year-precision inferred date
cannot score like a stated, dated groundbreaking. Extraction prompts must return
precision and basis with any date, and a date without them fails schema validation at the
model gateway.

## Alternatives considered

- **Store the raw string alongside a parsed date.** Insufficient alone: it preserves the
  evidence but leaves every consumer to re-parse, and scoring still reads the fabricated
  day.
- **Store only what parses to a full date, drop the rest.** Discards the earliest and
  most valuable signals, which are the imprecise ones.
- **A single numeric `date_confidence`.** A number cannot tell the UI how to render, and
  cannot be inverted back into "Q3 2027".
- **Precision label on a single point date (the v0.1 proposal).** Better than nothing and
  still wrong: consumers read the point, and basis is unrepresentable.

## Consequences

Good: the non-negotiable becomes structurally true; early forward-looking signals are
capturable; horizon and timing scores stop being falsely precise; and a user pursuing a
project can see whether the date came from the company or from us.

Bad: every date comparison in queries and scoring must consider intervals and basis,
which is more code than `where event_date > x`. Retrofitting after signals exist means
reprocessing the entire corpus — which is why this belongs in Phase 1, before the first
signal is written, and why D15 is one of only two decisions flagged as urgent.

## Revisit when

Not expected. Any reversal must explain how a year-precision source statement is stored
without inventing a day, and how an inferred date is distinguished from a stated one.
