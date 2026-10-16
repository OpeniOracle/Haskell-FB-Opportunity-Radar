import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { fakeSupabase } from '@/test/readTruncation/fakeSupabase'
import type { FakeOptions, Row } from '@/test/readTruncation/fakeSupabase'
import { NOW, buildWorld, pad } from '@/test/readTruncation/world'
import type { WorldSize } from '@/test/readTruncation/world'
import { renderApp } from '@/test/render'
import { createApiDataSource, READ_LIMIT } from '@/data/apiDataSource'
import { Count } from '@/components/Count'
import { IncompleteDataNotice } from '@/components/SurfaceStates'
import { describeIncompleteness, figureIsExact } from '@/lib/completeness'
import type { DatasetKey, DatasetReadReport, ReadCompleteness } from '@/types/domain'

/**
 * R2.5 -- WHAT A PERSON SEES WHEN A READ WAS CUT SHORT.
 *
 * `readTruncation.test.ts` proves what the read model REPORTS. This proves the
 * pages SAY it: that every affected surface shows the notice, that the figures it
 * can no longer vouch for are marked "at least", and that an absence is never
 * stated as fact when the record that would contradict it may simply not have
 * loaded. It runs the real data source against the PostgREST-shaped fake, so no
 * assertion here depends on a hand-built `completeness` object being faithful.
 *
 * The tone is part of the contract: the notice is informational (`role="status"`,
 * the `notice--info` treatment), never an alert, and it says the stored records
 * are unchanged.
 */

const holder = vi.hoisted(() => ({ client: null as unknown }))
vi.mock('@/lib/supabaseClient', () => ({ supabaseBrowser: () => holder.client }))

function dataSource(size: WorldSize = {}, options: FakeOptions = {}, override: Record<string, Row[]> = {}) {
  const fake = fakeSupabase({ ...buildWorld(size), ...override }, options)
  holder.client = fake.client
  return createApiDataSource(() => NOW)
}

/** The page's notice, if it has one. Informational by construction. */
const notice = () => screen.queryByText(/Not every record could be loaded/)?.closest('.notice') ?? null

beforeEach(() => {
  holder.client = null
})

/* ---------------------------------------------------------------------- the parts */

