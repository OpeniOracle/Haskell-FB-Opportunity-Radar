# ADR 0009 — Confidence is three questions, not one

**Status:** Proposed · **Ratified at:** Gate G-2 · **Relates to:** C4, D16
**Supersedes:** the "rename the confidence values" proposal in response v0.1

## Context

`02` defines a single confidence enum — Possible / Probable / Confirmed — and separately
defines an opportunity lifecycle whose third stage is also called Confirmed. Two problems
follow, and only the first is obvious.

**The naming collision.** "Confirmed / Possible" is a legal combination and an
incomprehensible one. Users and code will conflate a property of the project with a
property of our knowledge of it.

**The conflation underneath.** One enum is being asked to answer three independent
questions: how good is the underlying record, what kind of claim are we making from it,
and how sure are we overall. These come apart constantly. An SEC filing is authoritative;
our inference that a named capex allocation implies a plant project is not. A single enum
must either overstate the inference because the source is strong, or understate the
source because the inference is weak. **This is the most common route to a false
Confirmed**, and no rename fixes it.

## Decision

**The lifecycle is unchanged: Emerging → Developing → Confirmed.** It describes the
project — does one credible leading indicator exist, is it forming, or has an
authoritative source established it. It is a property of the world, and it stays the
plain-language vocabulary users already have.

Three fields replace the confidence enum, describing our *knowledge*:

| Field | Values | Question | Determined by |
| --- | --- | --- | --- |
| **Evidence strength** | `indicative` · `corroborated` · `authoritative` | How good is the record? | Deterministic rules over evidence: access mode (ADR 0006), source authority, count of independent evidence families and organizations |
| **Assessment type** | `observed_fact` · `inference` · `hypothesis` | What kind of claim is this? | The classifier, from whether the evidence states, indirectly supports, or merely suggests the claim |
| **Confidence level** | `low` · `moderate` · `high` | How sure are we overall? | Derived from the first two, plus corroboration, recency, and resolution confidence. Overridable with a reason |

**They do not overlap.** Evidence strength is a property of *documents* and can be
computed without reading the claim. Assessment type is a property of the *claim's
relationship to those documents*. Confidence level is the *composite*, and it is the only
one of the three that scoring consumes directly — which keeps the scoring formula in `02`
intact, with multipliers 0.60 / 0.80 / 1.00 keyed on low / moderate / high.

The combinations are the point:

- *authoritative + observed_fact + high* — the company announced it. Promote.
- *authoritative + inference + moderate* — the filing is unimpeachable, our reading of it
  is not. The combination a single enum cannot express.
- *indicative + hypothesis + low* — a lead. Real, worth watching, must never page anyone.
- *corroborated + observed_fact + high* — two independent publishers report the same
  stated fact. The workhorse.

**Guardrails, enforced in the schema.** Confidence level is capped at `moderate` when
assessment type is `inference`, and at `low` when it is `hypothesis`, regardless of
evidence strength — a strong source cannot launder a weak claim. And an opportunity
cannot reach the **Confirmed** stage without at least one supporting signal that is
`authoritative` + `observed_fact`.

## Alternatives considered

- **Keep the single enum.** Leaves both the collision and the conflation.
- **Rename the values only** (the v0.1 proposal: `single_source` / `corroborated` /
  `authoritative`). Fixes the collision, not the conflation — which is the more expensive
  of the two.
- **Rename the lifecycle stages instead.** Rejected: "Confirmed project" is the natural
  phrase for what that stage means, and `04` asks for plain language. Changing the
  user-facing word to protect an internal enum is the wrong trade.
- **A single numeric confidence score.** Loses explainability. `04` requires that scores
  never appear without their components, and the same logic applies here.

## Consequences

Good: the collision disappears; the authoritative-source-weak-inference case becomes
expressible and controllable; evidence strength can be computed deterministically and
audited without a model; and score explanations get materially more honest.

Bad: three columns instead of one, three values for a classifier to produce and validate,
and more UI surface to design — a card cannot show all three without clutter, so the
default display shows confidence level and reveals the other two on inspection. Reviewers
must also resist collapsing them back into one field for convenience.

## Revisit when

Usability testing shows users cannot distinguish the axes even on the detail page, or a
year of dismissal-reason data shows one axis carries no independent signal.
