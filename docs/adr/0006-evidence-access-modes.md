# ADR 0006 — Five evidence access modes, with promotion rules

**Status:** Proposed · **Ratified at:** Gate G-2 (rules) and G-3 (licensing) ·
**Relates to:** C5, D6, D7, D19
**Supersedes:** the two-tier `full` / `reference` split in response v0.1

## Context

`00` requires allowlisted HTTPS destinations with explicit redirect policies. `03`
simultaneously lists broad news discovery via GDELT as an initial source family, hourly.

These conflict. GDELT returns URLs from an open-ended set of publishers worldwide.
Fetching those article bodies means fetching arbitrary hosts, which is what the allowlist
exists to prevent — and it raises licensing questions, since most publisher content is
not ours to store or display.

The v0.1 two-tier split (`full` vs `reference`) resolved the allowlist conflict but was
too coarse for the rest of the job. It could not distinguish structured records pulled
from an API from scraped article text, nor full text we own from full text we licence,
nor a link-with-snippet from a bare index entry that has no text at all.

## Decision

Evidence carries an **access mode**, and the mode caps how strong that evidence can be.

| Mode | Stored | Fetch behavior | Max evidence strength |
| --- | --- | --- | --- |
| `structured_primary` | Parsed records from an official API or filing, plus raw response | Direct, allowlisted | **authoritative** |
| `archived_full_text` | Full text and raw bytes, excerptable, locators preserved | Direct, allowlisted primary source or approved publisher | **authoritative** |
| `licensed_full_text` | Full text under licence; display and retention contract-bounded | Licensed feed or API | **authoritative** |
| `reference_only` | URL, title, publisher, timestamps, and the snippet the discovery source itself supplied. No body | **Publisher is never fetched** | **indicative** |
| `metadata_only` | Existence, identifiers, timestamps. No text | Index or listing only | **indicative** |

**Promotion rules — the enforceable half:**

1. `reference_only` and `metadata_only` evidence cannot raise evidence strength above
   `indicative`, however many such records agree.
2. An opportunity cannot enter the **Confirmed** stage without at least one supporting
   signal that is `authoritative` **and** `observed_fact` (ADR 0009) — which by rule 1
   requires a structured, archived, or licensed record.
3. Any number of `reference_only` records may raise momentum and trend velocity, and may
   create or sustain an Emerging opportunity. They may never, alone, promote one.
4. Syndicated copies collapse into one evidence family before corroboration is counted,
   so breadth of discovery never inflates apparent corroboration (`02`).

Enforcement is structural, in two places. The schema forbids reference and metadata modes
from carrying a raw-storage or extracted-text URI. And the egress gateway refuses to
fetch publisher URLs discovered inside a reference-mode payload — the connector cannot
fetch what the gateway will not open, so the rule cannot be bypassed under deadline
pressure.

Sources declare `license_mode` and `retention_days`; unknown licensing defaults to
reference-only.

## Alternatives considered

- **Fetch every discovered URL.** Violates the allowlist constraint and creates
  unresolved copyright and retention exposure.
- **Drop broad news discovery entirely.** Regional and trade reporting is where four of
  the fifteen pilot accounts — the ones with no periodic SEC filings — are visible at all.
- **Allowlist publishers as they are encountered.** An allowlist in name only. Promotion
  of a publisher to `archived_full_text` is a deliberate, reviewed source-registry change.
- **Keep the two-tier split.** Cannot express licensed content, cannot distinguish a
  structured API record from scraped prose, and gives no vocabulary for index-only
  sources.

## Consequences

Good: discovery breadth without an open crawler or unlicensed storage; corroboration math
stays honest; licensing posture is explicit per source and enforced in the schema; and the
platform's rate of becoming confident is a stated, reviewable policy rather than an
emergent property.

Bad: some genuinely useful reporting stays link-only, so a real project may sit at lower
confidence than a human reader would assign. That is the correct direction to be wrong in,
and D6 (a licensed feed) is the remedy if it proves costly. There is also a real
operational effect: GDELT can put a project on the Pulse within hours, and promotion may
wait days for the company, the regulator, or the permit office to publish.

## Revisit when

A licensed business-news subscription is approved (D6), or a specific trade publication is
reviewed and promoted to `archived_full_text` — which is a source-registry change, not a
change to this decision.
