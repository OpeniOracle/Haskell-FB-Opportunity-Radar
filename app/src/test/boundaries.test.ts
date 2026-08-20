import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fromRoot } from '@/test/paths'
import { companyFixtures, counterpartyNames } from '@/data/fixtures/companies'
import { evidenceFixtures } from '@/data/fixtures/evidence'
import { facilityFixtures } from '@/data/fixtures/facilities'
import { sourceHealthFixture } from '@/data/fixtures/health'

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

/**
 * The fixture set itself, asserted structurally rather than by eye.
 *
 * Every organization the preview can name is fictional and begins with
 * `Example`. Seeding the real pilot identities belongs to a later roadmap PR
 * against a database, not to a fixture file.
 */
describe('fixture-only organizations', () => {
  const everyOrganizationName = [
    ...companyFixtures.map((c) => c.canonicalName),
    ...companyFixtures.flatMap((c) => c.aliases),
    ...companyFixtures.flatMap((c) => c.relationships.map((r) => r.counterpartyName)),
    ...companyFixtures.map((c) => c.parentName).filter((n): n is string => n !== null),
    ...Object.values(counterpartyNames),
    ...facilityFixtures.map((f) => f.organizationName),
    ...evidenceFixtures.map((e) => e.publisher),
  ]

  it('names only Example organizations', () => {
    expect(everyOrganizationName.length).toBeGreaterThan(20)
    for (const name of everyOrganizationName) {
      expect(name, name).toMatch(/^(Example|EBC$|EM&S$)/)
    }
  })

  it('populates no tier, engagement or account-strategy value anywhere', () => {
    // D14-L. The type has no value member, so this asserts the shape survives.
    for (const company of companyFixtures) {
      for (const attribute of [
        company.targetTier,
        company.engagement,
        company.accountStrategyScore,
      ]) {
        expect(attribute.available).toBe(false)
        expect(attribute.blockedBy).toMatch(/D14-L/)
        expect(Object.keys(attribute)).toEqual(['available', 'reason', 'blockedBy'])
      }
    }
  })

  it('uses no real facility, source or connector identity', () => {
    const surfaces = [
      ...facilityFixtures.map((f) => f.name),
      ...sourceHealthFixture.connectors.map((c) => c.name),
    ]
    for (const value of surfaces) {
      expect(value).not.toMatch(/Nestl|PepsiCo|Coca|Tyson|Kraft|Mondelez/)
    }
  })
})
