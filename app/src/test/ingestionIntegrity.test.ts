import { describe, expect, it } from 'vitest'
import {
  HEARTBEAT_INTERVAL_MS,
  RUN_LEASE_DEFAULT_MS,
  RUN_LEASE_MAX_MS,
  RUN_LEASE_MIN_MS,
  RunLeaseLostError,
  boundedLeaseMs,
  closeRun,
  healthAfterAbandonment,
  heartbeat,
  lastActivityOf,
  leaseCheckpoint,
  openRun,
  recoverStaleRun,
  runIngestion,
} from '../../netlify/functions/_shared/connectors/runner'
import {
  FULL_TEXT_EXCERPT_MAX_CHARS,
  REFERENCE_EXCERPT_MAX_CHARS,
  emptyCounters,
  evidenceAccessPolicy,
  runConnectorPass,
  type SourcePassResult,
} from '../../netlify/functions/_shared/connectors/pipeline'
import type { EgressResult, RetryingGetOptions } from '../../netlify/functions/_shared/egress'
import type {
  Connector,
  ConnectorContext,
  DiscoveredDocument,
  RetrievedDocument,
} from '../../netlify/functions/_shared/connectors/types'

/**
 * PHASE 2 PR 1 — INGESTION INTEGRITY, ASSERTED AGAINST THE WRITE PATH.
 *
 * Three defects, each found in the production database rather than in a test:
 *
 *   1. A run whose invocation was ended by the platform stayed `running` for a
 *      month. Every later run collided with it, reported "skipped" with health
 *      `healthy`, and wrote nothing down.
 *   2. Source-health writes ignored their errors, so a refused write left the
 *      previous health in place with nothing to say it had failed.
 *   3. The pipeline wrote `access_mode = 'structured_primary'` for every
 *      connector, so a reference-only corporate newsroom stored 53 complete
 *      pages as `body_text`.
 *
 * `runIngestion` had no end-to-end test at all before this file. These drive it
 * against an in-memory PostgREST double that applies filters the way PostgREST
 * does -- including the compare-and-set filters on an update -- and enforces the
 * partial unique index `source_runs_single_active_uidx`, because a double that
 * cannot refuse a second running row cannot test overlap.
 *
 * Named in boundaries.test.ts's exemption list: it drives the real SEC and Mars
 * connectors through an injected transport, so it must name their hosts. Every
 * organization in it is an "Example" company.
 */

/* ======================================================= a PostgREST double */

type Row = Record<string, unknown>
type DbError = { code: string; message: string; details?: string; hint?: string }

interface Fault {
  table: string
  op: 'select' | 'insert' | 'update' | 'upsert'
  /** Only fault when the payload has these keys (update/insert). */
  when?: (payload: Row | null) => boolean
  error: DbError
}

interface DoubleOptions {
  faults?: Fault[]
  /** Called after an update's filters are evaluated and before it applies. */
  beforeUpdate?: (table: string, payload: Row) => void
}

const UNIQUE: Readonly<Record<string, string[]>> = {
  source_document_cache: ['source_id', 'request_url'],
  signal_evidence: ['signal_id', 'evidence_id'],
  opportunity_signals: ['opportunity_id', 'signal_id'],
}

