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

/*
   THE ENTRA CREDENTIALS, WHICH BELONG TO SUPABASE AND NOT TO THIS BUNDLE.

   Microsoft sign-in is configured by giving the Supabase project an Entra
   application ID and client secret. The BROWSER needs neither: it calls
   `signInWithOAuth`, Supabase redirects it to Microsoft, and the secret is used
   server-to-server in the token exchange. So neither value has any business
   being VITE_-prefixed, and a paste into the wrong environment variable is
   exactly the mistake this plants for.

   The tenant ID is not secret — it appears in every authority URL — but it is
   planted too, because a tenant ID in the bundle means somebody wired the
   authority into the client, which is a design this application does not have
   and would not want.
*/
const PLANTED_ENTRA_SECRET = 'PLANTEDentraClientSecretValue~doNotShip'
const PLANTED_ENTRA_TENANT = 'PLANTED-tenant-0000-4000-8000-000000000000'

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
        // Both unprefixed AND prefixed, so both routes into the bundle are
        // exercised. The application reads neither.
        AZURE_CLIENT_SECRET: PLANTED_ENTRA_SECRET,
        VITE_AZURE_CLIENT_SECRET: PLANTED_ENTRA_SECRET,
        AZURE_TENANT_ID: PLANTED_ENTRA_TENANT,
        VITE_AZURE_TENANT_ID: PLANTED_ENTRA_TENANT,
        // The flag that IS read, and is deliberately not a secret.
        VITE_AUTH_MICROSOFT_ENABLED: 'true',
      },
      stdio: 'pipe',
    })

    expect(existsSync(dist), 'dist/ must exist after the build').toBe(true)
    const files = walk(dist).filter((f) => /\.(js|css|html|map|json|txt)$/.test(f))
    expect(files.length).toBeGreaterThan(0)

    const contents = files.map((f) => ({ path: f.slice(dist.length), text: readFileSync(f, 'utf8') }))

    // Proof the scan is actually reading shipped code, AND that it can see a
    // value Vite inlined from the environment.
    //
    // The second half is the one that matters. Until authentication existed,
    // `supabaseClient.ts` was imported by nothing and Vite tree-shook it, so the
    // planted publishable value was absent from the bundle — which meant the
    // secret assertions below could have passed because the scan was blind
    // rather than because the bundle was clean. The auth gate imports the client
    // on every page load, so the publishable key now genuinely ships, and its
    // presence is the positive control this test needed.
    const sawKnownAppString = contents.some((c) => c.text.includes('Illustrative data'))
    expect(sawKnownAppString, 'the scan must be reading real build output').toBe(true)

    const sawInlinedPublishable = contents.some((c) => c.text.includes(PLANTED_PUBLISHABLE))
    expect(
      sawInlinedPublishable,
      'the publishable key must be inlined and visible to this scan, or the secret assertions below prove nothing',
    ).toBe(true)

    for (const [label, needle] of [
      ['planted secret key', PLANTED_SECRET],
      ['planted model key', 'sk-planted-model-key-value'],
      ['planted ingest secret', 'planted-ingest-shared-secret'],
      ['planted Entra client secret', PLANTED_ENTRA_SECRET],
      ['planted Entra tenant id', PLANTED_ENTRA_TENANT],
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
      /*
         No Microsoft endpoint may be addressed by the browser directly.

         The sign-in redirect is Supabase's to construct: the application calls
         `signInWithOAuth` and Supabase builds the authority URL from
         credentials only it holds. A `login.microsoftonline.com` literal in the
         bundle would mean the client had taken that over, which is how a client
         secret ends up somewhere it can be read.
      */
      ['a Microsoft authority URL', /login\.microsoftonline\.com/],
      ['a Microsoft Graph endpoint', /graph\.microsoft\.com/],
    ] as const) {
      const offenders = contents.filter((c) => pattern.test(c.text)).map((c) => c.path)
      expect(offenders, label).toEqual([])
    }
  })
})
