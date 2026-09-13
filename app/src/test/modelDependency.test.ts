import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { APP_ROOT } from '@/test/paths'
import { modelGateway, unavailableGateway } from '../../netlify/functions/_shared/modelGateway'
import { modelEnv } from '../../netlify/functions/_shared/env'
import {
  PIPELINE_VERSION,
  runConnectorPass,
} from '../../netlify/functions/_shared/connectors/pipeline'
import { classifyText } from '../../netlify/functions/_shared/connectors/classify'
import type {
  Connector,
  ConnectorContext,
  DiscoveredDocument,
  RetrievedDocument,
} from '../../netlify/functions/_shared/connectors/types'

/**
 * WHAT THE MODEL IS ACTUALLY FOR, ASSERTED RATHER THAN DESCRIBED.
 *
 * The documentation said classification "fails closed" without `MODEL_API_KEY`,
 * which reads as: no key, no classification, no opportunities. That is not what
 * the code does, and the difference decides whether a model credential is a
 * precondition for the first cohort or not.
 *
 * `modelGateway` is imported by exactly ONE file in this repository —
 * `netlify/functions/status.ts` — and only to report whether it is configured.
 * The ingestion pipeline never calls it. Classification is
 * `connectors/classify.ts`: deterministic, regex-based, requiring a project
 * action, a physical asset and a corroborating fact to co-occur in one window.
 *
 * So the honest statement is stronger than "optional": the model is currently
 * UNUSED by every stage that produces a row a user can see. This suite pins
 * that, in both directions — the pipeline must not start depending on a model
 * silently, and the gateway must not start being reachable without a key.
 */

const ROOT = join(APP_ROOT, '..')

/* ------------------------------------------------------------ the fixture */

/**
 * A recorded SEC 8-K exhibit passage. Real shape, fabricated company, so it can
 * live in `src/` without naming a pilot filer.
 */
const RECORDED_BODY = `
Example Foods, Inc. announced today that it will build a new 450,000 square foot
processing plant in Bowling Green, Kentucky. The company said the $300 million
facility is expected to begin production by the end of 2027 and will create
approximately 400 jobs.
`.trim()

/** A passage that is deliberately NOT a signal: a mention with no corroboration. */
const RECORDED_NON_SIGNAL = `
Example Foods, Inc. announced a new partnership with a national retailer today,
expanding its product line across additional stores. The company said it remains
focused on its existing facility network and long term growth.
`.trim()

const COMPANY = {
  id: '11111111-1111-4111-8111-111111111111',
  entity_key: 'example-foods',
  canonical_name: 'Example Foods, Inc.',
}

function doc(id: string, title: string): DiscoveredDocument {
  return {
    sourceDocumentId: id,
    url: `https://www.example.invalid/${id}.htm`,
    canonicalUrl: `https://www.example.invalid/${id}.htm`,
    title,
    publishedAt: '2026-03-04T10:00:00.000Z',
    publishedPrecision: 'minute',
    documentType: '8-K',
    organizationEntityKey: COMPANY.entity_key,
    discoveryPath: 'recorded-fixture',
    metadata: { accessionNumber: id },
  }
}

function retrieved(document: DiscoveredDocument, text: string): RetrievedDocument {
  return {
    document,
    finalUrl: document.url,
    status: 200,
    bytes: new TextEncoder().encode(text),
    contentHash: `hash-${document.sourceDocumentId}`,
    mimeType: 'text/html',
    retrievedAt: '2026-03-05T00:00:00.000Z',
    etag: null,
    lastModified: null,
    unchanged: false,
    extractedText: text,
    extractionStatus: 'success',
  }
}

const DOCUMENTS: readonly [DiscoveredDocument, string][] = [
  [doc('0000000001-26-000001', 'Example Foods announces Kentucky plant'), RECORDED_BODY],
  [doc('0000000001-26-000002', 'Example Foods announces retail partnership'), RECORDED_NON_SIGNAL],
]