function pgDouble(seed: Record<string, Row[]>, options: DoubleOptions = {}) {
  const tables = new Map<string, Row[]>(Object.entries(seed).map(([k, v]) => [k, v.map((r) => ({ ...r }))]))
  let seq = 0
  const rows = (t: string): Row[] => {
    if (!tables.has(t)) tables.set(t, [])
    return tables.get(t)!
  }
  const fault = (table: string, op: Fault['op'], payload: Row | null): DbError | null => {
    for (const f of options.faults ?? []) {
      if (f.table === table && f.op === op && (!f.when || f.when(payload))) return f.error
    }
    return null
  }
  /** source_runs_single_active_uidx, and the logical-run key. */
  const runConflict = (candidate: Row, self: Row | null): DbError | null => {
    for (const other of rows('source_runs')) {
      if (other === self) continue
      if (other.source_id !== candidate.source_id) continue
      if (candidate.run_status === 'running' && other.run_status === 'running') {
        return { code: '23505', message: 'duplicate key value violates unique constraint "source_runs_single_active_uidx"' }
      }
      if (
        self === null &&
        candidate.collection_window_start !== undefined &&
        other.collection_window_start === candidate.collection_window_start
      ) {
        return { code: '23505', message: 'duplicate key value violates unique constraint on the logical run' }
      }
    }
    return null
  }

  function builder(table: string) {
    const filters: ((row: Row) => boolean)[] = []
    let op: 'select' | 'insert' | 'update' | 'upsert' = 'select'
    let payload: Row | null = null
    let returning = false
    let onConflict: string[] | null = null

    const execute = (): { data: Row[] | null; error: DbError | null } => {
      const injected = fault(table, op, payload)
      if (injected) return { data: null, error: injected }

      if (op === 'select') {
        return { data: rows(table).filter((r) => filters.every((f) => f(r))).map((r) => ({ ...r })), error: null }
      }

      if (op === 'insert') {
        const row: Row = { id: `${table}-${(seq += 1)}`, ...payload }
        if (table === 'source_runs') {
          const conflict = runConflict(row, null)
          if (conflict) return { data: null, error: conflict }
        }
        rows(table).push(row)
        return { data: returning ? [{ ...row }] : null, error: null }
      }

      if (op === 'update') {
        options.beforeUpdate?.(table, payload!)
        // Re-evaluate: the hook may have changed a row under the filter.
        const now = rows(table).filter((r) => filters.every((f) => f(r)))
        for (const row of now) {
          if (table === 'source_runs') {
            const conflict = runConflict({ ...row, ...payload }, row)
            if (conflict) return { data: null, error: conflict }
          }
        }
        for (const row of now) Object.assign(row, payload)
        return { data: returning ? now.map((r) => ({ ...r })) : null, error: null }
      }

      // upsert
      const keys = onConflict ?? UNIQUE[table] ?? []
      const existing = keys.length
        ? rows(table).find((r) => keys.every((k) => r[k] === payload![k]))
        : undefined
      if (existing) Object.assign(existing, payload)
      else rows(table).push({ id: `${table}-${(seq += 1)}`, ...payload })
      return { data: null, error: null }
    }

    const api: Record<string, unknown> = {
      select() {
        if (op === 'select') return api
        returning = true
        return api
      },
      insert(p: Row) {
        op = 'insert'
        payload = p
        return api
      },
      update(p: Row) {
        op = 'update'
        payload = p
        return api
      },
      upsert(p: Row, opts?: { onConflict?: string }) {
        op = 'upsert'
        payload = p
        onConflict = opts?.onConflict ? opts.onConflict.split(',') : null
        return api
      },
      eq(c: string, v: unknown) {
        filters.push((r) => (r[c] ?? null) === v)
        return api
      },
      neq(c: string, v: unknown) {
        filters.push((r) => (r[c] ?? null) !== v)
        return api
      },
      is(c: string, v: unknown) {
        filters.push((r) => (r[c] ?? null) === v)
        return api
      },
      in(c: string, values: unknown[]) {
        filters.push((r) => values.includes(r[c]))
        return api
      },
      async maybeSingle() {
        const { data, error } = execute()
        return { data: data?.[0] ?? null, error }
      },
      async single() {
        const { data, error } = execute()
        return { data: data?.[0] ?? null, error }
      },
      then(resolve: (r: unknown) => unknown, reject?: (e: unknown) => unknown) {
        try {
          return Promise.resolve(resolve(execute()))
        } catch (e) {
          return reject ? reject(e) : Promise.reject(e)
        }
      },
    }
    return api
  }

  return {
    client: { from: (t: string) => builder(t) } as never,
    rows,
    tables,
  }
}

/* ============================================================== fixtures */

const NOW = new Date('2026-10-14T06:00:00.000Z')
const WINDOW = { start: '2026-10-13T00:00:00.000Z', end: '2026-10-14T00:00:00.000Z' }

/** The entity keys the runner reads. The companies are fictional. */
const EXAMPLE_FILER = { id: 'org-filer', entity_key: 'sec:0000100493', canonical_name: 'Example Foods, Inc.' }
const EXAMPLE_PRIVATE = { id: 'org-private', entity_key: 'radar:mars-incorporated', canonical_name: 'Example Confections' }

function secSource(overrides: Row = {}): Row {
  return {
    id: 'sec-edgar',
    enabled: true,
    connector_config: {},
    access_mode: 'archived_full_text',
    license_mode: 'open',
    health_status: 'healthy',
    consecutive_failures: 0,
    last_success_at: '2026-10-13T06:00:24.305Z',
    ...overrides,
  }
}

function newsroomSource(overrides: Row = {}): Row {
  return {
    id: 'mars-newsroom',
    enabled: true,
    connector_config: {
      feedCandidates: [],
      sitemapCandidates: ['https://www.mars.com/sitemap.xml'],
      indexCandidates: [],
    },
    // The production registry row: copyrighted corporate material, ADR 0014.
    access_mode: 'reference_only',
    license_mode: 'unknown',
    health_status: 'healthy',
    consecutive_failures: 0,
    last_success_at: null,
    ...overrides,
  }
}

/** The run stalled since 2026-09-14: running, no checkpoint, never closed. */
const STALLED_RUN: Row = {
  id: 'run-stalled',
  source_id: 'mars-newsroom',
  status: 'running',
  run_status: 'running',
  started_at: '2026-09-14T05:23:06.215Z',
  checkpoint: null,
  collection_window_start: '2025-09-15T00:00:00.000Z',
  collection_window_end: '2026-09-15T00:00:00.000Z',
}

function respond(url: string, body: string, contentType: string, status = 200): EgressResult {
  return {
    url,
    finalUrl: url,
    status,
    headers: { 'content-type': contentType },
    body: new TextEncoder().encode(body),
    startedAt: NOW.toISOString(),
    finishedAt: NOW.toISOString(),
    redirects: [],
    notModified: false,
  }
}

/** SEC with nothing filed in the window: a fast, clean, complete run. */
async function quietSec(url: string): Promise<EgressResult> {
  if (url.includes('company_tickers')) {
    return respond(url, JSON.stringify({ '0': { cik_str: 100493, ticker: 'EXF', title: 'EXAMPLE FOODS INC' } }), 'application/json')
  }
  if (url.includes('/submissions/')) {
    return respond(url, JSON.stringify({ cik: '100493', name: 'Example Foods, Inc.', filings: { recent: {} } }), 'application/json')
  }
  return respond(url, 'not found', 'text/plain', 404)
}

