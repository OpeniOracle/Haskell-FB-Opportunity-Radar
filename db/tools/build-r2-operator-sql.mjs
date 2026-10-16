/**
 * Build the Supabase SQL Editor operator files for the R2 schema foundation
 * (migrations 0025 - 0030) from the canonical migrations, so they cannot drift.
 *
 *   node db/tools/build-r2-operator-sql.mjs          # write both files
 *   node db/tools/build-r2-operator-sql.mjs --check  # fail if either is out of date
 *
 * TWO FILES, ONE EACH WAY:
 *
 *   db/operator/r2_schema_foundation.operator.sql           APPLY all six
 *   db/operator/r2_schema_foundation.rollback.operator.sql  ROLL BACK all six
 *
 * WHY ALL SIX IN ONE STATEMENT.
 *
 * `db/migrate.mjs` is the normal path and gives each migration its own
 * transaction, which is right for CI and means a failure at 0028 leaves 0025 -
 * 0027 applied. That is a consistent state but not the one an operator wants to
 * explain on a production database. These files are a single `DO` block: one
 * statement, therefore one transaction, however the SQL Editor handles the script
 * around it (it does not keep one session across statements, so an explicit
 * begin/commit would not wrap a multi-statement file). Either all six migrations
 * and all six ledger rows exist afterwards, or none do.
 *
 * WHY THE PAYLOAD IS INLINED, NEVER PASSED THROUGH EXECUTE.
 *
 * PL/pgSQL runs ordinary SQL written directly in its body, utility statements
 * included, so each migration's statements are inlined verbatim and there is no
 * dynamic SQL anywhere. The payload in the operator file is byte-identical to the
 * canonical migration, so a reviewer can diff the two by eye and CI does.
 *
 * THE PAYLOADS CONTAIN NESTED `DO` BLOCKS: each down migration refuses to
 * destroy recorded work, and 0026 refuses, naming the sources, to add its rule to
 * a registry that already breaks it. A `DO` inside a `DO` is valid PL/pgSQL, and
 * the outer block uses a tag that cannot collide with the inner `$$`. Because the
 * guards are PART OF THE CANONICAL MIGRATIONS they are inlined verbatim like
 * everything else, so the operator file refuses for exactly the reasons, and with
 * exactly the messages, that `db/migrate.mjs` does. There is no second copy of a
 * rule to drift.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const MIGRATIONS = join(ROOT, 'db/migrations')
const OUT_DIR = join(ROOT, 'db/operator')

const VERSIONS = ['0025', '0026', '0027', '0028', '0029', '0030']
const APPLY_FILE = join(OUT_DIR, 'r2_schema_foundation.operator.sql')
const ROLLBACK_FILE = join(OUT_DIR, 'r2_schema_foundation.rollback.operator.sql')
const APPLY_TAG = '$operator_r2$'
const ROLLBACK_TAG = '$operator_r2_rollback$'

/** Byte-for-byte the rule in db/migrate.mjs. Diverging would defeat the point. */
function checksum(text) {
  const normalised = text
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trimEnd())
    .filter((l) => l !== '')
    .join('\n')
  return createHash('sha256').update(normalised).digest('hex')
}

const files = readdirSync(MIGRATIONS)
const migrations = VERSIONS.map((version) => {
  const up = files.find((f) => f.startsWith(`${version}_`) && f.endsWith('.up.sql'))
  const down = files.find((f) => f.startsWith(`${version}_`) && f.endsWith('.down.sql'))
  if (!up || !down) throw new Error(`Migration ${version} is missing its up or down file.`)
  const name = up.slice(5, -'.up.sql'.length)
  const upSql = readFileSync(join(MIGRATIONS, up), 'utf8')
  const downSql = readFileSync(join(MIGRATIONS, down), 'utf8')
  return { version, name, up, down, upSql, downSql, sum: checksum(upSql) }
})

/**
 * Everything between a migration's own `begin;` and `commit;`, which are removed
 * because transaction control is not allowed inside a DO block.
 *
 * REFUSES to generate rather than generate something that fails in the
 * dashboard: each of these is a real way inlining stops being valid, and every
 * one is silent until an operator runs the file.
 */
