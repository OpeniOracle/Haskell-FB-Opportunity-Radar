import { describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderApp } from '@/test/render'
import { createFixtureDataSource, parseScenario } from '@/data/fixtureDataSource'

/**
 * Every state must answer four questions: what happened, does the user need to
 * act, what happens next, and when this was last checked. The technical cause is
 * available but is never the headline.
 */
describe('scenario plumbing', () => {
  it('parses the scenario from the query string and falls back safely', () => {
    expect(parseScenario('?state=degraded')).toBe('degraded')
    expect(parseScenario('?state=nonsense')).toBe('ready')
    expect(parseScenario('')).toBe('ready')
  })

  it('reports a last-checked time on every state, including the failures', async () => {
    const source = createFixtureDataSource('unavailable')
    const state = await source.getPulse()
    expect(state.kind).toBe('unavailable')
    expect(state.checkedAt).toBeTruthy()
  })

  it('never reports a real data source in this milestone', () => {
    const source = createFixtureDataSource()
    expect(source.meta.mode).toBe('fixture')
    expect(source.meta.illustrative).toBe(true)
  })
})

describe('empty state', () => {
  it.each([
    ['/', 'You’re caught up'],
    ['/opportunities', 'No opportunities to review'],
  ])('is concise and user-oriented at %s', async (path, heading) => {
    renderApp(`${path}?state=empty`)
    expect(await screen.findByRole('heading', { level: 2, name: heading })).toBeInTheDocument()
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0)
    // What happens next, and when it was last checked.
    expect(screen.getByText(/automatically|as evidence is collected/)).toBeInTheDocument()
    expect(screen.getByText(/Last checked/)).toBeInTheDocument()
  })
})

describe('unavailable state', () => {
  it.each([
    ['/', 'Today’s changes aren’t ready yet'],
    ['/opportunities', 'Opportunities aren’t ranked yet'],
  ])('leads with plain language at %s', async (path, heading) => {
    renderApp(`${path}?state=unavailable`)
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByRole('heading', { level: 2, name: heading })).toBeInTheDocument()
    expect(within(alert).getByText(/Nothing is required from you/)).toBeInTheDocument()
    expect(within(alert).getByText(/Last checked/)).toBeInTheDocument()
  })

  it('keeps the technical cause behind a disclosure', async () => {
    const user = userEvent.setup()
    renderApp('/opportunities?state=unavailable')
    const alert = await screen.findByRole('alert')

    const summary = within(alert).getByText('Technical detail')
    const details = summary.closest('details') as HTMLDetailsElement
    expect(details.open).toBe(false)

    await user.click(summary)
    expect(within(alert).getByText('Scoring run pending')).toBeInTheDocument()
  })

  it('never puts a taxonomy version or scoring internal in the headline', async () => {
    renderApp('/opportunities?state=unavailable')
    const heading = await screen.findByRole('heading', { level: 2 })
    expect(heading.textContent).not.toMatch(/taxonomy|connector|scoring run/i)
  })
})

describe('degraded and stale', () => {
  it('keeps content visible in the degraded state and names what is affected', async () => {
    const user = userEvent.setup()
    renderApp('/opportunities?state=degraded')
    expect(await screen.findByText(/Partial coverage/)).toBeInTheDocument()
    expect(screen.getAllByRole('article').length).toBeGreaterThan(0)

    const affected = screen.getByText('What is affected')
    const details = affected.closest('details') as HTMLDetailsElement
    expect(details.open).toBe(false)
    await user.click(affected)
    expect(within(details).getByText(/Example Snack Foods/)).toBeInTheDocument()
  })

  it('keeps content visible in the stale state and states the as-of time', async () => {
    renderApp('/opportunities?state=stale')
    expect(await screen.findByText(/Showing data from/)).toBeInTheDocument()
    expect(screen.getAllByRole('article').length).toBeGreaterThan(0)
    expect(screen.getByText(/Last checked/)).toBeInTheDocument()
  })
})

/**
 * All five states on all seven surfaces.
 *
 * PR 1 covered Daily Pulse and Opportunities. The five surfaces added in this
 * milestone have to reach the same bar, so the matrix below drives every route
 * through every scenario rather than sampling.
 */
const ALL_ROUTES = [
  '/',
  '/opportunities',
  '/opportunities/opp-fixture-1',
  '/accounts',
  '/accounts/org-fixture-1',
  '/facilities/fac-fixture-1',
  '/evidence/ev-fixture-1',
  '/admin/health',
  '/views',
]

describe('every state on every surface', () => {
  it.each(ALL_ROUTES)('announces the loading state at %s', async (route) => {
    renderApp(`${route}?state=loading`)
    const busy = await screen.findByRole('status', { busy: true })
    expect(busy).toHaveAttribute('aria-live', 'polite')
    expect(within(busy).getByText(/Loading/)).toBeInTheDocument()
  })

  it.each(ALL_ROUTES)('shows a recoverable empty state at %s', async (route) => {
    renderApp(`${route}?state=empty`)
    const heading = await screen.findByRole('heading', { level: 2 })
    expect(heading.textContent?.length ?? 0).toBeGreaterThan(0)
    // What happens next, and when it was last checked — on every surface.
    expect(screen.getAllByText(/Last checked/).length).toBeGreaterThan(0)
  })

  it.each(ALL_ROUTES)('explains the unavailable state in plain language at %s', async (route) => {
    renderApp(`${route}?state=unavailable`)
    const heading = await screen.findByRole('heading', { level: 2 })
    expect(heading.textContent).not.toMatch(/taxonomy|null|undefined|error 5\d\d/i)
    // The technical cause exists but stays behind a disclosure.
    expect(screen.getByText('Technical detail')).toBeInTheDocument()
    const details = screen.getByText('Technical detail').closest('details') as HTMLDetailsElement
    expect(details.open).toBe(false)
  })

  it.each(ALL_ROUTES)('keeps content readable in the degraded state at %s', async (route) => {
    renderApp(`${route}?state=degraded`)
    expect(await screen.findByText(/Partial coverage/)).toBeInTheDocument()
    // Degraded sits ABOVE content that is still worth reading.
    expect(screen.getByRole('main').textContent?.length ?? 0).toBeGreaterThan(200)
  })

  it.each(ALL_ROUTES)('states the as-of time in the stale state at %s', async (route) => {
    renderApp(`${route}?state=stale`)
    expect(await screen.findByText(/Showing data from/)).toBeInTheDocument()
    expect(screen.getAllByText(/Last checked/).length).toBeGreaterThan(0)
  })
})

/**
 * An address that names a record that does not exist is a state, not a crash and
 * not a redirect. It must never fall through to a neighbouring record.
 */
describe('unknown record identifiers', () => {
  it.each([
    ['/accounts/nope', /No company matches that address/],
    ['/facilities/nope', /No facility matches that address/],
    ['/evidence/nope', /No evidence record matches that address/],
  ])('reports %s as unavailable', async (route, message) => {
    renderApp(route)
    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(screen.getByText(/Unknown identifier: nope/)).toBeInTheDocument()
  })
})
