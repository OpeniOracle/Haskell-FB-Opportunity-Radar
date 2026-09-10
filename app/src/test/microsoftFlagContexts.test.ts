import { afterAll, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { APP_ROOT, fromRoot } from '@/test/paths'
import { microsoftFlagEnabled } from '@/lib/supabaseClient'

/**
 * The deployment contract for "Continue with Microsoft", held to per context.
 *
 * WHY THIS EXISTS AS ITS OWN SUITE.
 *
 * The flag used to be one value in `[build.environment]`, which applies to every
 * context. netlify.toml OVERRIDES the Netlify UI and API, so that arrangement
 * had a failure nobody would have diagnosed quickly: turning the button on for
 * deploy previews from the dashboard would have been silently ignored, the
 * preview would have built with the button off, and nothing anywhere would have
 * said why. The fix is three explicit per-context declarations, and this suite
 * is what stops them collapsing back into one.
 *
 * WHAT A STRING SEARCH CANNOT PROVE, stated up front because it is the trap.
 *
 * The Microsoft markup is compiled into the bundle either way — the button is
 * gated at RUNTIME on `port.microsoftEnabled`, not by a build-time branch — so
 * "Continue with Microsoft" appears in a production build too, and asserting on
 * its presence would pass for both contexts and prove nothing. What actually
 * differs is the RESOLVED FLAG that ships: Vite inlines the environment value,
 * the minifier folds the comparison, and the object literal carries the answer.
 * That is what the build assertions below read.
 */

const NETLIFY_TOML = readFileSync(fromRoot('../netlify.toml'), 'utf8')

/**
 * The body of one TOML table, up to the next table header.
 *
 * Deliberately small and specific rather than a TOML dependency: the whole
 * point is to read the committed file the way a reviewer does, and a parser
 * that silently normalises the shape would hide the very drift being watched
 * for.
 */
function tableBody(name: string): string | null {
  /*
     A HEADER IS A WHOLE LINE, not a substring, and this cost a debugging round.

     The first version used `indexOf('[context.production.environment]')` -- and
     the prose above that very table in netlify.toml quotes the header by name to
     explain what it does. `indexOf` found the COMMENT, parsed it as the table,
     found no assignment in it, and reported that production declared nothing.
     Every downstream failure followed from that, including a build that was
     handed an undefined flag.

     So the header must be anchored to the start of a line and be the only thing
     on it, which is what a TOML table header actually is.
  */
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const header = new RegExp(`^[ \\t]*\\[${escaped}\\][ \\t]*$`, 'm')
  const match = header.exec(NETLIFY_TOML)
  if (!match) return null

  const after = match.index + match[0].length
  const rest = NETLIFY_TOML.slice(after)
  // The next table header, again anchored, ends this one's body.
  const next = rest.search(/^[ \t]*\[[^\]]+\][ \t]*$/m)
  return next === -1 ? rest : rest.slice(0, next)
}

/** The value a table assigns to a key, ignoring commented-out lines. */
function declaredValue(table: string, key: string): string | null {
  const body = tableBody(table)
  if (body === null) return null
  for (const line of body.split('\n')) {
    const bare = line.trim()
    if (bare.startsWith('#')) continue
    const match = new RegExp(`^${key}\\s*=\\s*"([^"]*)"`).exec(bare)
    if (match) return match[1] ?? null
  }
  return null
}

const FLAG = 'VITE_AUTH_MICROSOFT_ENABLED'

// ---------------------------------------------------------------------------
// 1. The committed configuration.
// ---------------------------------------------------------------------------

describe('the Microsoft flag is declared per context, never globally', () => {
  /*
     THE REGRESSION THIS SUITE WAS WRITTEN FOR.

     `[build.environment]` applies to every context AND outranks the Netlify UI.
     A value here cannot be overridden from the dashboard, so it must not exist.
  */
  it('is absent from [build.environment]', () => {
    expect(declaredValue('build.environment', FLAG)).toBeNull()
  })

  it('is declared by every context that deploys', () => {
    for (const context of [
      'context.production.environment',
      'context.deploy-preview.environment',
      'context.branch-deploy.environment',
    ]) {
      expect(declaredValue(context, FLAG), `${context} must declare ${FLAG}`).not.toBeNull()
    }
  })

  it('is declared exactly three times in the whole file', () => {
    // Assignments only — the surrounding prose names the variable repeatedly.
    const assignments = NETLIFY_TOML.split('\n').filter(
      (line) => !line.trim().startsWith('#') && new RegExp(`^\\s*${FLAG}\\s*=`).test(line),
    )
    expect(assignments).toHaveLength(3)
  })

  it('cannot silently return to one global value', () => {
    /*
       The two ways the old shape could come back, both caught:

         * a declaration reappearing in `[build.environment]`, which would apply
           everywhere and outrank the dashboard;
         * a context quietly dropping its declaration and inheriting instead,
           which is the invisible half — a context that says nothing reads as
           "off" only if you already know what the global block does.
     */
    expect(declaredValue('build.environment', FLAG)).toBeNull()
    expect(declaredValue('context.production.environment', FLAG)).toBe('false')
    expect(declaredValue('context.deploy-preview.environment', FLAG)).toBe('true')
    expect(declaredValue('context.branch-deploy.environment', FLAG)).toBe('false')
  })
})