function payloadOf(sql, label, { allowDollarQuotes }) {
  const lines = sql.split('\n')
  const first = lines.findIndex((l) => l.trim().toLowerCase() === 'begin;')
  const last = lines.map((l) => l.trim().toLowerCase()).lastIndexOf('commit;')
  if (first === -1) throw new Error(`${label} has no \`begin;\` line.`)
  if (last === -1) throw new Error(`${label} has no \`commit;\` line.`)
  if (last < first) throw new Error(`${label}: \`commit;\` precedes \`begin;\`.`)

  const body = lines.slice(first + 1, last)
  const stripped = body.map((l) => l.replace(/--.*$/, '')).join('\n')

  /*
     WHAT ACTUALLY BREAKS THE WRAPPER IS A DOLLAR-QUOTE DELIMITER, NOT A DOLLAR SIGN.

     A lone `$` is ordinary text (the end-of-string anchor in a regular
     expression, say) and cannot close an outer `$tag$` quote. What can is a
     delimiter: `$`, optional identifier characters, `$`. So the rule is exactly
     that. A migration may contain the anonymous `$$` of its own guard blocks,
     balanced, and nothing with a tag, so the wrapper's own tag can never be
     matched from inside.
  */
  const delimiters = stripped.match(/\$[A-Za-z_0-9]*\$/g) ?? []
  if (!allowDollarQuotes && delimiters.length > 0) {
    throw new Error(`${label} contains a dollar-quote delimiter (${delimiters[0]}); the wrapper's quoting may no longer be unambiguous.`)
  }
  if (allowDollarQuotes) {
    if (delimiters.some((d) => d !== '$$')) throw new Error(`${label} contains a dollar-quote tag other than $$.`)
    if (delimiters.length % 2 !== 0) throw new Error(`${label} has an unbalanced $$.`)
  }
  if (stripped.includes(APPLY_TAG) || stripped.includes(ROLLBACK_TAG)) {
    throw new Error(`${label} contains the wrapper's own tag.`)
  }
  if (/\b(begin|commit|rollback|savepoint)\b\s*;/i.test(stripped)) {
    // `begin` without a semicolon is PL/pgSQL's block opener and is fine; a
    // `begin;` or `commit;` statement is transaction control and is not.
    throw new Error(`${label} contains transaction control, which a DO block forbids.`)
  }
  if (/\bconcurrently\b/i.test(stripped)) throw new Error(`${label}: CREATE INDEX CONCURRENTLY cannot run in a transaction.`)
  if (/\bvacuum\b|\bcreate\s+database\b|\bcreate\s+tablespace\b/i.test(stripped)) {
    throw new Error(`${label} contains a statement that cannot run inside a transaction.`)
  }
  if (/\bexecute\b/i.test(stripped)) throw new Error(`${label} uses dynamic SQL, which these files promise not to.`)
  return body
}

for (const m of migrations) {
  m.upPayload = payloadOf(m.upSql, m.up, { allowDollarQuotes: true })
  m.downPayload = payloadOf(m.downSql, m.down, { allowDollarQuotes: true })
}

const NAMES = migrations.map((m) => `${m.version}  ${m.name}`).join('\n--   ')
const SUMS = migrations.map((m) => `--   ${m.version}  ${m.sum}`).join('\n')

/* ------------------------------------------------------------------ APPLY */

