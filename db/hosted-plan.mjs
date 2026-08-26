#!/usr/bin/env node
/**
 * Produce the hosted application plan.
 *
 * The Supabase management API takes SQL, not a psql session, so `\ir` — a psql
 * meta-command — has to be expanded before a migration can be applied through
 * it. The CHECKSUM is still computed over the ORIGINAL file text, so the ledger
 * the hosted project ends up with is byte-identical to the one CI produces.
 * Expanding for transport must not change the recorded identity of a migration.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS = join(HERE, 'migrations')
const OUT = join(HERE, '.hosted')

function checksum(text) {
  const normalised = text
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trimEnd())
    .filter((l) => l !== '')
    .join('\n')
  return createHash('sha256').update(normalised).digest('hex')
}

/** Expand `\ir <path>` relative to the including file, recursively. */
function expand(sql, baseDir) {
  return sql
    .split('\n')
    .map((line) => {
      const m = /^\s*\\ir\s+(\S+)\s*$/.exec(line)
      if (!m) return line
      const target = resolve(baseDir, m[1])
      return `-- >>> inlined from ${m[1]}\n${expand(readFileSync(target, 'utf8'), dirname(target))}\n-- <<< end ${m[1]}`
    })
    .join('\n')
}

mkdirSync(OUT, { recursive: true })

const plan = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith('.up.sql'))
  .sort()
  .map((file) => {
    const path = join(MIGRATIONS, file)
    const original = readFileSync(path, 'utf8')
    const version = file.slice(0, 4)
    const name = file.slice(5, -7)
    const sql = expand(original, MIGRATIONS)
    writeFileSync(join(OUT, `${version}_${name}.sql`), sql, 'utf8')
    return { version, name, checksum: checksum(original), bytes: sql.length }
  })

writeFileSync(join(OUT, 'plan.json'), JSON.stringify(plan, null, 2), 'utf8')
for (const m of plan) {
  console.log(`${m.version}  ${m.name.padEnd(38)} ${m.checksum.slice(0, 12)}  ${m.bytes} bytes`)
}