const recordedConnector: Connector = {
  id: 'recorded',
  version: '1.0.0',
  sourceId: 'recorded-source',
  hosts: ['www.example.invalid'],
  async discover() {
    return { kind: 'documents', documents: DOCUMENTS.map(([d]) => d) }
  },
  async retrieve(_ctx, document) {
    const found = DOCUMENTS.find(([d]) => d.sourceDocumentId === document.sourceDocumentId)
    if (!found) throw new Error('not in the recording')
    return retrieved(found[0], found[1])
  },
}

/* ------------------------------------------------- an in-memory Supabase */

interface Row {
  [key: string]: unknown
}

/**
 * Enough of PostgREST's builder to run the pipeline's writes, and nothing more.
 *
 * It records every row so the assertion can be "these exact rows were written",
 * which is the only form of the question that answers "what exists in the
 * database without a model key".
 */
function memoryClient() {
  const tables = new Map<string, Row[]>()
  let seq = 0

  function rowsOf(table: string): Row[] {
    if (!tables.has(table)) tables.set(table, [])
    return tables.get(table)!
  }

  function builder(table: string) {
    const filters: [string, unknown][] = []
    let pending: { op: 'select' | 'insert' | 'update' | 'upsert'; payload?: Row } | null = null

    const matches = (row: Row) => filters.every(([k, v]) => row[k] === v)

    const api: Record<string, unknown> = {
      select() {
        if (pending?.op === 'insert' || pending?.op === 'update') return api
        pending = { op: 'select' }
        return api
      },
      eq(column: string, value: unknown) {
        filters.push([column, value])
        return api
      },
      is(column: string, value: unknown) {
        filters.push([column, value])
        return api
      },
      insert(payload: Row) {
        pending = { op: 'insert', payload }
        return api
      },
      update(payload: Row) {
        pending = { op: 'update', payload }
        return api
      },
      upsert(payload: Row) {
        pending = { op: 'upsert', payload }
        return api
      },
      async maybeSingle() {
        const hit = rowsOf(table).find(matches)
        return { data: hit ?? null, error: null }
      },
      async single() {
        if (pending?.op === 'insert') {
          seq += 1
          const row = { id: `${table}-${seq}`, ...pending.payload }
          rowsOf(table).push(row)
          return { data: { id: row.id }, error: null }
        }
        const hit = rowsOf(table).find(matches)
        return { data: hit ?? null, error: null }
      },
      // Awaited without a terminal call: update, upsert, or a plain select.
      then(resolve: (r: { data: Row[] | null; error: null }) => unknown) {
        if (pending?.op === 'update') {
          for (const row of rowsOf(table).filter(matches)) Object.assign(row, pending.payload)
          return resolve({ data: null, error: null })
        }
        if (pending?.op === 'upsert') {
          rowsOf(table).push({ id: `${table}-${(seq += 1)}`, ...pending.payload })
          return resolve({ data: null, error: null })
        }
        return resolve({ data: rowsOf(table).filter(matches), error: null })
      },
    }
    return api
  }

  return {
    client: { from: (table: string) => builder(table) } as never,
    tables,
    rows: (table: string) => rowsOf(table),
  }
}

function context(): ConnectorContext {
  return {
    userAgent: 'test',
    allowlist: ['www.example.invalid'],
    get: async () => {
      throw new Error('the recorded connector performs no egress')
    },
    pacer: { wait: async () => {} } as never,
    cache: { read: async () => null, write: async () => {} },
    now: () => new Date('2026-03-05T00:00:00.000Z'),
    config: {},
    window: { start: '2025-03-05T00:00:00.000Z', end: '2026-03-05T00:00:00.000Z' },
    log: () => {},
  }
}

/** Every model variable, and the four permutations that matter. */
const MODEL_VARS = ['MODEL_API_KEY', 'MODEL_PROVIDER', 'MODEL_ID', 'MODEL_PROMPT_VERSION'] as const