const applyHeader = `\
-- =====================================================================
-- OPERATOR FILE -- R2 schema foundation, migrations 0025 - 0030
--
-- GENERATED BY db/tools/build-r2-operator-sql.mjs. DO NOT EDIT BY HAND.
-- Edit the canonical migrations and regenerate; CI fails if they drift apart.
--
--   ${NAMES}
--
-- WHAT IT DOES, in one sentence per migration (docs/design/23 has the reasons):
--
--   0025  adds review_state, project_lifecycle and commercial_qualification to
--         opportunities, defaulting to unreviewed / unknown / not_assessed
--   0026  adds sources.rights_class, defaulting to unclassified, and the rule
--         that only a federal public record or a source that has DOCUMENTED a
--         rights determination (open or licensed, terms_reviewed_at and
--         license_notes) may be archived
--   0027  adds signals.event_date_role (NULL = not recorded)
--   0028  restricts facility_identifiers.identifier_system to a vocabulary
--   0029  creates ingestion_tasks, the server-side work queue for R4
--   0030  creates evidence_text_fingerprints, for recurring-disclosure suppression
--
-- WHAT IT DOES NOT DO: it writes no row, changes no existing value, renames or
-- removes no column, stage, status, identifier or foreign key, and touches no
-- grant it did not add. It is DDL only.
--
-- HOW TO RUN IT
--
--   Supabase Dashboard -> SQL Editor -> paste this ENTIRE file -> Run.
--   Or: psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f <this file>
--
--   There is nothing to paste INTO it and nothing to substitute. Run it OUTSIDE
--   the 06:00 UTC ingestion window: it takes brief exclusive locks on
--   opportunities, sources, signals and facility_identifiers while it adds
--   constraints, and a collector mid-run would simply wait for them.
--
-- WHAT IT GUARANTEES
--
--   It is ONE statement, therefore ONE transaction, whatever the client does
--   with the script around it. Either every change below AND all six ledger rows
--   exist afterwards, or none do. There is no path that produces one without the
--   other, and no path that applies some of the six.
--
-- WHAT IT REFUSES
--
--   Any line containing ABORT: means NOTHING WAS COMMITTED. It refuses if any of
--   the six is already recorded, if 0024 is missing, if a source already archives
--   without a documented rights determination (0026 names each source and what it
--   lacks), or if a facility identifier is outside the 0028 vocabulary. Each
--   message says what to fix.
--
--   BEFORE RUNNING IT, run the read-only preflight in docs/design/23 section 7. A
--   database whose pilot sources predate the seed that records their review date
--   will be refused at 0026, which is the rule working, not a fault.
--
-- ROLLING BACK
--
--   db/operator/r2_schema_foundation.rollback.operator.sql, which refuses
--   rather than discard anything a person has recorded since.
--
-- CHECKSUMS (whitespace-normalised per line, sha256 -- the rule db/migrate.mjs
-- uses, so a database migrated this way verifies clean afterwards)
--
${SUMS}
-- =====================================================================

do ${APPLY_TAG}
begin
    -- ------------------------------------------------------------ preconditions
    if to_regclass('public.schema_migrations') is null then
        raise exception 'ABORT: there is no schema_migrations ledger. This database has never been migrated by db/migrate.mjs.';
    end if;

    if not exists (select 1 from public.schema_migrations where version = '0024') then
        raise exception 'ABORT: migration 0024 is not present. R2 applies on top of 0024; apply the earlier migrations first.';
    end if;

    if exists (select 1 from public.schema_migrations where version in (${VERSIONS.map((v) => `'${v}'`).join(', ')})) then
        raise exception 'ABORT: at least one of migrations ${VERSIONS[0]} - ${VERSIONS[VERSIONS.length - 1]} is already recorded. This file applies all six or none; check the ledger before doing anything else.';
    end if;

    -- EXISTING ROWS THAT A NEW RULE WOULD REFUSE. The constraints would refuse
    -- them anyway and roll everything back, but with a constraint name. For 0026
    -- the migration carries its own guard (a source that archives without a
    -- documented rights determination is named, with what it lacks), inlined below
    -- with the rest of its payload. 0028 has no guard of its own, so it is checked
    -- here, before anything is attempted.
    --
    -- 0028: nothing writes facility_identifiers today, so this is expected to pass
    -- on an empty table.
    if exists (
        select 1 from public.facility_identifiers
         where identifier_system not in ('fsis_establishment_number', 'fsis_establishment_id',
                                         'frs_registry_id', 'npdes_permit_id')
            or identifier_value = ''
            or identifier_value <> btrim(identifier_value)
    ) then
        raise exception 'ABORT: % facility identifier row(s) fall outside the 0028 vocabulary or carry stray whitespace. Migration 0028 would refuse them. Correct or remove those rows deliberately and run this again.',
            (select count(*) from public.facility_identifiers
              where identifier_system not in ('fsis_establishment_number', 'fsis_establishment_id',
                                              'frs_registry_id', 'npdes_permit_id')
                 or identifier_value = ''
                 or identifier_value <> btrim(identifier_value));
    end if;

${migrations
  .map(
    (m) => `-- >>>>>>>>>>>>>>>>>>>>>> ${m.version} CANONICAL PAYLOAD BEGINS <<<<<<<<<<<<<<<<<<<<<<
