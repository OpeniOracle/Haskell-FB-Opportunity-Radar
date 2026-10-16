import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CountMode, FakeOptions, FakeSupabase, Row } from '@/test/readTruncation/fakeSupabase'
import { fakeSupabase } from '@/test/readTruncation/fakeSupabase'
import { LEDGER_SCHEMA, NOW, buildWorld, pad } from '@/test/readTruncation/world'
import type { WorldSize } from '@/test/readTruncation/world'
import type { DatasetKey, SurfaceState } from '@/types/domain'
import { FAILURE, READ_LIMIT, createApiDataSource } from '@/data/apiDataSource'
import { reportRead, validCount } from '@/lib/completeness'

/**
 * R2.5 — A READ THAT WAS CUT SHORT MUST NOT BE REPORTED AS WHOLE.
 *
 * The browser reads whole tables with `.limit(1000)`, and the database answers
 * a capped read by returning the first rows and saying nothing. Before this, a
 * page built from those rows read as if it were built from all of them.
 *
 * Every case below runs the REAL `createApiDataSource` against a fake that
 * behaves like PostgREST: it orders, it caps, and it returns the total only when
 * asked and only when it is able. What is asserted is what the read model
 * REPORTS about the rows it got -- never that adding `ORDER BY` made a short
 * result whole, which it does not. Ordering makes the rows a capped read keeps
 * the SAME ones each time; it is the count that says whether they are all of them.
 */

const holder = vi.hoisted(() => ({ client: null as unknown }))
vi.mock('@/lib/supabaseClient', () => ({ supabaseBrowser: () => holder.client }))

function connect(size: WorldSize = {}, options: FakeOptions = {}, override: Record<string, Row[]> = {}) {
  const fake = fakeSupabase({ ...buildWorld(size), ...override }, { schema: LEDGER_SCHEMA, ...options })
  holder.client = fake.client
  return { fake, source: createApiDataSource(() => NOW) }
}

function report(state: SurfaceState<unknown>, dataset: DatasetKey) {
  const found = state.completeness?.datasets.find((d) => d.dataset === dataset)
  if (!found) throw new Error(`no report for ${dataset}`)
  return found
}

beforeEach(() => {
  holder.client = null
})

/* -------------------------------------------------- what a read turned out to be */

describe('the rule that decides whether a read was whole', () => {
  it.each([
    [999, 999, 'complete'],
    [1000, 1000, 'complete'],
    [1000, 1001, 'truncated'],
    [1000, 1500, 'truncated'],
    [0, 0, 'complete'],
  ])('returned %i of a reported %i is %s', (returned, total, status) => {
    expect(reportRead('evidence', returned, total, READ_LIMIT).status).toBe(status)
  })

  it('compares with the DATABASE total, not with the limit the client asked for', () => {
    // A server that caps at 500 hands back 500 rows to a client that asked for
    // 1,000. 500 < 1,000, so a comparison with the limit would call it whole.
    expect(reportRead('evidence', 500, 700, 1000).status).toBe('truncated')
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['negative', -1],
    ['fractional', 2.5],
    ['NaN', Number.NaN],
    ['infinite', Number.POSITIVE_INFINITY],
    ['a string', '5'],
  ])('treats a %s count as no count at all', (_label, count) => {
    expect(validCount(count)).toBeNull()
    const result = reportRead('evidence', 600, count, 1000)
    expect(result.status).toBe('indeterminate')
    expect(result.total).toBeNull()
  })

  it('does not read a missing count as zero, and does not read fewer than the limit as whole', () => {
    // 600 rows and no total: the server may have capped at 600.
    expect(reportRead('evidence', 600, null, 1000).status).toBe('indeterminate')
  })

  it('calls a total SMALLER than the rows that came back inconsistent, not complete', () => {
    expect(reportRead('evidence', 10, 5, 1000).status).toBe('indeterminate')
  })
})

/* ------------------------------------------------- fewer than, exactly, and over the cap */