const PERMUTATIONS: readonly { name: string; env: Record<string, string> }[] = [
  { name: 'no model variables at all', env: {} },
  {
    name: 'every model variable set',
    env: {
      MODEL_API_KEY: 'test-key-not-a-real-credential',
      MODEL_PROVIDER: 'anthropic',
      MODEL_ID: 'claude-test-model',
      MODEL_PROMPT_VERSION: 'v7',
    },
  },
  {
    name: 'provider and id set but NO key',
    env: { MODEL_PROVIDER: 'anthropic', MODEL_ID: 'claude-test-model' },
  },
  {
    name: 'a key with no provider, id or prompt version',
    env: { MODEL_API_KEY: 'test-key-not-a-real-credential' },
  },
]

async function runOnce() {
  const { client, rows } = memoryClient()
  const result = await runConnectorPass(
    client,
    recordedConnector,
    context(),
    [COMPANY],
    'run-1',
    1,
  )
  return { result, rows }
}

/** Everything that decides what a user sees, with generated ids removed. */
function shape(rows: (t: string) => Row[]) {
  const strip = (r: Row) => {
    const rest = { ...r }
    delete rest.id
    return rest
  }
  return {
    evidence: rows('evidence').map(strip),
    signals: rows('signals').map(strip),
    opportunities: rows('opportunities').map(strip),
    signal_evidence: rows('signal_evidence').map(strip),
    opportunity_signals: rows('opportunity_signals').map(strip),
  }
}

let savedEnv: NodeJS.ProcessEnv
let fetchCalls: string[]

beforeEach(() => {
  savedEnv = { ...process.env }
  for (const name of MODEL_VARS) delete process.env[name]
  fetchCalls = []
  vi.stubGlobal('fetch', async (input: unknown) => {
    fetchCalls.push(String(input))
    throw new Error('no network in this suite')
  })
})

afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key]
  Object.assign(process.env, savedEnv)
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
// 1. The pipeline does not consult a model, under any configuration.
// ---------------------------------------------------------------------------

describe('the ingestion pipeline is identical with and without model configuration', () => {
  it('writes the same rows under every permutation of the four model variables', async () => {
    const results: Record<string, unknown> = {}

    for (const permutation of PERMUTATIONS) {
      for (const name of MODEL_VARS) delete process.env[name]
      Object.assign(process.env, permutation.env)

      const { result, rows } = await runOnce()
      results[permutation.name] = { counters: result.counters, shape: shape(rows) }

      expect(result.runStatus, permutation.name).toBe('success')
      // No request left the process under ANY permutation: the pipeline does
      // not call a model, and the connector is recorded.
      expect(fetchCalls, `${permutation.name} made a request`).toEqual([])
    }

    const baseline = JSON.stringify(results['no model variables at all'])
    for (const permutation of PERMUTATIONS) {
      expect(
        JSON.stringify(results[permutation.name]),
        `${permutation.name} produced a different result from the unconfigured run`,
      ).toBe(baseline)
    }
  })

  it('creates evidence, a signal and an opportunity with no model key present', async () => {
    const { result, rows } = await runOnce()

    expect(result.counters.documentsDiscovered).toBe(2)
    expect(result.counters.documentsRetrieved).toBe(2)
    // Both documents are STORED. Only one carries a qualifying signal.
    expect(rows('evidence')).toHaveLength(2)
    expect(result.counters.evidenceCreated).toBe(2)
    expect(result.counters.documentsAccepted).toBe(1)
    expect(result.counters.documentsRejected).toBe(1)

    expect(rows('signals')).toHaveLength(1)
    expect(rows('opportunities')).toHaveLength(1)
    expect(rows('signal_evidence')).toHaveLength(1)
    expect(rows('opportunity_signals')).toHaveLength(1)
  })

  it('retains the non-qualifying document rather than discarding or failing it', async () => {
    const { rows } = await runOnce()
    const statuses = rows('evidence').map((r) => r.classification_status)
    // 'not_relevant' means EVALUATED and found to carry no signal. It is not
    // 'unclassified' (never evaluated) and there is no 'failed' state at all --
    // the document is kept, with its bytes hash, URL and excerpt.
    expect(statuses.sort()).toEqual(['not_relevant', 'supporting_evidence'])
    expect(statuses).not.toContain('failed')
    expect(rows('evidence').every((r) => r.review_status === 'unreviewed')).toBe(true)
  })

  it('records that the signal was NOT model-generated', async () => {
    const { rows } = await runOnce()
    const metadata = rows('signals')[0]!.model_metadata as Record<string, unknown>
    expect(metadata.modelGenerated).toBe(false)
    expect(metadata.derivedBy).toBe(`pipeline@${PIPELINE_VERSION}`)
    // The reasoning is the classifier's, and it is stored so a reviewer can
    // disagree with it.
    expect(String(metadata.reasoning)).not.toHaveLength(0)
    expect(metadata.matchedAction).toBeTruthy()
    expect(metadata.matchedAsset).toBeTruthy()
  })

  it('derives an opportunity that is unscored rather than scored with an invented number', async () => {
    const { rows } = await runOnce()
    const opportunity = rows('opportunities')[0]!
    for (const column of [
      'haskell_fit',
      'project_maturity',
      'potential_scope',
      'timing_momentum',
      'raw_score',
      'confidence_multiplier',
      'final_score',
    ]) {
      expect(opportunity[column], `${column} must not be written by the pipeline`).toBeUndefined()
    }
    expect(opportunity.stage).toBe('emerging')
    expect(opportunity.status).toBe('new')
    expect(opportunity.derived_by).toBe(`pipeline@${PIPELINE_VERSION}`)
  })
})

