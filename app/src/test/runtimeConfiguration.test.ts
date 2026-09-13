import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { APP_ROOT, fromRoot } from '@/test/paths'
import { join } from 'node:path'
import {
  ENV_SCOPES,
  MissingEnvError,
  assertSecUserAgentUsable,
  describeServerVariables,
  serverEnv,
} from '../../netlify/functions/_shared/env'
import {
  EgressDeniedError,
  egressGet,
  hostAllowed,
} from '../../netlify/functions/_shared/egress'
import { SEC_HOSTS } from '../../netlify/functions/_shared/connectors/sec'
import { MARS_HOSTS } from '../../netlify/functions/_shared/connectors/mars'

/**
 * Where a deployed function's configuration actually comes from.
 *
 * THE DEFECT THIS SUITE EXISTS TO PREVENT.
 *
 * `netlify.toml` used to declare SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY,
 * SUPABASE_EVIDENCE_BUCKET, RADAR_ENV, EGRESS_ALLOWLIST, SEC_EDGAR_USER_AGENT,
 * SEC_CONTACT_CONFIRMED and three MODEL_* variables, under a comment saying
 * "the functions runtime inherits these". It does not. Netlify's documentation
 * is explicit that configuration-file variables reach the BUILD and are not
 * available to serverless functions:
 *
 *   https://docs.netlify.com/build/functions/environment-variables/
 *
 * Those declarations were worse than absent. They read as configuration while
 * supplying nothing, so a Functions-scoped variable that had never been set
 * looked like it already was — and a green build with five deployed function
 * bundles proves only that the bundles exist, never that `process.env` holds
 * anything when they run.
 *
 * So this suite asserts two separate things: that the committed file no longer
 * claims to configure a function, and that every function fails CLOSED when the
 * value it needs is genuinely absent from its runtime environment.
 */

const NETLIFY_TOML = readFileSync(fromRoot('../netlify.toml'), 'utf8')

/** Assignments only — the surrounding prose names these variables constantly. */
function assignedInToml(name: string): boolean {
  return NETLIFY_TOML.split('\n').some(
    (line) => !line.trim().startsWith('#') && new RegExp(`^\\s*${name}\\s*=`).test(line),
  )
}

/**
 * Every variable a deployed function reads through `process.env`.
 *
 * Derived from `ENV_SCOPES` plus the optional reads in `serverEnv` and
 * `modelEnv`, and kept here as an explicit list so that adding a runtime
 * variable without deciding where it is configured fails a test.
 */
const FUNCTION_RUNTIME_VARS = [
  'SUPABASE_URL',
  'SUPABASE_SECRET_KEY',
  'SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_JWT_SECRET',
  'SUPABASE_EVIDENCE_BUCKET',
  'EGRESS_ALLOWLIST',
  'SEC_EDGAR_USER_AGENT',
  'SEC_CONTACT_CONFIRMED',
  'INGEST_SHARED_SECRET',
  'RADAR_ENV',
  'MODEL_PROVIDER',
  'MODEL_API_KEY',
  'MODEL_ID',
  'MODEL_PROMPT_VERSION',
] as const

/** Values Vite compiles into the bundle, or that the build itself reads. */
const BUILD_TIME_VARS = [
  'NODE_VERSION',
  'PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD',
  'VITE_SUPABASE_URL',
  'VITE_RADAR_ENV',
  'VITE_AUTH_MICROSOFT_ENABLED',
] as const

// ---------------------------------------------------------------------------
// 1. The committed file configures the build, and nothing else.
// ---------------------------------------------------------------------------