describe.each([
  [999, 'complete', false],
  [1000, 'complete', false],
  [1001, 'truncated', true],
  [1500, 'truncated', true],
] as const)('an evidence table of %i rows', (rows, status, short) => {
  it(`is ${status}, and Daily Pulse says so`, async () => {
    const { source } = connect({ evidence: rows })
    const state = await source.getPulse()
    if (state.kind !== 'ready') throw new Error(`expected ready, got ${state.kind}`)

    const evidence = report(state, 'evidence')
    expect(evidence.status).toBe(status)
    expect(evidence.total).toBe(rows)
    expect(evidence.returned).toBe(Math.min(rows, READ_LIMIT))
    expect(state.completeness?.complete).toBe(!short)

    // The headline is the database's total whenever it reported one. 1,500
    // stored records read as 1,500 even though 1,000 loaded...
    expect(state.data.headline.evidenceCount).toBe(rows)
    // ...and is not marked a floor, because it is not one.
    expect(state.data.headline.lowerBounds?.evidenceCount ?? false).toBe(false)
  })
})

describe('exactly 1,000 rows', () => {
  it('is whole, not truncated: a full page is not evidence of a cut', async () => {
    const { source } = connect({ evidence: 1000 })
    const state = await source.getPulse()
    expect(report(state, 'evidence').status).toBe('complete')
    expect(state.completeness?.complete).toBe(true)
  })

  it('is only knowable BECAUSE the total was requested: without it, the same page is indeterminate', async () => {
    const { source } = connect({ evidence: 1000 }, { countMode: { evidence: 'omit' } })
    const state = await source.getPulse()
    expect(report(state, 'evidence').status).toBe('indeterminate')
    expect(state.completeness?.complete).toBe(false)
  })
})

describe('a 1,500-row evidence dataset', () => {
  it('keeps the NEWEST 1,000, the same ones on every read, and still says it is incomplete', async () => {
    const { source } = connect({ evidence: 1500 })

    const first = await source.getPulse()
    const second = await source.getPulse()
    if (first.kind !== 'ready' || second.kind !== 'ready') throw new Error('expected ready')

    // Newest first: ev-00001 is the newest. The latest-evidence list is the head.
    expect(first.data.latestEvidence.map((e) => e.id)).toEqual(
      Array.from({ length: 8 }, (_, i) => `ev-${pad(i + 1)}`),
    )
    expect(second.data.latestEvidence).toEqual(first.data.latestEvidence)

    // Deterministic is not the same as complete.
    expect(first.completeness?.complete).toBe(false)
    expect(report(first, 'evidence')).toMatchObject({ status: 'truncated', returned: 1000, total: 1500 })
  })

  it('keeps the same rows when many share one timestamp, because a unique id breaks the tie', async () => {
    const tied = buildWorld({ evidence: 1200 })
    const sameInstant = tied.evidence!.map((row) => ({ ...row, retrieved_at: '2026-10-01T00:00:00.000Z' }))
    const { source } = connect({ evidence: 1200 }, {}, { evidence: sameInstant })

    const reads = await Promise.all([source.getPulse(), source.getPulse(), source.getPulse()])
    const latest = reads.map((s) => (s.kind === 'ready' ? s.data.latestEvidence.map((e) => e.id) : []))
    expect(latest[1]).toEqual(latest[0])
    expect(latest[2]).toEqual(latest[0])
    expect(latest[0]).toHaveLength(8)
  })
})

