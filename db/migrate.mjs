#!/usr/bin/env node
/**
 * Migration harness.
 *
 * Deliberately dependency-free: it shells out to `psql` rather than pulling a
 * driver into the tree. PR 3 is DDL only, and a schema harness that needs a
 * package install to run is a harness that will not run in an incident.
 *
 * Two forward paths are supported, because E-B1 requires both:
 *
 *   from empty      every migration, 0001 upward
 *   from v0.1.0     the reference schema in `schemas/database.sql` is already
 *                   present, so 0001 is STAMPED rather than executed and the
 *                   delta runs on top
 *
 * Checksums are recorded on apply and verified on every run. An edited
 * migration that has already been applied is a defect, not a convenience, and
 * the harness refuses to continue rather than papering over the divergence.
 *
 * Usage:
 *   node db/migrate.mjs status
 *   node db/migrate.mjs up [--to 0007] [--from-baseline]
 *   node db/migrate.mjs down [--to 0004]
 *   node db/migrate.mjs verify
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS = join(HERE, 'migrations')
const BASELINE = join(HERE, '..', 'schemas', 'database.sql')

/** The first migration reproduces the v0.1.0 reference schema. */
export const BASELINE_VERSION = '0001'

function psql(sql, { file = null } = {}) {
  const args = ['-v', 'ON_ERROR_STOP=1', '--no-psqlrc', '-q']
  if (file) args.push('-f', file)
  else args.push('-c', sql)
  return execFileSync('psql', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  })
}

function query(sql) {
  const out = execFileSync('psql', ['-v', 'ON_ERROR_STOP=1', '--no-psqlrc', '-tA', '-c', sql], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  })
  return out.trim() ? out.trim().split('\n') : []
}

function checksum(text) {
  // Whitespace-insensitive at the line level, so reformatting is not a false
  // alarm while a semantic edit still is.
  const normalised = text
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trimEnd())
    .filter((l) => l !== '')
    .join('\n')
  return createHash('sha256').update(normalised).digest('hex')
}

export function discover() {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.up.sql')).sort()
  return files.map((f) => {
    const version = f.slice(0, 4)
    const name = f.slice(5, -'.up.sql'.length)
    const upPath = join(MIGRATIONS, f)
    const downPath = join(MIGRATIONS, `${version}_${name}.down.sql`)
    const up = readFileSync(upPath, 'utf8')
    let down = null
    try {
      down = readFileSync(downPath, 'utf8')
    } catch {
      down = null
    }
    return { version, name, upPath, downPath, up, down, checksum: checksum(up) }
  })
}

function ensureLedger() {
  psql(`
    create table if not exists schema_migrations (
      version     text primary key,
      name        text not null,
      checksum    text not null,
      applied_at  timestamptz not null default now(),
      stamped     boolean not null default false
    );
    comment on table schema_migrations is
      'Applied migrations with their checksums. stamped = recorded without executing, used when a database already carries the v0.1.0 baseline.';
  `)
}

function applied() {
  ensureLedger()
  const rows = query(`select version || '\t' || checksum || '\t' || stamped from schema_migrations order by version`)
  return new Map(rows.map((r) => {
    const [version, sum, stamped] = r.split('\t')
    return [version, { checksum: sum, stamped: stamped === 't' }]
  }))
}

/** An applied migration whose file has changed since is a defect. */
export function verifyChecksums({ quiet = false } = {}) {
  const known = applied()
  const drifted = []
  for (const m of discover()) {
    const rec = known.get(m.version)
    if (rec && rec.checksum !== m.checksum) {
      drifted.push({ version: m.version, name: m.name, expected: rec.checksum, actual: m.checksum })
    }
  }
  if (drifted.length) {
    for (const d of drifted) {
      console.error(`CHECKSUM DRIFT ${d.version}_${d.name}`)
      console.error(`  recorded: ${d.expected}`)
      console.error(`  on disk : ${d.actual}`)
    }
    console.error('\nAn applied migration was edited. Write a new migration instead.')
    process.exit(1)
  }
  if (!quiet) console.log(`checksums ok (${known.size} applied)`)
  return true
}

function up({ to = null, fromBaseline = false } = {}) {
  ensureLedger()
  verifyChecksums({ quiet: true })
  const known = applied()
  let ran = 0

  for (const m of discover()) {
    if (known.has(m.version)) continue
    if (to && m.version > to) break

    const stamp = fromBaseline && m.version === BASELINE_VERSION
    if (stamp) {
      // The database already carries the v0.1.0 reference schema.
      console.log(`stamp  ${m.version}_${m.name}  (baseline already present)`)
    } else {
      console.log(`apply  ${m.version}_${m.name}`)
      psql(null, { file: m.upPath })
    }
    psql(
      `insert into schema_migrations (version, name, checksum, stamped)
       values ('${m.version}', '${m.name.replace(/'/g, "''")}', '${m.checksum}', ${stamp});`,
    )
    ran += 1
  }
  console.log(ran === 0 ? 'nothing to apply' : `applied ${ran} migration(s)`)
}

function down({ to = null } = {}) {
  ensureLedger()
  const known = applied()
  const all = discover().slice().reverse()
  let ran = 0

  for (const m of all) {
    if (!known.has(m.version)) continue
    if (to && m.version <= to) break
    const rec = known.get(m.version)
    if (rec.stamped) {
      // Stamped, never executed here — unstamp rather than dropping a schema
      // this harness did not create.
      console.log(`unstamp ${m.version}_${m.name}`)
    } else {
      if (!m.down) {
        console.error(`No down migration for ${m.version}_${m.name}. Refusing to continue.`)
        process.exit(1)
      }
      console.log(`revert ${m.version}_${m.name}`)
      psql(null, { file: m.downPath })
    }
    psql(`delete from schema_migrations where version = '${m.version}';`)
    ran += 1
  }
  console.log(ran === 0 ? 'nothing to revert' : `reverted ${ran} migration(s)`)
}

function status() {
  const known = applied()
  const rows = discover()
  console.log('version  state      name')
  for (const m of rows) {
    const rec = known.get(m.version)
    const state = !rec ? 'pending' : rec.stamped ? 'stamped' : 'applied'
    console.log(`${m.version}     ${state.padEnd(10)} ${m.name}`)
  }
  const pending = rows.filter((m) => !known.has(m.version)).length
  console.log(`\n${rows.length} migration(s), ${pending} pending`)
}

const [, , cmd, ...rest] = process.argv
const flag = (n) => {
  const i = rest.indexOf(n)
  return i === -1 ? null : rest[i + 1]
}

try {
  switch (cmd) {
    case 'up':
      up({ to: flag('--to'), fromBaseline: rest.includes('--from-baseline') })
      break
    case 'down':
      down({ to: flag('--to') })
      break
    case 'status':
      status()
      break
    case 'verify':
      verifyChecksums()
      break
    case 'baseline':
      // Load the v0.1.0 reference schema, for the upgrade-path test.
      console.log(`loading baseline ${BASELINE}`)
      psql(null, { file: BASELINE })
      break
    default:
      console.error('usage: migrate.mjs <up|down|status|verify|baseline> [--to NNNN] [--from-baseline]')
      process.exit(2)
  }
} catch (err) {
  const detail = err.stderr?.toString?.() ?? err.message
  console.error(detail.trim())
  process.exit(1)
}