describe('netlify.toml does not pretend to configure a function', () => {
  for (const name of FUNCTION_RUNTIME_VARS) {
    it(`does not declare ${name}`, () => {
      expect(
        assignedInToml(name),
        `${name} is read by a deployed function through process.env. A netlify.toml ` +
          'declaration cannot reach one, so declaring it here is a claim the file cannot keep.',
      ).toBe(false)
    })
  }

  it('still declares the build-time values, which DO work from here', () => {
    // The counterpart assertion. Without it, deleting the whole block would
    // pass every test above while breaking the build.
    for (const name of BUILD_TIME_VARS) {
      expect(assignedInToml(name), `${name} is a build value and belongs here`).toBe(true)
    }
  })

  /*
     A SYNTAX CHECK, BECAUSE EVERY OTHER TEST HERE READS THIS FILE WITH A
     REGULAR EXPRESSION.

     Removing the runtime block by hand truncated the comment above
     `[context.production.environment]` and left the table header with the tail
     of a sentence still attached to it:

         [context.production.environment]` and finding

     That is not valid TOML, so Netlify would have failed the build. Nothing
     caught it: this suite and `microsoftFlagContexts.test.ts` both match
     headers anchored to whole lines, so a header with trailing text simply
     stopped matching, and a test that looks for the ABSENCE of a variable
     passes very comfortably when the file it is reading is broken.

     There is no TOML parser in this project's dependencies and one is not
     worth adding for this, but the corruption has a shape: a line that is
     neither blank, nor a comment, nor a bare table header, nor a `key =
     value`. Checking that shape costs nothing and would have failed loudly.
  */
  it('is structurally valid TOML, not merely free of the wrong keys', () => {
    const offenders = NETLIFY_TOML
      .split('\n')
      .map((line, index) => ({ line: line.trim(), number: index + 1 }))
      .filter(({ line }) => line !== '' && !line.startsWith('#'))
      .filter(({ line }) => {
        if (/^\[\[[^\]]+\]\]$/.test(line)) return false // [[array.of.tables]]
        if (/^\[[^\]]+\]$/.test(line)) return false // [table]
        if (/^[A-Za-z0-9_.-]+\s*=\s*\S/.test(line)) return false // key = value
        return true
      })
      .map(({ line, number }) => `${number}: ${line}`)

    expect(offenders).toEqual([])
  })

  it('keeps no server-side secret in the repository at all', () => {
    for (const secret of ['SUPABASE_SECRET_KEY', 'INGEST_SHARED_SECRET', 'MODEL_API_KEY']) {
      expect(assignedInToml(secret)).toBe(false)
    }
    expect(NETLIFY_TOML).not.toMatch(/sb_secret_[A-Za-z0-9_-]{8,}/)
  })
})

// ---------------------------------------------------------------------------
// 2. Reading configuration goes through one abstraction.
// ---------------------------------------------------------------------------

describe('functions read configuration only through the environment abstraction', () => {
  const functionSources = [
    'session.ts',
    'status.ts',
    'evidence.ts',
    'admin-run.ts',
    'scheduled-ingest.ts',
  ].map((f) => ({ f, text: readFileSync(join(APP_ROOT, 'netlify/functions', f), 'utf8') }))

  it('no handler reaches for process.env directly', () => {
    // One reader means one place to audit, and one place that can fail closed.
    for (const { f, text } of functionSources) {
      expect(text, `${f} must read configuration through _shared/env`).not.toMatch(/process\.env/)
    }
  })

  it('the abstraction reads with a COMPUTED key, which no bundler can inline', () => {
    const env = readFileSync(join(APP_ROOT, 'netlify/functions/_shared/env.ts'), 'utf8')
    expect(env).toMatch(/process\.env\[name\]/)
    // This is why a build-time value could never have leaked into a bundle and
    // silently made the old netlify.toml declarations appear to work.
    expect(env).not.toMatch(/process\.env\.SUPABASE_URL/)
    expect(env).not.toMatch(/process\.env\.SUPABASE_SECRET_KEY/)
  })
})

// ---------------------------------------------------------------------------
// 3. Absent configuration fails closed, per scope.
// ---------------------------------------------------------------------------