describe.each([
  'organizations',
  'opportunities',
  'signals',
  'evidence',
  'opportunity_signals',
  'signal_evidence',
  'sources',
  'account_source_expectations',
] as const)('the %s read, one row past the cap', (dataset) => {
  it('is reported truncated, and nothing else is', async () => {
    const override: Record<string, Row[]> = {}
    const world = buildWorld({ expectations: 3 })
    const base = world[dataset]!
    override[dataset] = Array.from({ length: READ_LIMIT + 1 }, (_, i) => {
      const seed = base[i % base.length]!
      return { ...seed, id: seed.id === undefined ? undefined : `${String(seed.id)}-x${i}`, ...(dataset === 'organizations' ? {} : {}) }
    })
    // Link tables have a composite key and no id: make every row distinct by key.
    if (dataset === 'opportunity_signals') {
      override[dataset] = Array.from({ length: READ_LIMIT + 1 }, (_, i) => ({
        opportunity_id: `opp-${pad((i % 3) + 1)}`,
        signal_id: `sig-${pad(i + 1)}`,
      }))
    }
    if (dataset === 'signal_evidence') {
      override[dataset] = Array.from({ length: READ_LIMIT + 1 }, (_, i) => ({
        signal_id: `sig-${pad((i % 3) + 1)}`,
        evidence_id: `ev-${pad(i + 1)}`,
        source_family_key: 'sec-edgar',
      }))
    }
    if (dataset === 'account_source_expectations') {
      override[dataset] = Array.from({ length: READ_LIMIT + 1 }, (_, i) => ({
        organization_id: `org-${pad(i + 1)}`,
        source_family: 'sec-edgar',
        expectation: 'required',
        rationale: 'synthetic',
      }))
    }

    const { source } = connect({ expectations: 3 }, {}, override)
    const state = await source.getPulse()
    if (state.kind === 'unavailable') throw new Error(`unavailable: ${state.reason}`)

    expect(report(state, dataset)).toMatchObject({ status: 'truncated', returned: READ_LIMIT, total: READ_LIMIT + 1 })
    const others = state.completeness!.datasets.filter(
      (d) => d.dataset !== dataset && d.dataset !== 'change_events' && d.dataset !== 'source_health_events',
    )
    expect(others.every((d) => d.status === 'complete')).toBe(true)
    expect(state.completeness?.complete).toBe(false)
  })
})

/* -------------------------------------------------- relationship tables, truncated */

describe('truncated relationship tables', () => {
  // 300 opportunities x 5 links = 1,500 link rows. Ordered by opportunity, the
  // first 1,000 rows are opportunities 1-200 whole, and 201-300 get none.
  const size: WorldSize = { opportunities: 300, signals: 300, evidence: 300, linksPerOpportunity: 5 }

  it('marks every opportunity document count a floor, including the ones whose links DID load', async () => {
    const { source } = connect(size)
    const state = await source.getOpportunities()
    if (state.kind !== 'ready') throw new Error(`expected ready, got ${state.kind}`)

    expect(report(state, 'opportunity_signals')).toMatchObject({ status: 'truncated', returned: 1000, total: 1500 })
    expect(state.completeness?.complete).toBe(false)
    // Conservative on purpose: a count is exact only if every table it passes
    // through was whole, and no opportunity can tell which of its links is missing.
    expect(state.data.every((o) => o.evidence.countIsLowerBound === true)).toBe(true)
  })

  it('shows the parent-child damage it is warning about: an opportunity with no links loaded', async () => {
    const { source } = connect(size)
    const state = await source.getOpportunities()
    if (state.kind !== 'ready') throw new Error('expected ready')

    const early = state.data.find((o) => o.id === 'opp-00001')!
    const late = state.data.find((o) => o.id === 'opp-00250')!

    // opp-00001 loaded every link; opp-00250's links were past the cut.
    expect(early.sources.length).toBeGreaterThan(0)
    expect(late.sources.length).toBe(0)
    // Both say "at least". The second is the one that would otherwise read as
    // "this opportunity has no documents".
    expect(late.evidence.countIsLowerBound).toBe(true)
  })

  it('does not mark a count a floor when the links are whole', async () => {
    const { source } = connect({ opportunities: 50, signals: 50, evidence: 50, linksPerOpportunity: 5 })
    const state = await source.getOpportunities()
    if (state.kind !== 'ready') throw new Error('expected ready')
    expect(state.completeness?.complete).toBe(true)
    expect(state.data.some((o) => o.evidence.countIsLowerBound)).toBe(false)
  })

  it('truncating signal_evidence alone is enough', async () => {
    // 600 signals x 2 documents = 1,200 link rows, while every other table is whole.
    const { source } = connect({ opportunities: 3, signals: 600, evidence: 600, evidencePerSignal: 2 })
    const state = await source.getOpportunities()
    if (state.kind !== 'ready') throw new Error('expected ready')
    expect(report(state, 'signal_evidence')).toMatchObject({ status: 'truncated', returned: 1000, total: 1200 })
    for (const dataset of ['opportunities', 'signals', 'evidence', 'opportunity_signals'] as const) {
      expect(report(state, dataset).status).toBe('complete')
    }
    expect(state.data.every((o) => o.evidence.countIsLowerBound === true)).toBe(true)
  })

  it('truncating signals alone is enough', async () => {
    const { source } = connect({ opportunities: 3, signals: 1100, evidence: 3, evidencePerSignal: 1 })
    const state = await source.getOpportunities()
    if (state.kind !== 'ready') throw new Error('expected ready')
    expect(report(state, 'signals')).toMatchObject({ status: 'truncated', returned: 1000, total: 1100 })
    expect(state.data.every((o) => o.evidence.countIsLowerBound === true)).toBe(true)
  })

  it('stops an account being called a coverage gap on the strength of a missing link', async () => {
    const world = buildWorld({ opportunities: 3, signals: 1100, evidence: 3, expectations: 3 })
    const { source } = connect({}, {}, world)
    const state = await source.getCompanies()
    if (state.kind !== 'ready') throw new Error(`expected ready, got ${state.kind}`)

    const reasons = state.data.map((c) => c.coverage.gapReason ?? '')
    // No account is told "X has not produced a signal"; each is told it was not
    // SEEN among what loaded, and that the gap may be overstated.
    expect(reasons.some((r) => /has not produced a signal/.test(r))).toBe(false)
    expect(reasons.some((r) => /may overstate the gap/.test(r))).toBe(true)
  })

  it('Source Health floors the counts that pass through the links', async () => {
    const { source } = connect(size)
    const state = await source.getSourceHealth()
    if (state.kind === 'unavailable' || state.kind === 'loading' || state.kind === 'empty') {
      throw new Error(`expected data, got ${state.kind}`)
    }
    for (const connector of state.data.connectors) {
      expect(connector.activity.lowerBounds?.opportunitiesCreated).toBe(true)
    }
    // Coverage is judged from signals, signal->evidence links and expectations;
    // truncating opportunity->signal links does not touch it, so it makes no claim.
    expect(state.data.coverageMayBeOverstated).toBeUndefined()
  })

  it('Source Health marks coverage as possibly overstated when the coverage inputs were cut', async () => {
    const { source } = connect({ opportunities: 3, signals: 600, evidence: 600, evidencePerSignal: 2 })
    const state = await source.getSourceHealth()
    if (state.kind === 'unavailable' || state.kind === 'loading' || state.kind === 'empty') {
      throw new Error(`expected data, got ${state.kind}`)
    }
    expect(state.data.coverageMayBeOverstated).toBe(true)
  })
})

