# 23 — R2: the schema foundation

**Status:** Implemented in this change (migrations 0025 – 0030, contract tests, operator files, ADR 0017 *Proposed*). **Date:** 2026-10-16. **Hardened after owner review** (section 13): the fingerprint rollback refuses to discard hashes, and the source-rights rule requires a *documented* determination, not a licence flag.
**Implements:** roadmap R2 of docs 18, 19 and 20, decisions D-R1, D-R2 and D-R3.
**Not in scope, and not done:** R3 (classifier / derivation), R4 (dispatcher, worker, heartbeat), the market-event writer, any connector, any read-model or UI change, and **any application of these migrations to production**. **No migration has been run against any Supabase project.** Changes no accepted ADR.

---

## 1. What this adds, in one table

| Migration | Adds | Default for every existing row | Why |
|---|---|---|---|
| **0025** | `opportunities.review_state`, `.project_lifecycle`, `.commercial_qualification` + 5 constraints | `unreviewed`, `unknown`, `not_assessed` | D-R1, D-R3: a machine-derived candidate is never shown as confirmed, qualified or pursuit-ready; a completed project stays searchable without reading as something to sell into |
| **0026** | `sources.rights_class` + 2 constraints | `unclassified` | D-R2 / ADR 0017: state, local, economic-development and municipal records are `reference_only` until a rights determination is **documented** |
| **0027** | `signals.event_date_role` + 2 constraints | `NULL` (not recorded) | The date a signal carries must say what it *is*; a forecast is never a day |
| **0028** | `facility_identifiers` vocabulary + value check (2 constraints) | — (rows already conform, or the migration refuses) | A matching key must not fork on a misspelt system name |
| **0029** | `ingestion_tasks` (server-side work queue) | — (empty) | The queue R4 needs so a run that runs out of time can be continued, not restarted |
| **0030** | `evidence_text_fingerprints` (server-side) | — (empty) | The memory R3's recurring-disclosure suppression needs. **Its rollback refuses while it holds a fingerprint** |

DDL only. Nothing writes a row, nothing changes an existing value, and no stage, status, identifier, history row or foreign key is renamed, reinterpreted or removed.

## 2. One pull request, or a split?

The brief asks for a dependency-ordered split *before* implementing if the work is too large to review. It is not, for these reasons: the six migrations are independent of one another (no migration reads a column another adds), each is 40–150 lines of SQL with its own down file, and every one is reviewable alone. They are in dependency order and each is **independently revertible**, and the operator files apply and roll back all six as one transaction, so there is no partially-applied R2 to reason about.

