import { readFileSync, readdirSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase } from '@/test/readTruncation/fakeSupabase'
import type { FakeOptions, Row } from '@/test/readTruncation/fakeSupabase'
import { LEDGER_SCHEMA, NOW, buildWorld, pad } from '@/test/readTruncation/world'
import type { WorldSize } from '@/test/readTruncation/world'
import { fromRoot } from '@/test/paths'
import { createApiDataSource } from '@/data/apiDataSource'
import {
  CHANGE_OBJECT_TYPES,
  MARKET_CHANGE_TYPES,
  SOURCE_EVENT_TYPES,
  SOURCE_HEALTH_STATUSES,
  assembleFeed,
  describeMarketChange,
  describeSourceEvent,
} from '@/lib/changeFeed'
import type { Described, RecordLookup } from '@/lib/changeFeed'
import type { ChangeEvent, PulseSnapshot, SurfaceState } from '@/types/domain'

/**
 * THE DAILY PULSE CHANGE FEED READS REAL COLUMNS AND SAYS ONLY WHAT A ROW SAYS.
 *
 * The feed used to select `change_kind` and `summary`, which `change_events` has
 * never had. The read failed, the error was swallowed, and the feed was empty in
 * production for as long as the page existed. Then every row it WOULD have read
 * was labelled `evidence_added` on the market channel whatever it was.
 *
 * Three kinds of test here:
 *
 *   1. The VOCABULARY is pinned to the repository's own sources: the DDL for the
 *      columns, object types, materiality and health statuses, and `runner.ts`
 *      for the event types the collector actually writes. A column that does not
 *      exist, or an event type nobody described, fails here and not in production.
 *   2. The DESCRIPTIONS are checked as claims. Every sentence must be built from
 *      the row, never from the clock or from a guess about commercial value.
 *   3. The READ is run end to end against a PostgREST-shaped fake that rejects a
 *      column the table does not have.
 */

const holder = vi.hoisted(() => ({ client: null as unknown }))
vi.mock('@/lib/supabaseClient', () => ({ supabaseBrowser: () => holder.client }))

beforeEach(() => {
  holder.client = null
})

/* ------------------------------------------------------------------- the DDL */

const MIGRATIONS = readdirSync(fromRoot('../db/migrations'))
  .filter((name) => name.endsWith('.up.sql'))
  .sort()
  .map((name) => `../db/migrations/${name}`)
const SQL_FILES = ['../schemas/database.sql', ...MIGRATIONS]
const read = (file: string) => readFileSync(fromRoot(file), 'utf8')

const COLUMN_TYPE =
  /^([a-z_][a-z0-9_]*)\s+(?:uuid|text|jsonb|timestamptz|integer|boolean|bigint|numeric|date|smallint)\b/i

/** Every column a table has once all the migrations have run, read from the SQL itself. */
function ddlColumns(table: string): string[] {
  const columns = new Set<string>()
  for (const file of SQL_FILES) {
    const sql = read(file)
    const create = new RegExp(`create table (?:if not exists )?${table} \\(([\\s\\S]*?)\\n\\);`, 'i').exec(sql)
    for (const raw of (create?.[1] ?? '').split('\n')) {
      const line = raw.trim()
      if (!line || line.startsWith('--')) continue
      const match = COLUMN_TYPE.exec(line)
      if (match?.[1]) columns.add(match[1])
    }
    for (const statement of sql.split(';')) {
      if (!new RegExp(`^\\s*(?:--[^\\n]*\\n\\s*)*alter table (?:if exists )?${table}\\b`, 'i').test(statement)) continue
      for (const added of statement.matchAll(/add column (?:if not exists )?([a-z_][a-z0-9_]*)/gi)) {
        if (added[1]) columns.add(added[1])
      }
    }
  }
  return [...columns]
}