/* ------------------------------------------------------------------- ordering */

describe('deterministic ordering', () => {
  /** What each full-table read must end its order with, so no two rows can tie. */
  const UNIQUE_TAIL: Record<string, string[]> = {
    organizations: ['id'],
    opportunities: ['id'],
    signals: ['id'],
    evidence: ['id'],
    opportunity_signals: ['opportunity_id', 'signal_id'], // composite primary key
    signal_evidence: ['signal_id', 'evidence_id'], // composite primary key
    sources: ['id'],
    account_source_expectations: ['organization_id', 'source_family'], // unique pair
    source_runs: ['id'],
    organization_locations: ['id'],
    opportunity_locations: ['id'],
  }

  it('asks for an order on every capped read, ending in a unique key', async () => {
    const { source, fake } = connect({ organizations: 3, opportunityLocations: 2, organizationLocations: 2 })
    await source.getPulse()
    await source.getSourceHealth()
    await source.getMapLocations()

    const capped = fake.calls.filter((c) => c.limit === READ_LIMIT)
    expect(new Set(capped.map((c) => c.table))).toEqual(new Set(Object.keys(UNIQUE_TAIL)))

    for (const call of capped) {
      const columns = call.orders.map((o) => o.column)
      const tail = UNIQUE_TAIL[call.table]!
      expect(columns.slice(-tail.length), `${call.table} must end its order with ${tail.join(', ')}`).toEqual(tail)
    }
  })

  it('asks for newest first, with NULLs last, where a timestamp decides what a cap keeps', async () => {
    const { source, fake } = connect()
    await source.getPulse()
    const newest = ['opportunities', 'signals', 'evidence'].map((t) =>
      fake.calls.find((c) => c.table === t)!.orders[0]!,
    )
    for (const order of newest) {
      expect(order.ascending).toBe(false)
      expect(order.nullsFirst).toBe(false)
    }
  })

  it('orders only by columns it also selects, so no grant is implied', async () => {
    const { source, fake } = connect({ opportunityLocations: 2, organizationLocations: 2 })
    await source.getPulse()
    await source.getSourceHealth()
    await source.getMapLocations()

    for (const call of fake.calls) {
      const selected = call.columns.split(',').map((c) => c.trim())
      for (const order of call.orders) {
        expect(selected, `${call.table} orders by ${order.column}`).toContain(order.column)
      }
      // The withheld evidence columns are still never named (migration 0015).
      expect(call.columns).not.toMatch(/body_text|archive_uri|raw_storage_uri|extracted_text_uri/)
    }
  })

  it('gives the same answer on repeated reads even when the database returns rows in a new order each time', async () => {
    const { source } = connect({ organizations: 40, opportunities: 40, signals: 40, evidence: 40, linksPerOpportunity: 3 })
    const runs = [await source.getOpportunities(), await source.getOpportunities(), await source.getOpportunities()]
    expect(JSON.stringify(runs[1])).toBe(JSON.stringify(runs[0]))
    expect(JSON.stringify(runs[2])).toBe(JSON.stringify(runs[0]))
  })

  it('the fake really would have shuffled an unordered read (so the test above can fail)', async () => {
    const world = buildWorld({ evidence: 30 })
    const fake: FakeSupabase = fakeSupabase(world)
    const read = async () => {
      const q = fake.client.from('evidence') as { select: (c: string) => PromiseLike<{ data: Row[] }> }
      return (await q.select('id')).data.map((r) => r.id)
    }
    const a = await read()
    const b = await read()
    expect(b).not.toEqual(a)
  })

  it('does not claim ordering made a truncated read whole', async () => {
    const { source } = connect({ evidence: 1100 })
    const state = await source.getPulse()
    expect(state.completeness?.complete).toBe(false)
  })

  it('puts a row with no timestamp last, not first, when a cap decides what is kept', async () => {
    const world = buildWorld({ opportunities: 1100, signals: 3, evidence: 3 })
    // The newest-by-id row has no timestamp. PostgreSQL would sort it FIRST in a
    // descending order and let it take a kept place; NULLS LAST must prevent that.
    world.opportunities![0] = { ...world.opportunities![0]!, last_material_change_at: null }
    const { source } = connect({}, {}, world)
    const state = await source.getOpportunities()
    if (state.kind !== 'ready') throw new Error('expected ready')
    expect(state.data.map((o) => o.id)).not.toContain('opp-00001')
    expect(report(state, 'opportunities').status).toBe('truncated')
  })
})