describe('the notice component', () => {
  const report = (
    dataset: DatasetKey,
    status: DatasetReadReport['status'],
    returned: number,
    total: number | null,
  ): DatasetReadReport => ({ dataset, label: dataset, status, returned, total, limit: READ_LIMIT })

  const truncated: ReadCompleteness = {
    complete: false,
    datasets: [
      { dataset: 'evidence', label: 'evidence records', status: 'truncated', returned: 1000, total: 1500, limit: READ_LIMIT },
    ],
  }

  it('renders nothing when there is nothing to say', () => {
    const { container, rerender } = render(<IncompleteDataNotice completeness={undefined} checkedAt="2026-10-16T12:00:00Z" />)
    expect(container).toBeEmptyDOMElement()
    rerender(
      <IncompleteDataNotice
        completeness={{ complete: true, datasets: [report('evidence', 'complete', 1000, 1000)] }}
        checkedAt="2026-10-16T12:00:00Z"
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('does not treat an intentionally limited read as a fault', () => {
    const { container } = render(
      <IncompleteDataNotice
        completeness={{ complete: true, datasets: [report('change_events', 'limited', 25, null)] }}
        checkedAt="2026-10-16T12:00:00Z"
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('says how many loaded of how many exist, in plain words, as a status rather than an alert', () => {
    render(<IncompleteDataNotice completeness={truncated} checkedAt="2026-10-16T12:00:00Z" />)
    const box = notice()!
    expect(box).not.toBeNull()
    expect(box).toHaveAttribute('role', 'status')
    expect(box).toHaveClass('notice--info')
    expect(box).not.toHaveClass('notice--error')
    expect(within(box as HTMLElement).queryByRole('alert')).toBeNull()
    expect(screen.getByText('Showing 1,000 of 1,500 evidence records.')).toBeInTheDocument()
    expect(screen.getByText(/The stored records are unchanged/)).toBeInTheDocument()
  })

  it('names an indeterminate read for what it is: unconfirmed, not missing', () => {
    render(
      <IncompleteDataNotice
        completeness={{ complete: false, datasets: [report('signals', 'indeterminate', 600, null)] }}
        checkedAt="2026-10-16T12:00:00Z"
      />,
    )
    expect(screen.getByText('Could not confirm that all signals were loaded (600 came back).')).toBeInTheDocument()
  })

  it('names a failed read', () => {
    render(
      <IncompleteDataNotice
        completeness={{ complete: false, datasets: [report('change_events', 'failed', 0, null)] }}
        checkedAt="2026-10-16T12:00:00Z"
      />,
    )
    expect(screen.getByText('The change_events could not be read.')).toBeInTheDocument()
  })

  it('describes only what is short, and keeps the relationship warning for the relationship tables', () => {
    const evidenceOnly = describeIncompleteness(truncated)
    expect(evidenceOnly.shortfalls).toEqual(['Showing 1,000 of 1,500 evidence records.'])
    expect(evidenceOnly.consequences.join(' ')).toMatch(/Links between opportunities, signals and documents are incomplete/)

    const sourcesOnly = describeIncompleteness({
      complete: false,
      datasets: [report('sources', 'truncated', 1000, 1200)],
    })
    expect(sourcesOnly.consequences.join(' ')).not.toMatch(/Links between opportunities/)
    expect(sourcesOnly.consequences.join(' ')).toMatch(/Source health covers only the sources that loaded/)
  })

  it('describes nothing for a whole read', () => {
    expect(describeIncompleteness({ complete: true, datasets: [report('evidence', 'complete', 3, 3)] })).toEqual({
      shortfalls: [],
      consequences: [],
    })
  })
})

describe('Count', () => {
  it('prints an exact figure plainly', () => {
    render(<Count value={1234} exact />)
    expect(screen.getByText('1,234')).toBeInTheDocument()
    expect(screen.queryByText(/or more/)).toBeNull()
  })

  it('marks a floor as "at least", visibly and for a screen reader', () => {
    const { container } = render(<Count value={1000} exact={false} />)
    expect(container.textContent).toContain('1,000+')
    expect(container.textContent).toContain('or more')
    expect(container.querySelector('[title]')?.getAttribute('title')).toMatch(/At least 1,000/)
  })

  it('is exact by default only when told so', () => {
    expect(figureIsExact(undefined, 'evidence')).toBe(true)
    expect(figureIsExact({ complete: true, datasets: [] }, 'evidence')).toBe(false)
  })
})

/* ----------------------------------------------------------------- Daily Pulse */

describe('Daily Pulse', () => {
  it('says 1,000 of 1,500 evidence records, and does not present 1,000 as the total', async () => {
    renderApp('/', { data: dataSource({ evidence: 1500, signals: 40, opportunities: 20, linksPerOpportunity: 2 }) })
    await screen.findByRole('heading', { level: 1, name: 'Daily Pulse' })
    await screen.findByText(/Not every record could be loaded/)

    expect(notice()).toHaveAttribute('role', 'status')
    expect(screen.getByText('Showing 1,000 of 1,500 evidence records.')).toBeInTheDocument()
    // The headline uses the database's own total, so it is exact and says 1,500...
    expect(screen.getByText('Evidence')).toBeInTheDocument()
    expect(document.querySelector('main')?.textContent).toMatch(/Evidence1,500/)
    expect(document.querySelector('main')?.textContent).not.toMatch(/Evidence1,000/)
    // ...while a per-opportunity document count passes through the cut tables, so
    // it is a floor and says so, for the eye and for a screen reader.
    expect(document.querySelector('main')?.textContent).toMatch(/2\+ or more documents/)
  })

  it('shows no notice when every read was whole', async () => {
    renderApp('/', { data: dataSource({ evidence: 999, signals: 40, opportunities: 20 }) })
    await screen.findByRole('heading', { level: 1, name: 'Daily Pulse' })
    expect(notice()).toBeNull()
    expect(document.body.textContent).not.toMatch(/\d\+\s*or more/)
  })

  it('shows no notice at exactly 1,000 rows when the database confirms that is all of them', async () => {
    renderApp('/', { data: dataSource({ evidence: 1000, signals: 40, opportunities: 20 }) })
    await screen.findByRole('heading', { level: 1, name: 'Daily Pulse' })
    expect(notice()).toBeNull()
  })

  it('warns when exactly 1,000 rows arrive with no total to confirm them', async () => {
    renderApp('/', {
      data: dataSource({ evidence: 1000, signals: 40, opportunities: 20 }, { countMode: { evidence: 'null' } }),
    })
    await screen.findByRole('heading', { level: 1, name: 'Daily Pulse' })
    await screen.findByText(/Not every record could be loaded/)
    expect(screen.getByText(/Could not confirm that all evidence records were loaded \(1,000 came back\)/)).toBeInTheDocument()
  })

  it('warns when counts are unavailable, and does not call the data wrong', async () => {
    renderApp('/', {
      data: dataSource({ evidence: 30, signals: 10, opportunities: 5 }, { countMode: { opportunities: 'omit' } }),
    })
    await screen.findByRole('heading', { level: 1, name: 'Daily Pulse' })
    await screen.findByText(/Not every record could be loaded/)
    expect(screen.getByText(/Could not confirm that all opportunities were loaded/)).toBeInTheDocument()
  })

  it('says recent changes could not be read when that read fails, and still renders the page', async () => {
    renderApp('/', {
      data: dataSource({ evidence: 30, signals: 10, opportunities: 5 }, { errors: { change_events: { code: '42703', message: 'column does not exist' } } }),
    })
    await screen.findByRole('heading', { level: 1, name: 'Daily Pulse' })
    await screen.findByText(/Not every record could be loaded/)
    expect(screen.getByText(/recent changes could not be read/i)).toBeInTheDocument()
    expect(screen.getByText(/The recent-changes list could not be loaded/)).toBeInTheDocument()
  })

  it('is open about the change feed being the latest 25 on purpose, without calling it a fault', async () => {
    renderApp('/', { data: dataSource({ evidence: 30, signals: 10, opportunities: 5, changeEvents: 40 }, {}, {}) })
    await screen.findByRole('heading', { level: 1, name: 'Daily Pulse' })
    // A bounded feed is intentional: no incompleteness notice for it, but the
    // feed says plainly that it is the latest 25 and not everything.
    expect(notice()).toBeNull()
    expect(document.querySelector('main')?.textContent).toMatch(/latest 25 changes/i)
  })
})

/* ---------------------------------------------------------------- Opportunities */

describe('Opportunities', () => {
  it('warns on the list and marks document counts as a floor', async () => {
    renderApp('/opportunities', {
      data: dataSource({ evidence: 1500, signals: 40, opportunities: 12, linksPerOpportunity: 2 }),
    })
    await screen.findByRole('heading', { level: 1, name: 'Opportunities' })
    await screen.findByText(/Not every record could be loaded/)
    expect(screen.getByText('Showing 1,000 of 1,500 evidence records.')).toBeInTheDocument()
    expect(document.body.textContent).toMatch(/\d+\+\s*(?:or more)?/)
  })

  it('has no notice and no floors when everything loaded', async () => {
    renderApp('/opportunities', { data: dataSource({ evidence: 30, signals: 10, opportunities: 5 }) })
    await screen.findByRole('heading', { level: 1, name: 'Opportunities' })
    await screen.findAllByText(/Opportunity 0000/)
    expect(notice()).toBeNull()
  })

  it('does not call an opportunity that did not load "no such opportunity"', async () => {
    // 1,100 opportunities: the newest 1,000 load. opp-01100 is the oldest, so it falls past the cap.
    renderApp('/opportunities/opp-01100', {
      data: dataSource({ opportunities: 1100, signals: 5, evidence: 5, linksPerOpportunity: 1 }),
    })
    await screen.findByText(/Not every record could be loaded/)
    expect(screen.getByText(/This opportunity did not load/)).toBeInTheDocument()
    expect(screen.queryByText(/No such opportunity/)).toBeNull()
  })

  it('still says "no such opportunity" when the list was whole', async () => {
    renderApp('/opportunities/opp-99999', { data: dataSource({ opportunities: 5, signals: 5, evidence: 5 }) })
    await screen.findByText(/No such opportunity/)
    expect(notice()).toBeNull()
  })
})

/* ---------------------------------------------------------------------- Company */

describe('Company', () => {
  it('warns on the list, floors the counts, and hedges every absence', async () => {
    renderApp('/accounts', {
      data: dataSource({ organizations: 4, opportunities: 12, signals: 1100, evidence: 30, expectations: 4 }),
    })
    await screen.findByRole('heading', { level: 1, name: 'Company' })
    await screen.findByText(/Not every record could be loaded/)
    expect(screen.getByText('Showing 1,000 of 1,100 signals.')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/has not produced a signal/)
  })

  it('has no notice when the read was whole', async () => {
    renderApp('/accounts', { data: dataSource({ organizations: 4, opportunities: 8, signals: 8, evidence: 8 }) })
    await screen.findByRole('heading', { level: 1, name: 'Company' })
    await screen.findAllByText(/Org 0000/)
    expect(notice()).toBeNull()
  })

  it('warns on the detail page, and does not say an account has no opportunities', async () => {
    // Accounts 1-3 each have an opportunity; 1,100 opportunities truncates `opportunities`.
    renderApp('/accounts/org-00002', {
      data: dataSource({ organizations: 3, opportunities: 1100, signals: 10, evidence: 10 }),
    })
    await screen.findByText(/Not every record could be loaded/)
    expect(screen.getByText('Showing 1,000 of 1,100 opportunities.')).toBeInTheDocument()
  })

  it('does not call an account that did not load "no such company"', async () => {
    // org-01100 sorts last, so it falls past the cap on a 1,100-account list.
    renderApp('/accounts/org-01100', {
      data: dataSource({ organizations: 1100, opportunities: 5, signals: 5, evidence: 5 }),
    })
    await screen.findByText(/That company is not among the accounts that loaded/)
    expect(screen.getByText(/the account list is incomplete, so it may still exist/)).toBeInTheDocument()
    expect(screen.queryByText(/No such (company|account)/i)).toBeNull()
  })

  it('still says the company is not found when the account list was whole', async () => {
    renderApp('/accounts/org-99999', { data: dataSource({ organizations: 4, opportunities: 5, signals: 5, evidence: 5 }) })
    await screen.findByText(/This company isn’t available/)
    expect(screen.queryByText(/may still exist/)).toBeNull()
  })
})

/* ------------------------------------------------------------------------- Map */

describe('Map', () => {
  it('warns when project locations were cut short, and hedges "unlocated"', async () => {
    const world = buildWorld({ opportunities: 20, signals: 20, evidence: 20 })
    world.opportunity_locations = Array.from({ length: READ_LIMIT + 200 }, (_, i) => ({
      id: `ploc-${pad(i + 1)}`,
      opportunity_id: `opp-${pad((i % 20) + 1)}`,
      evidence_id: null,
      location_type: 'approximate_project_area',
      extracted_text: `Place ${pad(i + 1)}`,
      facility_name: null,
      normalized_address: null,
      latitude: 41 + (i % 10) / 10,
      longitude: -81 - (i % 10) / 10,
      precision: 'locality',
      uncertainty_radius_m: 8000,
      resolved_at: '2026-10-16T11:00:00.000Z',
    }))
    holder.client = fakeSupabase(world).client
    renderApp('/map', { data: createApiDataSource(() => NOW) })
    await screen.findByRole('heading', { level: 1, name: 'Map' })
    await screen.findByText(/Not every record could be loaded/)
    expect(screen.getByText(`Showing ${READ_LIMIT.toLocaleString('en-US')} of ${(READ_LIMIT + 200).toLocaleString('en-US')} project locations.`)).toBeInTheDocument()
    expect(screen.getByText(/Some projects may be missing from the map/)).toBeInTheDocument()
  })

  it('has no notice when the locations were whole', async () => {
    renderApp('/map', { data: dataSource({ opportunities: 5, signals: 5, evidence: 5, opportunityLocations: 5 }) })
    await screen.findByRole('heading', { level: 1, name: 'Map' })
    expect(notice()).toBeNull()
  })
})

/* ----------------------------------------------------------------- Source Health */

describe('Source Health', () => {
  it('warns, floors connector activity, and says coverage may be overstated', async () => {
    // 600 signals x 2 documents = 1,200 links; the links of signals 501-600 are
    // past the cap. org-00004 owns exactly those signals, so on what loaded it
    // looks unobserved even though it has signals.
    const world = buildWorld({ organizations: 4, opportunities: 3, signals: 600, evidence: 600, evidencePerSignal: 2 })
    world.signals = (world.signals ?? []).map((s, i) => ({
      ...s,
      organization_id: i >= 500 ? 'org-00004' : `org-${pad((i % 3) + 1)}`,
    }))
    world.account_source_expectations = [
      { organization_id: 'org-00004', source_family: 'sec-edgar', expectation: 'required', rationale: 'synthetic' },
    ]
    holder.client = fakeSupabase(world).client
    renderApp('/admin/health', { data: createApiDataSource(() => NOW) })
    await screen.findByRole('heading', { level: 1, name: 'Source Health & Coverage' })
    await screen.findByText(/Not every record could be loaded/)

    expect(screen.getByText('Showing 1,000 of 1,200 signal–evidence links.')).toBeInTheDocument()
    const main = document.querySelector('main')!.textContent!
    // The headline does not assert a coverage gap as established.
    expect(main).toMatch(/shown as still below expected coverage/)
    expect(main).toMatch(/this may be overstated/)
    // The account's own gap is worded as "not seen among what loaded", not as fact.
    expect(main).toMatch(/was not seen for this account among the records that loaded/)
    expect(main).not.toMatch(/has not produced a signal for this account/)
    // Connector figures that pass through the cut links are floors.
    expect(main).toMatch(/\d+\+ or more/)
  })

  it('states a coverage gap plainly when every input to it was whole', async () => {
    const world = buildWorld({ organizations: 2, opportunities: 3, signals: 3, evidence: 3 })
    world.account_source_expectations = [
      { organization_id: 'org-00002', source_family: 'a-source-nobody-observed', expectation: 'required', rationale: 'synthetic' },
    ]
    holder.client = fakeSupabase(world).client
    renderApp('/admin/health', { data: createApiDataSource(() => NOW) })
    await screen.findByRole('heading', { level: 1, name: 'Source Health & Coverage' })
    const main = document.querySelector('main')!.textContent!
    expect(notice()).toBeNull()
    expect(main).toMatch(/has not produced a signal for this account|1 company is still below expected coverage/)
    expect(main).not.toMatch(/may be overstated/)
    expect(main).not.toMatch(/shown as still below/)
  })

  it('says collection runs were cut short, not that fewer ran', async () => {
    renderApp('/admin/health', { data: dataSource({ runs: READ_LIMIT + 50, opportunities: 3, signals: 3, evidence: 3 }) })
    await screen.findByRole('heading', { level: 1, name: 'Source Health & Coverage' })
    await screen.findByText(/Not every record could be loaded/)
    expect(screen.getByText(/Showing 1,000 of 1,050 collection runs\./)).toBeInTheDocument()
    expect(screen.getByText(/Run totals cover the loaded runs only/)).toBeInTheDocument()
  })

  it('has no notice when everything loaded', async () => {
    renderApp('/admin/health', { data: dataSource({ opportunities: 3, signals: 3, evidence: 3 }) })
    await screen.findByRole('heading', { level: 1, name: 'Source Health & Coverage' })
    expect(notice()).toBeNull()
    expect(document.body.textContent).not.toMatch(/may be overstated/)
  })
})

/* ---------------------------------------------------- the notice is on every surface */

describe('every affected surface carries the notice when an input was cut short', () => {
  const surfaces: Array<[string, string, string, WorldSize]> = [
    ['Daily Pulse', '/', 'Daily Pulse', { evidence: 1500, signals: 20, opportunities: 10 }],
    ['Opportunities', '/opportunities', 'Opportunities', { evidence: 1500, signals: 20, opportunities: 10 }],
    ['Company', '/accounts', 'Company', { evidence: 1500, signals: 20, opportunities: 10 }],
    ['Map', '/map', 'Map', { evidence: 1500, signals: 20, opportunities: 10 }],
    ['Source Health', '/admin/health', 'Source Health & Coverage', { evidence: 1500, signals: 20, opportunities: 10 }],
  ]

  it.each(surfaces)('%s', async (_name, url, heading, size) => {
    cleanup()
    renderApp(url, { data: dataSource(size) })
    await screen.findByRole('heading', { level: 1, name: heading })
    await screen.findByText(/Not every record could be loaded/)
    expect(notice()).toHaveAttribute('role', 'status')
    expect(screen.getByText('Showing 1,000 of 1,500 evidence records.')).toBeInTheDocument()
  })
})
