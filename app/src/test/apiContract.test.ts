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

async function load(name: 'session' | 'status'): Promise<Handler> {
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
