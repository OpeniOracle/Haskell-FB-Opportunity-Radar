import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import { fakeSupabase } from '@/test/readTruncation/fakeSupabase'
import type { FakeOptions, Row } from '@/test/readTruncation/fakeSupabase'
import { LEDGER_SCHEMA, NOW, buildWorld } from '@/test/readTruncation/world'
import type { WorldSize } from '@/test/readTruncation/world'
import { renderApp } from '@/test/render'
import { createApiDataSource } from '@/data/apiDataSource'

/**
 * WHAT A PERSON SEES IN THE DAILY PULSE CHANGE FEED.
 *
 * `changeFeed.test.ts` proves what the read model reports. This proves the page
 * says it: market changes where market changes belong and operational ones
 * underneath, an empty feed called empty and a failed one called failed, and no
 * sentence that a row did not write.
 */

const holder = vi.hoisted(() => ({ client: null as unknown }))
vi.mock('@/lib/supabaseClient', () => ({ supabaseBrowser: () => holder.client }))

beforeEach(() => {
  holder.client = null
})

function dataSource(size: WorldSize = {}, options: FakeOptions = {}, override: Record<string, Row[]> = {}) {
  holder.client = fakeSupabase({ ...buildWorld(size), ...override }, { schema: LEDGER_SCHEMA, ...options }).client
  return createApiDataSource(() => NOW)
}

const ledger = (over: Row): Row => ({
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

const sourceEvent = (over: Row): Row => ({
  source_id: 'sec-edgar',
  source_run_id: null,
  prior_status: 'healthy',
  new_status: 'degraded',
  event_type: 'status_change',
  summary: 'Run stored 3 of 5 documents.',
  coverage_impact: {},
  action_required: null,
  resolved_at: null,
  ...over,
})

const WORLD: WorldSize = { organizations: 2, opportunities: 3, signals: 3, evidence: 3 }

async function open(size: WorldSize, options: FakeOptions, override: Record<string, Row[]>) {
  renderApp('/', { data: dataSource(size, options, override) })
  await screen.findByRole('heading', { level: 1, name: 'Daily Pulse' })
}

const main = () => document.querySelector('main') as HTMLElement
const section = (name: RegExp) => {
  // "Coverage and system notices" is a disclosure summary, not a heading.
  const title = /system notices/.test(name.source)
    ? screen.getByText(name)
    : screen.getByRole('heading', { name })
  return title.closest('section') as HTMLElement
}

describe('Daily Pulse change feed', () => {
  it('lists market changes by what they are, in the market section, with the transition they record', async () => {
    await open(WORLD, {}, {
      change_events: [
        ledger({
          id: 'c1',
          change_type: 'stage_promoted',
          from_state: { stage: 'emerging' },
          to_state: { stage: 'developing' },
          occurred_at: '2026-10-16T11:00:00Z',
        }),
        ledger({ id: 'c2', change_type: 'evidence_added', object_id: 'opp-00002', occurred_at: '2026-10-16T10:00:00Z' }),
        ledger({
          id: 'c3',
          change_type: 'status_changed',
          object_id: 'opp-00003',
          from_state: { status: 'new' },
          to_state: { status: 'watching' },
          occurred_at: '2026-10-16T09:00:00Z',
        }),
      ],
    })

    const market = section(/Other market changes/)
    expect(within(market).getByText('Stage promoted')).toBeInTheDocument()
    expect(within(market).getByText('Stage: Emerging → Developing.')).toBeInTheDocument()
    expect(within(market).getByText('New evidence')).toBeInTheDocument()
    expect(within(market).getByText('New evidence was recorded for this opportunity.')).toBeInTheDocument()
    expect(within(market).getByText('Status changed')).toBeInTheDocument()
    expect(within(market).getByText('Status: New → Watching.')).toBeInTheDocument()
    // Named from the records the page holds.
    expect(within(market).getByText(/Opportunity 00001 — Org 00001/)).toBeInTheDocument()
  })

  it('files connector events under system notices, never among market changes', async () => {
    await open(WORLD, {}, {
      source_health_events: [
        sourceEvent({ id: 'h1', new_status: 'source_unavailable', event_type: 'failure', summary: 'The filing index returned 503.', created_at: '2026-10-16T10:30:00Z' }),
        sourceEvent({ id: 'h2', prior_status: 'source_unavailable', new_status: 'healthy', summary: 'Run completed.', created_at: '2026-10-16T11:30:00Z' }),
      ],
    })

    const system = section(/Coverage and system notices/)
    expect(within(system).getByText('Source recovered')).toBeInTheDocument()
    expect(within(system).getByText('Source unavailable')).toBeInTheDocument()
    expect(within(system).getByText(/Status: Healthy → Unavailable\. The filing index returned 503\./)).toBeInTheDocument()
    expect(within(system).getByText(/Status: Unavailable → Healthy\. Run completed\./)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /Other market changes/ })).toBeNull()
  })

  it('shows what a collector flagged for a person, in the collector’s terms', async () => {
    await open(WORLD, {}, {
      source_health_events: [
        sourceEvent({
          id: 'h1',
          new_status: 'manual_review_required',
          summary: 'No compliant automated path.',
          action_required: { action: 'operator_import', detail: 'x' },
          created_at: '2026-10-16T10:30:00Z',
        }),
      ],
    })
    expect(within(section(/Coverage and system notices/)).getByText('An operator import is needed for this source.')).toBeInTheDocument()
  })

  it('does not raise "Needs attention today" from a ledger row: that is a judgement the ledger does not make', async () => {
    await open(WORLD, {}, {
      change_events: [
        ledger({ id: 'c1', change_type: 'negative_signal', object_type: 'signal', object_id: 'sig-00001', occurred_at: '2026-10-16T11:00:00Z' }),
        ledger({ id: 'c2', change_type: 'stage_promoted', to_state: { stage: 'confirmed' }, occurred_at: '2026-10-16T10:00:00Z' }),
      ],
    })
    expect(screen.queryByRole('heading', { name: /Needs attention today/ })).toBeNull()
    expect(screen.queryByRole('link', { name: /Review opportunity/ })).toBeNull()
    expect(within(section(/Other market changes/)).getByText('Negative signal')).toBeInTheDocument()
  })

  it('says nothing about commercial value anywhere in the feed', async () => {
    await open(WORLD, {}, {
      change_events: [
        ledger({
          id: 'c1',
          change_type: 'stage_promoted',
          from_state: { stage: 'emerging', summary: 'a high-priority win worth millions' },
          to_state: { stage: 'confirmed', note: 'likely to close' },
          occurred_at: '2026-10-16T11:00:00Z',
        }),
      ],
    })
    const text = section(/Other market changes/).textContent ?? ''
    expect(text).toMatch(/Stage: Emerging → Confirmed\./)
    expect(text).not.toMatch(/priority|worth|millions|likely|close|win/i)
  })

  it('names a record it cannot find as such, and offers no link to it', async () => {
    await open(WORLD, {}, {
      change_events: [ledger({ id: 'c1', object_id: 'opp-99999', occurred_at: '2026-10-16T11:00:00Z' })],
    })
    expect(within(section(/Other market changes/)).getByText(/Opportunity \(record not found\)/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Review opportunity/ })).toBeNull()
  })

  it('says how many recorded changes it could not describe, instead of listing them as something else', async () => {
    await open(WORLD, {}, {
      change_events: [
        ledger({ id: 'c1', change_type: 'evidence_added', occurred_at: '2026-10-16T11:00:00Z' }),
        ledger({ id: 'c2', change_type: 'renamed', object_type: 'organization', object_id: 'org-00001', occurred_at: '2026-10-16T10:00:00Z' }),
        ledger({ id: 'c3', change_type: 'repriced', occurred_at: '2026-10-16T09:00:00Z' }),
      ],
    })
    expect(screen.getByText(/2 recorded changes were not listed because this page cannot describe them yet\./)).toBeInTheDocument()
    expect(main().textContent).not.toMatch(/renamed|repriced/)
  })

  it('uses the singular for one', async () => {
    await open(WORLD, {}, { change_events: [ledger({ id: 'c1', change_type: 'renamed', occurred_at: '2026-10-16T11:00:00Z' })] })
    expect(screen.getByText(/1 recorded change was not listed because this page cannot describe it yet\./)).toBeInTheDocument()
  })

  it('says the feed is the latest 25 when more are recorded', async () => {
    await open({ ...WORLD, changeEvents: 40 }, {}, {})
    expect(main().textContent).toMatch(/latest 25 changes only/)
    expect(screen.queryByText(/Not every record could be loaded/)).toBeNull()
  })
})

