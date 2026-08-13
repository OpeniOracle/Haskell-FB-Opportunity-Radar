# ADR 0010 — Operational health and intelligence coverage are separate metrics

**Status:** Proposed · **Ratified at:** Gates G-3 and G-6 · **Relates to:** C23, D17

## Context

`05` §Acceptance metrics lists automation, intelligence-quality, and user-value measures
in one undifferentiated block, and Phase 2 exit leads with "at least 95% of scheduled
connector runs complete successfully over a 14-day test window."

Nothing in the package prevents that number from being read as evidence that the market
is being covered. It is not. **A connector-success rate measures whether we collected
what we configured. It says nothing about whether we configured the right things.**

Source verification made the gap concrete rather than theoretical. Four of the fifteen
pilot accounts — Nestlé, Mars, Danone, and Niagara Bottling — have no periodic SEC filing
coverage, and a fifth, The Coca-Cola Company, has periodic coverage that does not reach
the bottling plants where its capital projects occur. For those accounts, every enabled
connector can report green while the account is effectively unmonitored, because the
sources that would carry their signals were never built.

That failure is invisible to every metric `05` currently defines. It looks like a quiet
quarter.

## Decision

Two independent metric families, with independent thresholds, both required at every exit
gate. Neither may substitute for the other.

**Family 1 — Operational health.** Connector execution success (logical runs ending
`success` / `unchanged` / `partial_success` over scheduled logical runs, retry attempts
excluded, `action_required` counted as failure); attempts per successful run; source
freshness against SLA; extraction completeness by method; operator-action rate; median
recovery time.

**Family 2 — Intelligence coverage.** Expected coverage completeness; discovery yield and
the share of accounts with zero signals; duplicate suppression; opportunity relevance via
dismissal reason codes; evidence-link availability; resolution accuracy.

Family 2 depends on one new object: **`account_source_expectations`**, a declared
statement per account of which source families *should* produce signal, seeded directly
from `docs/design/12_PILOT_SOURCE_COVERAGE_MATRIX.md`. Without it, "expected coverage" has
no denominator, and zero signals from Nestlé is indistinguishable from a quiet quarter.

The expectation vocabulary — `required`, `expected`, `optional`, `not_applicable` — also
solves the inverse problem. FDA food enforcement is declared `not_applicable` for Adjacent
Consumer Products accounts such as Kimberly-Clark and Procter & Gamble, so its silence is
correct rather than alarming, and those accounts are not penalized for a source that was
never going to fire.

**Reporting rule.** Pulse, the daily brief, and every exit review report the two families
side by side. An account with healthy connectors and no expected coverage is reported as
**uncovered**, never as quiet.

## Three refinements from the external-research pass

**Per-source cadence baselines, not a global window.** Each source declares an
`expected_cadence` and accumulates an observed `baseline_yield`; novelty anomalies are
evaluated against that source's own history. An adversarial review proposed a global
"new entities in 7 days below the historical P99" rule — rejected, because a fixed
seven-day window is meaningless for a board that posts quarterly, and a P99 band on a
low-count series is dominated by noise.

**Staleness must never mutate evidence strength.** The same review proposed pausing
"downstream confidence scoring for entities exclusively relying on a stale source." That
is the one thing coverage degradation must not do. A document retrieved and hashed six
months ago is exactly as true today as it was then; the source going quiet says nothing
about it. Staleness reduces **coverage assurance** in Family 2 and leaves
`evidence_strength` untouched. This is now an invariant, not an implication.

**An outbound-alert circuit breaker.** Neither family catches a *legitimate-looking*
flood: a classifier regression that inflates confidence produces alerts that are each
individually well-formed, correctly deduplicated, and wrong. When outbound volume exceeds
a multiple of its moving average, the notification queue is quarantined **before
delivery** and the inference version in use is pinned. Deduplication is not a defense
against this — it would deliver the storm perfectly.

## Alternatives considered

- **Keep the single acceptance-metric block.** Permits the most likely silent failure in
  the pilot, and permits it to be reported as success.
- **Measure coverage qualitatively — ask users whether they feel covered.** Useful as a
  supplement, unfalsifiable as a gate, and the first thing to degrade under delivery
  pressure.
- **Infer coverage from signal volume alone.** Confuses a genuinely quiet account with an
  unmonitored one, which is the exact distinction the platform exists to make. It also
  rewards noisy sources.
- **Define expectations automatically from what sources exist.** Circular: the denominator
  would be derived from the numerator, and a missing connector would define itself out of
  the measurement.

## Consequences

Good: the pilot's most likely silent failure becomes visible and reportable; coverage gaps
are attributable to specific accounts and source families rather than felt as vague
dissatisfaction; and the expectation table doubles as the Phase 2 build plan, since a
`required` expectation with no enabled source is a backlog item.

Bad: expectations must be authored and maintained by hand — roughly 15 accounts × 10
source families for the pilot — and they are a judgment call, so a wrong expectation
produces a wrong metric. They also need review whenever an account's structure changes,
which for this cohort is often (ADR 0005, D18).

## Revisit when

Expectation maintenance becomes the dominant cost of adding an account, or two consecutive
phases show expected-coverage and discovery-yield moving together closely enough that one
is redundant.
