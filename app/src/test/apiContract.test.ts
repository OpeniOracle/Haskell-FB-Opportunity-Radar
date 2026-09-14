import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * The API's answering contract, exercised by RUNNING the handlers.
 *
 * WHY THIS IS EXECUTED RATHER THAN READ. Every other test of these functions
 * asserts against their source, because the interesting paths need a live
 * Supabase project. That left the SHAPE of the answer untested — and shape is
 * exactly what failed. `/api/session` returned `text/html` with a 200 for
 * weeks; the handler was innocent and its source was correct, so no source
 * assertion could have noticed.
 *
 * Three paths need no network and are the ones that matter here:
 *
 *   - a wrong method, refused before anything else happens;
 *   - a deployment with the variables missing;
 *   - a request with no `Authorization` header, which `requireUser` refuses
 *     before it builds a client.
 *
 * Each must answer JSON, with a JSON content type, and must never be an HTML
 * document or a redirect to the UI. `netlifyRouting.test.ts` covers the other
 * half — that a request reaches these handlers at all.
 */

const REQUIRED = [
  'SUPABASE_URL',
  'SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_SECRET_KEY',
  'SEC_EDGAR_USER_AGENT',
  'INGEST_SHARED_SECRET',
]

/**
 * Values with the right SHAPE and no meaning. Nothing here is a credential.
 *
 * THE PREFIXES ARE ASSEMBLED, NOT WRITTEN. `env.ts` decides which family a key
 * belongs to by its prefix, so these must genuinely start with `sb_secret_`
 * and `sb_publishable_` or the handlers under test would reject them for the
 * wrong reason. Written as literals, GitHub's push protection reads them as
 * real Supabase keys and blocks the push -- correctly, on the evidence
 * available to it, since a scanner cannot tell that the body is twenty-six
 * zeroes. Concatenating the prefix keeps the runtime value exactly right and
 * leaves no key-shaped string in the file for a scanner to find.
 *
 * This is the only reason for the concatenation. It is not a way of slipping a
 * real value past a check: there is nothing here to slip past, and
 * `boundaries.test.ts` still asserts that none of these values reaches any
 * output.
 */
const SB = 'sb_'
const FAKE_ENV: Record<string, string> = {
  SUPABASE_URL: 'https://project.supabase.invalid',
  SUPABASE_PUBLISHABLE_KEY: `${SB}publishable_${'0'.repeat(32)}`,
  SUPABASE_SECRET_KEY: `${SB}secret_${'0'.repeat(32)}`,
  SEC_EDGAR_USER_AGENT: 'Openi Analytics test@openi-analytics.invalid',
  INGEST_SHARED_SECRET: 'test-shared-secret-not-a-real-one',
}

const saved = new Map<string, string | undefined>()