/* --------------------------------------------------------------------- failures */

describe('failed reads', () => {
  const GRAPH = [
    'organizations',
    'opportunities',
    'signals',
    'evidence',
    'opportunity_signals',
    'signal_evidence',
    'sources',
    'account_source_expectations',
  ] as const

  it.each(GRAPH)('a failed %s read makes every graph surface unavailable, never empty or ready', async (table) => {
    const { source } = connect({}, { errors: { [table]: { code: '42501', message: 'permission denied' } } })

    const states = await Promise.all([
      source.getPulse(),
      source.getOpportunities(),
      source.getCompanies(),
      source.getCompany('org-00001'),
      source.getSourceHealth(),
      source.getMapLocations(),
    ])
    for (const state of states) {
      // `sources` is also the freshness read, so it fails one step earlier; the
      // outcome is the same and is what matters.
      expect(state.kind).toBe('unavailable')
      expect(state.completeness).toBeUndefined()
    }
  })

  it.each([
    ['42501', FAILURE.notPermitted.blockedBy],
    ['PGRST301', FAILURE.unauthorized.blockedBy],
    ['42P01', FAILURE.notMigrated.blockedBy],
    ['500', FAILURE.requestFailed.blockedBy],
  ])('classifies a %s failure as what it is, not as "nothing found"', async (code, blockedBy) => {
    const { source } = connect({}, { errors: { opportunity_signals: { code, message: 'x' } } })
    const state = await source.getOpportunities()
    expect(state.kind).toBe('unavailable')
    if (state.kind === 'unavailable') expect(state.blockedBy).toBe(blockedBy)
  })

  it('treats a rejected request (a dropped connection) as a failed request, not an empty one', async () => {
    const { source } = connect({}, { rejects: ['signal_evidence'] })
    const state = await source.getPulse()
    expect(state.kind).toBe('unavailable')
    if (state.kind === 'unavailable') expect(state.blockedBy).toBe(FAILURE.requestFailed.blockedBy)
  })

  it('a failed run history makes Source Health unavailable rather than showing it with no runs', async () => {
    const { source } = connect({}, { errors: { source_runs: { code: '42501', message: 'permission denied' } } })
    expect((await source.getSourceHealth()).kind).toBe('unavailable')
  })

  it.each(['organization_locations', 'opportunity_locations'])('a failed %s read makes the map unavailable', async (table) => {
    const { source } = connect({}, { errors: { [table]: { code: '42501', message: 'permission denied' } } })
    expect((await source.getMapLocations()).kind).toBe('unavailable')
  })

  it('a failed change-feed read does not take Pulse down, and is reported rather than swallowed', async () => {
    const { source } = connect(
      { changeEvents: 3, healthEvents: 2 },
      { errors: { change_events: { code: '42703', message: 'column does not exist' } } },
    )
    const state = await source.getPulse()
    if (state.kind !== 'ready') throw new Error(`expected ready, got ${state.kind}`)

    expect(report(state, 'change_events').status).toBe('failed')
    expect(state.completeness?.complete).toBe(false)
    // The other ledger still lists, and the feed is NOT called empty.
    expect(state.data.changesSinceLastVisit.length).toBeGreaterThan(0)
    expect(state.data.changeFeed?.empty).toBe(false)
    // Everything else on the page is exactly as it was.
    expect(report(state, 'evidence').status).toBe('complete')
  })
})

