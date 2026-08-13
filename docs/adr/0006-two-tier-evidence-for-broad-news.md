# ADR 0006 — Two-tier evidence resolves broad news discovery against the allowlist

**Status:** Proposed · **Ratified at:** Gate G-3 · **Relates to:** C5, D6, D7

## Context

`00` requires allowlisted HTTPS destinations with explicit redirect policies. `03`
simultaneously lists broad news discovery via GDELT as an initial source family, hourly.

These conflict. GDELT returns URLs from an open-ended set of publishers worldwide.
Fetching those article bodies means fetching arbitrary hosts, which is what the
allowlist exists to prevent — and it raises licensing questions, since most publisher
content is not ours to store or display.

Ignoring the conflict produces one of two bad outcomes: a de facto open crawler, or a
discovery source that is configured and then never usable.

## Decision

Evidence carries an `evidence_mode`:

- **`reference`** — metadata only: URL, title, publisher, publication time, and the
  snippet the discovery source itself provides. No fetch of the publisher and no stored
  body. Rendered as an attributed link. Reference evidence may raise a lead for review
  and may contribute to trend velocity, but **cannot by itself support corroborated or
  authoritative confidence**.
- **`full`** — full text stored and excerptable. Permitted only from a primary source
  (a company newsroom, a filing, a regulator), a reviewed and allowlisted trade
  publication, or a licensed feed.

Sources declare `license_mode` and `retention_days`; unknown licensing defaults to
reference mode. The database constraint enforces the rule rather than trusting the
connector: reference-mode evidence may not carry a raw-storage or extracted-text URI.

This also aligns with `02` §Corroboration rules. Syndicated copies of one press release
collapse into one evidence family no matter how many discovery rows point at them, so
breadth of discovery never inflates apparent corroboration.

## Alternatives considered

- **Fetch every discovered URL.** Rejected: violates the allowlist constraint and
  creates unresolved copyright and retention exposure.
- **Drop broad news discovery entirely.** Rejected: regional and trade reporting is
  where five of the fifteen pilot accounts — the ones with no SEC filings — are visible
  at all.
- **Allowlist publishers as they are encountered.** Rejected as the default path: it is
  an allowlist in name only. Publisher promotion to `full` is a deliberate, reviewed act.

## Consequences

Good: discovery breadth without an open crawler or unlicensed storage; corroboration
math stays honest; licensing posture is explicit per source and enforced in the schema.

Bad: some genuinely useful reporting stays link-only, so a real project may sit at a
lower confidence than a human reader would assign. That is the correct direction to be
wrong in, and D6 (licensed feed) is the remedy if it proves costly.

## Revisit when

A licensed business-news subscription is approved (D6), or a specific trade publication
is reviewed and promoted to `full` — which is a source-registry change, not a change to
this decision.