If a reviewer would still rather have two, the natural seam is **A = 0025–0028** (columns and vocabulary, which unblock R3) and **B = 0029–0030** (the two new tables, which unblock R4 and R3's suppression). Nothing in A depends on B.

## 3. The existing database, and what it changed about the plan

The catalogue was read from a database with every migration applied (63 tables, **no views, no enums or domains**: vocabularies are `text` plus `CHECK`; RLS enabled on every table; one public trigger, on `auth_invite_allowlist`). The overlaps found, and the decision each forced:

| Proposed | Already exists | Decision |
|---|---|---|
| `evidence.origin_key` (docs 19, 20) | `evidence_families(family_key unique)` + `evidence.evidence_family_id` (0004, "groups records that describe the same underlying event"), **ADR 0006 rule 4** ("syndicated copies collapse into one evidence family before corroboration is counted") and **ADR 0009** ("count of independent evidence families") | **Not added.** A second key would be a second source of truth for the same fact. `family_key` *is* the origin key and `evidence_family_id` is already readable by the browser. R3 populates it. See O-1 |
| `ingestion_jobs` + `ingestion_tasks` (doc 18) | `source_runs`: one pass over one window of one source, with `run_status` (`pending / running / success / partial_success / unchanged / failure / skipped`), a window, checkpoint, counters, one active run per source (`source_runs_single_active_uidx`) and one run per window (`source_runs_logical_key`) | **Only `ingestion_tasks`.** A run *is* the job; a second job table would restate it under a competing status vocabulary. A task belongs to a run, and dispatch idempotence is the run's. See O-2 |
| `project_lifecycle` | `opportunities.project_maturity` is a 0–25 **score**; `stage` is how well we *know* the project; `status` is what *Haskell* is doing (and `closed_won/lost` are Haskell's outcome, not the project's) | New column, named `project_lifecycle`, never reusing `project_maturity`. No existing value reinterpreted. A completed project uses the existing `expired` status (interim, doc 19) |
| `review_state` | `opportunities.status` (`dismissed` …), `evidence.review_status` | New, per D-R1. It is a verdict on whether a *machine candidate is real*, orthogonal to `status` (what we do about a real one). Who/when stays in `audit_events` and `opportunity_status_history`, so no reviewer columns |
| `sources.rights_class` | `license_mode` (open / licensed / restricted / unknown), `access_mode` (ADR 0006), `data_sensitivity_class`, `retention_days`, **`terms_reviewed_at` and `license_notes`** (baseline columns, both nullable, never read by the application) | New, because it answers a different question: *what kind of publisher*. The **rule** between them is the point of 0026, and it is what makes the two existing documentation columns mean something |
| "source provenance" | `source_id`, `source_run_id`, `connector_id`, `connector_version`, `extractor_version`, `transformation_version`, `content_hash`, `original_url`, `resolved_url`, `retrieved_at`, `first/last_seen_at`; `source_run_attempts.http_status` | **Nothing added.** The one gap doc 19 names (per-retrieval HTTP status) is not a gap in practice: evidence rows exist only for successful retrievals, and failures are already in `source_run_attempts`. Fingerprints (0030) are the only provenance table R3 needs |
| `event_date_role` | `event_date`, `event_date_precision`, `event_date_basis` (ADR 0004); `evidence.temporal_*` | Added; the *meaning* of the date is the missing fact |
| facility identifier vocabulary | `facility_identifiers.identifier_system` is free text, unique on `(system, value)` | A `CHECK` vocabulary (0028) |
| doc 18's `account_source_coverage_v`, `opportunity_card_v`, `source_health_v` | none (no views exist) | **Not in this PR.** They replace the 1,000-row read (doc 21 §9) and belong with the UI switch (roadmap R9); the brief's list does not include them |
| `qualified_by`, `qualified_at`, `basis` (doc 19) | `audit_events` (actor, action, before/after state, reason) | **Not added** — D-R1's own reasoning applies: who and when are audit facts. See O-5 |
| `signals.suppression_reason` (doc 19) | `signals.model_metadata` | **Not added**: it is R3's to design and is not in the brief |

## 4. The migrations

### 0025 — review, lifecycle, qualification

`review_state ∈ {unreviewed, accepted, rejected}`; `project_lifecycle ∈ {announced, approved, under_construction, completed, cancelled, withdrawn, historical, unknown}`; `commercial_qualification ∈ {not_assessed, no_open_work, open_work_unverified, qualified}`. Each `NOT NULL` with a constant default (PostgreSQL stores it as catalogue metadata; no table rewrite).

Two cross-column rules make the requirements *expressible only one way*:

* **`opportunities_assessment_requires_review`** — `commercial_qualification` may leave `not_assessed` only on an `accepted` row. A pipeline write cannot make anything qualified: it creates `unreviewed` rows (the default) and the test suite proves the pipeline names none of these columns.
* **`opportunities_ended_project_is_not_active`** — `completed | cancelled | withdrawn | historical` projects must hold a terminal status (`dismissed | closed_won | closed_lost | cancelled | expired`) and be at most `no_open_work`. They stay in the table, searchable and filterable, and cannot read as active. A later phase of a completed project is a *separate* opportunity row.

Default for analyst-created rows: doc 20 proposes `accepted` when `derived_by IS NULL`. A column default cannot depend on another column and a migration may not write rows, so the default is the **safe** one; an analyst path sets `accepted` explicitly, and accepting any *existing* analyst row is a reviewed data step (§7), not a migration.

### 0026 — rights class

`rights_class ∈ {federal_public_record, state_local_public_record, economic_development_body, corporate_first_party, discovery_or_republication, unclassified}`. One rule, **`sources_archive_requires_established_rights`**: a source is a federal public record, **or** reference-only / metadata-only, **or** has **documented** a rights determination, meaning all three of

* `license_mode` is `open` or `licensed` (`unknown`, the default, and `restricted` are neither),
* `terms_reviewed_at` is not null, and
* `license_notes` contains a non-blank character.

So a state, municipal, EDO, corporate or unclassified source cannot be put into full-text archiving by a typo, a hurried seed, or **setting one licence flag**; establishing rights is a recorded act. ADR 0017 (**Proposed**) states the policy and the constraint implements it word for word. The reviewed seed `db/seed/0009` classifies the three pilot sources, touches only `unclassified` ones, and changes no access mode.

**What the schema could and could not support.** Both documentation columns exist since the baseline schema, are nullable `timestamptz` / `text`, and are read by nothing in the application, so requiring them breaks no code. The constraint proves the determination was *recorded* (a date and a note exist). It cannot prove the note is true, names a competent reviewer, or that the date is real, and there is no reviewer column (O-5's reasoning: who and when are audit facts). A minimum note length would be a number picked from the air, so none is enforced. Two details matter: `NULL` is the trap (a bare `license_notes ~ '\S'` is `NULL` for a `NULL` note and a `CHECK` accepts `NULL`, so the constraint coalesces the note and tests the date with `IS NOT NULL`, and a case proves a `NULL` note is refused), and the check uses `\S`, so a note of spaces, tabs and newlines is refused.

**Existing rows, and the one place this bites.** When 0026 runs, every source is still `unclassified`, because seed 0009 can only classify them *afterwards* (the column does not exist before). So for that one moment the pilot's federal sources are judged like any other source: they archive under ADR 0014 and declare `open`, so they must have documented it. Seed 0002 (which already declared them `open`) now also records the determination: `terms_reviewed_at` = **2026-08-26**, the date ADR 0014 was accepted for the pilot, and a note naming the ADR; seed 0006 does the same for `sec-edgar`'s note. The seed fills a blank date and **never overwrites a recorded one**. But a production database was seeded *before* that, and its two federal rows almost certainly hold a `NULL` review date, so **0026 will refuse them on first apply, atomically, naming both** (§7 has the preflight and the one-statement remedy). That is the rule working as the owner asked ("invalid existing records cause a clear, atomic refusal rather than being silently changed"); it is not a defect, but it is a step the operator must expect (O-11).

0026 carries its own guard so the refusal says *which sources and what each lacks* (`sec-edgar (terms_reviewed_at is empty)`), not only a constraint name. The guard is part of the migration, so the operator file inlines it and refuses with the same message; there is no second copy of the rule to drift.

### 0027 — event date role

`event_date_role ∈ {announcement, milestone, decision, effective, forecast}`, nullable, no default. **`signals_event_date_role_matches_date`**: `forecast` ⇔ no `event_date`; every other role requires one. A prediction can never be stored as a day (ADR 0004), and a role cannot float free of a date.

### 0028 — facility identifiers

`identifier_system ∈ {fsis_establishment_number, fsis_establishment_id, frs_registry_id, npdes_permit_id}` — the identifiers the roadmap's connectors produce (doc 18 §8.2, §11). The two FSIS systems are separate key spaces; which a connector writes is for R6 to confirm against the live directory. `identifier_value` must be non-empty and untrimmed. **No per-system format is enforced**: this environment cannot reach the registries, and a pattern written from memory that rejects a real identifier would break ingestion on first contact. RCRA, air permit, parcel, building permit, utility and corporate codes are **not** listed: no connector on the roadmap produces them.

### 0029 — `ingestion_tasks`

One unit of work inside a `source_runs` row. `status ∈ {pending, running, success, failure, skipped}` (the run vocabulary, minus the two whole-pass words). Constraints encode the protocol (§6 of the migration): a running task names its owner and heartbeat; a pending task carries no claim; a finished task has a completion time and an unfinished one does not; a failure names an error class; a heartbeat cannot predate its claim. `unique (source_run_id, task_key)` makes enqueueing idempotent. Two **partial** indexes serve the claim query (`pending`) and the stale-lease query (`running`). The claim is a compare-and-set `UPDATE … WHERE status = 'pending'`, so it works through PostgREST as the service role with no advisory locks; the suite proves that of two racing claims exactly one wins. **Server-side only:** RLS enabled *and* forced, every privilege revoked from `anon` and `authenticated`, no policy. It contains no dispatcher, no worker, and enqueues nothing.

### 0030 — `evidence_text_fingerprints`

`(organization_id, source_id, fingerprint char(64))` primary key, `first_evidence_id` (`ON DELETE SET NULL`, so suppression keeps working if the evidence is deleted under a retention rule), `first_seen_at`. The fingerprint must be 64 lower-case hex digits. Hashes only, never text. Server-side only, as 0029. How a sentence is normalised is R3's decision and is made once, in code.

**Rollback refuses while the table holds a row.** The first draft called the table a cache (drop it, recompute it from the stored documents). That is true only where the document was kept. For reference-only evidence the body was never stored, and `first_evidence_id` goes `NULL` when the evidence is deleted, so a hash may be the only trace a sentence was ever seen; once dropped it cannot be rebuilt, and years-old boilerplate would read as a fresh announcement again. So `0030_….down.sql` counts the rows and, if there are any, aborts naming the count (`evidence_text_fingerprints holds N fingerprint(s) …`), changing nothing. **It never deletes a fingerprint and never resets the table.** An empty table is dropped without ceremony. Because the generated operator rollback inlines each down file verbatim and reverses 0030 *first*, the atomic R2 rollback is protected by the same guard: nothing, including 0025–0029, is reverted if a fingerprint exists.

## 5. Compatibility with the application

* **Reads.** Every client read names its columns explicitly (`ORGANIZATION_COLUMNS`, `OPPORTUNITY_COLUMNS`, …) except `facilities`, which is untouched. Adding columns changes none of them, and the contract suite runs the interface's real queries as the `authenticated` role against a migrated, seeded database. No surface reads a new column; `app/src/test/r2SchemaFoundation.test.ts` asserts that no runtime file names any of them.
* **Writes.** The real `upsertOpportunity` runs against a recording client: an insert names none of the new columns (so the row is born `unreviewed` / `unknown` / `not_assessed`), and a refresh writes exactly `updated_at`, `last_material_change_at`, `derived_at`. The runner's health writes and the signal refresh succeed on a database migrated with R2 (`db/tests/r2-existing-rows.sh` §4).
* **Existing rows.** Built as production is (migrated to 0024, seeded, then filled with older rows), R2 applies and **a hash of every pre-existing column of every pre-existing row is identical** before and after, row counts are unchanged, and no access mode or licence moves.
* **Rolling back** from that state restores the same hash and the same ledger.
* **One existing fixture changed.** `db/tests/remediation-2026-10.sh` modelled "a registry that disagrees with ADR 0014" as Mars archived with an unknown licence. Since 0026 the database itself refuses that row, so the fixture now models the disagreement as archived, declared open *and reviewed* (Mars already carries a licence note from its seed). The test still proves what it proves; the change is the new rule working.
* **Two seeds changed, both data, both idempotent.** `0002_pilot_sources.sql` records the ADR 0014 determination for the two federal sources (`terms_reviewed_at`, a note) so a fresh database satisfies 0026 when it is seeded, and `0006` names the ADR in `sec-edgar`'s note. Neither touches an access mode or a licence mode, neither overwrites a review date that is already recorded, and both columns are in the baseline schema, so the seeds still run on a database that has not had R2 applied.

## 6. RLS and grants

| Object | Posture after R2 | Why |
|---|---|---|
| `opportunities` (column-level grants, 0015/0022) | `review_state`, `project_lifecycle`, `commercial_qualification` **granted** to `authenticated`, in 0025, in the same transaction | They are the inputs to the display rule that separates the research area from the pursuit workspace; they carry no private content. A column grant does not reach a later column (0021 failed exactly this way until 0022), so it is explicit |
| `opportunities.derived_by`, `derived_at`, `opportunity_key`, `account_strategy` | **still withheld**; asserted | unchanged |
| `sources` (column-level) | `rights_class` **granted** (a policy label, not configuration); `connector_id`, `connector_config`, `query_scope`, `extraction_config`, `retry_policy`, `operator_intervention` **still withheld**; asserted | |
| `signals` (table-level) | `event_date_role` covered by the existing grant; asserted readable | a table-level grant reaches later columns |
| `facility_identifiers` (table-level) | unchanged | |
| `evidence` | unchanged: `body_text`, `archive_uri`, `raw_storage_uri`, `extracted_text_uri` **still withheld**; asserted | private evidence fields stay private |
| `ingestion_tasks`, `evidence_text_fingerprints` | RLS **enabled and forced**, **no policy**, all privileges revoked from `anon` and `authenticated` | server-side only, like `source_document_cache` (0021) and `geocode_cache` (0023); `service_role` bypasses RLS |

The existing global cases ("every table has RLS", "anon reads nothing", "authenticated writes nothing") cover the new tables automatically; `db/tests/client-column-grants.sh` and the `r2 browser grants` group add the column-by-column assertions, including that no browser role gained a write privilege anywhere R2 touched.

## 7. Deployment and rollback — operator-controlled

**Nothing here is applied by a merge, a deploy or any function.** Netlify deploys the application only; `db/migrate.mjs` and the files below are run by an operator holding separate written authorization. Only the apply file is meant for production; `db/migrate.mjs up` is the CI and local path.

### Files

| File | Purpose |
|---|---|
| `db/operator/r2_schema_foundation.operator.sql` | applies 0025–0030 as **one statement** |
| `db/operator/r2_schema_foundation.rollback.operator.sql` | reverses all six as one statement |
| `db/seed/0009_source_rights_classes.sql` | data step: classifies the three pilot sources |

Both operator files are **generated** from the canonical migrations (`db/tools/build-r2-operator-sql.mjs`) and CI fails on drift. Each is a single `DO` block, so it is one transaction however the SQL Editor handles the script (it does not keep a session across statements): **all six changes and all six ledger rows exist afterwards, or none do.** The payload is the migration text inlined verbatim, with no dynamic SQL, and the ledger checksums are the ones `db/migrate.mjs verify` computes, so a database migrated this way verifies clean.

### Procedure

1. **Preflight (read-only).** Run these; all but the first must return zero rows.

   ```sql
   select max(version) from schema_migrations;                           -- 0024
   -- sources 0026 would refuse: archiving without a documented determination.
   -- Before R2 every source is unclassified, so no class is consulted.
   select id, access_mode, license_mode,
          terms_reviewed_at is not null as has_review_date,
          coalesce(license_notes, '') ~ '\S' as has_note
     from sources
    where access_mode not in ('reference_only','metadata_only')
      and not (license_mode in ('open','licensed')
               and terms_reviewed_at is not null
               and coalesce(license_notes, '') ~ '\S');
   select id, identifier_system, identifier_value from facility_identifiers   -- rows 0028 would refuse
    where identifier_system not in ('fsis_establishment_number','fsis_establishment_id','frs_registry_id','npdes_permit_id')
       or identifier_value = '' or identifier_value <> btrim(identifier_value);
   select count(*) from opportunities where derived_by is null;          -- analyst rows: expect 0 (see O-6)
   select (select count(*) from opportunities) o, (select count(*) from sources) s,
          (select count(*) from signals) g, (select count(*) from evidence) e;   -- record these
   ```

   The apply file refuses on the second and third itself, with an explanation, so a skipped preflight cannot do harm.

   **Expect the second query to list `fsis-mpi` and `sec-edgar`**, with `has_review_date = false`, on a database seeded before the determination was recorded (O-11). They are federal public records, but they are still `unclassified` until seed 0009 runs *after* R2, so the rule judges them on their documentation. Record it first, for those two sources and only where the date is blank (separately authorized; it changes no access mode):

   ```sql
   update sources
      set terms_reviewed_at = timestamptz '2026-08-26 00:00:00+00'   -- ADR 0014 accepted for the pilot
    where id in ('sec-edgar', 'fsis-mpi') and terms_reviewed_at is null;
   ```

   (Or choose the date the owner prefers; the rule needs only that one exists. `license_notes` is already non-blank on both. If it is not, record the determination there too.) Seeds `0002` then `0006`, in that order, do the same thing and refresh the notes. **Never run `0002` alone**: it sets `sec-edgar`'s endpoints to its own values, and `0006` is what reconciles them afterwards. Re-run the query: it must return no rows.
2. **When.** Outside the 06:00 UTC ingestion window. The file takes brief `ACCESS EXCLUSIVE` locks on `opportunities`, `sources`, `signals` and `facility_identifiers` while adding constraints (all small tables); a collector mid-run waits for them, it does not fail.
3. **Apply.** SQL Editor → paste the entire apply file → Run. Any line containing `ABORT:` means **nothing was committed**; it names what to fix.
4. **Verify.** `node db/migrate.mjs verify` (checksums), then re-run the record counts: unchanged. Every new column holds its default; the new tables are empty (the file asserts all of this before returning).
5. **Classify the pilot sources** (separately authorized): `node db/seed.mjs 0009`. It changes no access mode and never overrides a class that is already set.
6. **Analyst rows** (only if the preflight found any, separately authorized): `update opportunities set review_state = 'accepted' where derived_by is null;`. Never in a migration.

### Rollback

Paste `r2_schema_foundation.rollback.operator.sql`. It **refuses rather than destroy recorded work**: dropping a column or a table discards what is in it, so each down migration aborts, naming the count, if a person has recorded any review state, lifecycle or qualification (0025), a rights class (0026), an event date role (0027), a task still pending or running (0029), or **any recurring-disclosure fingerprint (0030)**. The fingerprint guard runs first, so a populated fingerprint table stops the whole rollback before anything else is reverted. To roll back past it on purpose, export the table, remove the rows deliberately, and run the file again. Export or deliberately reset what it names and run it again; it never forces. It also refuses if a later migration is recorded above 0030, or if all six are not recorded. Rolling back never touches an access mode, so nothing reference-only becomes archivable by it. After it, the ledger ends at 0024 and the schema is dump-for-dump the 0024 schema (tested).

If the apply file is the wrong tool (no SQL Editor access), `node db/migrate.mjs up` with `SUPABASE_DB_URL` applies the same migrations one transaction each; a refusal at 0028 then leaves 0025–0027 applied, which is consistent but is the state the operator file exists to avoid.

### Ordering against the unapplied R1 remediation

None. `remediation_2026_10_ingestion_integrity.operator.sql` corrects **evidence rows** (Mars bodies and modes) and a stalled run; the 0026 rule concerns the **sources registry**. `mars-newsroom` is reference-only and satisfies it as it stands. `sec-edgar` and `fsis-mpi` are open and archived and satisfy it **once their review date is recorded** (see the preflight above); the preflight proves it for the actual database before anything is applied.

## 8. Tests and results

Local run, **PostgreSQL 16.15** (`bash db/verify.sh`, the full CI contract): all stages pass — empty database forward/rollback; v0.1.0 baseline round trip **dump for dump**; schema-contract tests; seeds (twice); checksum drift detected; seed reconciliation; evidence and signal payloads; client column grants; run lifecycle; the 2026-10 remediation; **R2 on existing data**; **the R2 operator files**; the 0021 operator file.

* `db/tests/r2-cases.mjs` — **295 contract cases** in 7 groups (the source-rights group grew from 44 to 143: every non-federal class against every archiving mode, with the licence flag alone, a missing review date, a `NULL` note, a blank note, a restricted licence, a documented `open` and a documented `licensed` determination, reference-only and metadata-only, a federal source, and the `UPDATE` paths that document, un-document or reclassify a source), each negative case refused *by the constraint it names* (every other constraint on the statement is satisfied; two cases first failed for the wrong reason, one through PostgreSQL's unspecified evaluation order and one through `char(64)` refusing an over-long value before any check, and were corrected), each with a matching accepted case; defaults; the claim compare-and-set race; cascade and `SET NULL` behaviour; role-switched privilege cases.
* `db/tests/r2-existing-rows.sh` — production's shape, populated with older rows: byte-identical rows, defaults only, existing write paths, the browser's reads, the seed (idempotent, never overrides), exact round-trip restoration, **six refusals each tested at its own migration level** (the harness rolls back one migration at a time), **the fingerprint rollback with an empty table and with a populated one** (refused with the count, schema + rows + ledger byte-identical, a deeper rollback stops at 0030 and reverts nothing, and once the rows are removed deliberately the rollback proceeds), and the cases where existing rows violate a new rule and the migration refuses atomically, naming the rows, then applies once they are fixed: five source-rights shapes (unknown licence, no review date, `NULL` note, whitespace-only note, restricted), a reference-only source that needs nothing, a fully documented `licensed` source that is accepted unchanged, **and the pilot's two federal sources exactly as production holds them (no review date)**, refused by name and then applied after the date is recorded, with a recorded date never overwritten by the seed.
* `db/tests/operator-r2.sh` — operator files: payloads byte-identical to the canonical files; apply ≡ `migrate.mjs` (schema, ledger, checksums, privileges); `migrate verify` accepts it; repeat refused; data refusals (each source-rights shape, the pilot sources without a review date, and an identifier outside the vocabulary), after which **the same file applies once they are corrected**; **a failure in 0030 after 0025–0029 have run leaves nothing committed**; rollback ≡ never having been at R2 (with an empty fingerprint table); **a populated fingerprint table refuses the atomic rollback**; every refusal leaves the schema, the ledger **and the rows of every table the rollback would drop or empty** byte-identical.
* `db/tests/client-column-grants.sh` — extended (see §6).
* `app/src/test/r2SchemaFoundation.test.ts` — 11 cases (pipeline writes; no runtime file names an R2 column or table).
* Application suite, typecheck, lint, build, bundle guards and the boundary checks: see the pull request.
* **PostgreSQL 17 was not run locally** (no PGDG access and no Docker daemon in this environment). The CI matrix runs this same `db/verify.sh` on 16 and 17; that run is the evidence for 17. Nothing in these migrations is version-specific.

## 9. Production impact

**On merge: none.** No migration runs, nothing is deployed to the database, and the application neither reads nor writes any new object. **On apply:** no visible change to any surface; every existing row reads exactly as before; the browser gains read access to four non-sensitive columns and nothing else; the ingestion path is unchanged (and tested on the migrated schema); locks are brief on small tables. **Reversible** without loss until a person records something in a new column, at which point the rollback refuses rather than discards.

Real risks, each covered: a registry row that archives without a documented determination would make 0026 refuse (preflight; atomic refusal that names the source and what it lacks; **expected for `sec-edgar` and `fsis-mpi` on a database seeded before the determination was recorded, with a one-statement remedy in §7**); a facility identifier outside the vocabulary would make 0028 refuse (the same); the operator applying outside the intended order (the file checks 0024 and refuses a partial or repeated R2).

## 10. Can R3 begin?

**Yes, once 0025–0030 are applied to the database R3 will run against** — the schema work R3 depends on is done, and it is the *application* of the migrations (operator, authorized) that gates it, not their existence. What R3 can now rely on: an unreviewed / not-assessed default it must not override; a lifecycle that must be written together with a terminal `status` for a finished project; an `event_date_role` that must accompany every `event_date` and be `forecast` only with none; `evidence_families` as the origin key (R3 populates `evidence_family_id`); a server-side fingerprint table; and `rights_class` to decide, per source, whether archiving is even available. What R3 still has to decide for itself: the sentence normalisation and fingerprint algorithm, the origin-family key's composition, and the D16 questions it does not touch. **R4** can begin against 0029 independently (doc 19: R3 and R4 are parallelisable after R2). Neither is started here.

## 11. Decisions for the owner

| # | Decision | This PR's choice | Reversal |
|---|---|---|---|
| **O-1** | `evidence.origin_key` was named in docs 19/20 | **Not added**; `evidence_families.family_key` is the origin key (ADR 0006 rule 4, ADR 0009, 0004) | Add a column in a later migration if R3 shows a need the family table cannot meet |
| **O-2** | `ingestion_jobs` (doc 18) | **Not created**; `source_runs` is the job, `ingestion_tasks` its queue | A job table would be additive |
| **O-3** | `evidence_text_fingerprints` is not in the brief's list but is in docs 18/20's R2 and is R3's prerequisite | **Included** (small, server-side, independent) | Drop 0030, **after exporting the fingerprints**: the down file refuses while any exist, because they cannot be rebuilt for reference-only sources |
| **O-4** | `project_lifecycle` vocabulary (doc 20 left it to this PR) and the **ended-project rule** | doc 20's eight values; ended ⇒ terminal status and at most `no_open_work` | Replace the constraint in a migration |
| **O-5** | `qualified_by / qualified_at / basis` (doc 19) | **Not added**; `audit_events` records who and when, per D-R1's own reasoning | Add with the review queue (R12) if an audit row is judged insufficient |
| **O-6** | Existing analyst-created opportunities (`derived_by IS NULL`) | All rows start `unreviewed`; accepting analyst rows is a **separate data step** (§7.6) | — |
| **O-7** | **ADR 0017** (source-rights classes and the coupling rule) | Drafted, **Proposed**, not accepted; now states that "established" means *documented* and what the constraint can and cannot prove | Review it; the constraint implements it, and replacing the constraint is one migration |
| **O-8** | FSIS identifier systems (`fsis_establishment_number` and `fsis_establishment_id`) and **no format validation** | Two systems; formats deferred to a live sample | Widen or tighten in a migration with R6 |
| **O-9** | doc 18's three read views | **Not in this PR** | With R9 |
| **O-10** | Whether the browser should read the new columns now | **Granted** (inputs to the display rule), unused until R9 | Revoke in a migration; nothing reads them |
| **O-11** | The recorded determination for the two federal pilot sources | `terms_reviewed_at` = **2026-08-26** (ADR 0014's acceptance date) and a note naming the ADR, written by seeds 0002/0006 and, on production, by the one-statement remedy in §7. Blank dates only; a recorded date is never overwritten | Record a different date: the rule needs only that one exists. After seed 0009 classifies them as federal they no longer depend on it |
| **O-12** | How much the documented-determination rule enforces | Presence only: an `open`/`licensed` flag **and** a review date **and** a non-blank note. No minimum note length, no reviewer column | Add a reviewer column or a length floor in a migration if review shows presence is too weak; both are additive |

## 12. What this does not do

No classifier, derivation or scoring change; no worker, dispatcher or scheduler; no market-event writer; no connector, host or schedule; no read-model, view or surface change; no seed applied; no migration applied; no change to any stage, status, identifier, history row or foreign key; no new dependency.

## 13. Changes after owner review

The owner accepted the architecture and decisions O-1 to O-10 and asked for two corrections, made on the same branch:

1. **Fingerprint rollback is safe.** 0030's down file refuses, with a count and the reason, while `evidence_text_fingerprints` holds any row; it never deletes. The generated atomic rollback inherits the guard. Tests cover the empty and the populated table and prove schema, rows and ledger unchanged on refusal (§4, §8).
2. **ADR 0017 and migration 0026 agree.** The constraint requires a documented determination (`license_mode` open or licensed, `terms_reviewed_at`, `license_notes`), not a licence flag alone. The schema supports it. The one consequence for existing data (`sec-edgar`, `fsis-mpi`) is documented, tested and has a one-statement remedy (§3, §4, §7, O-11).

Everything else, including the migration set, numbering, defaults, grants and the proposed status of ADR 0017, is unchanged.