/* ------------------------------------------------------ null and unavailable counts */

describe.each([
  ['a null count', 'null'],
  ['an omitted count', 'omit'],
  ['a count lower than the rows returned', 'short'],
] as [string, CountMode][])('%s', (_label, mode) => {
  it('is indeterminate, so the figure is shown as a floor and the notice appears', async () => {
    const { source } = connect({ evidence: 40 }, { countMode: { evidence: mode } })
    const state = await source.getPulse()
    if (state.kind !== 'ready') throw new Error('expected ready')

    expect(report(state, 'evidence')).toMatchObject({ status: 'indeterminate', total: null, returned: 40 })
    expect(state.completeness?.complete).toBe(false)
    // With no total to print, the figure is what came back, marked as a floor.
    expect(state.data.headline.evidenceCount).toBe(40)
    expect(state.data.headline.lowerBounds?.evidenceCount).toBe(true)
  })

  it('applies to the other datasets too', async () => {
    const { source } = connect({}, { countMode: { signals: mode } })
    const state = await source.getPulse()
    if (state.kind !== 'ready') throw new Error('expected ready')
    expect(report(state, 'signals').status).toBe('indeterminate')
    expect(state.data.headline.lowerBounds?.signalCount).toBe(true)
    expect(state.data.headline.lowerBounds?.newSignalCount).toBe(true)
  })
})

describe('a zero count beside rows that came back', () => {
  it('is indeterminate: a total below what arrived is not a total', async () => {
    const { source } = connect({ evidence: 5 }, { countMode: { evidence: 'zero' } })
    const state = await source.getPulse()
    expect(report(state, 'evidence').status).toBe('indeterminate')
  })
})

describe('an empty table', () => {
  it('with a confirmed zero is complete, and the surface is empty', async () => {
    const { source } = connect({ opportunities: 0, signals: 0, evidence: 0 })
    const state = await source.getOpportunities()
    expect(state.kind).toBe('empty')
    expect(state.completeness?.complete).toBe(true)
  })

  it('with NO total is still empty, but carries the reason it could not be confirmed', async () => {
    const { source } = connect({ opportunities: 0, signals: 0, evidence: 0 }, { countMode: { opportunities: 'omit' } })
    const state = await source.getOpportunities()
    expect(state.kind).toBe('empty')
    expect(state.completeness?.complete).toBe(false)
    expect(report(state, 'opportunities').status).toBe('indeterminate')
  })
})

/* ---------------------------------------------------------------- server-side cap */

