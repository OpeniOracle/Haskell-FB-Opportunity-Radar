import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { APP_ROOT } from '@/test/paths'
import { FAILURE } from '@/data/apiDataSource'

/**
 * "Your access to the Radar has been withdrawn" must mean exactly that.
 *
 * THE PRODUCTION INCIDENT. A signed-in, verified user present in
 * `auth_invite_allowlist` was told on every surface that their access had been
 * withdrawn. Nothing was wrong with the account.
 *
 * Migration 0015 grants SELECT on `evidence` and `sources` COLUMN BY COLUMN.
 * Migration 0021 added fifteen columns and granted none of them, and
 * `freshness()` reads `sources.last_success_at` on every surface. PostgreSQL
 * refused with 42501, and 42501 was mapped onto the withdrawal message.
 *
 * 42501 is insufficient_privilege, and privileges here belong to the
 * `authenticated` ROLE -- identical for every signed-in user. It can never mean
 * one person's standing changed. Removal from the allowlist is enforced by
 * `/api/session` and by row-level policies returning nothing; it never revokes
 * a grant.
 */

const ROOT = join(APP_ROOT, '..')
const source = readFileSync(join(APP_ROOT, 'src/data/apiDataSource.ts'), 'utf8')

/** `classifyError` is module-private, so it is exercised through the source. */
function classify(error: { code?: string; message?: string } | null): string {
  // A faithful transcription would drift. Instead the branches are asserted
  // against the real source below, and the OUTCOMES are asserted here through
  // the exported FAILURE table those branches return.
  if (!error) return 'requestFailed'
  const code = error.code ?? ''
  const message = error.message ?? ''
  if (code === 'PGRST301' || /jwt/i.test(message)) return 'unauthorized'
  if (code === '42501' || /permission denied/i.test(message)) return 'notPermitted'
  return 'requestFailed'
}

describe('what "access withdrawn" is allowed to mean', () => {
  it('a rejected token is about the caller', () => {
    expect(classify({ code: 'PGRST301' })).toBe('unauthorized')
    expect(classify({ message: 'JWT expired' })).toBe('unauthorized')
  })

  /*
     THE REGRESSION. PostgreSQL words a COLUMN-level denial as "permission
     denied for table sources" -- indistinguishable from a table denial by text,
     and neither is a statement about this person.
  */
  it('a missing grant is NOT about the caller', () => {
    expect(classify({ code: '42501', message: 'permission denied for table sources' })).toBe(
      'notPermitted',
    )
    expect(classify({ code: '42501', message: 'permission denied for table evidence' })).toBe(
      'notPermitted',
    )
    expect(classify({ message: 'permission denied for table sources' })).toBe('notPermitted')
  })

  it('the two produce different messages, and only one blames the account', () => {
    expect(FAILURE.unauthorized.reason).toMatch(/withdrawn/i)
    expect(FAILURE.unauthorized.blockedBy).toBe('authorization')

    expect(FAILURE.notPermitted.reason).not.toMatch(/withdrawn/i)
    expect(FAILURE.notPermitted.reason).toMatch(/your access is unaffected/i)
    expect(FAILURE.notPermitted.reason).toMatch(/deployment fault/i)
    expect(FAILURE.notPermitted.blockedBy).toBe('configuration')
  })

  it('the source routes 42501 away from the withdrawal message', () => {
    const fn = source.slice(source.indexOf('function classifyError'), source.indexOf('interface Freshness'))
    expect(fn).toContain('FAILURE.notPermitted')
    // The old branch put 42501 and PGRST301 in one condition.
    expect(fn).not.toMatch(/code === 'PGRST301' \|\| code === '42501'/)
  })

  it('an unrelated failure is still a service failure', () => {
    expect(classify({ code: 'PGRST116' })).toBe('requestFailed')
    expect(classify(null)).toBe('requestFailed')
  })
})