describe('a function with no runtime configuration fails closed', () => {
  const saved = { ...process.env }

  beforeEach(() => {
    for (const name of FUNCTION_RUNTIME_VARS) delete process.env[name]
  })
  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in saved)) delete process.env[key]
    }
    Object.assign(process.env, saved)
  })

  /** A configuration that satisfies everything, so one value can be removed. */
  function configureAll() {
    process.env.SUPABASE_URL = 'https://example-project.supabase.co'
    process.env.SUPABASE_SECRET_KEY = 'sb_secret_exampleValueForTests'
    process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_exampleValueForTests'
    process.env.INGEST_SHARED_SECRET = 'example-operator-secret'
    process.env.SEC_EDGAR_USER_AGENT = 'Openi Test Radar ops@example.invalid'
    process.env.EGRESS_ALLOWLIST = 'sec.gov,data.sec.gov'
  }

  it('refuses every scope when nothing at all is configured', () => {
    for (const scope of Object.keys(ENV_SCOPES) as (keyof typeof ENV_SCOPES)[]) {
      expect(() => serverEnv(scope), `${scope} must refuse`).toThrow(MissingEnvError)
    }
  })

  it('fails closed without SUPABASE_URL', () => {
    configureAll()
    delete process.env.SUPABASE_URL
    expect(() => serverEnv('session')).toThrow(MissingEnvError)
    expect(() => serverEnv('evidence')).toThrow(MissingEnvError)
    expect(() => serverEnv('ingest')).toThrow(MissingEnvError)
  })

  it('fails closed without SUPABASE_SECRET_KEY', () => {
    configureAll()
    delete process.env.SUPABASE_SECRET_KEY
    expect(() => serverEnv('session')).toThrow(MissingEnvError)
    expect(() => serverEnv('ingest')).toThrow(MissingEnvError)
  })

  it('refuses manual ingestion without INGEST_SHARED_SECRET', () => {
    configureAll()
    delete process.env.INGEST_SHARED_SECRET
    // `admin-run` is the ONLY manual path into the collector; the scheduled
    // function has no HTTP route at all.
    expect(() => serverEnv('admin-run')).toThrow(MissingEnvError)
    expect(() => serverEnv('ingest')).toThrow(MissingEnvError)
    // The reads a signed-in person makes are unaffected.
    expect(() => serverEnv('session')).not.toThrow()
    expect(() => serverEnv('evidence')).not.toThrow()
  })

  it('prevents SEC retrieval without SEC_EDGAR_USER_AGENT', () => {
    configureAll()
    delete process.env.SEC_EDGAR_USER_AGENT
    expect(() => serverEnv('ingest')).toThrow(MissingEnvError)
  })

  it('prevents SEC retrieval when the user agent is a placeholder', () => {
    configureAll()
    // SEC's fair-access guidance asks for a real contact. An agent that names
    // nobody is the one that gets blocked, and blaming SEC for that later is
    // the outcome this refusal prevents.
    for (const placeholder of ['', '   ', 'TODO', 'changeme', 'example@example.com']) {
      process.env.SEC_EDGAR_USER_AGENT = placeholder
      const env = (() => {
        try {
          return serverEnv('core')
        } catch {
          return null
        }
      })()
      if (env) expect(() => assertSecUserAgentUsable(env)).toThrow()
    }
  })

  it('leaves authentication and ordinary reads working when ingestion config is absent', () => {
    // The whole point of scoping: a missing collector credential must not take
    // the sign-in gate down with it.
    process.env.SUPABASE_URL = 'https://example-project.supabase.co'
    process.env.SUPABASE_SECRET_KEY = 'sb_secret_exampleValueForTests'
    process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_exampleValueForTests'
    // No INGEST_SHARED_SECRET, no SEC_EDGAR_USER_AGENT, no EGRESS_ALLOWLIST.
    expect(() => serverEnv('session')).not.toThrow()
    expect(() => serverEnv('evidence')).not.toThrow()
    expect(() => serverEnv('status')).not.toThrow()
    expect(() => serverEnv('ingest')).toThrow(MissingEnvError)
  })

  it('reports readiness as booleans and categories, never as values', () => {
    configureAll()
    const report = describeServerVariables()
    const serialised = JSON.stringify(report)
    expect(serialised).not.toContain('sb_secret_exampleValueForTests')
    expect(serialised).not.toContain('example-operator-secret')
    expect(serialised).not.toContain('ops@example.invalid')
    for (const entry of report) {
      expect(typeof entry.present).toBe('boolean')
      expect(entry).not.toHaveProperty('value')
    }
  })
})

// ---------------------------------------------------------------------------
// 4. No outbound request happens before configuration is validated.
// ---------------------------------------------------------------------------