-- Verbatim from db/migrations/${m.up}, minus its own begin;/commit;
-- lines. Nothing else is changed. Diff it if you like.
${m.upPayload.join('\n')}
-- >>>>>>>>>>>>>>>>>>>>>>> ${m.version} CANONICAL PAYLOAD ENDS <<<<<<<<<<<<<<<<<<<<<<

    -- ledger row ${m.version}, inside the same transaction as its payload.
    insert into public.schema_migrations (version, name, checksum, stamped)
    values ('${m.version}', '${m.name}', '${m.sum}', false);
`,
  )
  .join('\n')}
    -- ----------------------------------------------------------- postconditions
    -- Asserted, not assumed. A silent partial application is exactly what this
    -- file exists to make impossible, so it proves the result before returning.
    if (select count(*) from public.schema_migrations where version in (${VERSIONS.map((v) => `'${v}'`).join(', ')})) <> 6 then
        raise exception 'ABORT: the six ledger rows were not all recorded.';
    end if;

    if (select count(*) from information_schema.columns
         where table_schema = 'public'
           and ((table_name = 'opportunities' and column_name in ('review_state', 'project_lifecycle', 'commercial_qualification'))
             or (table_name = 'sources' and column_name = 'rights_class')
             or (table_name = 'signals' and column_name = 'event_date_role'))) <> 5 then
        raise exception 'ABORT: the five new columns are not all present.';
    end if;

    if to_regclass('public.ingestion_tasks') is null or to_regclass('public.evidence_text_fingerprints') is null then
        raise exception 'ABORT: a new table was not created.';
    end if;

    if (select count(*) from pg_constraint
         where conname in ('opportunities_review_state_check', 'opportunities_project_lifecycle_check',
                           'opportunities_commercial_qualification_check', 'opportunities_assessment_requires_review',
                           'opportunities_ended_project_is_not_active', 'sources_rights_class_check',
                           'sources_archive_requires_established_rights', 'signals_event_date_role_check',
                           'signals_event_date_role_matches_date', 'facility_identifiers_system_check',
                           'facility_identifiers_value_is_clean', 'evidence_text_fingerprints_is_sha256_hex')) <> 12 then
        raise exception 'ABORT: a constraint this migration set adds is missing.';
    end if;

    -- THE NEW SERVER-SIDE TABLES ARE LOCKED DOWN: RLS enabled AND forced, no
    -- policy, and no privilege held by the browser's roles.
    if exists (
        select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relname in ('ingestion_tasks', 'evidence_text_fingerprints')
           and not (c.relrowsecurity and c.relforcerowsecurity)
    ) then
        raise exception 'ABORT: row-level security is not enabled and forced on a new table.';
    end if;
    if exists (select 1 from pg_policies where tablename in ('ingestion_tasks', 'evidence_text_fingerprints')) then
        raise exception 'ABORT: a policy exists on a server-side table.';
    end if;
    if has_table_privilege('authenticated', 'public.ingestion_tasks', 'select')
       or has_table_privilege('anon', 'public.ingestion_tasks', 'select')
       or has_table_privilege('authenticated', 'public.evidence_text_fingerprints', 'select')
       or has_table_privilege('anon', 'public.evidence_text_fingerprints', 'select') then
        raise exception 'ABORT: a browser role can read a server-side table.';
    end if;

    -- THE BROWSER GRANTS ARE EXACTLY THE FOUR COLUMNS NAMED, and nothing that was
    -- withheld before has become readable. (Migration 0021 added columns and
    -- granted none; every page failed with 42501 until 0022.)
    if not (has_column_privilege('authenticated', 'public.opportunities', 'review_state', 'select')
        and has_column_privilege('authenticated', 'public.opportunities', 'project_lifecycle', 'select')
        and has_column_privilege('authenticated', 'public.opportunities', 'commercial_qualification', 'select')
        and has_column_privilege('authenticated', 'public.sources', 'rights_class', 'select')) then
        raise exception 'ABORT: the browser cannot read a column it was meant to be granted.';
    end if;
    if has_column_privilege('authenticated', 'public.opportunities', 'derived_by', 'select')
       or has_column_privilege('authenticated', 'public.opportunities', 'opportunity_key', 'select')
       or has_column_privilege('authenticated', 'public.opportunities', 'account_strategy', 'select')
       or has_column_privilege('authenticated', 'public.sources', 'connector_config', 'select')
       or has_column_privilege('authenticated', 'public.evidence', 'body_text', 'select')
       or has_column_privilege('authenticated', 'public.evidence', 'archive_uri', 'select') then
        raise exception 'ABORT: a column that was withheld from the browser became readable.';
    end if;

    -- NO ROW WAS WRITTEN AND NO EXISTING VALUE CHANGED: every new column holds
    -- only its default, and the new tables are empty.
    if exists (select 1 from public.opportunities
                where review_state <> 'unreviewed' or project_lifecycle <> 'unknown'
                   or commercial_qualification <> 'not_assessed') then
        raise exception 'ABORT: an opportunity carries a non-default review state, lifecycle or qualification.';
    end if;
    if exists (select 1 from public.sources where rights_class <> 'unclassified') then
        raise exception 'ABORT: a source was classified by the migration.';
    end if;
    if exists (select 1 from public.signals where event_date_role is not null) then
        raise exception 'ABORT: a signal was given an event date role.';
    end if;
    if exists (select 1 from public.ingestion_tasks) or exists (select 1 from public.evidence_text_fingerprints) then
        raise exception 'ABORT: a new table holds a row. These migrations write none.';
    end if;

    raise notice 'R2 schema foundation applied: migrations 0025 - 0030, one transaction. Next: the reviewed seed db/seed/0009_source_rights_classes.sql (classifies the three pilot sources; changes no access mode).';
end
${APPLY_TAG};

-- =====================================================================
-- AFTERWARDS (each only on its own authorization -- this file did none of it)
--
--   1. Classify the three pilot sources:
--        node db/seed.mjs 0009
--      or paste db/seed/0009_source_rights_classes.sql into the SQL Editor.
--      It touches only sources still 'unclassified' and changes no access mode.
--
--   2. If, and only if, the preflight in docs/design/23 found analyst-created
--      opportunities (derived_by IS NULL), accept them there. Never here.
--
--   3. Verify the ledger: node db/migrate.mjs verify
-- =====================================================================
`