describe('a server that caps below the client limit', () => {
  it('is still reported truncated, because the comparison is with the total', async () => {
    const { source } = connect({ evidence: 700 }, { maxRows: 500 })
    const state = await source.getPulse()
    expect(report(state, 'evidence')).toMatchObject({ status: 'truncated', returned: 500, total: 700 })
    expect(state.completeness?.complete).toBe(false)
  })
})

/* ------------------------------------------------------- intentionally limited reads */

describe('the recent-changes feed', () => {
  it('is limited by design, which is not a fault and does not raise the notice', async () => {
    const { source } = connect({ changeEvents: 40 })
    const state = await source.getPulse()
    expect(report(state, 'change_events')).toMatchObject({ status: 'limited', returned: 25, limit: 25 })
    expect(state.completeness?.complete).toBe(true)
    expect(state.kind === 'ready' && state.data.changeFeed?.bounded).toBe(true)
  })

  it('reads the latest 25 MATERIAL change events, in a stable order', async () => {
    const { source, fake } = connect({ changeEvents: 40 })
    await source.getPulse()
    const call = fake.calls.find((c) => c.table === 'change_events')!
    expect(call.limit).toBe(25)
    expect(call.orders.map((o) => o.column)).toEqual(['occurred_at', 'id'])
    expect(call.filters).toEqual([['materiality', 'material']])
    expect(call.count).toBeUndefined() // a slice by design needs no total
  })
})

/* ---------------------------------------------------------------- the other surfaces */

describe('Company', () => {
  it('floors an account count that is built from a truncated opportunities read', async () => {
    const { source } = connect({ organizations: 3, opportunities: 1100, signals: 3, evidence: 3 })
    const state = await source.getCompanies()
    if (state.kind !== 'ready') throw new Error('expected ready')
    expect(state.data.every((c) => c.lowerBounds?.openOpportunityCount === true)).toBe(true)
    expect(state.data.every((c) => c.lowerBounds?.signalCount !== true)).toBe(true)
  })

  it('does not say a company does not exist when the list of accounts was cut short', async () => {
    const { source } = connect({ organizations: 1100 })
    const state = await source.getCompany('org-01101')
    expect(state.kind).toBe('unavailable')
    if (state.kind === 'unavailable') {
      expect(state.blockedBy).toBe('incomplete_read')
      expect(state.reason).toMatch(/may still exist/)
    }
  })

  it('does say so when every account was read', async () => {
    const { source } = connect({ organizations: 5 })
    const state = await source.getCompany('org-09999')
    if (state.kind === 'unavailable') expect(state.blockedBy).toBe('not_found')
    else throw new Error('expected unavailable')
  })

  it('carries the completeness of what the page was built from', async () => {
    const { source } = connect({ evidence: 1200 })
    const state = await source.getCompany('org-00001')
    if (state.kind !== 'ready') throw new Error('expected ready')
    expect(report(state, 'evidence').status).toBe('truncated')
  })
})

describe('the map', () => {
  it('does not say a filing named no place when the location rows were cut short', async () => {
    const { source } = connect({ opportunities: 3, opportunityLocations: 1100 })
    // Every location row points at one of three opportunities, so all three are
    // placed; the question is the wording for a project with NO loaded row.
    const world = buildWorld({ opportunities: 4, opportunityLocations: 1100 })
    world.opportunity_locations = world.opportunity_locations!.map((r, i) => ({
      ...r,
      opportunity_id: `opp-${pad((i % 3) + 1)}`,
    }))
    const cut = connect({}, {}, world)
    const state = await cut.source.getMapLocations()
    if (state.kind !== 'ready') throw new Error(`expected ready, got ${state.kind}`)

    const unlocated = state.data.unlocated.find((u) => u.id === 'opp-00004')!
    expect(unlocated.reason).toMatch(/may exist that is not shown/)
    expect(unlocated.reason).not.toMatch(/did not name a site/)
    expect(state.data.countsAreLowerBounds).toBe(true)
    expect(report(state, 'opportunity_locations').status).toBe('truncated')
    void source
  })

  it('keeps the original wording when every location row loaded', async () => {
    const { source } = connect({ opportunities: 4, opportunityLocations: 2 })
    const state = await source.getMapLocations()
    if (state.kind !== 'ready') throw new Error('expected ready')
    expect(state.data.unlocated.map((u) => u.reason)).toContain(
      'The filing did not name a site, a city or a state for this project.',
    )
    expect(state.data.countsAreLowerBounds).toBeUndefined()
  })

  it('floors the counts when the OPPORTUNITIES were cut short, because a pin whose opportunity did not load is dropped', async () => {
    const { source } = connect({ opportunities: 1100, opportunityLocations: 3 })
    const state = await source.getMapLocations()
    if (state.kind !== 'ready') throw new Error('expected ready')
    expect(state.data.countsAreLowerBounds).toBe(true)
  })
})