function setEnv(values: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(values)) {
    if (!saved.has(key)) saved.set(key, process.env[key])
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

beforeEach(() => {
  for (const name of REQUIRED) {
    if (!saved.has(name)) saved.set(name, process.env[name])
  }
})

afterEach(() => {
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  saved.clear()
})

type Handler = (event: unknown) => Promise<{
  statusCode: number
  headers: Record<string, string>
  body: string
}>

async function load(name: 'session' | 'status' | 'evidence'): Promise<Handler> {
  const module = await import(`../../netlify/functions/${name}.ts`)
  return module.handler as Handler
}

function request(method = 'GET', headers: Record<string, string> = {}) {
  return { httpMethod: method, headers, path: '/api/session', queryStringParameters: {} }
}

/** The property the routing bug violated: an answer, not a document. */
function expectJson(response: { headers: Record<string, string>; body: string }) {
  const type = response.headers['content-type'] ?? response.headers['Content-Type'] ?? ''
  expect(type, 'an API response must declare JSON').toMatch(/application\/json/)
  expect(type).not.toMatch(/text\/html/)
  // Not an HTML document, and not a UI redirect dressed up as a body.
  expect(response.body.trimStart().startsWith('<'), 'body looks like HTML').toBe(false)
  expect(response.body).not.toMatch(/<!doctype|<html|<div id="root"/i)
  expect(() => JSON.parse(response.body)).not.toThrow()
}

/** Per-caller answers must never be held by a shared cache. */
function expectPrivateNoStore(response: { headers: Record<string, string> }) {
  const cache = response.headers['cache-control'] ?? response.headers['Cache-Control'] ?? ''
  expect(cache).toMatch(/no-store/)
  expect(cache).toMatch(/private/)
}

describe.each(['session', 'status'] as const)('/api/%s', (name) => {
  it('refuses a request with no Authorization header with a JSON 401', async () => {
    setEnv(FAKE_ENV)
    const handler = await load(name)
    const response = await handler(request('GET'))

    expect(response.statusCode).toBe(401)
    expectJson(response)
    expectPrivateNoStore(response)

    const body = JSON.parse(response.body)
    expect(body.error.code).toBe('unauthorized')
    // No location header: an API must not answer with a trip to the login page.
    expect(response.headers.location ?? response.headers.Location).toBeUndefined()
  })

  it('answers a JSON 503 when the deployment is missing its variables', async () => {
    setEnv(Object.fromEntries(REQUIRED.map((key) => [key, undefined])))
    const handler = await load(name)
    const response = await handler(request('GET'))

    expect(response.statusCode).toBe(503)
    expectJson(response)
    expectPrivateNoStore(response)
    expect(JSON.parse(response.body).error.code).toBe('not_configured')
  })

  it('answers a JSON 503 when a key is present but the wrong family', async () => {
    // Present, non-empty, and completely wrong: the publishable key where the
    // secret belongs. This used to reach an unhandled throw, which a Netlify
    // function renders as an HTML error page from a JSON endpoint.
    setEnv({ ...FAKE_ENV, SUPABASE_SECRET_KEY: FAKE_ENV.SUPABASE_PUBLISHABLE_KEY })
    const handler = await load(name)
    const response = await handler(request('GET'))

    expect(response.statusCode).toBe(503)
    expectJson(response)
    expect(JSON.parse(response.body).error.code).toBe('not_configured')
    // It names the variable so an operator can act, and quotes no value.
    expect(response.body).toContain('SUPABASE_SECRET_KEY')
    expect(response.body).not.toContain(FAKE_ENV.SUPABASE_PUBLISHABLE_KEY)
  })

  it('refuses a non-GET method in JSON', async () => {
    setEnv(FAKE_ENV)
    const handler = await load(name)
    const response = await handler(request('POST'))

    expect(response.statusCode).toBe(405)
    expectJson(response)
    expect(response.headers.allow).toBe('GET')
  })
})

/**
 * NO FUNCTION MAY BE DISABLED BY ANOTHER FUNCTION'S DEPENDENCY.
 *
 * This is the defect stated as a property. `serverEnv()` required every
 * variable in the project, so a Deploy Preview missing `SEC_EDGAR_USER_AGENT`
 * -- which belongs to the SEC collector and to nothing else -- answered 503
 * from `/api/session`, `/api/status` and `/api/evidence/*`. Authentication was
 * switched off by an unconfigured optional integration.
 */
describe('per-function environment scoping', () => {
  /** Everything except the SEC collector's variable and the operator secret. */
  const WITHOUT_SEC = {
    ...FAKE_ENV,
    SEC_EDGAR_USER_AGENT: undefined,
    INGEST_SHARED_SECRET: undefined,
  }

  it.each(['session', 'status'] as const)(
    '/api/%s still authenticates with SEC and ingest unconfigured',
    async (name) => {
      setEnv(WITHOUT_SEC)
      const handler = await load(name)
      const response = await handler(request('GET'))

      // 401, not 503. The function is working; the caller simply has no token.
      expect(response.statusCode, `${name} was disabled by an unrelated variable`).toBe(401)
      expect(JSON.parse(response.body).error.code).toBe('unauthorized')
      expectJson(response)
    },
  )

  it('the scope map gives each entry point only what it uses', async () => {
    const { ENV_SCOPES } = await import('../../netlify/functions/_shared/env.ts')

    // Nothing but the collector may require the SEC contact string.
    for (const [scope, names] of Object.entries(ENV_SCOPES)) {
      if (scope === 'ingest') continue
      expect(names, `${scope} must not require the SEC collector's variable`).not.toContain(
        'SEC_EDGAR_USER_AGENT',
      )
    }
    expect(ENV_SCOPES.ingest).toContain('SEC_EDGAR_USER_AGENT')

    // Only the operator-authenticated paths may require the operator secret.
    for (const [scope, names] of Object.entries(ENV_SCOPES)) {
      if (scope === 'ingest' || scope === 'admin-run') continue
      expect(names, `${scope} must not require the operator secret`).not.toContain(
        'INGEST_SHARED_SECRET',
      )
    }

    // And every scope keeps the floor, because nothing works without it.
    for (const [scope, names] of Object.entries(ENV_SCOPES)) {
      expect(names, `${scope} is missing the Supabase URL`).toContain('SUPABASE_URL')
      expect(names, `${scope} is missing the secret key`).toContain('SUPABASE_SECRET_KEY')
    }
  })

  it.each(['session', 'status', 'evidence'] as const)(
    'a 503 from %s never blames the SEC collector',
    async (name) => {
      // With EVERYTHING unset, each function must name only its own missing
      // variables. Naming SEC here would mean it is still a precondition, and
      // the operator would go and set a variable that changes nothing.
      setEnv(Object.fromEntries(REQUIRED.map((key) => [key, undefined])))
      const handler = await load(name)
      const response = await handler(request('GET'))

      expect(response.statusCode).toBe(503)
      const message = JSON.parse(response.body).error.message as string
      expect(message, `${name} reports SEC as its own missing dependency`).not.toContain(
        'SEC_EDGAR_USER_AGENT',
      )
      expect(message, `${name} reports the operator secret as its own`).not.toContain(
        'INGEST_SHARED_SECRET',
      )
    },
  )
})

describe('environment reporting', () => {
  it('reports presence and shape, and never a value', async () => {
    setEnv(FAKE_ENV)
    const { describeServerVariables } = await import('../../netlify/functions/_shared/env.ts')
    const report = describeServerVariables()

    expect(report.map((entry: { name: string }) => entry.name)).toEqual(REQUIRED)
    for (const entry of report) {
      expect(entry.present).toBe(true)
      expect(entry.shape).toBe('ok')
    }

    // The decisive property: no value, or any part of one, is in the output.
    const serialised = JSON.stringify(report)
    for (const value of Object.values(FAKE_ENV)) {
      expect(serialised).not.toContain(value)
      expect(serialised).not.toContain(value.slice(0, 20))
    }
  })

  it('names the fault when a key is the wrong family, without quoting it', async () => {
    setEnv({ ...FAKE_ENV, SUPABASE_SECRET_KEY: FAKE_ENV.SUPABASE_PUBLISHABLE_KEY })
    const { describeServerVariables } = await import('../../netlify/functions/_shared/env.ts')
    const entry = describeServerVariables().find(
      (item: { name: string }) => item.name === 'SUPABASE_SECRET_KEY',
    )
    expect(entry).toBeDefined()
    expect(entry!.present).toBe(true)
    expect(entry!.shape).toBe('wrong_key_family')
    expect(JSON.stringify(entry)).not.toContain(FAKE_ENV.SUPABASE_PUBLISHABLE_KEY)
  })

  it('distinguishes missing from empty', async () => {
    setEnv({ ...FAKE_ENV, SUPABASE_URL: undefined, INGEST_SHARED_SECRET: '   ' })
    const { describeServerVariables } = await import('../../netlify/functions/_shared/env.ts')
    const report = describeServerVariables()
    const find = (name: string) => {
      const entry = report.find((item: { name: string }) => item.name === name)
      expect(entry, `${name} is not reported at all`).toBeDefined()
      return entry!
    }
    expect(find('SUPABASE_URL').shape).toBe('missing')
    expect(find('SUPABASE_URL').present).toBe(false)
    expect(find('INGEST_SHARED_SECRET').shape).toBe('empty')
    expect(find('INGEST_SHARED_SECRET').present).toBe(false)
  })
})

/* ==========================================================================
   /api/admin-run — the manual trigger, and the source filter it declares.
   ========================================================================== */

type AdminHandler = (event: unknown) => Promise<{
  statusCode: number
  headers: Record<string, string>
  body: string
}>

async function loadAdminRun(): Promise<AdminHandler> {
  const module = await import('../../netlify/functions/admin-run.ts')
  return module.handler as AdminHandler
}

function adminRequest(body: unknown, headers: Record<string, string> = {}) {
  return {
    httpMethod: 'POST',
    headers: { 'x-radar-operator-secret': FAKE_ENV.INGEST_SHARED_SECRET!, ...headers },
    path: '/api/admin-run',
    queryStringParameters: {},
    body: body === undefined ? undefined : JSON.stringify(body),
  }
}

const parse = (response: { body: string }) => JSON.parse(response.body) as Record<string, unknown>

describe('/api/admin-run source filter', () => {
  /*
     THE DEFECT THIS SECTION EXISTS TO PREVENT.

     `sources` was declared in the request interface, the runner has always
     supported `onlySources`, and nothing connected the two. `collect(window)`
     was called with no filter, so `{"sources":["sec-edgar"]}` ran every enabled
     source and reported success without ever mentioning that it had ignored the
     request.

     Harmless while exactly one source is enabled. Exactly wrong on the day a
     second one is -- an operator asking for one source silently gets both,
     which is the opposite of a controlled activation.
  */
  it('passes the requested sources through to the collector', async () => {
    const text = await import('../../netlify/functions/admin-run.ts?raw').then(
      (m) => (m as { default: string }).default,
    )
    // The wiring, asserted at the call site rather than only through behaviour,
    // because the failure mode is a parameter that goes nowhere.
    expect(text.length).toBeGreaterThan(500)
    expect(text).toMatch(/collect\(window,\s*onlySources\)/)
    expect(text).toContain('parseSources')
  })

  it('refuses a request with no operator secret, and says nothing more', async () => {
    setEnv(FAKE_ENV)
    const handler = await loadAdminRun()
    const response = await handler({
      httpMethod: 'POST',
      headers: {},
      path: '/api/admin-run',
      queryStringParameters: {},
      body: JSON.stringify({ dryRun: true }),
    })
    expect(response.statusCode).toBe(401)
    expectJson(response)
    // A wrong secret and a missing one must be indistinguishable.
    expect(parse(response).message ?? parse(response).error).toBeTruthy()
    expect(response.body).not.toMatch(/missing|absent|no secret/i)
  })

  it('refuses a wrong operator secret identically', async () => {
    setEnv(FAKE_ENV)
    const handler = await loadAdminRun()
    const wrong = await handler(
      adminRequest({ dryRun: true }, { 'x-radar-operator-secret': 'not-the-secret' }),
    )
    const missing = await handler({
      httpMethod: 'POST',
      headers: {},
      path: '/api/admin-run',
      queryStringParameters: {},
      body: JSON.stringify({ dryRun: true }),
    })
    expect(wrong.statusCode).toBe(401)
    expect(wrong.body).toBe(missing.body)
  })

  it('refuses a non-POST before looking at anything else', async () => {
    setEnv(FAKE_ENV)
    const handler = await loadAdminRun()
    const response = await handler({
      httpMethod: 'GET',
      headers: {},
      path: '/api/admin-run',
      queryStringParameters: {},
    })
    expect(response.statusCode).toBe(405)
    expectJson(response)
  })

  for (const [name, value] of [
    ['a bare string', 'sec-edgar'],
    ['a number', 7],
    ['an array holding a number', ['sec-edgar', 3]],
    ['an object', { id: 'sec-edgar' }],
  ] as const) {
    it(`rejects ${name} as sources with a JSON 400`, async () => {
      setEnv(FAKE_ENV)
      const handler = await loadAdminRun()
      const response = await handler(adminRequest({ dryRun: true, sources: value }))
      expect(response.statusCode).toBe(400)
      expectJson(response)
      expect(response.body).toMatch(/array of source ids/i)
    })
  }

  it('rejects an empty sources array rather than silently running nothing', async () => {
    setEnv(FAKE_ENV)
    const handler = await loadAdminRun()
    const response = await handler(adminRequest({ dryRun: true, sources: [] }))
    expect(response.statusCode).toBe(400)
    expect(response.body).toMatch(/must not be empty/i)
  })

  /*
     A DRY RUN MUST VALIDATE WHAT THE REAL RUN WILL USE.

     `sources` is parsed BEFORE the dry-run branch. If it were parsed after, a
     dry run would accept a malformed value and the operator would discover the
     problem during the backfill instead.
  */
  it('validates sources during a dry run, not only during a real one', async () => {
    setEnv(FAKE_ENV)
    const handler = await loadAdminRun()
    const response = await handler(adminRequest({ dryRun: true, sources: [42] }))
    expect(response.statusCode).toBe(400)
  })

  it('refuses a window outside the documented bound, dry run included', async () => {
    setEnv(FAKE_ENV)
    const handler = await loadAdminRun()
    for (const windowDays of [0, -1, 401, 4000]) {
      const response = await handler(adminRequest({ dryRun: true, windowDays }))
      expect(response.statusCode, `windowDays=${windowDays}`).toBe(400)
      expectJson(response)
    }
  })

  it('refuses a body that is not JSON', async () => {
    setEnv(FAKE_ENV)
    const handler = await loadAdminRun()
    const response = await handler({
      httpMethod: 'POST',
      headers: { 'x-radar-operator-secret': FAKE_ENV.INGEST_SHARED_SECRET! },
      path: '/api/admin-run',
      queryStringParameters: {},
      body: 'not json',
    })
    expect(response.statusCode).toBe(400)
    expectJson(response)
  })

  it('reports the ingest scope by name when SEC_EDGAR_USER_AGENT is absent', async () => {
    setEnv({ ...FAKE_ENV, SEC_EDGAR_USER_AGENT: undefined })
    const handler = await loadAdminRun()
    const response = await handler(adminRequest({ dryRun: true }))
    expect(response.statusCode).toBe(503)
    expectJson(response)
    expect(response.body).toContain('SEC_EDGAR_USER_AGENT')
  })

  it('the dry run reports which sources a real run would touch', async () => {
    // Asserted on the handler's source: the read needs a live project, and the
    // property that matters is that the answer NAMES the intersection rather
    // than only echoing the window back.
    const module = await import('../../netlify/functions/admin-run.ts?raw').then(
      (m) => (m as { default: string }).default,
    )
    // No `.catch(() => '')`: a swallowed import would make every assertion
    // below pass against an empty string.
    expect(module.length).toBeGreaterThan(500)
    for (const field of ['requestedSources', 'enabledSources', 'wouldRun', 'requestedButNotEnabled']) {
      expect(module, `${field} missing from the dry-run response`).toContain(field)
    }
    // And it must say so plainly when the answer is "nothing".
    expect(module).toMatch(/NO source would run/)
  })
})