/* --------------------------------------------------------------- ROLLBACK */

const reversed = [...migrations].reverse()

const rollbackHeader = `\
-- =====================================================================
-- OPERATOR FILE -- ROLLBACK of the R2 schema foundation, 0030 down to 0025
--
-- GENERATED BY db/tools/build-r2-operator-sql.mjs. DO NOT EDIT BY HAND.
--
-- Reverses db/operator/r2_schema_foundation.operator.sql, in reverse order, in
-- ONE statement and therefore ONE transaction: all six are rolled back and all
-- six ledger rows removed, or nothing is.
--
-- IT REFUSES TO DESTROY WORK. Dropping a column discards what is in it, so each
-- migration's own down file refuses -- with a message naming the count -- if a
-- person has recorded anything that rolling back would delete:
--
--   0030  any recurring-disclosure fingerprint (hashes of text that reference-only
--         evidence never kept, so they cannot be rebuilt; nothing is deleted)
--   0029  tasks that are still pending or running
--   0028  nothing (constraints hold no data)
--   0027  any signal carrying an event date role
--   0026  any source carrying a rights class
--   0025  any opportunity carrying a review state, lifecycle or qualification
--
-- A refusal means NOTHING WAS COMMITTED. Export or deliberately reset what it
-- names, and run this again. It never forces.
--
-- WHAT A ROLLBACK DOES NOT RESTORE: it removes the classification columns and the
-- rule that coupled rights_class to access_mode. It never touched an access mode,
-- so rolling back cannot make anything reference-only become archivable.
--
-- HOW TO RUN IT: Supabase Dashboard -> SQL Editor -> paste this ENTIRE file ->
-- Run. Or: psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f <this file>
-- =====================================================================

do ${ROLLBACK_TAG}
begin
    -- ------------------------------------------------------------ preconditions
    if to_regclass('public.schema_migrations') is null then
        raise exception 'ABORT: there is no schema_migrations ledger.';
    end if;

    if (select count(*) from public.schema_migrations where version in (${VERSIONS.map((v) => `'${v}'`).join(', ')})) <> 6 then
        raise exception 'ABORT: the six R2 migrations are not all recorded, so there is no complete R2 to roll back. Check the ledger first.';
    end if;

    if exists (select 1 from public.schema_migrations where version > '0030') then
        raise exception 'ABORT: a migration later than 0030 is recorded. Roll that back first; R2 is not the top of the ledger.';
    end if;

${reversed
  .map(
    (m) => `-- >>>>>>>>>>>>>>>>>>>>>> ${m.version} CANONICAL ROLLBACK BEGINS <<<<<<<<<<<<<<<<<<<<<<