describe('Daily Pulse change feed: empty, inaccessible and failed are told apart', () => {
  it('says "no changes have been recorded yet" when both ledgers answered and held nothing', async () => {
    await open(WORLD, {}, {})
    expect(screen.getByText('No changes have been recorded yet.')).toBeInTheDocument()
    expect(screen.queryByText(/Not every record could be loaded/)).toBeNull()
  })

  it('does not say it when a ledger is empty and the other has something to list', async () => {
    await open({ ...WORLD, healthEvents: 1 }, {}, {})
    expect(screen.queryByText('No changes have been recorded yet.')).toBeNull()
  })

  it.each([
    [
      'a missing privilege',
      { code: '42501', message: 'permission denied for table change_events' },
      'The market changes could not be read: a database permission is missing. Your access is unaffected; this is a deployment fault.',
    ],
    [
      'a table that is not there yet',
      { code: '42P01', message: 'relation "change_events" does not exist' },
      'The market changes are not available yet: a database migration is outstanding.',
    ],
    ['a failed request', { code: 'XX000', message: 'boom' }, 'The market changes could not be read.'],
  ])('reports %s as a failure with its own sentence, and never as an empty feed', async (_label, error, sentence) => {
    await open(WORLD, { errors: { change_events: error } }, {})
    await screen.findByText(/Not every record could be loaded/)
    expect(screen.getByText(sentence)).toBeInTheDocument()
    expect(screen.queryByText('No changes have been recorded yet.')).toBeNull()
    // The notice is a status, not an alarm.
    expect(screen.getByText(/Not every record could be loaded/).closest('.notice')).toHaveAttribute('role', 'status')
  })

  it('still renders the rest of the page, and the other ledger, when one fails', async () => {
    await open({ ...WORLD, healthEvents: 2 }, { errors: { change_events: { code: '42501', message: 'permission denied' } } }, {})
    expect(screen.getByRole('heading', { name: /Top opportunities/ })).toBeInTheDocument()
    expect(within(section(/Coverage and system notices/)).getAllByText('Source degraded').length).toBe(2)
  })
})