// ---------------------------------------------------------------------------
// 2. What those values RESOLVE to, through the real rule.
// ---------------------------------------------------------------------------

describe('resolving the committed value, per context', () => {
  it('production resolves to disabled', () => {
    expect(microsoftFlagEnabled(declaredValue('context.production.environment', FLAG) ?? undefined))
      .toBe(false)
  })

  it('deploy previews resolve to enabled', () => {
    expect(
      microsoftFlagEnabled(declaredValue('context.deploy-preview.environment', FLAG) ?? undefined),
    ).toBe(true)
  })

  it('branch deploys resolve to disabled', () => {
    expect(
      microsoftFlagEnabled(declaredValue('context.branch-deploy.environment', FLAG) ?? undefined),
    ).toBe(false)
  })

  it('a local build, with the variable unset, resolves to disabled', () => {
    // An unlisted Netlify context and a laptop are the same case: nothing set.
    expect(microsoftFlagEnabled(undefined)).toBe(false)
  })

  it('treats every near-miss as disabled', () => {
    // A flag that can be switched on by a typo is not a gate.
    for (const raw of ['', ' true', 'true ', 'TRUE', 'True', '1', 'yes', 'on', 'enabled']) {
      expect(microsoftFlagEnabled(raw), `${JSON.stringify(raw)} must not enable`).toBe(false)
    }
    expect(microsoftFlagEnabled('true')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 3. The builds those contexts actually produce.
// ---------------------------------------------------------------------------

/*
   Two real Vite builds, one per context, into their own output directories so
   nothing collides with `dist/` or with the concurrent bundle-secret scan.

   A secret-shaped Entra value is planted in the environment of both, so the
   leak assertions are testing a build that had something to leak.
*/
const PLANTED_ENTRA_SECRET = 'PLANTEDentraClientSecretValue~doNotShip'
const PLANTED_SUPABASE_SECRET = 'sb_secret_PLANTEDflagContextCanary'

const OUT = {
  production: join(APP_ROOT, 'dist-flagcheck-production'),
  'deploy-preview': join(APP_ROOT, 'dist-flagcheck-preview'),
} as const

function build(context: keyof typeof OUT): { path: string; text: string }[] {
  execFileSync('npx', ['vite', 'build', '--logLevel', 'error', '--outDir', OUT[context]], {
    cwd: APP_ROOT,
    env: {
      ...process.env,
      VITE_SUPABASE_URL: 'https://example-project.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_flagContextIsFine',
      VITE_RADAR_ENV: context === 'production' ? 'production' : 'preview',
      // THE VALUE UNDER TEST, taken from the committed file rather than typed
      // here, so the build is driven by the contract and not by a copy of it.
      VITE_AUTH_MICROSOFT_ENABLED: declaredValue(
        `context.${context}.environment`,
        FLAG,
      ) as string,
      AZURE_CLIENT_SECRET: PLANTED_ENTRA_SECRET,
      VITE_AZURE_CLIENT_SECRET: PLANTED_ENTRA_SECRET,
      SUPABASE_SECRET_KEY: PLANTED_SUPABASE_SECRET,
    },
    stdio: 'pipe',
  })

  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
      const full = join(dir, entry)
      return statSync(full).isDirectory() ? walk(full) : [full]
    })

  return walk(OUT[context])
    .filter((f) => /\.(js|css|html|map)$/.test(f))
    .map((f) => ({ path: f.slice(OUT[context].length), text: readFileSync(f, 'utf8') }))
}

describe('the shipped bundle carries the right flag for its context', () => {
  const built: Partial<Record<keyof typeof OUT, { path: string; text: string }[]>> = {}

  afterAll(() => {
    for (const dir of Object.values(OUT)) rmSync(dir, { recursive: true, force: true })
  })

  /**
   * The flag as it actually ships, read out of the built JavaScript.
   *
   * Vite inlines `import.meta.env.VITE_AUTH_MICROSOFT_ENABLED` at build time, so
   * the CONTEXT'S VALUE ends up as a string literal at the call site:
   *
   *     microsoftSignIn:Cb("false")      production
   *     microsoftSignIn:Cb("true")       deploy preview
   *
   * That literal is the thing worth asserting. It proves the value from
   * netlify.toml reached this build — which is the contract — while whether the
   * value is interpreted correctly is proven separately, and better, by the
   * pure-function tests above.
   *
   * The minified callee name (`Cb` here) changes between builds, so it is
   * matched as an identifier rather than by name. A folded boolean literal is
   * accepted too, in case the indirection is ever removed and the minifier
   * starts constant-folding again.
   */
  function shippedFlag(files: { text: string }[]): boolean | null {
    const pattern =
      /microsoftSignIn:\s*(?:(!1|!0|false|true)[,}\s]|[A-Za-z_$][\w$]*\(\s*"(true|false)"\s*\))/
    for (const file of files) {
      const match = pattern.exec(file.text)
      if (!match) continue
      if (match[2]) return match[2] === 'true'
      return match[1] === '!0' || match[1] === 'true'
    }
    return null
  }

  it('builds a production-context bundle with the control disabled', () => {
    built.production = build('production')
    expect(existsSync(OUT.production)).toBe(true)
    expect(shippedFlag(built.production)).toBe(false)
  }, 180_000)

  it('builds a deploy-preview-context bundle with the control enabled', () => {
    built['deploy-preview'] = build('deploy-preview')
    expect(shippedFlag(built['deploy-preview'])).toBe(true)
  }, 180_000)

  it('differs between the two contexts, from the same source', () => {
    // The one assertion that would catch "both contexts got the same value",
    // which is what a single global declaration produces.
    expect(shippedFlag(built.production!)).not.toBe(shippedFlag(built['deploy-preview']!))
  })

  /*
     THE TRAP, ASSERTED SO NOBODY LATER "FIXES" THIS SUITE BY SEARCHING STRINGS.

     The markup is compiled in for both contexts and gated at runtime. If a
     future change ever makes the string genuinely absent from the production
     build that is fine and this test should be revisited -- but until then, a
     string search is not evidence and this records why.
  */
  it('proves a string search could not have told the two apart', () => {
    const inProduction = built.production!.some((f) => f.text.includes('Continue with Microsoft'))
    const inPreview = built['deploy-preview']!.some((f) =>
      f.text.includes('Continue with Microsoft'),
    )
    expect(inPreview).toBe(true)
    expect(inProduction).toBe(true)
  })

  it('keeps password sign-in and recovery-code entry in BOTH builds', () => {
    // Microsoft is an addition, never a replacement. The fallback has to ship
    // in the context where the button is off, which is the one that matters.
    for (const [context, files] of Object.entries(built)) {
      const all = files!.map((f) => f.text).join('')
      for (const needle of ['Email address', 'Sign in', 'Enter your recovery code']) {
        expect(all.includes(needle), `${context} must still ship ${JSON.stringify(needle)}`).toBe(
          true,
        )
      }
    }
  })

  it('carries the allowlist explanation wherever the button can appear', () => {
    const preview = built['deploy-preview']!.map((f) => f.text).join('')
    expect(preview).toContain('individually authorized reviewers')
  })

  it('ships no provider credential, in either context', () => {
    for (const [context, files] of Object.entries(built)) {
      for (const [label, pattern] of [
        ['planted Entra client secret', PLANTED_ENTRA_SECRET],
        ['planted Supabase secret key', PLANTED_SUPABASE_SECRET],
        ['any sb_secret_ key', /sb_secret_[A-Za-z0-9_-]{8,}/],
        ['a Microsoft authority URL', /login\.microsoftonline\.com/],
        ['a Microsoft Graph endpoint', /graph\.microsoft\.com/],
        ['a service_role reference', /service_role/],
        ['a bearer token literal', /eyJ[A-Za-z0-9_-]{20,}\./],
      ] as const) {
        const offenders = files!
          .filter((f) =>
            typeof pattern === 'string' ? f.text.includes(pattern) : pattern.test(f.text),
          )
          .map((f) => f.path)
        expect(offenders, `${context}: ${label}`).toEqual([])
      }
    }
  })

  it('names no reviewer and no account', () => {
    for (const [context, files] of Object.entries(built)) {
      const all = files!.map((f) => f.text).join('')
      // The two real organization domains must not appear as addresses in
      // anything that ships to a browser.
      expect(all, context).not.toMatch(/[A-Za-z0-9._%+-]+@(haskell|openi-analytics)\.com/)
    }
  })
})
