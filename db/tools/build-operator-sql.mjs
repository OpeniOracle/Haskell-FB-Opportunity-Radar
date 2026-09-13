/**
 * Build the Supabase SQL Editor operator file for migration 0021 from the
 * canonical migration, so the two cannot drift.
 *
 *   node db/tools/build-operator-sql.mjs          # write the file
 *   node db/tools/build-operator-sql.mjs --check  # fail if it is out of date
 *
 * WHY THIS FILE EXISTS AT ALL.
 *
 * `db/migrate.mjs` is the normal path and needs none of this: it opens one
 * psql session, runs the migration inside its own `begin; ... commit;`, and
 * records the ledger row. That path requires `SUPABASE_DB_URL` and a machine
 * with the pooler reachable.
 *
 * The Supabase SQL Editor is the fallback when neither is available, and it
 * has a property that makes a plain script unsafe: IT DOES NOT KEEP ONE
 * SESSION ACROSS THE STATEMENTS OF A SCRIPT. That was learned applying 0020,
 * when a temporary table created by one statement was already gone by the
 * next. The consequence people miss is the second-order one: if the session
 * does not survive, an explicit `begin; ... commit;` does not wrap the script
 * either, so a script that LOOKS atomic can commit its first half and fail on
 * its second -- leaving migration objects with no ledger row, which is the one
 * outcome a migration must never produce.
 *
 * So the whole thing is emitted as ONE `DO` block. A `DO` is a single
 * statement, and a single statement is one transaction no matter what the
 * client does with the script around it.
 *
 * WHY THE PAYLOAD IS INLINED AND NOT PUT THROUGH `EXECUTE`.
 *
 * The obvious shape -- `execute $mig$ ...the whole migration... $mig$` --
 * assumes one `EXECUTE` can run an arbitrary multi-statement migration. That
 * assumption is not one this file makes. PL/pgSQL runs an ordinary SQL
 * statement written directly in its body, utility statements included, so the
 * migration's own statements are inlined verbatim as PL/pgSQL statements and
 * there is no dynamic SQL anywhere in the generated file. Nothing is quoted,
 * re-escaped, or reassembled, which also means the payload in the operator
 * file is byte-identical to the canonical migration and a reviewer can diff
 * the two by eye.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const CANONICAL = join(ROOT, 'db/migrations/0021_live_source_ingestion.up.sql')
const GUARD_0020 = join(ROOT, 'db/migrations/0020_microsoft_identity_guard.up.sql')
const OUTPUT = join(ROOT, 'db/operator/0021_live_source_ingestion.operator.sql')

const VERSION = '0021'
const NAME = 'live_source_ingestion'
const TAG = '$operator_0021$'

/** Byte-for-byte the rule in db/migrate.mjs. Diverging would defeat the point. */
function checksum(text) {
  const normalised = text
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trimEnd())
    .filter((l) => l !== '')
    .join('\n')
  return createHash('sha256').update(normalised).digest('hex')
}

/**
 * Everything between the migration's own `begin;` and `commit;`.
 *
 * Those two lines are removed rather than kept, because transaction control is
 * not allowed inside a `DO` block and leaving them in would fail at runtime
 * with an error about the wrong thing entirely.
 */
function payloadOf(sql) {
  const lines = sql.split('\n')
  const first = lines.findIndex((l) => l.trim().toLowerCase() === 'begin;')
  const last = lines.map((l) => l.trim().toLowerCase()).lastIndexOf('commit;')
  if (first === -1) throw new Error('The canonical migration has no `begin;` line.')
  if (last === -1) throw new Error('The canonical migration has no `commit;` line.')
  if (last < first) throw new Error('`commit;` precedes `begin;`.')

  const body = lines.slice(first + 1, last)

  /*
     REFUSE TO GENERATE RATHER THAN GENERATE SOMETHING THAT FAILS IN THE
     DASHBOARD.

     Each of these is a real way the inlining approach stops being valid, and
     every one of them is silent until an operator runs the file against a
     production database. Cheaper to fail here.
  */
  const joined = body.join('\n')
  const stripped = joined
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n')

  if (stripped.includes('$')) {
    throw new Error(
      'The migration now contains a dollar sign, so a dollar-quoted wrapper may ' +
        'no longer be unambiguous. Choose a tag that cannot collide and re-check by hand.',
    )
  }
  if (/\b(begin|commit|rollback|savepoint)\b\s*;/i.test(stripped)) {
    throw new Error('The migration contains transaction control, which a DO block forbids.')
  }
  if (/\bconcurrently\b/i.test(stripped)) {
    throw new Error('CREATE INDEX CONCURRENTLY cannot run inside a transaction, so not here.')
  }
  if (/\bvacuum\b|\bcreate\s+database\b|\bcreate\s+tablespace\b/i.test(stripped)) {
    throw new Error('The migration contains a statement that cannot run inside a transaction.')
  }
  return body
}

