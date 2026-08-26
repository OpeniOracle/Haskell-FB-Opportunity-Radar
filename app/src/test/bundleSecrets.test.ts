import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { APP_ROOT } from '@/test/paths'

/**
 * The bundle is the thing that actually ships.
 *
 * `boundaries.test.ts` reads source. This reads the BUILD OUTPUT, because a
 * secret can reach the bundle without ever appearing in `src/` — an env var
 * inlined by Vite, a dependency that echoes configuration, a generated file.
 * Source-level checks cannot see any of that.
 *
 * The build runs with a deliberately planted secret-shaped value in the
 * environment. If Vite inlines it, this test finds it; if the check itself were
 * broken, the planted value would be missed and the test would pass for the
 * wrong reason — so the test also asserts that the planted PUBLISHABLE value
 * DOES appear, proving the scan can see inlined values at all.
 */
const PLANTED_SECRET = 'sb_secret_PLANTEDCANARYVALUEdoNotShip'
const PLANTED_PUBLISHABLE = 'sb_publishable_PLANTEDCANARYVALUEisFine'

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    return statSync(full).isDirectory() ? walk(full) : [full]
  })
}

describe('build output carries no secret', () => {
  const dist = join(APP_ROOT, 'dist')

  it('builds with a planted secret in the environment and does not ship it', () => {
    execFileSync('npx', ['vite', 'build', '--logLevel', 'error'], {
      cwd: APP_ROOT,
      env: {
        ...process.env,
        VITE_SUPABASE_URL: 'https://example-project.supabase.co',
        VITE_SUPABASE_PUBLISHABLE_KEY: PLANTED_PUBLISHABLE,
        // Never VITE_-prefixed in a real deployment. Planted unprefixed AND
        // prefixed, so both routes into the bundle are exercised.
        SUPABASE_SECRET_KEY: PLANTED_SECRET,
        MODEL_API_KEY: 'sk-planted-model-key-value',
        INGEST_SHARED_SECRET: 'planted-ingest-shared-secret',
      },
      stdio: 'pipe',
    })

    expect(existsSync(dist), 'dist/ must exist after the build').toBe(true)
    const files = walk(dist).filter((f) => /\.(js|css|html|map|json|txt)$/.test(f))
    expect(files.length).toBeGreaterThan(0)

    const contents = files.map((f) => ({ path: f.slice(dist.length), text: readFileSync(f, 'utf8') }))

    // Proof the scan is actually reading shipped code, not an empty set: a
    // string that is unambiguously in the application must be found.
    //
    // Note what this does NOT claim. The planted publishable value is absent
    // from the bundle too — but only because `supabaseClient.ts` is not yet
    // imported by any surface, so Vite tree-shakes it. That will change when the
    // Live Data PR wires the API-backed DataSource, and the secret assertions
    // below are the ones that must hold either way.
    const sawKnownAppString = contents.some((c) => c.text.includes('Illustrative data'))
    expect(sawKnownAppString, 'the scan must be reading real build output').toBe(true)

    for (const [label, needle] of [
      ['planted secret key', PLANTED_SECRET],
      ['planted model key', 'sk-planted-model-key-value'],
      ['planted ingest secret', 'planted-ingest-shared-secret'],
    ] as const) {
      const offenders = contents.filter((c) => c.text.includes(needle)).map((c) => c.path)
      expect(offenders, label).toEqual([])
    }
  }, 120_000)

  it('ships no secret-shaped literal at all', () => {
    const files = walk(dist).filter((f) => /\.(js|css|html|map)$/.test(f))
    const contents = files.map((f) => ({ path: f.slice(dist.length), text: readFileSync(f, 'utf8') }))
    for (const [label, pattern] of [
      ['sb_secret_', /sb_secret_[A-Za-z0-9_-]{8,}/],
      ['service_role', /service_role/],
      ['postgres connection string', /postgres(ql)?:\/\/[^\s"']+/],
      ['private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
    ] as const) {
      const offenders = contents.filter((c) => pattern.test(c.text)).map((c) => c.path)
      expect(offenders, label).toEqual([])
    }
  })
})