// ---------------------------------------------------------------------------
// 2. A run whose documents all fail classification is still a successful run.
// ---------------------------------------------------------------------------

describe('a source run succeeds even when no document qualifies', () => {
  const onlyNoise: Connector = {
    ...recordedConnector,
    async discover() {
      return { kind: 'documents', documents: [DOCUMENTS[1]![0]] }
    },
  }

  it('reports success, writes the evidence, and derives nothing', async () => {
    const { client, rows } = memoryClient()
    const result = await runConnectorPass(client, onlyNoise, context(), [COMPANY], 'run-2', 1)

    // THIS IS THE CASE THAT DECIDES WHAT SOURCE HEALTH SHOWS. Retrieval worked,
    // so the source is healthy and `last_success_at` advances; zero
    // opportunities is a finding, not a fault.
    expect(result.runStatus).toBe('success')
    expect(result.errors).toEqual([])
    expect(result.counters.evidenceCreated).toBe(1)
    expect(result.counters.documentsAccepted).toBe(0)
    expect(result.counters.documentsRejected).toBe(1)
    expect(result.counters.opportunitiesCreated).toBe(0)
    expect(rows('evidence')).toHaveLength(1)
    expect(rows('signals')).toHaveLength(0)
    expect(rows('opportunities')).toHaveLength(0)
  })

  it('names why each document was rejected, so zero is explainable', async () => {
    const { client } = memoryClient()
    const result = await runConnectorPass(client, onlyNoise, context(), [COMPANY], 'run-3', 1)
    const reasons = Object.keys(result.counters.rejectionReasons)
    expect(reasons.length).toBeGreaterThan(0)
    expect(reasons.join(' ')).not.toMatch(/model/i)
  })
})

// ---------------------------------------------------------------------------
// 3. Reprocessing: the classifier is pure, so a stored document can be re-read.
// ---------------------------------------------------------------------------

describe('a retained document can be reclassified later', () => {
  it('classifies from stored text alone, with no network and no credential', () => {
    // `classifyText` takes a string and returns a verdict. Nothing else. That
    // is what makes "reprocess what we already collected" a re-read of the
    // evidence table rather than a re-fetch from the source.
    const before = classifyText(RECORDED_NON_SIGNAL)
    const after = classifyText(RECORDED_BODY)
    expect(before.matches).toHaveLength(0)
    expect(after.matches.length).toBeGreaterThan(0)
    expect(fetchCalls).toEqual([])
  })

  it('is deterministic: the same text always produces the same verdict', () => {
    const a = JSON.stringify(classifyText(RECORDED_BODY))
    const b = JSON.stringify(classifyText(RECORDED_BODY))
    expect(a).toBe(b)
  })
})

