# Sourced evidence fixtures — none yet

This directory is **reserved and intentionally empty**. It exists so that
sourced evidence and synthetic regression examples can never share a folder, a
manifest section, or a test run (decision D-R4).

Nothing may be added here until **all** of the following exist for the unit:

1. **Frozen source-span bytes** with `span_sha256` and `document_sha256` —
   bounded to the ADR 0014 "minimum supporting excerpt", never a whole page.
2. A **rights class** for the source (federal record, state/local public body,
   economic-development body, corporate, wire, other) — with state and local
   records defaulting to `reference_only` (decision D-R2).
3. **Two blind human labels** and an adjudicated label, with agreement recorded.
4. A **`status_as_of`** history, so a replay label is never mistaken for the
   current state of a project.

The 130 provisional research labels (`gold_reference.json` / `.csv`, single
analyst, model-assisted, unadjudicated, 128 of 130 locator-only) **must not be
copied here**. They are not verified ground truth and are not production data.
`regressionGuards.test.ts` fails if this directory holds anything but this file,
and fails if a research record identifier appears anywhere under `regression/`.

The checksum manifest (`../MANIFEST.json`) carries an empty `sourced` section
for the same reason: adding a sourced fixture means adding it to the manifest
deliberately, in a reviewed change.