/**
 * A recognisable passage that must NEVER be persisted under a reference-only
 * source. It also carries a qualifying signal, so the classifier reads it and
 * the derivation path runs -- the case where a copy is most likely to leak.
 */
const FULL_TEXT_MARKER = 'UNMISTAKABLE-FULL-TEXT-MARKER'
const ARTICLE_BODY =
  `<p>Example Confections announced today that it will build a new 300,000 square foot ` +
  `manufacturing plant in Topeka, Kansas. The $240 million facility will create 200 jobs ` +
  `and is expected to open by early 2028.</p>` +
  `<p>${'Background paragraph about the company history and brands. '.repeat(40)}${FULL_TEXT_MARKER}</p>`
const ARTICLE_URL = 'https://www.mars.com/news-and-stories/press-releases/example-plant'

async function newsroom(url: string): Promise<EgressResult> {
  if (url.endsWith('/robots.txt')) return respond(url, 'User-agent: *\nDisallow: /private\n', 'text/plain')
  if (url.endsWith('/sitemap.xml')) {
    return respond(
      url,
      `<?xml version="1.0"?><urlset><url><loc>${ARTICLE_URL}</loc><lastmod>2026-10-13</lastmod></url></urlset>`,
      'application/xml',
    )
  }
  if (url === ARTICLE_URL) {
    const jsonLd = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'NewsArticle',
      headline: 'Example Confections announces Kansas plant',
      datePublished: '2026-10-13T14:00:00Z',
      articleBody: ARTICLE_BODY,
    })
    return respond(
      url,
      `<html><head><script type="application/ld+json">${jsonLd}</script></head><body>${ARTICLE_BODY}</body></html>`,
      'text/html',
    )
  }
  return respond(url, 'not found', 'text/plain', 404)
}

function runOptions(transport: (url: string, o: RetryingGetOptions) => Promise<EgressResult>, extra: Partial<Parameters<typeof runIngestion>[1]> = {}) {
  const log: string[] = []
  return {
    log,
    options: {
      window: WINDOW,
      userAgent: 'Example-Radar-Test/1.0 ops@example.invalid',
      allowlist: ['data.sec.gov', 'www.sec.gov', 'www.mars.com'],
      transport,
      now: () => NOW,
      log: (m: string) => log.push(m),
      ...extra,
    },
  }
}

const healthEvents = (db: ReturnType<typeof pgDouble>, sourceId: string) =>
  db.rows('source_health_events').filter((e) => e.source_id === sourceId)

/* ========================================================== the lease */

