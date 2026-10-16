# Synthetic regression harness (roadmap R1.5)

**Tests and diagnostics only. It changes no behaviour.** It imports the real
classifier, the real pipeline (`runConnectorPass`) and the real location
extractor, unmodified, and compares what they do with what a *correct*
derivation would do.

## What it is — and what it is not

| It is | It is not |
|---|---|
| A regression net for known failure modes, expressed as data | A measure of production precision, recall or accuracy — **no ratio is computed** |
| Fictional organisations, places and sentences (`.example` hosts) | Real evidence, real filings or any of the 130 research labels |
| A way to see, per dimension, what the pipeline gets wrong today | A reason to change the classifier in this PR |

## Layout

```
regression/
  README.md                          this file
  MANIFEST.json                      sha256 of every fixture file; `sourced` is empty
  synthetic-regression.report.json   the committed machine-readable diagnostic report
  harness.ts                         loaders, in-memory database, evaluation, report
  syntheticRegression.test.ts        one test per case, plus manifest and report checks
  regressionGuards.test.ts           fictional-only, no sourced data, no network, nothing in the bundle
  synthetic/                         SYNTHETIC fixtures: world, defect catalogue, cases.*.json
  sourced/                           RESERVED. Empty. See its README.
```

## How a case reads

Each case is a fictional document (or several) and the **intended** outcome,
asserted on **separate dimensions**:

| Dimension | Question |
|---|---|
| `signal` | Was the right signal recorded — or none, or an abstention? Reports `false_match`, `missed_signal`, `abstention_honored`, `abstention_violated` separately |
| `promotion` | Was an opportunity opened, or correctly not? `false_promotion` / `missed_promotion` |
| `eventDate` | Which `event_date` was written? |
| `independence` | How many independent sources were counted? |
| `cardinality` | How many signals and opportunities did one project produce? |
| `attribution` | Which organisation holds the opportunity? |
| `location` | Which places did the extractor return as the project site? |

`abstain` means the right behaviour is to hold for a human: no opportunity, and
nothing graded above `possible`. It is counted apart from correct-none.

## Known defects are pinned, not hidden

If the current code does not produce the intended outcome, the case lists
`knownDefects`: the defect id (from `synthetic/defects.json`) and the exact
dimensions that fail today. The test then asserts the code **still fails in
exactly that way** (a strict expected failure):

* CI stays green while a defect is open, and the defect is visible in the
  committed report.
* When a repair makes a pinned dimension pass, **that case turns red** with the
  instruction to retire the marker and regenerate the report. A fix cannot slip
  through unrecorded; a marker cannot outlive its defect.
* A failing dimension with **no** pinned defect fails the build.

## Adding or changing a case

1. Write the case in `synthetic/cases.<family>.json`. Use only fictional names
   and `.example` hosts. State the **intended** outcome, not what the code does.
2. Run `npm test -- src/test/regression`. If a dimension fails, decide whether
   the expectation or the code is wrong. Only if it is the code, add a
   `knownDefects` entry naming a defect from `defects.json` (add one if needed).
3. Regenerate the manifest and report, then review the diff:

   ```
   npm test -- src/test/regression -u
   ```

## Reading the report

`synthetic-regression.report.json` has a `summary` (counts of signal outcomes,
promotion outcomes, other dimensions and pinned defects) and one entry per case
with expected and observed values. Treat it as a map of **which intended
behaviours the code lacks**, never as a score.

## Provenance

The failure modes follow the taxonomy in the research reconciliation
(`docs/design/19_*` and `19a_*`, on the documentation branch
`claude/modest-fermi-eu1kn3`; not on `main`). Those documents are not required
to run or understand this harness.
