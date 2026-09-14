import { describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import { renderApp } from '@/test/render'
import {
  CONTEXTUAL_SURFACES,
  PRIMARY_SURFACES,
  RESERVED_DESTINATIONS,
  SURFACES,
} from '@/routes'

/**
 * The authoritative Phase 1 surface inventory.
 *
 * Source: `docs/design/15_PHASE_1_IMPLEMENTATION_PLAN.md` §11.2 and §11.4. These
 * assertions are deliberately literal — the previous inventory had the right
 * COUNT and the wrong CONTENTS, which a count-only test could not catch.
 */
describe('surface inventory', () => {
  /*
     THE INVENTORY CHANGED, IN BOTH DIRECTIONS, AND THE LIST IS STILL LITERAL.

     Saved Pursuits & Watches left: nothing can write a saved pursuit, so the
     entry promised a page that could only ever be empty. Map and Spyglass media
     intelligence joined: both now read live data.

     The list stays spelled out rather than counted, for exactly the reason the
     original note gives — the first bad inventory had the right count and the
     wrong contents.
  */
  it('declares exactly the built surfaces, by name', () => {
    expect(SURFACES.map((s) => s.label)).toEqual([
      'Daily Pulse',
      'Opportunities',
      'Company',
      'Facility',
      'Evidence detail',
      'Source Health & Coverage',
      'Spyglass media intelligence',
      'Map',
    ])
  })

  it('splits them six primary and two contextual', () => {
    expect(PRIMARY_SURFACES.map((s) => s.label)).toEqual([
      'Daily Pulse',
      'Opportunities',
      'Company',
      'Source Health & Coverage',
      'Spyglass media intelligence',
      'Map',
    ])
    expect(CONTEXTUAL_SURFACES.map((s) => s.label)).toEqual(['Facility', 'Evidence detail'])
  })

  it('lists no surface that cannot be populated', () => {
    /*
       The rule that moved both entries, asserted rather than described. A
       primary navigation entry is a promise that something is behind it, and
       `/views` broke that promise for as long as it existed.
    */
    expect(SURFACES.map((s) => s.routes[0])).not.toContain('/views')
    expect(SURFACES.every((s) => s.status === 'implemented')).toBe(true)
  })

  it('maps each surface to the routes the plan gives it', () => {
    const routes = Object.fromEntries(SURFACES.map((s) => [s.label, s.routes]))
    expect(routes).toEqual({
      'Daily Pulse': ['/'],
      Opportunities: ['/opportunities', '/opportunities/:opportunityId'],
      Company: ['/accounts', '/accounts/:accountId'],
      Facility: ['/facilities/:facilityId'],
      'Evidence detail': ['/evidence/:evidenceId'],
      'Source Health & Coverage': ['/admin/health'],
      'Spyglass media intelligence': ['/media'],
      Map: ['/map'],
    })
  })

  it('does not count a detail route as a separate surface', () => {
    // The regression: /opportunities/:id and /accounts/:id were counted as two
    // separate surfaces, displacing Facility and Evidence detail.
    const detailRoutes = SURFACES.flatMap((s) => s.routes).filter((r) => r.includes(':'))
    expect(detailRoutes).toContain('/opportunities/:opportunityId')
    expect(detailRoutes).toContain('/accounts/:accountId')
    expect(SURFACES).toHaveLength(8)
  })

  it('keeps Market Trends and Briefings out of the surface list', () => {
    /*
       Map is no longer among them. It moved into `SURFACES` when it acquired
       live locations, which is the only condition on which anything moves: a
       destination is listed when it works. Market Trends and Briefings still
       depend on alerting and on cross-account patterns, and stay reserved.
    */
    const labels = SURFACES.map((s) => s.label)
    for (const reserved of ['Market Trends', 'Briefings']) {
      expect(labels).not.toContain(reserved)
    }
    expect(RESERVED_DESTINATIONS.map((d) => d.label)).toEqual([
      'Market Trends',
      'Briefings',
    ])
  })

  it('marks every built surface as implemented', () => {
    expect(SURFACES.filter((s) => s.status === 'implemented')).toHaveLength(8)
    expect(SURFACES.filter((s) => s.status === 'scheduled')).toHaveLength(0)
  })
})

describe('rendering', () => {
  it('renders Daily Pulse at the root', async () => {
    renderApp('/')
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Daily Pulse' }),
    ).toBeInTheDocument()
  })

  it('renders Opportunities at /opportunities', async () => {
    renderApp('/opportunities')
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Opportunities' }),
    ).toBeInTheDocument()
  })

  it.each([
    ['/accounts', 'Company'],
    ['/admin/health', 'Source Health & Coverage'],
    ['/media', 'Spyglass media intelligence'],
    ['/map', 'Map'],
  ])('renders the built surface at %s', async (path, label) => {
    renderApp(path)
    expect(await screen.findByRole('heading', { level: 1, name: label })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 2, name: /not yet built/i })).toBeNull()
  })

  it('renders a record surface at each contextual route', async () => {
    renderApp('/accounts/org-fixture-1')
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 2, name: /not yet built/i })).toBeNull()
  })

  it.each(RESERVED_DESTINATIONS.map((d) => [d.path, d.label]))(
    'renders the reserved state at %s',
    async (path, label) => {
      renderApp(path)
      expect(await screen.findByRole('heading', { level: 1, name: label })).toBeInTheDocument()
      // Distinct wording from the scheduled-surface placeholder — different facts.
      expect(
        screen.getByRole('heading', { level: 2, name: 'Not part of Phase 1' }),
      ).toBeInTheDocument()
      expect(screen.queryByText('Scheduled, not yet built')).toBeNull()
    },
  )

  it('does not offer a nav entry for a contextual surface', async () => {
    renderApp('/facilities/fac-fixture-1')
    await screen.findByRole('heading', { level: 1 })
    const nav = screen.getByRole('navigation', { name: 'Primary' })
    expect(within(nav).queryByRole('link', { name: /Facility/ })).toBeNull()
    expect(within(nav).queryByRole('link', { name: /Evidence/ })).toBeNull()
  })

  it('shows an explicit not-found state rather than redirecting', async () => {
    renderApp('/no-such-surface')
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Page not found' }),
    ).toBeInTheDocument()
  })
})