describe('Source Health', () => {
  it('floors documents discovered when the run history was cut short', async () => {
    const { source } = connect({ runs: 1100 })
    const state = await source.getSourceHealth()
    if (state.kind === 'unavailable' || state.kind === 'loading' || state.kind === 'empty') {
      throw new Error(`expected data, got ${state.kind}`)
    }
    expect(report(state, 'source_runs')).toMatchObject({ status: 'truncated', returned: 1000, total: 1100 })
    for (const connector of state.data.connectors) {
      expect(connector.activity.lowerBounds?.documentsDiscovered).toBe(true)
      // The rest of the card is built from tables that were whole.
      expect(connector.activity.lowerBounds?.evidenceStored).toBe(false)
    }
    // Run history on a card is the latest ten however many were loaded.
    expect(state.data.connectors.every((c) => c.runHistory.length <= 10)).toBe(true)
  })

  it('reports nothing as short when every read was whole', async () => {
    const { source } = connect()
    const state = await source.getSourceHealth()
    if (state.kind === 'unavailable' || state.kind === 'loading' || state.kind === 'empty') {
      throw new Error(`expected data, got ${state.kind}`)
    }
    expect(state.completeness?.complete).toBe(true)
    expect(state.data.connectors.every((c) => c.activity.lowerBounds === undefined)).toBe(true)
    expect(state.data.coverageMayBeOverstated).toBeUndefined()
  })
})

/* ------------------------------------------------------ a whole read changes nothing */

describe('a read that was whole', () => {
  it('produces no lower-bound flag anywhere, so exact data is exactly what it was', async () => {
    const { source } = connect({ organizations: 5, opportunities: 5, signals: 5, evidence: 5, expectations: 2, changeEvents: 3 })
    const pulse = await source.getPulse()
    const opportunities = await source.getOpportunities()
    const companies = await source.getCompanies()
    const text = JSON.stringify([pulse, opportunities, companies])

    expect(pulse.completeness?.complete).toBe(true)
    for (const state of [opportunities, companies]) expect(state.completeness?.complete).toBe(true)
    expect(text).not.toMatch(/lowerBounds|countIsLowerBound|evidenceCountIsLowerBound|mayBeOverstated/)
  })
})

/* ------------------------------------------------------------------------ cost */

describe('requests', () => {
  it('adds no round trip: the total rides in the request that returns the rows', async () => {
    const { source, fake } = connect({ organizationLocations: 1, opportunityLocations: 1 })
    const count = async (run: () => Promise<unknown>) => {
      const before = fake.calls.length
      await run()
      return fake.calls.length - before
    }
    // 1 freshness read + the eight graph reads, plus each surface's own
    // (Pulse reads both change ledgers).
    expect(await count(() => source.getOpportunities())).toBe(9)
    expect(await count(() => source.getCompanies())).toBe(9)
    expect(await count(() => source.getPulse())).toBe(11)
    expect(await count(() => source.getSourceHealth())).toBe(10)
    expect(await count(() => source.getMapLocations())).toBe(11)
  })

  it('never asks for more than the cap, and asks for the total on every full-table read', async () => {
    const { source, fake } = connect({ organizationLocations: 1, opportunityLocations: 1 })
    await source.getPulse()
    await source.getSourceHealth()
    await source.getMapLocations()

    for (const call of fake.calls) {
      if (call.limit !== null) expect(call.limit).toBeLessThanOrEqual(READ_LIMIT)
    }
    const capped = fake.calls.filter((c) => c.limit === READ_LIMIT)
    expect(capped.length).toBeGreaterThan(0)
    expect(capped.every((c) => c.count === 'exact')).toBe(true)
  })
})