// ---------------------------------------------------------------------------
// 4. The gateway itself: unreachable without a key, fixed endpoint with one.
// ---------------------------------------------------------------------------

describe('the model gateway', () => {
  it('is unavailable and refuses when no key is configured', async () => {
    expect(modelEnv()).toBeNull()
    const gateway = modelGateway()
    expect(gateway.available).toBe(false)
    expect(gateway.describe).toBe('unavailable')

    const outcome = await gateway.run(
      {
        task: 'classify',
        systemInstructions: 'x',
        input: 'y',
        structuredContextDigest: 'z',
        contentHash: 'h',
        preprocessingVersion: '1',
        schemaVersion: '1',
        taxonomyVersion: '1',
      },
      (raw) => raw,
    )
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.reason).toBe('no_credential')
  })

  it('makes NO request when the key is absent', async () => {
    const gateway = modelGateway()
    await gateway.run(
      {
        task: 'classify',
        systemInstructions: 'x',
        input: 'y',
        structuredContextDigest: 'z',
        contentHash: 'h',
        preprocessingVersion: '1',
        schemaVersion: '1',
        taxonomyVersion: '1',
      },
      (raw) => raw,
    )
    expect(fetchCalls).toEqual([])
  })

  it('refuses a provider that has no adapter, rather than falling back to one', () => {
    process.env.MODEL_API_KEY = 'test-key-not-a-real-credential'
    process.env.MODEL_ID = 'anything'
    for (const provider of ['bedrock', 'vertex']) {
      process.env.MODEL_PROVIDER = provider
      const gateway = modelGateway()
      expect(gateway.available, provider).toBe(false)
      expect(gateway.describe, provider).toBe('unavailable')
    }
  })

  it('addresses exactly one endpoint, and it is a literal in the source', () => {
    const source = readFileSync(
      join(ROOT, 'app/netlify/functions/_shared/modelGateway.ts'),
      'utf8',
    )
    const urls = source.match(/https?:\/\/[^'"`\s)]+/g) ?? []
    const callable = urls.filter((u) => !u.startsWith('https://docs.') && !u.includes('adr'))
    expect(callable).toEqual(['https://api.anthropic.com/v1/messages'])

    // The endpoint is a literal argument to fetch. Not a variable, not a
    // template, not read from env, config, or anything a source could have
    // said. A retrieved document cannot redirect a model request.
    expect(source).toContain("fetch('https://api.anthropic.com/v1/messages'")
    expect(source).not.toMatch(/fetch\(\s*[A-Za-z_$]/)
    expect(source).not.toMatch(/fetch\(\s*`/)
    expect(source).not.toMatch(/MODEL_(BASE_URL|ENDPOINT|HOST|URL)/)
  })

  it('takes no URL, host or endpoint from the environment', () => {
    const env = readFileSync(join(ROOT, 'app/netlify/functions/_shared/env.ts'), 'utf8')
    // JUST the function body. An earlier version of this sliced to the end of
    // the file and matched `SUPABASE_DB_URL` in an unrelated export -- a test
    // that failed for a reason that had nothing to do with what it claimed.
    const start = env.indexOf('export function modelEnv')
    const modelEnvBlock = env.slice(start, env.indexOf('\n}\n', start) + 3)
    expect(modelEnvBlock).toContain('MODEL_API_KEY')
    expect(modelEnvBlock).not.toMatch(/url|endpoint|host|base/i)
    // And the four names it reads are the whole of its input.
    const names = [...modelEnvBlock.matchAll(/read\('([A-Z_]+)'\)/g)].map((m) => m[1])
    expect(names.sort()).toEqual([
      'MODEL_API_KEY',
      'MODEL_ID',
      'MODEL_PROMPT_VERSION',
      'MODEL_PROVIDER',
    ])
  })

  /*
     A HALF-CONFIGURED MODEL MUST NOT BREAK /api/status.

     `modelEnv()` throws when a key is set and MODEL_ID is not, and again for an
     unknown provider. Both refusals are right. But `status.ts` called
     `modelGateway()` outside its MissingEnvError handler, so either one escaped
     the handler and the endpoint answered 500 with HTML -- the endpoint an
     operator runs precisely BECAUSE something is wrong with the deployment.
  */
  it('refuses a key with no MODEL_ID rather than guessing a model', () => {
    process.env.MODEL_API_KEY = 'test-key-not-a-real-credential'
    expect(() => modelEnv()).toThrow(/MODEL_ID/)
    expect(fetchCalls).toEqual([])
  })

  it('refuses an unknown provider rather than falling back to the default', () => {
    process.env.MODEL_API_KEY = 'test-key-not-a-real-credential'
    process.env.MODEL_ID = 'anything'
    process.env.MODEL_PROVIDER = 'not-a-provider'
    expect(() => modelEnv()).toThrow(/MODEL_PROVIDER/)
  })

  it('status.ts reports a half-configured model instead of throwing', () => {
    const status = readFileSync(join(ROOT, 'app/netlify/functions/status.ts'), 'utf8')
    const block = status.slice(status.indexOf('let gateway'), status.indexOf('const ZERO'))
    expect(block).toMatch(/try\s*\{/)
    expect(block).toContain('unavailableGateway')
    expect(block).toContain('MissingEnvError')
    // The reason reaches the response, by name, never by value.
    expect(status).toContain('detail: gateway.detail ?? null')
  })

  it('takes no endpoint from connector configuration', () => {
    // `connector_config` is operator-editable data and is read by connectors
    // only. If it ever reached the model gateway, a database row would choose
    // where a credential is sent.
    const gateway = readFileSync(
      join(ROOT, 'app/netlify/functions/_shared/modelGateway.ts'),
      'utf8',
    )
    expect(gateway).not.toMatch(/connector_config|connectorConfig|ctx\.config/)
  })

  it('an explicitly unavailable gateway also makes no request', async () => {
    const gateway = unavailableGateway('test')
    const outcome = await gateway.run(
      {
        task: 'classify',
        systemInstructions: 'x',
        input: 'y',
        structuredContextDigest: 'z',
        contentHash: 'h',
        preprocessingVersion: '1',
        schemaVersion: '1',
        taxonomyVersion: '1',
      },
      (raw) => raw,
    )
    expect(outcome.ok).toBe(false)
    expect(fetchCalls).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 5. The wiring itself, so the answer above cannot quietly change.
// ---------------------------------------------------------------------------

describe('no ingestion code path reaches the model gateway', () => {
  const INGESTION_FILES = [
    'app/netlify/functions/scheduled-ingest.ts',
    'app/netlify/functions/admin-run.ts',
    'app/netlify/functions/_shared/connectors/pipeline.ts',
    'app/netlify/functions/_shared/connectors/classify.ts',
    'app/netlify/functions/_shared/connectors/runner.ts',
    'app/netlify/functions/_shared/connectors/sec.ts',
    'app/netlify/functions/_shared/connectors/mars.ts',
    'app/netlify/functions/_shared/connectors/extract.ts',
  ]

  for (const file of INGESTION_FILES) {
    it(`${file} does not import the model gateway`, () => {
      const source = readFileSync(join(ROOT, file), 'utf8')
      expect(source).not.toMatch(/from '.*modelGateway/)
      expect(source).not.toMatch(/\bmodelGateway\s*\(/)
      expect(source).not.toMatch(/\bmodelEnv\s*\(/)
    })
  }

  it('status.ts is the only consumer, and only to report configuration', () => {
    const status = readFileSync(join(ROOT, 'app/netlify/functions/status.ts'), 'utf8')
    expect(status).toContain('modelGateway')
    // It reports `available` and `describe`. It must never RUN a request, which
    // would make a diagnostic endpoint spend money and reach a third party.
    expect(status).not.toMatch(/gateway\.run\s*\(/)
  })
})