/** The quoted values of a `<column> in (...)` CHECK, with SQL comments removed. */
function checkValues(sql: string, column: string): string[] {
  const match = new RegExp(`${column} in \\(([\\s\\S]*?)\\)\\)`, 'i').exec(sql.replace(/--[^\n]*/g, ''))
  return [...(match?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!)
}

describe('the vocabulary is the schema’s own', () => {
  it('knows exactly the columns change_events has, as the migrations define them', () => {
    expect(ddlColumns('change_events').sort()).toEqual([...(LEDGER_SCHEMA.change_events ?? [])].sort())
  })

  it('knows exactly the columns source_health_events has, as the migrations define them', () => {
    expect(ddlColumns('source_health_events').sort()).toEqual([...(LEDGER_SCHEMA.source_health_events ?? [])].sort())
  })

  it('does not mention the columns the old read invented', () => {
    expect(ddlColumns('change_events')).not.toContain('change_kind')
    expect(ddlColumns('change_events')).not.toContain('summary')
  })

  it('recognises exactly the object types the ledger’s CHECK constraint allows', () => {
    expect([...CHANGE_OBJECT_TYPES].sort()).toEqual(checkValues(read('../db/migrations/0012_change_events_and_audit.up.sql'), 'object_type').sort())
  })

  it('lists material rows, a value the materiality CHECK actually allows', () => {
    expect(checkValues(read('../db/migrations/0012_change_events_and_audit.up.sql'), 'materiality')).toContain('material')
  })

  it('names exactly the health statuses a source may have', () => {
    const latest = read('../db/migrations/0021_live_source_ingestion.up.sql')
    const constraint = latest.slice(latest.indexOf('sources_health_status_check\n'))
    expect([...SOURCE_HEALTH_STATUSES].sort()).toEqual(checkValues(constraint, 'health_status').sort())
  })

  it('describes every event type the collector writes, so a new one cannot slip in undescribed', () => {
    const runner = read('netlify/functions/_shared/connectors/runner.ts'.replace(/^/, ''))
    const written = new Set<string>()
    for (const m of runner.matchAll(/\btype:\s*'([a-z_]+)'/g)) written.add(m[1]!)
    for (const m of runner.matchAll(/\btype:\s*[^\n]*\?\s*'([a-z_]+)'\s*:\s*'([a-z_]+)'/g)) {
      written.add(m[1]!)
      written.add(m[2]!)
    }
    for (const m of runner.matchAll(/recordSkip\(\s*client,\s*[^,]+,\s*[^,]+,\s*'([a-z_]+)'/g)) written.add(m[1]!)

    expect(written.size).toBeGreaterThan(3)
    // `status_change` is a real transition and is described by the transition itself.
    const described = new Set([...SOURCE_EVENT_TYPES, 'status_change'])
    for (const type of written) expect(described, `runner.ts writes "${type}"`).toContain(type)
  })
})

/* ------------------------------------------------------------------- builders */

function lookup(whole = true): RecordLookup {
  return {
    opportunity: (id) => (id === 'opp-1' ? { title: 'Line 4 expansion', organizationName: 'Org A' } : null),
    organization: (id) => (id === 'org-1' ? { name: 'Org A' } : null),
    signal: (id) => (id === 'sig-1' ? { title: 'Plant filing' } : id === 'sig-untitled' ? { title: null } : null),
    source: (id) => (id === 'sec-edgar' ? { name: 'SEC EDGAR' } : null),
    wasWhole: () => whole,
  }
}

const market = (over: Row = {}): Row => ({
  id: 'chg-1',
  object_type: 'opportunity',
  object_id: 'opp-1',
  change_type: 'evidence_added',
  from_state: null,
  to_state: null,
  materiality: 'material',
  actor_type: 'system',
  occurred_at: '2026-10-15T09:00:00.000Z',
  ...over,
})

const health = (over: Row = {}): Row => ({
  id: 'she-1',
  source_id: 'sec-edgar',
  prior_status: 'healthy',
  new_status: 'degraded',
  event_type: 'status_change',
  summary: 'Run stored 3 of 5 documents.',
  action_required: null,
  created_at: '2026-10-15T08:00:00.000Z',
  ...over,
})

function market1(over: Row = {}, whole = true): ChangeEvent {
  const result = describeMarketChange(market(over), lookup(whole))
  if (!('event' in result)) throw new Error(`skipped: ${result.skipped}`)
  return result.event
}

function health1(over: Row = {}): ChangeEvent {
  const result = describeSourceEvent(health(over), lookup())
  if (!('event' in result)) throw new Error(`skipped: ${result.skipped}`)
  return result.event
}

/* --------------------------------------------------------------- market events */

describe('market changes', () => {
  describe('new evidence', () => {
    it.each([
      ['opportunity', 'opp-1', 'New evidence was recorded for this opportunity.'],
      ['signal', 'sig-1', 'New evidence was recorded for this signal.'],
      ['organization', 'org-1', 'New evidence was recorded for this account.'],
    ])('on %s says what was recorded, and nothing about why it matters', (objectType, objectId, detail) => {
      const event = market1({ object_type: objectType, object_id: objectId })
      expect(event).toMatchObject({
        kind: 'evidence_added',
        channel: 'market',
        tone: 'neutral',
        title: 'New evidence',
        detail,
        needsAttention: false,
        actionHint: null,
      })
    })

    it('names the opportunity and its account, from records the page holds', () => {
      const event = market1()
      expect(event.subjectLabel).toBe('Line 4 expansion — Org A')
      expect(event.opportunityId).toBe('opp-1')
    })
  })

  describe('opportunity status transitions', () => {
    it('states both ends when both are valid statuses', () => {
      const event = market1({
        change_type: 'status_changed',
        from_state: { status: 'new' },
        to_state: { status: 'watching' },
      })
      expect(event).toMatchObject({ kind: 'status_changed', title: 'Status changed', detail: 'Status: New → Watching.' })
    })

    it('states only the new status when the old one is not recorded', () => {
      const event = market1({ change_type: 'status_changed', to_state: { status: 'on_hold' } })
      expect(event.detail).toBe('Now On hold.')
    })

    it('says the row does not say, rather than guessing, when neither is a valid status', () => {
      const event = market1({
        change_type: 'status_changed',
        from_state: { status: 'platinum' },
        to_state: 'watching',
      })
      expect(event.detail).toBe('The recorded change does not say which statuses.')
    })

    it('records a closure as the status it names, and does not quote a status that is not a closure', () => {
      expect(market1({ change_type: 'closed', to_state: { status: 'closed_lost' } }).detail).toBe('Recorded as Closed — lost.')
      expect(market1({ change_type: 'closed', to_state: { status: 'cancelled' } }).detail).toBe('Recorded as Cancelled.')
      // A "closed" event whose to_state says "watching" contradicts itself.
      expect(market1({ change_type: 'closed', to_state: { status: 'watching' } }).detail).toBe(
        'Recorded as closed; the outcome is not stated.',
      )
      expect(market1({ change_type: 'closed' }).detail).toBe('Recorded as closed; the outcome is not stated.')
    })
  })

  describe('stage changes', () => {
    it('states the transition and takes its tone from the stage reached', () => {
      const promoted = market1({
        change_type: 'stage_promoted',
        from_state: { stage: 'emerging' },
        to_state: { stage: 'developing' },
      })
      expect(promoted).toMatchObject({
        kind: 'stage_promoted',
        title: 'Stage promoted',
        detail: 'Stage: Emerging → Developing.',
        tone: 'developing',
      })
      const demoted = market1({
        change_type: 'stage_demoted',
        from_state: { stage: 'confirmed' },
        to_state: { stage: 'developing' },
      })
      expect(demoted).toMatchObject({ kind: 'stage_demoted', title: 'Stage demoted', detail: 'Stage: Confirmed → Developing.' })
    })

    it('uses a neutral tone and says nothing about stages when the row gives none', () => {
      const event = market1({ change_type: 'stage_promoted' })
      expect(event.tone).toBe('neutral')
      expect(event.detail).toBe('The recorded change does not say which stages.')
    })

    it('ignores a stage that is not in the vocabulary instead of printing it', () => {
      const event = market1({ change_type: 'stage_promoted', to_state: { stage: 'unicorn' } })
      expect(event.detail).not.toMatch(/unicorn/i)
      expect(event.tone).toBe('neutral')
    })
  })

  describe('other recorded changes', () => {
    it('describes a facility resolution by the object it was recorded on', () => {
      expect(market1({ change_type: 'facility_resolved' }).detail).toBe('A facility was resolved for this opportunity.')
      expect(
        market1({ change_type: 'facility_resolved', object_type: 'facility', object_id: 'fac-1' }),
      ).toMatchObject({ detail: 'This facility record was resolved.', subjectLabel: 'Facility' })
    })

    it('describes a negative signal as exactly that, with an attention tone and no instruction', () => {
      const event = market1({ change_type: 'negative_signal', object_type: 'signal', object_id: 'sig-1' })
      expect(event).toMatchObject({
        kind: 'negative_signal',
        tone: 'attention',
        detail: 'A negative signal was recorded for this signal.',
        needsAttention: false,
        actionHint: null,
      })
    })
  })

  describe('naming the subject', () => {
    it('names an untitled signal as untitled, not as missing', () => {
      const event = market1({ object_type: 'signal', object_id: 'sig-untitled' })
      expect(event.subjectLabel).toBe('Signal (no title recorded)')
    })

    it('says a record is not found only when the read it came from was whole', () => {
      expect(market1({ object_id: 'opp-gone' }, true).subjectLabel).toBe('Opportunity (record not found)')
      expect(market1({ object_id: 'opp-gone' }, false).subjectLabel).toBe('Opportunity (record not loaded)')
    })

    it('does not link to an opportunity that is not among the loaded records', () => {
      expect(market1({ object_id: 'opp-gone' }).opportunityId).toBeNull()
    })

    it('invents no organisation, project or place for a record it cannot see', () => {
      const event = market1({ object_id: 'opp-gone' })
      expect(`${event.subjectLabel} ${event.title} ${event.detail}`).not.toMatch(/Org A|Line 4/)
    })
  })

  describe('what is left out, and why', () => {
    it.each(['minor', 'silent', null, 'unknown'])('does not list a %s change: Pulse is given material ones', (materiality) => {
      expect(describeMarketChange(market({ materiality }), lookup())).toEqual({ skipped: 'not_material' })
    })

    it.each(['renamed', 'something_new', 'EVIDENCE_ADDED', 'constructor', '__proto__', 'toString', ''])(
      'does not describe an unrecognised change type (%j), and does not relabel it as a known one',
      (changeType) => {
        const result = describeMarketChange(market({ change_type: changeType }), lookup())
        expect('event' in result).toBe(false)
        expect(['unsupported_type', 'malformed']).toContain((result as { skipped: string }).skipped)
      },
    )

    it('does not describe a known change type on an object it is not defined for', () => {
      expect(describeMarketChange(market({ change_type: 'stage_promoted', object_type: 'signal' }), lookup())).toEqual({
        skipped: 'unsupported_subject',
      })
      expect(describeMarketChange(market({ change_type: 'status_changed', object_type: 'organization' }), lookup())).toEqual({
        skipped: 'unsupported_subject',
      })
    })

    it.each<[string, Row]>([
      ['no id', { id: null }],
      ['an empty id', { id: '  ' }],
      ['no timestamp', { occurred_at: null }],
      ['an unparseable timestamp', { occurred_at: 'last Tuesday' }],
      ['an unknown object type', { object_type: 'portfolio' }],
      ['no object id', { object_id: null }],
      ['no change type', { change_type: null }],
    ])('does not list a row with %s, and never replaces it with the current time', (_label, over) => {
      expect(describeMarketChange(market(over), lookup())).toEqual({ skipped: 'malformed' })
    })

    it('uses the recorded timestamp exactly', () => {
      expect(market1({ occurred_at: '2026-03-02T01:02:03.456+05:30' }).occurredAt).toBe('2026-03-02T01:02:03.456+05:30')
    })
  })

  describe('no invented summaries or commercial implications', () => {
    // Words a description would only contain if something had decided what the
    // change is WORTH. The ledger records that a change happened; it does not
    // record that. (Status labels such as "Pursuing" are the row's own values and
    // are excluded by using change types that do not carry a status.)
    const IMPLICATION =
      /\b(worth|priority|likely|significan|important|recommend|revenue|pursuit|should|opportunity to|hot|urgent|win|prospect|upside|momentum)\b/i

    const grid: [string, string][] = MARKET_CHANGE_TYPES.flatMap((changeType) =>
      CHANGE_OBJECT_TYPES.map((objectType) => [changeType, objectType] as [string, string]),
    )

    it.each(grid)('%s on %s makes no claim beyond the row', (changeType, objectType) => {
      const result = describeMarketChange(
        market({
          change_type: changeType,
          object_type: objectType,
          from_state: { stage: 'emerging', note: 'a very important, high-priority win' },
          to_state: { stage: 'confirmed', summary: 'likely to be worth millions' },
        }),
        lookup(),
      )
      if (!('event' in result)) return
      const { event } = result
      // Free text inside the states is never repeated.
      expect(`${event.title} ${event.detail} ${event.subjectLabel}`).not.toMatch(IMPLICATION)
      expect(event.needsAttention).toBe(false)
      expect(event.actionHint).toBeNull()
      expect(event.channel).toBe('market')
    })

    it('never classifies every change as evidence added', () => {
      const kinds = new Set(MARKET_CHANGE_TYPES.map((type) => market1({
        change_type: type,
        object_type: type === 'facility_resolved' ? 'organization' : type === 'evidence_added' ? 'opportunity' : 'opportunity',
      }).kind))
      expect(kinds.size).toBe(MARKET_CHANGE_TYPES.length)
      expect(kinds.has('evidence_added')).toBe(true)
      expect(MARKET_CHANGE_TYPES.length).toBeGreaterThan(1)
    })
  })
})

/* ---------------------------------------------------------- operational events */

describe('source events', () => {
  describe('failures and recovery', () => {
    it('reports a degradation as one, in the system channel, from the collector’s own summary', () => {
      const event = health1()
      expect(event).toMatchObject({
        id: 'health:she-1',
        kind: 'coverage_degraded',
        channel: 'system',
        tone: 'attention',
        title: 'Source degraded',
        detail: 'Status: Healthy → Degraded. Run stored 3 of 5 documents.',
        subjectLabel: 'SEC EDGAR',
        occurredAt: '2026-10-15T08:00:00.000Z',
        opportunityId: null,
        needsAttention: false,
        actionHint: null,
      })
    })

    it.each([
      ['degraded', 'Source degraded'],
      ['action_required', 'Source needs action'],
      ['manual_review_required', 'Source needs manual review'],
      ['source_unavailable', 'Source unavailable'],
    ])('names a move to %s', (status, title) => {
      expect(health1({ new_status: status })).toMatchObject({ kind: 'coverage_degraded', title })
    })

    it.each(['degraded', 'action_required', 'manual_review_required', 'source_unavailable'])(
      'reports a return from %s to healthy as a recovery',
      (prior) => {
        expect(health1({ prior_status: prior, new_status: 'healthy', summary: 'Run completed.' })).toMatchObject({
          kind: 'source_recovered',
          channel: 'system',
          tone: 'neutral',
          title: 'Source recovered',
        })
      },
    )

    it('does not call a first healthy status, or a non-failure change, a recovery', () => {
      expect(health1({ prior_status: null, new_status: 'healthy', event_type: 'failure' }).kind).toBe('source_notice')
      expect(health1({ prior_status: 'healthy', new_status: 'disabled' })).toMatchObject({
        kind: 'source_notice',
        title: 'Source status changed',
        detail: 'Status: Healthy → Disabled. Run stored 3 of 5 documents.',
      })
      expect(health1({ prior_status: 'disabled', new_status: 'healthy' }).kind).toBe('source_notice')
    })

    it('turns an action_required payload into the words of the action, and flags it', () => {
      const manual = health1({
        new_status: 'manual_review_required',
        action_required: { action: 'operator_import', detail: 'x' },
      })
      expect(manual.needsAttention).toBe(true)
      expect(manual.actionHint).toBe('An operator import is needed for this source.')

      const egress = health1({
        event_type: 'blocked_egress',
        prior_status: 'action_required',
        new_status: 'action_required',
        action_required: { action: 'extend_egress_allowlist', hosts: ['example.invalid'] },
      })
      expect(egress.actionHint).toBe("The collector's network allowlist needs extending for this source.")
      // The host is not repeated: the row's own summary says what it chooses to.
      expect(egress.actionHint).not.toMatch(/example/)

      expect(health1({ action_required: { action: 'something_new' } }).actionHint).toBe(
        'This source has been flagged for a person to review.',
      )
      expect(health1({ action_required: null }).needsAttention).toBe(false)
    })
  })

  describe('run notices, where the status did not change', () => {
    it.each([
      ['failure', 'Collection failed', 'attention'],
      ['run_abandoned', 'Collection run abandoned', 'attention'],
      ['blocked_egress', 'Collection blocked', 'attention'],
      ['skipped_overlap', 'Collection run skipped', 'neutral'],
      ['deferred_time_budget', 'Collection deferred', 'neutral'],
    ])('%s is listed as an operational notice', (eventType, title, tone) => {
      expect(health1({ event_type: eventType, prior_status: 'degraded', new_status: 'degraded' })).toMatchObject({
        kind: 'source_notice',
        channel: 'system',
        title,
        tone,
        detail: 'Run stored 3 of 5 documents.',
      })
    })

    it('treats an unrecognised prior status as unknown: it neither makes nor hides a transition', () => {
      const event = health1({ prior_status: 'sleeping', new_status: 'degraded', event_type: 'failure' })
      expect(event.kind).toBe('source_notice')
      expect(event.title).toBe('Collection failed')
      expect(event.detail).not.toMatch(/→/)
    })
  })

  describe('what is left out, and why', () => {
    it.each<[string, Row]>([
      ['an unknown new status', { new_status: 'asleep' }],
      ['no new status', { new_status: null }],
    ])('does not list a row with %s', (_label, over) => {
      expect(describeSourceEvent(health(over), lookup())).toEqual({ skipped: 'unsupported_type' })
    })

    it('does not list an unrecognised event type that records no change of status', () => {
      expect(
        describeSourceEvent(health({ event_type: 'heartbeat', prior_status: 'healthy', new_status: 'healthy' }), lookup()),
      ).toEqual({ skipped: 'unsupported_type' })
      expect(
        describeSourceEvent(health({ event_type: 'constructor', prior_status: null, new_status: 'healthy' }), lookup()),
      ).toEqual({ skipped: 'unsupported_type' })
    })

    it.each<[string, Row]>([
      ['no id', { id: null }],
      ['no timestamp', { created_at: null }],
      ['an unparseable timestamp', { created_at: 'soon' }],
      ['no source', { source_id: '' }],
      ['no event type', { event_type: null }],
    ])('does not list a row with %s', (_label, over) => {
      expect(describeSourceEvent(health(over), lookup())).toEqual({ skipped: 'malformed' })
    })
  })

  describe('the words come from the row', () => {
    it('repeats a long summary shortened, with an ellipsis, and does not paraphrase it', () => {
      const summary = `Stopped early. ${'The time budget ran out. '.repeat(40)}`
      const event = health1({ summary })
      expect(event.detail.length).toBeLessThanOrEqual('Status: Healthy → Degraded. '.length + 280)
      expect(event.detail.endsWith('…')).toBe(true)
      expect(event.detail).toContain('Stopped early. The time budget ran out.')
    })

    it('omits the summary when there is none instead of writing one', () => {
      expect(health1({ summary: '   ' }).detail).toBe('Status: Healthy → Degraded.')
      expect(health1({ summary: null, prior_status: null, event_type: 'failure' }).detail).toBe('')
    })

    it('names a source it does not hold by the identifier the row carries', () => {
      expect(health1({ source_id: 'mars-newsroom' }).subjectLabel).toBe('mars-newsroom')
    })

    it('uses the recorded time, never the time of the read', () => {
      expect(health1({ created_at: '2026-01-02T03:04:05Z' }).occurredAt).toBe('2026-01-02T03:04:05Z')
    })
  })
})

/* ------------------------------------------------------------------- assembly */

describe('assembling the feed', () => {
  const ev = (id: string, occurredAt: string): Described => ({
    event: {
      id,
      kind: 'evidence_added',
      channel: 'market',
      tone: 'neutral',
      title: 't',
      detail: 'd',
      occurredAt,
      subjectLabel: 's',
      needsAttention: false,
      actionHint: null,
      opportunityId: null,
    },
  })

  it('orders by the instant, not the string, so a different offset cannot jump the queue', () => {
    // 10:00+02:00 is 08:00Z: EARLIER than 09:00Z, though it sorts later as text.
    const feed = assembleFeed(
      [[ev('a', '2026-10-16T10:00:00+02:00'), ev('b', '2026-10-16T09:00:00Z'), ev('c', '2026-10-16T09:00:00.500Z')]],
      25,
    )
    expect(feed.events.map((e) => e.id)).toEqual(['c', 'b', 'a'])
  })

  it('breaks ties by id, so the same rows list the same way every time', () => {
    const rows = [ev('z', '2026-10-16T09:00:00Z'), ev('a', '2026-10-16T09:00:00Z'), ev('m', '2026-10-16T09:00:00Z')]
    const expected = ['a', 'm', 'z']
    for (const permutation of [[0, 1, 2], [2, 1, 0], [1, 2, 0], [0, 2, 1]]) {
      expect(assembleFeed([permutation.map((i) => rows[i]!)], 25).events.map((e) => e.id)).toEqual(expected)
    }
  })

  it('keeps the newest of the union and says there was more', () => {
    const many = Array.from({ length: 30 }, (_, i) => ev(`e${pad(i)}`, new Date(NOW.getTime() - i * 60_000).toISOString()))
    const feed = assembleFeed([many.slice(0, 15), many.slice(15)], 25)
    expect(feed.events).toHaveLength(25)
    expect(feed.events[0]?.id).toBe('e00000')
    expect(feed.events[24]?.id).toBe('e00024')
    expect(feed.overflowed).toBe(true)
    expect(assembleFeed([many.slice(0, 25)], 25).overflowed).toBe(false)
  })

  it('counts what it could not describe, and does not count what was never meant for Pulse', () => {
    const feed = assembleFeed(
      [[ev('a', '2026-10-16T09:00:00Z'), { skipped: 'unsupported_type' }, { skipped: 'malformed' }, { skipped: 'not_material' }], [{ skipped: 'unsupported_subject' }]],
      25,
    )
    expect(feed.events).toHaveLength(1)
    expect(feed.notListed).toBe(3)
  })
})

/* ---------------------------------------------------- the read, end to end */

function connect(size: WorldSize = {}, options: FakeOptions = {}, override: Record<string, Row[]> = {}) {
  const fake = fakeSupabase({ ...buildWorld(size), ...override }, { schema: LEDGER_SCHEMA, ...options })
  holder.client = fake.client
  return { fake, source: createApiDataSource(() => NOW) }
}

async function pulse(
  size: WorldSize = {},
  options: FakeOptions = {},
  override: Record<string, Row[]> = {},
): Promise<PulseSnapshot> {
  const { source } = connect(size, options, override)
  const state: SurfaceState<PulseSnapshot> = await source.getPulse()
  if (state.kind !== 'ready' && state.kind !== 'stale' && state.kind !== 'degraded') {
    throw new Error(`expected data, got ${state.kind}`)
  }
  return state.data
}

const ledgerRow = (over: Row): Row => ({
  object_type: 'opportunity',
  object_id: 'opp-00001',
  change_type: 'evidence_added',
  from_state: null,
  to_state: null,
  materiality: 'material',
  dedupe_key: `k-${String(over.id)}`,
  scoring_version: null,
  actor_type: 'system',
  ...over,
})

describe('the Pulse read', () => {
  it('selects only columns the tables really have, and orders and filters only on those', async () => {
    const { source, fake } = connect({ changeEvents: 2, healthEvents: 2 })
    await source.getPulse()
    for (const table of ['change_events', 'source_health_events']) {
      const call = fake.calls.find((c) => c.table === table)!
      const real = ddlColumns(table)
      const named = [
        ...call.columns.split(',').map((c) => c.trim()),
        ...call.orders.map((o) => o.column),
        ...call.filters.map(([c]) => c),
      ]
      for (const column of named) expect(real, `${table}.${column}`).toContain(column)
    }
  })

  it('asks the database for the 25 newest MATERIAL change events, ordered with a unique tail', async () => {
    const { source, fake } = connect({ changeEvents: 3 })
    await source.getPulse()
    const call = fake.calls.find((c) => c.table === 'change_events')!
    expect(call).toMatchObject({ limit: 25, filters: [['materiality', 'material']] })
    expect(call.orders.map((o) => `${o.column}${o.ascending ? '' : ' desc'}`)).toEqual(['occurred_at desc', 'id'])
    expect(call.orders[0]?.nullsFirst).toBe(false)
  })

  it('asks for the 25 newest source events, ordered with a unique tail', async () => {
    const { source, fake } = connect({ healthEvents: 3 })
    await source.getPulse()
    const call = fake.calls.find((c) => c.table === 'source_health_events')!
    expect(call.limit).toBe(25)
    expect(call.orders.map((o) => `${o.column}${o.ascending ? '' : ' desc'}`)).toEqual(['created_at desc', 'id'])
  })

  it('lists real events by what they are, with the market and operational channels apart', async () => {
    const data = await pulse(
      { organizations: 2, opportunities: 3, signals: 3, evidence: 3 },
      {},
      {
        change_events: [
          ledgerRow({ id: 'c1', change_type: 'stage_promoted', from_state: { stage: 'emerging' }, to_state: { stage: 'developing' }, occurred_at: '2026-10-16T11:00:00Z' }),
          ledgerRow({ id: 'c2', change_type: 'evidence_added', occurred_at: '2026-10-16T10:00:00Z' }),
          ledgerRow({ id: 'c3', change_type: 'status_changed', from_state: { status: 'new' }, to_state: { status: 'watching' }, occurred_at: '2026-10-16T09:00:00Z' }),
        ],
        source_health_events: [
          { id: 'h1', source_id: 'sec-edgar', source_run_id: null, prior_status: 'healthy', new_status: 'source_unavailable', event_type: 'failure', summary: 'The filing index returned 503.', coverage_impact: {}, action_required: null, resolved_at: null, created_at: '2026-10-16T10:30:00Z' },
          { id: 'h2', source_id: 'sec-edgar', source_run_id: null, prior_status: 'source_unavailable', new_status: 'healthy', event_type: 'status_change', summary: 'Run completed.', coverage_impact: {}, action_required: null, resolved_at: null, created_at: '2026-10-16T11:30:00Z' },
        ],
      },
    )

    expect(data.changesSinceLastVisit.map((c) => `${c.channel}:${c.kind}`)).toEqual([
      'system:source_recovered',
      'market:stage_promoted',
      'system:coverage_degraded',
      'market:evidence_added',
      'market:status_changed',
    ])
    // Not every row is evidence added.
    expect(new Set(data.changesSinceLastVisit.map((c) => c.kind)).size).toBe(5)
    // The opportunity is named from the loaded records, and linked.
    const promoted = data.changesSinceLastVisit.find((c) => c.kind === 'stage_promoted')!
    expect(promoted.subjectLabel).toBe('Opportunity 00001 — Org 00001')
    expect(promoted.opportunityId).toBe('opp-00001')
    expect(promoted.detail).toBe('Stage: Emerging → Developing.')
    expect(data.changeFeed).toEqual({ limit: 25, bounded: false, notListed: 0, empty: false })
  })

  it('keeps minor and silent change events out, as the database filter would', async () => {
    const data = await pulse(
      { opportunities: 2 },
      {},
      {
        change_events: [
          ledgerRow({ id: 'c1', change_type: 'evidence_added', materiality: 'minor', occurred_at: '2026-10-16T10:00:00Z' }),
          ledgerRow({ id: 'c2', change_type: 'evidence_added', materiality: 'silent', occurred_at: '2026-10-16T09:00:00Z' }),
        ],
      },
    )
    expect(data.changesSinceLastVisit).toEqual([])
    // Nothing material and nothing hidden: the feed is genuinely empty, and says so.
    expect(data.changeFeed).toMatchObject({ empty: true, notListed: 0 })
  })

  it('counts rows it cannot describe instead of dropping them silently or relabelling them', async () => {
    const data = await pulse(
      { opportunities: 2 },
      {},
      {
        change_events: [
          ledgerRow({ id: 'c1', change_type: 'evidence_added', occurred_at: '2026-10-16T10:00:00Z' }),
          ledgerRow({ id: 'c2', change_type: 'renamed', object_type: 'organization', object_id: 'org-00001', occurred_at: '2026-10-16T09:00:00Z' }),
          ledgerRow({ id: 'c3', change_type: 'stage_promoted', object_type: 'signal', object_id: 'sig-00001', occurred_at: '2026-10-16T08:00:00Z' }),
        ],
      },
    )
    expect(data.changesSinceLastVisit.map((c) => c.id)).toEqual(['c1'])
    expect(data.changeFeed).toMatchObject({ notListed: 2, empty: false })
  })

  it('names a missing related record honestly: not found when the read was whole', async () => {
    const data = await pulse(
      { opportunities: 2 },
      {},
      { change_events: [ledgerRow({ id: 'c1', object_id: 'opp-99999', occurred_at: '2026-10-16T10:00:00Z' })] },
    )
    expect(data.changesSinceLastVisit[0]).toMatchObject({
      subjectLabel: 'Opportunity (record not found)',
      opportunityId: null,
    })
  })

  it('names it as not loaded when the opportunities read was cut short, since it may exist', async () => {
    const data = await pulse(
      { opportunities: 1100, signals: 3, evidence: 3 },
      {},
      // opp-01100 is the oldest, so it falls past the 1,000-row cap.
      { change_events: [ledgerRow({ id: 'c1', object_id: 'opp-01100', occurred_at: '2026-10-16T10:00:00Z' })] },
    )
    expect(data.changesSinceLastVisit[0]?.subjectLabel).toBe('Opportunity (record not loaded)')
    expect(data.changesSinceLastVisit[0]?.opportunityId).toBeNull()
  })

  describe('stable ordering', () => {
    const rows = (n: number): Row[] =>
      Array.from({ length: n }, (_, i) =>
        ledgerRow({
          id: `chg-${pad(i + 1)}`,
          change_type: 'evidence_added',
          // Many rows share an instant, so only the id tail can order them.
          occurred_at: new Date(NOW.getTime() - Math.floor(i / 4) * 60_000).toISOString(),
        }),
      )

    it('lists the same rows in the same order on every read, whatever order the database returns', async () => {
      const { source } = connect({ opportunities: 3 }, {}, { change_events: rows(60) })
      const first = await source.getPulse()
      const reads = await Promise.all([source.getPulse(), source.getPulse(), source.getPulse()])
      const ids = (s: SurfaceState<PulseSnapshot>) =>
        s.kind === 'ready' ? s.data.changesSinceLastVisit.map((c) => c.id) : []
      for (const again of reads) expect(ids(again)).toEqual(ids(first))
      expect(ids(first)).toHaveLength(25)
      expect(ids(first)[0]).toBe('chg-00001')
    })

    it('keeps exactly the 25 newest when 60 are recorded, and says the feed is bounded', async () => {
      const data = await pulse({ opportunities: 3 }, {}, { change_events: rows(60) })
      expect(data.changesSinceLastVisit).toHaveLength(25)
      expect(data.changeFeed).toMatchObject({ bounded: true, limit: 25, empty: false })
    })

    it('bounds the union of both ledgers to 25, newest first, from both', async () => {
      const data = await pulse({ opportunities: 3, changeEvents: 20, healthEvents: 20 })
      expect(data.changesSinceLastVisit).toHaveLength(25)
      const times = data.changesSinceLastVisit.map((c) => Date.parse(c.occurredAt))
      expect([...times].sort((a, b) => b - a)).toEqual(times)
      expect(new Set(data.changesSinceLastVisit.map((c) => c.channel))).toEqual(new Set(['market', 'system']))
      expect(data.changeFeed?.bounded).toBe(true)
    })
  })
})

/* ------------------------------------------- empty, inaccessible, and failed */

describe('an empty feed, an inaccessible one and a failed one are three different things', () => {
  async function state(options: FakeOptions, size: WorldSize = { opportunities: 2 }) {
    const { source } = connect(size, options)
    const result = await source.getPulse()
    if (result.kind !== 'ready') throw new Error(`expected ready, got ${result.kind}`)
    return result
  }
  const reportOf = (result: Awaited<ReturnType<typeof state>>, dataset: string) =>
    result.completeness?.datasets.find((d) => d.dataset === dataset)

  it('empty: both ledgers answered with nothing, so it says so and the page is complete', async () => {
    const result = await state({})
    expect(result.data.changesSinceLastVisit).toEqual([])
    expect(result.data.changeFeed).toEqual({ limit: 25, bounded: false, notListed: 0, empty: true })
    expect(result.completeness?.complete).toBe(true)
    expect(reportOf(result, 'change_events')).toMatchObject({ status: 'limited', returned: 0 })
  })

  it.each([
    ['change_events', '42501', 'permission denied for table change_events', 'not_permitted'],
    ['source_health_events', '42501', 'permission denied for table source_health_events', 'not_permitted'],
    ['change_events', '42P01', 'relation "change_events" does not exist', 'not_migrated'],
    ['change_events', '42703', 'column change_events.change_kind does not exist', 'not_migrated'],
    ['change_events', 'PGRST301', 'JWT expired', 'unauthorized'],
    ['source_health_events', 'XX000', 'internal error', 'error'],
  ])('%s refused with %s is a failed read (%s), reported with its reason and never called empty', async (table, code, message, reason) => {
    const result = await state({ errors: { [table]: { code, message } } })
    expect(reportOf(result, table)).toMatchObject({ status: 'failed', reason })
    expect(result.completeness?.complete).toBe(false)
    expect(result.data.changeFeed?.empty).toBe(false)
    // The rest of the page is exactly as it was.
    expect(reportOf(result, 'evidence')?.status).toBe('complete')
  })

  it('a request that rejects outright fails that ledger, not the page', async () => {
    const result = await state({ rejects: ['source_health_events'] }, { opportunities: 2, changeEvents: 2 })
    expect(reportOf(result, 'source_health_events')).toMatchObject({ status: 'failed', reason: 'error' })
    expect(result.data.changesSinceLastVisit.length).toBe(2)
    expect(result.data.changeFeed?.empty).toBe(false)
  })

  it('both ledgers failing is two failures and an empty list that does not claim to be empty', async () => {
    const result = await state({
      errors: {
        change_events: { code: '42501', message: 'permission denied' },
        source_health_events: { code: '42501', message: 'permission denied' },
      },
    })
    expect(result.data.changesSinceLastVisit).toEqual([])
    expect(result.data.changeFeed?.empty).toBe(false)
    expect(result.completeness?.datasets.filter((d) => d.status === 'failed').map((d) => d.dataset)).toEqual([
      'change_events',
      'source_health_events',
    ])
  })

  it('one ledger empty and the other failed is not an empty feed either', async () => {
    const result = await state({ errors: { change_events: { code: '42501', message: 'permission denied' } } })
    expect(result.data.changeFeed?.empty).toBe(false)
  })

  it('the old read, which named columns that do not exist, would have failed here', async () => {
    const { fake } = connect({ opportunities: 2, changeEvents: 2 })
    const result = await (fake.client.from('change_events') as {
      select: (c: string) => PromiseLike<{ error: { code?: string } | null }>
    }).select('id, change_kind, summary, occurred_at')
    expect(result.error?.code).toBe('42703')
  })
})

/* --------------------------------------------------------- earlier guarantees */

describe('what the earlier safeguards promised still holds', () => {
  it('reports both ledgers as limited, which is not a fault and raises no notice', async () => {
    const { source } = connect({ opportunities: 2, changeEvents: 40, healthEvents: 40 })
    const result = await source.getPulse()
    expect(result.completeness?.complete).toBe(true)
    expect(result.completeness?.datasets.filter((d) => d.status === 'limited').map((d) => d.dataset)).toEqual([
      'change_events',
      'source_health_events',
    ])
  })

  it('makes one more bounded request than before, and no unbounded one', async () => {
    const { source, fake } = connect({ opportunities: 2 })
    await source.getPulse()
    // Freshness + the eight graph reads + two ledgers.
    expect(fake.calls).toHaveLength(11)
    for (const call of fake.calls.filter((c) => c.table === 'change_events' || c.table === 'source_health_events')) {
      expect(call.limit).toBe(25)
    }
  })
})