describe('the lease is bounded and read from the run itself', () => {
  it('defaults to fifteen minutes and clamps an override into its bounds', () => {
    expect(boundedLeaseMs(undefined)).toBe(RUN_LEASE_DEFAULT_MS)
    expect(RUN_LEASE_DEFAULT_MS).toBe(15 * 60_000)
    expect(boundedLeaseMs(1_000)).toBe(RUN_LEASE_MIN_MS)
    expect(boundedLeaseMs(10 * 24 * 60 * 60_000)).toBe(RUN_LEASE_MAX_MS)
    expect(boundedLeaseMs(Number.NaN)).toBe(RUN_LEASE_DEFAULT_MS)
    expect(boundedLeaseMs(20 * 60_000)).toBe(20 * 60_000)
  })

  it('outlives every Netlify execution limit by a wide margin, and the heartbeat is far inside it', () => {
    // Scheduled 30 s, synchronous 60 s, background 15 min. The minimum lease is
    // longer than any synchronous invocation, and the heartbeat interval is a
    // small fraction of the minimum lease.
    expect(RUN_LEASE_MIN_MS).toBeGreaterThan(60_000)
    expect(HEARTBEAT_INTERVAL_MS * 10).toBeLessThan(RUN_LEASE_MIN_MS)
  })

  it('takes last activity from the heartbeat, falls back to the start, and never invents one', () => {
    const beat = leaseCheckpoint('holder-1', new Date('2026-10-14T05:59:00.000Z'))
    expect(lastActivityOf({ started_at: '2026-09-14T05:23:06.215Z', checkpoint: beat })?.toISOString()).toBe(
      '2026-10-14T05:59:00.000Z',
    )
    expect(lastActivityOf({ started_at: '2026-09-14T05:23:06.215Z', checkpoint: null })?.toISOString()).toBe(
      '2026-09-14T05:23:06.215Z',
    )
    // A checkpoint written by something else is not mistaken for a heartbeat.
    expect(lastActivityOf({ started_at: '2026-09-14T05:23:06.215Z', checkpoint: '{"page":3}' })?.toISOString()).toBe(
      '2026-09-14T05:23:06.215Z',
    )
    expect(lastActivityOf({ started_at: null, checkpoint: null })).toBeNull()
  })

  it('writes a checkpoint free of quotes, braces and commas, so a PostgREST eq filter matches it verbatim', () => {
    const value = leaseCheckpoint('3f6c2e7a-0000-4000-8000-000000000001', NOW)
    expect(value).not.toMatch(/["{}(),]/)
  })

  it('escalates a repeated abandonment from degraded to action_required', () => {
    expect(healthAfterAbandonment(1)).toBe('degraded')
    expect(healthAfterAbandonment(2)).toBe('action_required')
    expect(healthAfterAbandonment(7)).toBe('action_required')
  })
})

/* ================================================= stalled-run recovery */

describe('a run stalled since 2026-09-14 is recovered on the next invocation', () => {
  it('closes the stalled run as abandoned, records it, and the source runs again', async () => {
    const db = pgDouble({
      organizations: [EXAMPLE_FILER, EXAMPLE_PRIVATE],
      sources: [newsroomSource()],
      source_runs: [STALLED_RUN],
    })
    const { options } = runOptions(newsroom)
    const results = await runIngestion(db.client, options)

    const stalled = db.rows('source_runs').find((r) => r.id === 'run-stalled')!
    expect(stalled.run_status).toBe('failure')
    expect(stalled.status).toBe('failed')
    expect(stalled.error_code).toBe('abandoned')
    expect(stalled.completed_at).toBe(NOW.toISOString())
    expect(String(stalled.error_summary)).toContain('2026-09-14T05:23:06.215Z')

    const events = healthEvents(db, 'mars-newsroom')
    const abandoned = events.find((e) => e.event_type === 'run_abandoned')!
    expect(abandoned.source_run_id).toBe('run-stalled')
    expect(abandoned.prior_status).toBe('healthy')
    expect(abandoned.new_status).toBe('degraded')

    // A fresh run for today's window was opened and closed by its holder.
    const fresh = db.rows('source_runs').filter((r) => r.id !== 'run-stalled')
    expect(fresh).toHaveLength(1)
    expect(fresh[0]!.collection_window_start).toBe(WINDOW.start)
    expect(fresh[0]!.run_status).not.toBe('running')

    expect(results).toHaveLength(1)
    expect(results[0]!.runStatus).not.toBe('skipped')
  }, 20_000)

  it('does not abandon an old run that is still sending heartbeats', async () => {
    // Started a month ago -- older than any lease -- but its holder renewed
    // the lease a minute ago. Age alone is not evidence of death.
    const alive: Row = {
      ...STALLED_RUN,
      source_id: 'sec-edgar',
      checkpoint: leaseCheckpoint('live-holder', new Date(NOW.getTime() - 60_000)),
    }
    const db = pgDouble({
      organizations: [EXAMPLE_FILER],
      sources: [secSource({ health_status: 'source_unavailable' })],
      source_runs: [alive],
    })
    const { options } = runOptions(quietSec)
    const results = await runIngestion(db.client, options)

    expect(db.rows('source_runs').find((r) => r.id === 'run-stalled')!.run_status).toBe('running')
    expect(db.rows('source_runs')).toHaveLength(1)

    // The stand-down is written down, and nothing about health is invented.
    const skip = healthEvents(db, 'sec-edgar').find((e) => e.event_type === 'skipped_overlap')!
    expect(skip.source_run_id).toBe('run-stalled')
    expect(skip.prior_status).toBe('source_unavailable')
    expect(skip.new_status).toBe('source_unavailable')
    expect(results[0]!.runStatus).toBe('skipped')
    expect(results[0]!.healthStatus).toBe('source_unavailable')
    expect(db.rows('sources')[0]!.consecutive_failures).toBe(0)
  })

  it('stands down if the run is renewed between the check and the close (compare-and-set)', async () => {
    let renewed = false
    const db = pgDouble(
      {
        organizations: [EXAMPLE_FILER],
        sources: [secSource()],
        source_runs: [{ ...STALLED_RUN, source_id: 'sec-edgar' }],
      },
      {
        // The holder renews in the gap between the recovery's read and its
        // conditional close.
        beforeUpdate: (table, payload) => {
          if (table === 'source_runs' && payload.error_code === 'abandoned' && !renewed) {
            renewed = true
            const row = db.rows('source_runs').find((r) => r.id === 'run-stalled')!
            row.checkpoint = leaseCheckpoint('live-holder', NOW)
          }
        },
      },
    )
    const { options } = runOptions(quietSec)
    const results = await runIngestion(db.client, options)

    expect(renewed).toBe(true)
    const run = db.rows('source_runs').find((r) => r.id === 'run-stalled')!
    expect(run.run_status).toBe('running')
    expect(run.error_code ?? null).toBeNull()
    expect(healthEvents(db, 'sec-edgar').some((e) => e.event_type === 'run_abandoned')).toBe(false)
    expect(healthEvents(db, 'sec-edgar').some((e) => e.event_type === 'skipped_overlap')).toBe(true)
    expect(results[0]!.runStatus).toBe('skipped')
  })

  it('lets exactly one of two concurrent recoveries close the run', async () => {
    const db = pgDouble({
      organizations: [EXAMPLE_FILER],
      sources: [secSource()],
      source_runs: [{ ...STALLED_RUN, source_id: 'sec-edgar' }],
    })
    const [a, b] = await Promise.all([
      recoverStaleRun(db.client, 'sec-edgar', NOW, RUN_LEASE_DEFAULT_MS),
      recoverStaleRun(db.client, 'sec-edgar', NOW, RUN_LEASE_DEFAULT_MS),
    ])
    const kinds = [a.kind, b.kind].sort()
    expect(kinds).toEqual(['contended', 'recovered'])
    expect(healthEvents(db, 'sec-edgar').filter((e) => e.event_type === 'run_abandoned')).toHaveLength(1)
    expect(db.rows('sources')[0]!.consecutive_failures).toBe(1)
  })

  it('escalates to action_required when the source was already failing', async () => {
    const db = pgDouble({
      organizations: [EXAMPLE_FILER],
      sources: [secSource({ consecutive_failures: 1, health_status: 'degraded' })],
      source_runs: [{ ...STALLED_RUN, source_id: 'sec-edgar' }],
    })
    const outcome = await recoverStaleRun(db.client, 'sec-edgar', NOW, RUN_LEASE_DEFAULT_MS)
    expect(outcome.kind).toBe('recovered')
    expect(db.rows('sources')[0]!.health_status).toBe('action_required')
    expect(db.rows('sources')[0]!.consecutive_failures).toBe(2)
    // An abandonment never advances last_success_at.
    expect(db.rows('sources')[0]!.last_success_at).toBe('2026-10-13T06:00:24.305Z')
  })
})

/* ============================================= a holder that lost its run */

describe('a holder whose run was taken away stops, and does not overwrite the recovery', () => {
  async function heldRun() {
    const db = pgDouble({ sources: [secSource()], source_runs: [] })
    const opened = await openRun(db.client, 'sec-edgar', WINDOW, NOW, 'holder-a')
    return { db, lease: opened.lease }
  }

  it('renews its lease while the run is its own', async () => {
    const { db, lease } = await heldRun()
    const later = new Date(NOW.getTime() + HEARTBEAT_INTERVAL_MS + 1)
    await heartbeat(db.client, lease, later)
    expect(db.rows('source_runs')[0]!.checkpoint).toBe(leaseCheckpoint('holder-a', later))
  })

  it('learns it lost the run when its heartbeat matches nothing', async () => {
    const { db, lease } = await heldRun()
    // A recovery closed it.
    Object.assign(db.rows('source_runs')[0]!, { run_status: 'failure', status: 'failed', error_code: 'abandoned' })
    await expect(
      heartbeat(db.client, lease, new Date(NOW.getTime() + HEARTBEAT_INTERVAL_MS + 1)),
    ).rejects.toBeInstanceOf(RunLeaseLostError)
  })

  it('leaves the abandonment record and source health alone when its close matches nothing', async () => {
    const { db, lease } = await heldRun()
    Object.assign(db.rows('source_runs')[0]!, { run_status: 'failure', status: 'failed', error_code: 'abandoned' })
    const healthBefore = { ...db.rows('sources')[0]! }

    const outcome = await closeRun(db.client, lease, successResult(), NOW)
    expect(outcome.closed).toBe(false)
    expect(outcome.errors.join(' ')).toMatch(/no longer held/)
    expect(db.rows('source_runs')[0]!.error_code).toBe('abandoned')
    expect(db.rows('source_runs')[0]!.run_status).toBe('failure')
    expect(db.rows('sources')[0]).toEqual(healthBefore)
    expect(db.rows('source_health_events')).toHaveLength(0)
  })

  it('stops starting documents mid-pass when its lease is lost, and rethrows', async () => {
    let beats = 0
    const docs = [doc('d1'), doc('d2'), doc('d3')]
    const db = pgDouble({})
    const pass = runConnectorPass(
      db.client,
      recordedConnector(docs.map((d) => [d, 'nothing here'])),
      context(),
      [COMPANY],
      'run-1',
      1,
      OPEN_ARCHIVE,
      {
        heartbeat: async () => {
          beats += 1
          if (beats >= 3) throw new RunLeaseLostError('recorded-source', 'run-1')
        },
      },
    )
    await expect(pass).rejects.toBeInstanceOf(RunLeaseLostError)
    // Discovery beat, d1 beat, then the third beat fails: d2 and d3 never start.
    expect(db.rows('evidence')).toHaveLength(1)
  })
})

/* ============================================== honest source health */

describe('a skipped or blocked source is never reported as collected or healthy', () => {
  it('records an overlap against the active run and reports the health the database holds', async () => {
    const db = pgDouble({
      organizations: [EXAMPLE_FILER],
      sources: [secSource({ health_status: 'degraded' })],
      source_runs: [
        { ...STALLED_RUN, id: 'run-live', source_id: 'sec-edgar', checkpoint: leaseCheckpoint('other', NOW) },
      ],
    })
    const { options } = runOptions(quietSec)
    const [result] = await runIngestion(db.client, options)
    expect(result!.runStatus).toBe('skipped')
    expect(result!.healthStatus).toBe('degraded')
    expect(result!.healthStatus).not.toBe('healthy')
    expect(db.rows('sources')[0]!.last_success_at).toBe('2026-10-13T06:00:24.305Z')
  })

  it('persists a missing egress host as action_required, where it used to exist only in a log line', async () => {
    const db = pgDouble({ organizations: [EXAMPLE_FILER], sources: [secSource()], source_runs: [] })
    const { options } = runOptions(quietSec, { allowlist: ['data.sec.gov'] })
    const [result] = await runIngestion(db.client, options)
    expect(result!.runStatus).toBe('failure')
    expect(db.rows('sources')[0]!.health_status).toBe('action_required')
    expect(db.rows('sources')[0]!.consecutive_failures).toBe(1)
    const event = healthEvents(db, 'sec-edgar').find((e) => e.event_type === 'blocked_egress')!
    expect(event.action_required).toEqual({ action: 'extend_egress_allowlist', hosts: ['www.sec.gov'] })
    expect(db.rows('source_runs')).toHaveLength(0)
  })

  it('does not open a run once the time budget is spent, and says so', async () => {
    const db = pgDouble({ organizations: [EXAMPLE_FILER], sources: [secSource()], source_runs: [] })
    const { options } = runOptions(quietSec, { deadlineMs: NOW.getTime() })
    const [result] = await runIngestion(db.client, options)
    expect(result!.runStatus).toBe('skipped')
    expect(result!.healthStatus).toBe('healthy') // unchanged, read back, not assumed
    expect(db.rows('source_runs')).toHaveLength(0)
    expect(healthEvents(db, 'sec-edgar')[0]!.event_type).toBe('deferred_time_budget')
  })

  it('reports deferred documents as an unfinished run, never a healthy one', async () => {
    let calls = 0
    const docs = [doc('d1'), doc('d2'), doc('d3')]
    const db = pgDouble({})
    const result = await runConnectorPass(
      db.client,
      recordedConnector(docs.map((d) => [d, 'nothing here'])),
      context(),
      [COMPANY],
      'run-1',
      1,
      OPEN_ARCHIVE,
      { budgetExhausted: () => (calls += 1) > 1 },
    )
    expect(result.counters.documentsDeferred).toBe(2)
    expect(result.runStatus).toBe('partial_success')
    expect(result.healthStatus).toBe('degraded')
    expect(result.note).toMatch(/2 document\(s\) were not started/)
  })

  it('calls a run that deferred everything a failure, so last_success_at cannot move', async () => {
    const db = pgDouble({})
    const result = await runConnectorPass(
      db.client,
      recordedConnector([[doc('d1'), 'nothing here']]),
      context(),
      [COMPANY],
      'run-1',
      1,
      OPEN_ARCHIVE,
      { budgetExhausted: () => true },
    )
    expect(result.runStatus).toBe('failure')
    expect(result.healthStatus).toBe('degraded')
  })
})

/* ============================================== database-write failures */

describe('a refused health write is reported, never assumed', () => {
  it('surfaces a failed source update and reports the health actually stored', async () => {
    const db = pgDouble(
      { organizations: [EXAMPLE_FILER], sources: [secSource({ health_status: 'source_unavailable' })], source_runs: [] },
      {
        faults: [
          {
            table: 'sources',
            op: 'update',
            error: { code: '42501', message: 'permission denied for table sources' },
          },
        ],
      },
    )
    const { options, log } = runOptions(quietSec)
    const [result] = await runIngestion(db.client, options)
    expect(result!.errors.join(' ')).toMatch(/source health update failed: 42501/)
    // The run itself completed, but the source still holds the old health,
    // and that -- not `healthy` -- is what the report says.
    expect(result!.healthStatus).toBe('source_unavailable')
    expect(log.join('\n')).toMatch(/source health update failed/)
  })

  it('surfaces a failed health-event insert', async () => {
    const db = pgDouble(
      { organizations: [EXAMPLE_FILER], sources: [secSource({ health_status: 'degraded' })], source_runs: [] },
      {
        faults: [
          { table: 'source_health_events', op: 'insert', error: { code: '23514', message: 'new row violates check constraint "x"' } },
        ],
      },
    )
    const { options } = runOptions(quietSec)
    const [result] = await runIngestion(db.client, options)
    expect(result!.errors.join(' ')).toMatch(/source health event insert failed: 23514/)
  })

  it('reports a run whose close was refused as a failure, and leaves source health alone', async () => {
    const db = pgDouble(
      { organizations: [EXAMPLE_FILER], sources: [secSource()], source_runs: [] },
      {
        faults: [
          {
            table: 'source_runs',
            op: 'update',
            when: (p) => p !== null && 'completed_at' in p,
            error: { code: '57014', message: 'canceling statement due to statement timeout' },
          },
        ],
      },
    )
    const { options } = runOptions(quietSec)
    const [result] = await runIngestion(db.client, options)
    expect(result!.runStatus).toBe('failure')
    expect(result!.errors.join(' ')).toMatch(/closing the run failed: 57014/)
    expect(db.rows('sources')[0]!.last_success_at).toBe('2026-10-13T06:00:24.305Z')
    expect(db.rows('sources')[0]!.health_status).toBe('healthy')
  })
})

/* ================================================ evidence access policy */

describe('the evidence access mode comes from the source registry', () => {
  it.each([
    // [access_mode, license_mode, recorded mode, body kept, locator kept]
    ['archived_full_text', 'open', 'archived_full_text', true, true],
    ['structured_primary', 'open', 'structured_primary', true, true],
    ['licensed_full_text', 'licensed', 'licensed_full_text', true, true],
    ['reference_only', 'unknown', 'reference_only', false, true],
    ['reference_only', 'open', 'reference_only', false, true],
    ['metadata_only', 'open', 'metadata_only', false, false],
    // Fail closed: ADR 0006, "unknown licensing defaults to reference-only".
    ['archived_full_text', 'unknown', 'reference_only', false, true],
    ['structured_primary', 'restricted', 'reference_only', false, true],
    ['licensed_full_text', 'open', 'reference_only', false, true],
    ['archived_full_text', null, 'reference_only', false, true],
    [null, 'open', 'reference_only', false, true],
    ['full_page', 'open', 'reference_only', false, true],
  ] as const)('%s / %s -> %s', (accessMode, licenseMode, mode, body, locator) => {
    const policy = evidenceAccessPolicy({ accessMode, licenseMode })
    expect(policy.mode).toBe(mode)
    expect(policy.retainsBody).toBe(body)
    expect(policy.retainsLocator).toBe(locator)
    expect(policy.maxExcerptChars).toBe(
      mode === 'metadata_only' ? 0 : body ? FULL_TEXT_EXCERPT_MAX_CHARS : REFERENCE_EXCERPT_MAX_CHARS,
    )
    expect(policy.downgradedFrom !== null).toBe(mode !== accessMode)
  })

  it('reads the mode from the registry row through the real runner, and keeps no body for reference-only', async () => {
    const db = pgDouble({
      organizations: [EXAMPLE_PRIVATE],
      sources: [newsroomSource()],
      source_runs: [],
    })
    const { options, log } = runOptions(newsroom)
    const [result] = await runIngestion(db.client, options)

    expect(result!.counters.evidenceCreated).toBe(1)
    const evidence = db.rows('evidence')
    expect(evidence).toHaveLength(1)
    const row = evidence[0]!
    expect(row.access_mode).toBe('reference_only')
    expect(row.body_text).toBeNull()
    expect(row.archive_uri ?? null).toBeNull()
    // What ADR 0014 retains for reference-only material.
    expect(row.locator).toBe(ARTICLE_URL)
    expect(row.title).toBe('Example Confections announces Kansas plant')
    // The source's own date, normalised by the connector, never the clock.
    expect(row.published_at).toBe('2026-10-13T14:00:00.000Z')
    expect(row.retrieved_at).toBe(NOW.toISOString())
    expect(String(row.content_hash)).toMatch(/^[0-9a-f]{64}$/)
    expect(String(row.evidence_excerpt).length).toBeLessThanOrEqual(REFERENCE_EXCERPT_MAX_CHARS)
    expect(String(row.evidence_excerpt)).toContain('Topeka, Kansas')

    // The classifier read the text in memory and derived a signal from it --
    // and no copy of the text beyond the bounded excerpt reached any table.
    expect(result!.counters.signalsCreated).toBeGreaterThan(0)
    expect(db.rows('signals')).toHaveLength(result!.counters.signalsCreated)
    for (const signal of db.rows('signals')) {
      expect(String(signal.summary).length).toBeLessThanOrEqual(REFERENCE_EXCERPT_MAX_CHARS)
    }
    for (const opportunity of db.rows('opportunities')) {
      expect(String(opportunity.executive_summary).length).toBeLessThanOrEqual(REFERENCE_EXCERPT_MAX_CHARS)
    }

    // The decisive check: the passage deep in the article appears NOWHERE --
    // no table, no cache row, no run record, no result, no log line.
    const everything = JSON.stringify([...db.tables.entries()])
    expect(everything).not.toContain(FULL_TEXT_MARKER)
    // The body repeats its background sentence forty times. A bounded excerpt
    // may legitimately reach the first one; three copies of that excerpt exist
    // (evidence, signal, opportunity). Anything more would be the body.
    const repeats = everything.split('Background paragraph about the company history').length - 1
    expect(repeats).toBeLessThanOrEqual(3)
    expect(JSON.stringify(result)).not.toContain(FULL_TEXT_MARKER)
    expect(log.join('\n')).not.toContain(FULL_TEXT_MARKER)

    // The cache holds validators only.
    for (const cached of db.rows('source_document_cache')) {
      expect(Object.keys(cached).sort()).toEqual(
        ['content_hash', 'etag', 'fetched_at', 'id', 'last_modified', 'request_url', 'source_id', 'status'].sort(),
      )
    }
  }, 20_000)
})

describe('the reference-only write path, document by document', () => {
  it('never adds a body to an existing row, and never classifies from a body it should not hold', async () => {
    // A row stored before the access mode was enforced, still carrying a body.
    // A 304 brings no text; resuming from the stored body would be reading a
    // copy we may not keep. It must not be used, and it must not be extended.
    const legacy: Row = {
      id: 'evidence-legacy',
      source_id: 'recorded-source',
      source_document_id: 'd1',
      content_hash: 'hash-d1',
      superseded_at: null,
      body_text: 'Example Foods will build a new 450,000 square foot plant in Bowling Green, Kentucky for $300 million.',
      locator: 'https://www.example.invalid/d1.htm',
      evidence_excerpt: null,
      classification_status: 'not_relevant',
      extraction_status: 'success',
      evidence_locator: { documentType: '8-K' },
      access_mode: 'structured_primary',
    }
    const db = pgDouble({ evidence: [legacy] })
    const notModified: Connector = {
      ...recordedConnector([[doc('d1'), '']]),
      async retrieve(_ctx, document) {
        return { ...retrievedFor(document, ''), status: 304, unchanged: true, extractedText: null, contentHash: 'hash-d1' }
      },
    }
    const result = await runConnectorPass(db.client, notModified, context(), [COMPANY], 'run-1', 1, {
      accessMode: 'reference_only',
      licenseMode: 'unknown',
    })
    expect(result.counters.signalsCreated).toBe(0)
    expect(db.rows('signals')).toHaveLength(0)
    // Left exactly as it was: correcting it is the remediation's job, not a
    // scheduled run's.
    expect(db.rows('evidence')[0]!.body_text).toBe(legacy.body_text)
    expect(db.rows('evidence')[0]!.access_mode).toBe('structured_primary')
  })

  it('keeps no locator, no excerpt and derives nothing for metadata-only', async () => {
    const db = pgDouble({})
    const result = await runConnectorPass(
      db.client,
      recordedConnector([[doc('d1'), SIGNAL_TEXT]]),
      context(),
      [COMPANY],
      'run-1',
      1,
      { accessMode: 'metadata_only', licenseMode: 'open' },
    )
    const row = db.rows('evidence')[0]!
    expect(row.access_mode).toBe('metadata_only')
    expect(row.body_text).toBeNull()
    expect(row.locator).toBeNull()
    expect(row.evidence_excerpt).toBeNull()
    expect(row.classification_status).toBe('unclassified')
    expect(result.counters.signalsCreated).toBe(0)
  })

  it('records a downgrade on the row when the registry asks for more than its licence allows', async () => {
    const db = pgDouble({})
    await runConnectorPass(
      db.client,
      recordedConnector([[doc('d1'), SIGNAL_TEXT]]),
      context(),
      [COMPANY],
      'run-1',
      1,
      { accessMode: 'archived_full_text', licenseMode: 'unknown' },
    )
    const row = db.rows('evidence')[0]!
    expect(row.access_mode).toBe('reference_only')
    expect(row.body_text).toBeNull()
    expect((row.evidence_locator as Row).accessModeDowngradedFrom).toMatch(/archived_full_text requires license_mode/)
  })

  it('keeps the body for an open government source, as before', async () => {
    const db = pgDouble({})
    await runConnectorPass(db.client, recordedConnector([[doc('d1'), SIGNAL_TEXT]]), context(), [COMPANY], 'run-1', 1, OPEN_ARCHIVE)
    const row = db.rows('evidence')[0]!
    expect(row.access_mode).toBe('archived_full_text')
    expect(row.body_text).toBe(SIGNAL_TEXT)
  })

  it('keeps a refused row out of the run errors: the failing row is never quoted', async () => {
    // PostgreSQL puts the ENTIRE failing row in `details`. For evidence that
    // is the document. The run's errors, its record and its log must not
    // carry it.
    const db = pgDouble(
      {},
      {
        faults: [
          {
            table: 'evidence',
            op: 'insert',
            error: {
              code: '23514',
              message: 'new row for relation "evidence" violates check constraint "evidence_reference_only_has_no_body"',
              details: `Failing row contains (${FULL_TEXT_MARKER} ${SIGNAL_TEXT})`,
            },
          },
        ],
      },
    )
    const result = await runConnectorPass(
      db.client,
      recordedConnector([[doc('d1'), `${SIGNAL_TEXT} ${FULL_TEXT_MARKER}`]]),
      context(),
      [COMPANY],
      'run-1',
      1,
      { accessMode: 'reference_only', licenseMode: 'unknown' },
    )
    expect(result.errors.join(' ')).toMatch(/evidence_reference_only_has_no_body/)
    expect(JSON.stringify(result)).not.toContain(FULL_TEXT_MARKER)
  })
})

/* ====================================================== pass fixtures */

const COMPANY = { id: 'org-example', entity_key: 'example-foods', canonical_name: 'Example Foods, Inc.' }
const OPEN_ARCHIVE = { accessMode: 'archived_full_text', licenseMode: 'open' } as const
const SIGNAL_TEXT =
  'Example Foods, Inc. announced that it will build a new 450,000 square foot processing plant in ' +
  'Bowling Green, Kentucky. The $300 million facility will create 400 jobs.'

function doc(id: string): DiscoveredDocument {
  return {
    sourceDocumentId: id,
    url: `https://www.example.invalid/${id}.htm`,
    canonicalUrl: `https://www.example.invalid/${id}.htm`,
    title: `Example document ${id}`,
    publishedAt: '2026-10-13T10:00:00.000Z',
    publishedPrecision: 'minute',
    documentType: '8-K',
    organizationEntityKey: COMPANY.entity_key,
    discoveryPath: 'recorded-fixture',
    metadata: {},
  }
}

function retrievedFor(document: DiscoveredDocument, text: string): RetrievedDocument {
  return {
    document,
    finalUrl: document.url,
    status: 200,
    bytes: new TextEncoder().encode(text),
    contentHash: `hash-${document.sourceDocumentId}`,
    mimeType: 'text/html',
    retrievedAt: NOW.toISOString(),
    etag: null,
    lastModified: null,
    unchanged: false,
    extractedText: text,
    extractionStatus: 'success',
  }
}

function recordedConnector(documents: readonly [DiscoveredDocument, string][]): Connector {
  return {
    id: 'recorded',
    version: '1.0.0',
    sourceId: 'recorded-source',
    hosts: ['www.example.invalid'],
    async discover() {
      return { kind: 'documents', documents: documents.map(([d]) => d) }
    },
    async retrieve(_ctx, document) {
      const found = documents.find(([d]) => d.sourceDocumentId === document.sourceDocumentId)
      if (!found) throw new Error('not in the recording')
      return retrievedFor(found[0], found[1])
    },
  }
}

function context(): ConnectorContext {
  return {
    userAgent: 'test',
    allowlist: ['www.example.invalid'],
    get: async () => {
      throw new Error('the recorded connector performs no egress')
    },
    pacer: { take: async () => {} } as never,
    cache: { read: async () => null, write: async () => {} },
    now: () => NOW,
    config: {},
    window: WINDOW,
    log: () => {},
  }
}

function successResult(): SourcePassResult {
  return {
    sourceId: 'sec-edgar',
    runStatus: 'success',
    healthStatus: 'healthy',
    counters: emptyCounters(),
    note: '0 evidence record(s) written from 0 discovered.',
    errors: [],
  }
}
