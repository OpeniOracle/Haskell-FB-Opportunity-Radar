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

/**
 * The two modules permitted to reach the network, and the one permitted to read
 * build-time configuration.
 *
 * These exemptions NARROW the boundary; they do not remove it. Before the
 * production foundation the application was fixture-backed and the honest rule
 * was "no network at all". The application now has a backend, so the rule
 * becomes "network only through these files" — which is still a rule a reviewer
 * can check in one place, and still fails for every surface, hook and component.
 */
const NETWORK_MODULES = ['/lib/apiClient.ts', '/lib/supabaseClient.ts']
/*
  Three modules may read build-time configuration.

  `supabaseClient.ts` needs the project URL and publishable key.
  `vite-env.d.ts` declares their types.
  `DataSourceContext.tsx` reads `import.meta.env.DEV` and nothing else — it is
  the build-time constant that decides whether the fixture module is reachable
  at all. Reading it here is what lets the production bundle exclude fixtures
  structurally rather than skip them at runtime, so this entry buys a stronger
  guarantee than it costs.
*/
const ENV_MODULES = [
  '/lib/supabaseClient.ts',
  '/vite-env.d.ts',
  '/data/DataSourceContext.tsx',
]

/**
 * Seven files necessarily contain the very strings this suite forbids, each for
 * a stated reason:
 *
 *   boundaries.test.ts    this file — it lists what it forbids
 *   bundleSecrets.test.ts plants secret-shaped values to prove they never reach
 *                         the build output, and reads `process.env` to plant them
 *   cspPolicy.test.ts     asserts the exact Supabase origin the policy grants, so
 *                         it must name that origin, and spawns the generator with
 *                         an environment
 *   sessionRevocation.test.ts
 *                         mints real JWTs against a `.invalid` issuer URL and
 *                         asserts that migration 0018 grants execute to
 *                         `service_role` and to nobody else
 *   hostedValidationScripts.test.ts
 *                         reads the operator scripts to prove they never place a
 *                         secret in argv, a file, or shell history, so it must
 *                         name the patterns it is looking for
 *   authGate.test.tsx     supplies absolute attacker URLs — `https://evil.example`
 *                         and friends — as open-redirect candidates. A return-path
 *                         test that could not name an external origin would be
 *                         testing nothing
 *   authAccessibility.test.tsx
 *                         asserts that no key, token or `service_role` string
 *                         reaches the rendered sign-in page, so it must name them
 *   apiContract.test.ts   RUNS the Netlify handlers to prove they answer JSON
 *                         rather than HTML, which means setting the server
 *                         variables they read and giving each one a value of the
 *                         right shape. Every value in it is fabricated — the URL
 *                         resolves to nothing and the keys are zeroes — and the
 *                         file asserts that none of them reaches the output
 *
 * Excluded by exact name so the exemption stays auditable. Excluding all of
 * `test/` would hide a real leak in any future test file.
 */
const SELF_REFERENTIAL = [
  'boundaries.test.ts',
  'bundleSecrets.test.ts',
  'cspPolicy.test.ts',
  'sessionRevocation.test.ts',
  'hostedValidationScripts.test.ts',
  'authGate.test.tsx',
  'authAccessibility.test.tsx',
  'apiContract.test.ts',
]

const files = walk(srcDir)
const sources = files
  .filter((f) => !SELF_REFERENTIAL.some((name) => f.endsWith(name)))
  .map((f) => ({ path: f.slice(srcDir.length), text: readFileSync(f, 'utf8') }))

const outsideNetworkModules = sources.filter((s) => !NETWORK_MODULES.includes(s.path))

