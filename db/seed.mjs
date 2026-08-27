#!/usr/bin/env node
/**
 * The seed runner.
 *
 * Seeds are DATA and migrations are DDL, and the two are kept apart on purpose.
 * A migration that carries rows runs on every environment including production
 * without anyone deciding that it should; CI fails the build if one tries. Seeds
 * are applied deliberately, by name, against a database someone chose.
 *
 * Every seed file is IDEMPOTENT — `on conflict … do update` throughout — so
 * re-running is how you apply a correction, not a duplicate-key error. There is
 * no ledger and no checksum here for exactly that reason: unlike a migration, a
 * seed is meant to be re-applied when its content changes.
 *
 *   node db/seed.mjs            apply every seed in order
 *   node db/seed.mjs --list     show what would run
 *   node db/seed.mjs 0003       apply one, by numeric prefix
 *   node db/seed.mjs --verify   report what is present, change nothing
 */
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SEED_DIR = join(HERE, 'seed')

function discover() {
  return readdirSync(SEED_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((file) => ({
      file,
      version: file.slice(0, 4),
      name: file.slice(5, -4),
      path: join(SEED_DIR, file),
    }))
}

function psql(sql, { quiet = false } = {}) {
  return execFileSync(
    'psql',
    ['-v', 'ON_ERROR_STOP=1', '--no-psqlrc', quiet ? '-tAq' : '-q', '-f', '-'],
    { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'inherit'] },
  )
}

function query(sql) {
  return psql(sql, { quiet: true }).trim()
}

/**
 * Applied in ONE transaction. A half-seeded cohort is worse than an unseeded
 * one: it looks populated, and the accounts that failed are invisible.
 */
function apply(seeds) {
  const combined = seeds
    .map((s) => `-- ${'='.repeat(70)}\n-- ${s.file}\n${readFileSync(s.path, 'utf8')}`)
    .join('\n')
  psql(`begin;\n${combined}\ncommit;`)
  for (const s of seeds) console.log(`seed   ${s.version}_${s.name}`)
}

function verify() {
  const rows = query(`
    select
      (select count(*) from organizations where highest_value)         as cohort,
      (select count(*) from organization_identifiers
        where identifier_system = 'sec_cik')                           as ciks,
      (select count(*) from sources)                                   as sources,
      (select count(*) from sources where enabled)                     as enabled_sources,
      (select count(*) from signal_families)                           as families,
      (select count(*) from signal_event_types)                        as event_types,
      (select count(*) from account_source_expectations)               as expectations,
      (select count(*) from account_source_expectations
        where expectation = 'not_applicable')                          as not_applicable,
      (select count(*) from licence_authorizations)                    as licence_rows,
      (select count(*) from reserved_service_addresses)                as reserved_addresses,
      (select count(*) from auth_invite_allowlist)                     as invited_addresses,
      (select count(*) from organizations
        where highest_value and target_tier <> 'not_targeted')         as tiered
  `)
  const [
    cohort, ciks, sources, enabledSources, families, eventTypes,
    expectations, notApplicable, licenceRows, reservedAddresses,
    invitedAddresses, tiered,
  ] = rows.split('|')

  console.log(`  pilot cohort .................. ${cohort}`)
  console.log(`  SEC identifiers ............... ${ciks}`)
  console.log(`  sources ....................... ${sources} (${enabledSources} enabled)`)
  console.log(`  signal families ............... ${families}`)
  console.log(`  signal event types ............ ${eventTypes}`)
  console.log(`  coverage expectations ......... ${expectations} (${notApplicable} not_applicable)`)
  console.log(`  licence authorizations ........ ${licenceRows}`)
  console.log(`  reserved service addresses .... ${reservedAddresses}`)
  console.log(`  invited addresses ............. ${invitedAddresses}`)
  console.log(`  accounts carrying a tier ...... ${tiered}`)

  const problems = []
  if (Number(cohort) !== 15) problems.push(`expected 15 pilot accounts, found ${cohort}`)
  // D14-L. Both must be zero, and they are checked here rather than trusted,
  // because "we did not seed it" is a claim and "the database has none" is a fact.
  if (Number(licenceRows) !== 0) {
    problems.push(`licence_authorizations must be empty, found ${licenceRows} row(s)`)
  }
  if (Number(tiered) !== 0) {
    problems.push(`${tiered} account(s) carry a target_tier; D14-L forbids it`)
  }
  // The SEC contact mailbox must be reserved, or nothing stops someone
  // inviting it in good faith.
  if (Number(reservedAddresses) < 1) {
    problems.push('no service address is reserved; the SEC contact mailbox must be')
  }
  if (Number(enabledSources) !== 0) {
    problems.push(
      `${enabledSources} source(s) are enabled, but no connector exists yet — an enabled source with nothing behind it reports healthy while collecting nothing`,
    )
  }

  if (problems.length) {
    console.error('\nFAILED:')
    for (const p of problems) console.error(`  - ${p}`)
    process.exit(1)
  }
  console.log('\nseed state ok')
}

const args = process.argv.slice(2)
const seeds = discover()

if (args.includes('--list')) {
  for (const s of seeds) console.log(`${s.version}  ${s.name}`)
} else if (args.includes('--verify')) {
  verify()
} else {
  const only = args.find((a) => /^\d{4}$/.test(a))
  const selected = only ? seeds.filter((s) => s.version === only) : seeds
  if (!selected.length) {
    console.error(only ? `No seed numbered ${only}.` : 'No seed files found.')
    process.exit(1)
  }
  apply(selected)
  console.log('')
  verify()
}