const canonical = readFileSync(CANONICAL, 'utf8')
const sum = checksum(canonical)
const sum0020 = checksum(readFileSync(GUARD_0020, 'utf8'))
const payload = payloadOf(canonical)

const header = `\
-- =====================================================================
-- OPERATOR FILE -- migration ${VERSION} (${NAME})
--
-- GENERATED BY db/tools/build-operator-sql.mjs. DO NOT EDIT BY HAND.
-- Edit db/migrations/${VERSION}_${NAME}.up.sql and regenerate; CI fails if the
-- two drift apart.
--
-- HOW TO RUN IT
--
--   Supabase Dashboard -> SQL Editor -> paste this ENTIRE file -> Run.
--   Or: psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f <this file>
--
--   There is nothing to paste INTO it, nothing to substitute, and no section
--   left out. The whole migration is below.
--
-- WHAT IT GUARANTEES
--
--   It is ONE statement. A DO block is a single statement and therefore a
--   single transaction, whatever the client does with the script around it --
--   which matters because the Supabase SQL Editor does not keep one session
--   across the statements of a script, so an explicit begin/commit would NOT
--   wrap a multi-statement version of this file.
--
--   Either every object below exists AND the ledger row is recorded, or
--   neither is. There is no path that produces one without the other.
--
--   There is no dynamic SQL: the migration's statements are inlined verbatim
--   as PL/pgSQL statements, so the payload here is byte-identical to the
--   canonical migration.
--
-- WHAT IT REFUSES
--
--   Any line containing ABORT: means NOTHING WAS COMMITTED. The block refuses
--   if 0018 or 0020 is missing, if 0021 is already recorded, if the recorded
--   0020 checksum is not the expected one, or if the Microsoft identity guard
--   from 0020 is not present.
--
-- CHECKSUMS (whitespace-normalised per line, sha256 -- the rule db/migrate.mjs
-- uses, so a file applied this way verifies clean afterwards)
--
--   ${VERSION}  ${sum}
--   0020  ${sum0020}   (read, never modified)
-- =====================================================================

do ${TAG}
begin
    -- ------------------------------------------------------------ preconditions
    if to_regclass('public.schema_migrations') is null then
        raise exception 'ABORT: there is no schema_migrations ledger. This database has never been migrated by db/migrate.mjs.';
    end if;

    if exists (select 1 from public.schema_migrations where version = '${VERSION}') then
        raise exception 'ABORT: migration ${VERSION} is already recorded. Nothing to do.';
    end if;

    if not exists (select 1 from public.schema_migrations where version = '0018') then
        raise exception 'ABORT: migration 0018 is not present. This database is older than ${VERSION} expects.';
    end if;

    if not exists (select 1 from public.schema_migrations where version = '0020') then
        raise exception 'ABORT: migration 0020 is not present. Apply it first; the hosted order is 0018, 0020, ${VERSION}.';
    end if;

    -- 0020 IS READ HERE AND NEVER WRITTEN. ${VERSION} touches no auth object, and
    -- these two checks are the cheapest way to prove that afterwards: they
    -- establish the guard was intact BEFORE, so the identical checks at the end
    -- mean something.
    if not exists (
        select 1 from public.schema_migrations
        where version = '0020' and checksum = '${sum0020}'
    ) then
        raise exception 'ABORT: the recorded checksum for migration 0020 is not the expected value. Do not proceed; investigate the ledger first.';
    end if;

    if to_regproc('public.auth_guard_microsoft_identity') is null then
        raise exception 'ABORT: auth_guard_microsoft_identity is missing. Migration 0020 is recorded but its objects are not there.';
    end if;

-- >>>>>>>>>>>>>>>>>>>>>> CANONICAL PAYLOAD BEGINS <<<<<<<<<<<<<<<<<<<<<<
-- Verbatim from db/migrations/${VERSION}_${NAME}.up.sql, minus its own
-- begin;/commit; lines. Nothing else is changed. Diff it if you like.
${payload.join('\n')}
-- >>>>>>>>>>>>>>>>>>>>>>> CANONICAL PAYLOAD ENDS <<<<<<<<<<<<<<<<<<<<<<<

    -- ------------------------------------------------------------- ledger row
    -- Inside the same transaction as the payload. That is the whole design:
    -- objects without a ledger row, or a ledger row without objects, are both
    -- unreachable states.
    insert into public.schema_migrations (version, name, checksum, stamped)
    values ('${VERSION}', '${NAME}', '${sum}', false);

    -- ----------------------------------------------------------- postconditions
    -- Asserted, not assumed. A silent partial application is exactly what this
    -- file exists to make impossible, so it proves the result before returning.
    if to_regclass('public.source_document_cache') is null then
        raise exception 'ABORT: source_document_cache was not created.';
    end if;
    if to_regclass('public.evidence_current_document_uidx') is null then
        raise exception 'ABORT: evidence_current_document_uidx was not created.';
    end if;
    if to_regclass('public.evidence_document_lookup_idx') is null then
        raise exception 'ABORT: evidence_document_lookup_idx was not created.';
    end if;
    if to_regclass('public.evidence_last_seen_idx') is null then
        raise exception 'ABORT: evidence_last_seen_idx was not created.';
    end if;
    if to_regclass('public.signals_organization_cluster_uidx') is null then
        raise exception 'ABORT: signals_organization_cluster_uidx was not created.';
    end if;
    if to_regclass('public.opportunities_organization_key_uidx') is null then
        raise exception 'ABORT: opportunities_organization_key_uidx was not created.';
    end if;
    if to_regclass('public.source_runs_single_active_uidx') is null then
        raise exception 'ABORT: source_runs_single_active_uidx was not created.';
    end if;

    if (select count(*) from information_schema.columns
        where table_schema = 'public' and table_name = 'evidence'
          and column_name in ('source_document_id','document_revision','connector_id',
                              'connector_version','first_seen_at','last_seen_at',
                              'classification_status','review_status','superseded_at')) <> 9 then
        raise exception 'ABORT: the evidence columns are not all present.';
    end if;

    if (select count(*) from information_schema.columns
        where table_schema = 'public' and table_name = 'opportunities'
          and column_name in ('opportunity_key','derived_by','derived_at')) <> 3 then
        raise exception 'ABORT: the opportunities columns are not all present.';
    end if;

    if (select count(*) from information_schema.columns
        where table_schema = 'public' and table_name = 'sources'
          and column_name in ('connector_id','connector_config','last_success_at')) <> 3 then
        raise exception 'ABORT: the sources columns are not all present.';
    end if;

    -- The scoring columns must now admit null, or an unscored opportunity is
    -- impossible and the collector is forced to invent a number.
    if exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'opportunities'
          and column_name in ('haskell_fit','project_maturity','potential_scope',
                              'timing_momentum','raw_score','confidence_multiplier',
                              'final_score','why_it_matters')
          and is_nullable = 'NO'
    ) then
        raise exception 'ABORT: an opportunities scoring column is still NOT NULL.';
    end if;

    if (select count(*) from public.schema_migrations where version = '${VERSION}') <> 1 then
        raise exception 'ABORT: ${VERSION} is not recorded exactly once.';
    end if;

    -- 0020, unchanged, checked again now that ${VERSION} has run.
    if not exists (
        select 1 from public.schema_migrations
        where version = '0020' and checksum = '${sum0020}'
    ) then
        raise exception 'ABORT: the 0020 ledger row changed while ${VERSION} was applying.';
    end if;
    if to_regproc('public.auth_guard_microsoft_identity') is null then
        raise exception 'ABORT: auth_guard_microsoft_identity disappeared while ${VERSION} was applying.';
    end if;

    raise notice 'Migration ${VERSION} applied and recorded. 0020 and the Microsoft identity guard are intact.';
end
${TAG};
`

const check = process.argv.includes('--check')
if (check) {
  let existing
  try {
    existing = readFileSync(OUTPUT, 'utf8')
  } catch {
    console.error(`MISSING: ${OUTPUT} has never been generated.`)
    process.exit(1)
  }
  if (existing !== header) {
    console.error('DRIFT: db/operator/0021_live_source_ingestion.operator.sql does not match')
    console.error('the canonical migration it is generated from.')
    console.error('Run: node db/tools/build-operator-sql.mjs')
    process.exit(1)
  }
  console.log(`operator file matches the canonical migration (${VERSION} checksum ${sum})`)
} else {
  writeFileSync(OUTPUT, header)
  console.log(`wrote ${OUTPUT}`)
  console.log(`  ${VERSION} checksum ${sum}`)
  console.log(`  0020 checksum ${sum0020} (read only)`)
}