-- Verbatim from db/migrations/${m.down}, minus its own begin;/commit;
-- lines. Nothing else is changed. Diff it if you like.
${m.downPayload.join('\n')}
-- >>>>>>>>>>>>>>>>>>>>>>> ${m.version} CANONICAL ROLLBACK ENDS <<<<<<<<<<<<<<<<<<<<<<<

    delete from public.schema_migrations where version = '${m.version}';
`,
  )
  .join('\n')}
    -- ----------------------------------------------------------- postconditions
    if exists (select 1 from public.schema_migrations where version in (${VERSIONS.map((v) => `'${v}'`).join(', ')})) then
        raise exception 'ABORT: a ledger row for an R2 migration remains.';
    end if;

    if exists (select 1 from information_schema.columns
                where table_schema = 'public'
                  and ((table_name = 'opportunities' and column_name in ('review_state', 'project_lifecycle', 'commercial_qualification'))
                    or (table_name = 'sources' and column_name = 'rights_class')
                    or (table_name = 'signals' and column_name = 'event_date_role'))) then
        raise exception 'ABORT: an R2 column remains.';
    end if;

    if to_regclass('public.ingestion_tasks') is not null or to_regclass('public.evidence_text_fingerprints') is not null then
        raise exception 'ABORT: an R2 table remains.';
    end if;

    if exists (select 1 from pg_constraint
                where conname in ('opportunities_assessment_requires_review', 'opportunities_ended_project_is_not_active',
                                  'sources_archive_requires_established_rights', 'signals_event_date_role_matches_date',
                                  'facility_identifiers_system_check', 'facility_identifiers_value_is_clean')) then
        raise exception 'ABORT: an R2 constraint remains.';
    end if;

    -- The pre-R2 database is what remains: 0024 is the top of the ledger.
    if (select max(version) from public.schema_migrations) <> '0024' then
        raise exception 'ABORT: the ledger does not end at 0024.';
    end if;

    raise notice 'R2 schema foundation rolled back: migrations 0030 - 0025, one transaction. The ledger ends at 0024.';
end
${ROLLBACK_TAG};
`

/* ------------------------------------------------------------------ output */

const outputs = [
  [APPLY_FILE, applyHeader],
  [ROLLBACK_FILE, rollbackHeader],
]

if (process.argv.includes('--check')) {
  let drift = false
  for (const [path, expected] of outputs) {
    let actual = null
    try {
      actual = readFileSync(path, 'utf8')
    } catch {
      /* missing */
    }
    if (actual !== expected) {
      console.error(`${path.replace(`${ROOT}/`, '')} is out of date. Run: node db/tools/build-r2-operator-sql.mjs`)
      drift = true
    }
  }
  if (drift) process.exit(1)
  console.log('the R2 operator files match the canonical migrations')
} else {
  for (const [path, text] of outputs) {
    writeFileSync(path, text)
    console.log(`wrote ${path.replace(`${ROOT}/`, '')}`)
  }
}