describe('egress is refused before any request leaves', () => {
  const ALLOW = ['sec.gov', 'data.sec.gov', 'www.sec.gov', 'mars.com', 'www.mars.com']

  /**
   * The real transport, stubbed globally.
   *
   * `EgressOptions` has no fetch-injection point, and an earlier draft of this
   * suite passed a `fetchImpl` option that does not exist, silenced the type
   * error with a cast, and then asserted that the never-called fake had not
   * been called. Three tests passed for that reason rather than because the
   * code refused anything. Stubbing the global is what actually exercises it.
   */
  let calls: string[] = []

  function transport(handler: (url: string) => Response) {
    calls = []
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      calls.push(url)
      return handler(url)
    })
  }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const never = () => {
    throw new Error('the transport must not be reached')
  }

  it('an empty allowlist denies everything', async () => {
    // `EGRESS_ALLOWLIST` unset parses to an empty array. Empty must mean "no
    // egress", not "no restriction" -- the difference between fail-closed and
    // fail-open is this one line.
    transport(never)
    await expect(
      egressGet('https://sec.gov/anything', { allowlist: [], userAgent: 'test' }),
    ).rejects.toBeInstanceOf(EgressDeniedError)
    expect(calls, 'nothing may be requested before the allowlist is consulted').toEqual([])
  })

  it('permits a host and its subdomains, and nothing that merely looks similar', () => {
    expect(hostAllowed('sec.gov', ALLOW)).toBe(true)
    expect(hostAllowed('data.sec.gov', ALLOW)).toBe(true)
    expect(hostAllowed('www.mars.com', ALLOW)).toBe(true)
    // The classic allowlist failures.
    expect(hostAllowed('notsec.gov', ALLOW)).toBe(false)
    expect(hostAllowed('sec.gov.attacker.net', ALLOW)).toBe(false)
    expect(hostAllowed('marsx.com', ALLOW)).toBe(false)
    expect(hostAllowed('evil.example', ALLOW)).toBe(false)
  })

  const REFUSED_URLS: [string, string][] = [
    ['a plain http downgrade', 'http://sec.gov/x'],
    ['a non-http scheme', 'file:///etc/passwd'],
    ['a host outside the allowlist', 'https://evil.example/x'],
    ['a lookalike suffix', 'https://sec.gov.attacker.net/x'],
    ['userinfo in front of an allowed host', 'https://evil.example@sec.gov/x'],
    ['a password in front of an allowed host', 'https://user:pw@sec.gov/x'],
    ['an allowed host on a non-default port', 'https://sec.gov:8443/x'],
    ['an IPv4 literal', 'https://192.0.2.1/x'],
    ['an IPv6 literal', 'https://[2001:db8::1]/x'],
    ['a loopback literal', 'https://127.0.0.1/x'],
  ]

  for (const [name, url] of REFUSED_URLS) {
    it(`refuses ${name}, without requesting it`, async () => {
      transport(never)
      await expect(
        egressGet(url, { allowlist: ALLOW, userAgent: 'test' }),
      ).rejects.toBeInstanceOf(EgressDeniedError)
      expect(calls, `${url} must be refused before any request`).toEqual([])
    })
  }

  it('does make the request when the URL is genuinely allowed', async () => {
    // The positive control. Without it every refusal above could be passing
    // because the transport is broken rather than because the guard works.
    transport(() => new Response('ok', { status: 200 }))
    const result = await egressGet('https://data.sec.gov/submissions/x.json', {
      allowlist: ALLOW,
      userAgent: 'test',
    })
    expect(result.status).toBe(200)
    expect(calls).toHaveLength(1)
  })

  it('refuses a redirect that escapes the allowlist, and records only safe metadata', async () => {
    transport(() =>
      new Response('', { status: 302, headers: { location: 'https://evil.example/landing' } }),
    )
    const error = await egressGet('https://sec.gov/start', {
      allowlist: ALLOW,
      userAgent: 'test',
    }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(EgressDeniedError)
    expect(calls, 'the first hop is made; the escape is refused before the second').toHaveLength(1)

    // The message names the host and the allowlist. It must never carry a body,
    // a credential, or a query string that might hold one.
    const message = (error as Error).message
    expect(message).toContain('evil.example')
    expect(message).not.toContain('/landing')
    expect(message).not.toMatch(/password|token|secret|authorization/i)
  })

  it('refuses a redirect that downgrades the protocol', async () => {
    transport(() =>
      new Response('', { status: 301, headers: { location: 'http://sec.gov/insecure' } }),
    )
    const error = await egressGet('https://sec.gov/start', {
      allowlist: ALLOW,
      userAgent: 'test',
    }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(EgressDeniedError)
    expect(calls).toHaveLength(1)
  })

  it('refuses a redirect to an allowed host on a strange port', async () => {
    transport(() =>
      new Response('', { status: 302, headers: { location: 'https://sec.gov:8443/x' } }),
    )
    const error = await egressGet('https://sec.gov/start', {
      allowlist: ALLOW,
      userAgent: 'test',
    }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(EgressDeniedError)
    expect(calls).toHaveLength(1)
  })

  it('refuses a redirect that adds userinfo to an allowed host', async () => {
    transport(() =>
      new Response('', { status: 302, headers: { location: 'https://someone@sec.gov/x' } }),
    )
    const error = await egressGet('https://sec.gov/start', {
      allowlist: ALLOW,
      userAgent: 'test',
    }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(EgressDeniedError)
  })
})

// ---------------------------------------------------------------------------
// 5. The allowlist the runbook tells an operator to type is the one the
//    connectors need — no wider, and not narrower.
// ---------------------------------------------------------------------------

/**
 * `EGRESS_ALLOWLIST` is the one runtime variable whose *value* has to be
 * written down for a human to copy, so the written value can drift from the
 * code the way a comment drifts from a function.
 *
 * It drifts in two directions and they are not symmetric. Too narrow and the
 * runner refuses to start a source, naming the missing host — loud, and fixed
 * in a minute. Too wide and nothing fails at all: a bare `sec.gov` quietly
 * authorises every host SEC ever publishes, and no test, log line or run status
 * would ever mention it. Only this test would.
 */
describe('the documented allowlist matches what the connectors declare', () => {
  /** Exactly the value in docs/ENVIRONMENT.md and the runbook. */
  const COHORT_ALLOWLIST = 'data.sec.gov,www.sec.gov,www.mars.com'
  const entries = COHORT_ALLOWLIST.split(',')

  it('permits every host the SEC and Mars connectors declare', () => {
    for (const host of [...SEC_HOSTS, ...MARS_HOSTS]) {
      expect(hostAllowed(host, entries), `${host} must be permitted`).toBe(true)
    }
  })

  /*
     The runner refuses a source whose declared hosts are not ALL permitted,
     rather than merging them in — a connector that could extend the allowlist
     is not an allowlist. So this is the same assertion the runner makes at run
     time, made here where it does not cost a failed hosted run to discover.
  */
  it('leaves no declared host for the runner to reject', () => {
    const missing = [...SEC_HOSTS, ...MARS_HOSTS].filter(
      (host) => !entries.some((entry) => host === entry || host.endsWith(`.${entry}`)),
    )
    expect(missing).toEqual([])
  })

  it('names exact hosts, never a bare parent domain', () => {
    // A registrable domain has one dot. Every entry here must be more specific
    // than that, because an entry covers everything beneath it.
    for (const entry of entries) {
      expect(entry.split('.').length, `${entry} is a parent domain`).toBeGreaterThan(2)
    }
    expect(entries).not.toContain('sec.gov')
    expect(entries).not.toContain('mars.com')
  })

  it('grants nothing a connector did not ask for', () => {
    const declared = new Set<string>([...SEC_HOSTS, ...MARS_HOSTS])
    for (const entry of entries) {
      expect(declared.has(entry), `${entry} is not requested by any connector`).toBe(true)
    }
  })

  it('contains no wildcard, scheme, port, path or space', () => {
    for (const entry of entries) {
      expect(entry).toMatch(/^[a-z0-9.-]+$/)
      expect(entry).not.toContain('*')
      expect(entry).not.toContain(':')
      expect(entry).not.toContain('/')
    }
  })

  it('still refuses a lookalike of every entry', () => {
    for (const entry of entries) {
      expect(hostAllowed(`not${entry}`, entries)).toBe(false)
      expect(hostAllowed(`${entry}.attacker.example`, entries)).toBe(false)
    }
  })

  /*
     The model gateway calls api.anthropic.com directly rather than through the
     egress gateway. That is deliberate — the allowlist governs SOURCE
     retrieval, where "what did we read and from where" has to be answerable
     from evidence — but it means adding the host here would achieve nothing,
     and somebody will eventually try.
  */
  it('does not carry the model endpoint, which does not use this allowlist', () => {
    expect(entries).not.toContain('api.anthropic.com')
    expect(entries).not.toContain('anthropic.com')
  })

  it('is the value both documents actually tell the operator to enter', () => {
    for (const doc of ['docs/ENVIRONMENT.md', 'docs/HOSTED_VALIDATION_RUNBOOK.md']) {
      const text = readFileSync(join(APP_ROOT, '..', doc), 'utf8')
      expect(text, `${doc} must quote the cohort allowlist`).toContain(COHORT_ALLOWLIST)
      // And must not still be telling anyone to type the old, wider value.
      expect(text).not.toContain('sec.gov,data.sec.gov,www.sec.gov,mars.com')
    }
  })
})