describe('milestone boundaries', () => {
  it('finds source files to check', () => {
    expect(sources.length).toBeGreaterThan(15)
  })

  it.each([
    ['fetch(', /\bfetch\s*\(/],
    ['XMLHttpRequest', /XMLHttpRequest/],
    ['WebSocket', /new\s+WebSocket/],
    ['EventSource', /new\s+EventSource/],
  ])('makes no %s call outside the approved network modules', (_label, pattern) => {
    const offenders = outsideNetworkModules.filter((s) => pattern.test(s.text)).map((s) => s.path)
    expect(offenders).toEqual([])
  })

  it('has exactly the approved network modules, and no more', () => {
    // If a third module ever needs the network, that is a decision someone
    // should have to make deliberately by editing this list.
    const present = NETWORK_MODULES.filter((m) => sources.some((s) => s.path === m))
    expect(present.sort()).toEqual([...NETWORK_MODULES].sort())
  })

  it('references no remote origin', () => {
    // The browser addresses its own origin and the Supabase project, and the
    // Supabase URL arrives from configuration rather than being written down
    // here. A literal external URL in the bundle is still a boundary breach.
    const offenders = sources
      .filter((s) => /https?:\/\/(?!www\.w3\.org)/.test(s.text))
      .map((s) => s.path)
    expect(offenders).toEqual([])
  })

  it('addresses only same-origin API paths', () => {
    // The API client builds every URL from a root-relative path. An absolute
    // URL there would put the browser back in direct contact with a host the
    // CSP was narrowed to exclude.
    const client = sources.find((s) => s.path === '/lib/apiClient.ts')
    expect(client, 'apiClient.ts must exist').toBeDefined()
    expect(client!.text).toMatch(/const API_ROOT = '\/api'/)
    expect(client!.text).not.toMatch(/fetch\(\s*['"`]https?:/)
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

  it('reads no server environment, anywhere', () => {
    // `process.env` in a browser bundle is either dead code or a leak. The
    // server-side names live in netlify/functions and never come here.
    const offenders = sources.filter((s) => /process\.env/.test(s.text)).map((s) => s.path)
    expect(offenders).toEqual([])
  })

  it('reads build-time configuration only in the approved modules', () => {
    const offenders = sources
      .filter((s) => !ENV_MODULES.includes(s.path))
      .filter((s) => /import\.meta\.env/.test(s.text))
      .map((s) => s.path)
    expect(offenders).toEqual([])
  })

  it('names no server-side secret variable', () => {
    // Vite inlines every VITE_-prefixed variable into the bundle. A
    // service-role key behind that prefix would be published, not configured.
    const forbidden = [
      // The current secret key, and every shape of the legacy pair.
      'SUPABASE_SECRET_KEY',
      'VITE_SUPABASE_SECRET_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
      'VITE_SUPABASE_SERVICE_ROLE_KEY',
      'SUPABASE_ANON_KEY',
      'VITE_SUPABASE_ANON_KEY',
      'VITE_SUPABASE_DB_URL',
      'VITE_MODEL_API_KEY',
      'VITE_INGEST_SHARED_SECRET',
      'SUPABASE_DB_URL',
      'MODEL_API_KEY',
      'INGEST_SHARED_SECRET',
    ]
    for (const name of forbidden) {
      const offenders = sources.filter((s) => s.text.includes(name)).map((s) => s.path)
      expect(offenders, `secret variable "${name}"`).toEqual([])
    }
  })

  it('carries no literal Supabase key of any kind', () => {
    // A secret key here would be published to every visitor. A publishable key
    // here would be harmless but wrong — it belongs in configuration, so that
    // rotating it is not a code change.
    const patterns: [string, RegExp][] = [
      ['sb_secret_ key', /sb_secret_[A-Za-z0-9_-]+/],
      ['sb_publishable_ key', /sb_publishable_[A-Za-z0-9_-]+/],
      ['legacy JWT key', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
      ['service_role reference', /service_role/],
    ]
    for (const [label, pattern] of patterns) {
      const offenders = sources.filter((s) => pattern.test(s.text)).map((s) => s.path)
      expect(offenders, label).toEqual([])
    }
  })

  it('names the publishable key, and only the publishable key', () => {
    const client = sources.find((s) => s.path === '/lib/supabaseClient.ts')
    expect(client, 'supabaseClient.ts must exist').toBeDefined()
    expect(client!.text).toContain('VITE_SUPABASE_PUBLISHABLE_KEY')
    expect(client!.text).not.toContain('VITE_SUPABASE_ANON_KEY')
  })

  it('offers no self-registration path', () => {
    // The pilot is invite-only. Self-registration is disabled on the Supabase
    // project itself; this makes it impossible to reintroduce from the client
    // without deleting a test.
    const offenders = sources
      .filter((s) => /\.auth\s*\.\s*signUp\s*\(/.test(s.text))
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

/**
 * The ownership fixture is preserved on purpose.
 *
 * It exists to exercise multiple ownership events, half-open intervals, control
 * termination, a retained minority interest, and an organization-scoped
 * operational milestone. Reproducing that STRUCTURE is the point. What must not
 * happen is reproducing a real event's particulars, so the distinguishing
 * values are pinned here — a future edit that drifted them toward the documented
 * worked example would fail.
 */
describe('ownership fixture stays fictional and materially distinct', () => {
  const company = companyFixtures.find((c) => c.id === 'org-fixture-2')!

  it('keeps the structure the fixture exists to test', () => {
    expect(company.relationships).toHaveLength(3)
    expect(company.relationships.filter((r) => r.relationship === 'parent_subsidiary'))
      .toHaveLength(2)
    expect(company.relationships.filter((r) => r.relationship === 'minority_interest'))
      .toHaveLength(1)
    // Control ends exactly where the retained stake begins — the half-open point.
    const parent = company.relationships.find((r) => r.id === 'rel-2-b')!
    const stake = company.relationships.find((r) => r.id === 'rel-2-c')!
    expect(parent.toDate).toBe(stake.fromDate)
    // And an organization-scoped operational event that is not an ownership edge.
    expect(company.timeline.some((e) => e.kind === 'operational' && e.facilityId === null))
      .toBe(true)
  })

  it('uses only fictional counterparties', () => {
    for (const r of company.relationships) {
      expect(r.counterpartyName).toMatch(/^Example /)
    }
    expect(company.canonicalName).toMatch(/^Example /)
  })

  it('differs materially from the documented worked example', () => {
    const stake = company.relationships.find((r) => r.relationship === 'minority_interest')!
    // Not the documented percentage.
    expect(stake.ownershipPercent).toBe(18.4)
    expect(stake.ownershipPercent).not.toBe(19.85)
    // Not the documented dates.
    for (const d of ['2025-07-01', '2025-12-06', '2025-12-08']) {
      expect(company.relationships.map((r) => r.fromDate)).not.toContain(d)
      expect(company.relationships.map((r) => r.toDate)).not.toContain(d)
      expect(company.timeline.map((e) => e.occurredOn.start)).not.toContain(d)
    }
    // Carries an earlier parent edge the worked example does not have, and no
    // listing/market event.
    expect(company.relationships.some((r) => r.id === 'rel-2-a')).toBe(true)
    expect(company.timeline.some((e) => /listing|trading/i.test(e.title))).toBe(false)
  })
})
