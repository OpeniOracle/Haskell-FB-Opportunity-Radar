# ADR 0016 — The first cohort's backfill window is twelve months

**Status:** Accepted
**Date:** 2026-08-27
**Applies to:** Tyson Foods, PepsiCo, Mars — the first live-data cohort

## Context

The Radar's scheduled collector takes a one-day window. The first run against a
new source has no history behind it, so it needs a window that reaches back far
enough to be useful on the day it is switched on, and not so far that it asks a
fair-access source for a decade in a single invocation.

No backfill depth was documented anywhere in the design package. The only prior
occurrence of the word "backfill" in `docs/` is incidental prose in ADR 0014.
This ADR records the decision rather than leaving it to whoever types the
command.

## Decision

**Twelve months**, ending at the start of tomorrow (UTC), for the first run of
each source in the first cohort.

`admin-run` accepts `windowDays` and bounds it at 400, which is twelve months
plus room for a re-run that spans a leap day and a timezone edge without being
able to become "five years" through a mistyped digit.

## Why twelve months

**It covers a full reporting cycle.** A 10-K, four 10-Qs and the 8-Ks between
them are one year of a public company's disclosure. A shorter window can miss
the annual filing entirely, which is the one that discusses properties and
capital expenditure at length.

**It is proportionate to what the sources will serve.** For two large filers
this is a few hundred documents, not tens of thousands — a scale SEC's guidance
comfortably accommodates at the pacing the connector uses.

**It matches how the output is used.** A facilities lead announced two years ago
has either broken ground or been abandoned; either way it is not a
business-development signal today. Reaching further back would add records that
an analyst would have to age out by hand.

## What we are accepting

A project announced thirteen months ago and still live will not appear until
someone runs a wider window deliberately. That is a real gap, and the mitigation
is that widening it is a parameter rather than a code change — the operator can
run `-WindowDays 400` once and see what falls in.

## Alternatives considered

**Everything EDGAR holds.** Rejected: decades of filings, almost all of them
irrelevant to a facilities radar, fetched from a source that asks callers to be
proportionate. The cost is real and the marginal signal approaches zero.

**Ninety days.** Rejected: it misses the annual report for three quarters of the
year, which is where the property and capital-expenditure discussion lives.

**Per-source windows.** Rejected for the first cohort as unnecessary complexity.
Mars publishes far less than either filer, so the same window costs nothing
there; if that changes, `windowDays` is already per-invocation.

## Consequences

- The runbook's backfill step names 365 days explicitly.
- `MAX_WINDOW_DAYS = 400` in `admin-run.ts` is the enforced ceiling.
- The schedule remains one day. This ADR is about the FIRST run, not the cadence.