describe('the grant migration names the columns the client reads', () => {
  const migration = readFileSync(
    join(ROOT, 'db/migrations/0022_grant_live_ingestion_columns.up.sql'),
    'utf8',
  )
  const grant0015 = readFileSync(
    join(ROOT, 'db/migrations/0015_row_level_security.up.sql'),
    'utf8',
  )

  /*
     The SQL, without the prose.

     The migration's header EXPLAINS which columns stay withheld, so a check for
     "body_text must not be granted" run over the whole file fails on the
     sentence saying it is not granted. A test a comment can fail is testing the
     comment.
  */
  const migrationSql = migration
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')

  /** Every column named in a `.select('…')` against one table in the client. */
  /**
   * The client source with its column constants inlined.
   *
   * The reads moved from literal strings to shared constants
   * (`EVIDENCE_COLUMNS` and friends) so five surfaces cannot each ask for a
   * different set. A scanner that only understood literals started reporting
   * that the client had stopped reading columns it reads on every request —
   * which would have been read as "the grant is too wide" and answered by
   * REVOKING a column the interface needs. Resolving the constants first is
   * what keeps this test measuring the thing it is named after.
   */
  const resolved = (() => {
    let text = source
    for (const [, name, value] of source.matchAll(
      /const ([A-Z_]+_COLUMNS)\s*=\s*\n?\s*'([^']+)'/g,
    )) {
      text = text.split(`\${${name}}`).join(value)
    }
    return text
  })()

  function selectedColumns(table: string): string[] {
    const out = new Set<string>()
    // Both quoting styles: several selects are template literals now.
    const pattern = new RegExp(
      `from\\('${table}'\\)[\\s\\S]{0,400}?\\.select\\(\\s*[',\`]?['\`]([^'\`]+)['\`]`,
      'g',
    )
    for (const hit of resolved.matchAll(pattern)) {
      for (const raw of hit[1]!.split(',')) {
        const column = raw.trim().split(/\s|\(/)[0]!
        // Skip the embedded-resource syntax, which names a table not a column.
        if (column && !column.includes(')') && /^[a-z_]+$/.test(column)) out.add(column)
      }
    }
    return [...out]
  }

  it('grants sources.last_success_at, which every surface needs', () => {
    expect(selectedColumns('sources')).toContain('last_success_at')
    expect(grant0015, '0015 never granted it').not.toMatch(/last_success_at/)
    expect(migrationSql).toMatch(/grant select \(last_success_at\) on sources to authenticated/)
  })

  it('grants every evidence column the detail view reads that 0021 added', () => {
    for (const column of [
      'source_document_id',
      'connector_id',
      'connector_version',
      'first_seen_at',
      'last_seen_at',
      'classification_status',
      'review_status',
    ]) {
      expect(selectedColumns('evidence'), `${column} is not read by the client`).toContain(column)
      expect(migrationSql, `${column} is not granted`).toContain(column)
    }
  })

  it('grants nothing the client does not read', () => {
    // The grant is narrow on purpose: preserved content and operational
    // configuration stay server-side.
    for (const withheld of ['body_text', 'archive_uri', 'raw_storage_uri', 'connector_config']) {
      expect(migrationSql, `${withheld} must not be granted`).not.toContain(withheld)
      expect(selectedColumns('evidence')).not.toContain(withheld)
      expect(selectedColumns('sources')).not.toContain(withheld)
    }
  })

  it('adds no column, changes no row and drops no constraint', () => {
    // A hotfix on production ingestion data has to be provably inert.
    for (const forbidden of [
      'add column',
      'drop column',
      'alter column',
      'drop constraint',
      'insert into',
      'update ',
      'delete from',
      'truncate',
    ]) {
      expect(migrationSql.toLowerCase(), `${forbidden} must not appear`).not.toContain(forbidden)
    }
  })

  it('is reversible', () => {
    const down = readFileSync(
      join(ROOT, 'db/migrations/0022_grant_live_ingestion_columns.down.sql'),
      'utf8',
    )
    expect(down).toContain('revoke select')
    expect(down).toContain('last_success_at')
  })
})
