import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fromRoot } from '@/test/paths'

/**
 * The PR 1 boundary, asserted rather than promised.
 *
 * The instruction for this milestone forbids network calls, authentication,
 * model calls, database access, and real company data. ESLint enforces some of it
 * at the import level; this test enforces the rest across the whole source tree,
 * so a future contributor cannot quietly widen the scope without a red test.
 */

const srcDir = fromRoot('src')

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return walk(full)
    return /\.(ts|tsx|css)$/.test(entry) ? [full] : []
  })
}

const files = walk(srcDir)
const sources = files
  // This file necessarily contains the very strings it forbids.
  .filter((f) => !f.endsWith('boundaries.test.ts'))
  .map((f) => ({ path: f.slice(srcDir.length), text: readFileSync(f, 'utf8') }))

describe('milestone boundaries', () => {
  it('finds source files to check', () => {
    expect(sources.length).toBeGreaterThan(15)
  })

  it.each([
    ['fetch(', /\bfetch\s*\(/],
    ['XMLHttpRequest', /XMLHttpRequest/],
    ['WebSocket', /new\s+WebSocket/],
    ['EventSource', /new\s+EventSource/],
  ])('makes no %s call anywhere in the application', (_label, pattern) => {
    const offenders = sources.filter((s) => pattern.test(s.text)).map((s) => s.path)
    expect(offenders).toEqual([])
  })

  it('references no remote origin', () => {
    const offenders = sources
      .filter((s) => /https?:\/\/(?!www\.w3\.org)/.test(s.text))
      .map((s) => s.path)
    expect(offenders).toEqual([])
  })

  it('contains no credential-shaped values', () => {
    const patterns = [
      /\bapi[_-]?key\s*[:=]\s*['"][^'"]+['"]/i,
      /\bsecret\s*[:=]\s*['"][^'"]+['"]/i,
      /\btoken\s*[:=]\s*['"][^'"]{12,}['"]/i,
      /\bpassword\s*[:=]\s*['"][^'"]+['"]/i,
      /\bBearer\s+[A-Za-z0-9._-]{16,}/,
      /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
      /\bsk-[A-Za-z0-9]{16,}/,
      /\bghp_[A-Za-z0-9]{20,}/,
    ]
    for (const pattern of patterns) {
      const offenders = sources.filter((s) => pattern.test(s.text)).map((s) => s.path)
      expect(offenders, `pattern ${pattern}`).toEqual([])
    }
  })

  it('reads no environment variables', () => {
    const offenders = sources
      .filter((s) => /process\.env|import\.meta\.env/.test(s.text))
      .map((s) => s.path)
    expect(offenders).toEqual([])
  })

  it('names no real company from the pilot account list', () => {
    // A deliberately blunt check. Fixtures are all "Example …"; any of these
    // appearing would mean real account data had entered the preview.
    const realNames = [
      'Nestl',
      'PepsiCo',
      'Coca-Cola',
      'Anheuser',
      'Tyson',
      'Kraft',
      'Conagra',
      'General Mills',
      'Unilever',
      'Danone',
      'Niagara',
      'Sherwin',
      'Mondelez',
      'Keurig',
      'Hormel',
      'Smithfield',
      'PACK EXPO',
    ]
    for (const name of realNames) {
      const offenders = sources.filter((s) => s.text.includes(name)).map((s) => s.path)
      expect(offenders, `real name "${name}"`).toEqual([])
    }
  })
})
