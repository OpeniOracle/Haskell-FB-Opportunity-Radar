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
  it('declares exactly the seven Phase 1 surfaces, by name', () => {
    expect(SURFACES.map((s) => s.label)).toEqual([
      'Daily Pulse',
      'Opportunities',
      'Company',
      'Facility',
      'Evidence detail',
      'Source Health & Coverage',
      'Saved Pursuits & Watches',
    ])
  })

  it('splits them five primary and two contextual', () => {
    expect(PRIMARY_SURFACES.map((s) => s.label)).toEqual([
      'Daily Pulse',
      'Opportunities',
      'Company',
      'Source Health & Coverage',
      'Saved Pursuits & Watches',
    ])
    expect(CONTEXTUAL_SURFACES.map((s) => s.label)).toEqual(['Facility', 'Evidence detail'])
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
      'Saved Pursuits & Watches': ['/views'],
    })
  })

  it('does not count a detail route as a separate surface', () => {
    // The regression: /opportunities/:id and /accounts/:id were counted as two of
    // the seven, displacing Facility and Evidence detail.
    const detailRoutes = SURFACES.flatMap((s) => s.routes).filter((r) => r.includes(':'))
    expect(detailRoutes).toContain('/opportunities/:opportunityId')
    expect(detailRoutes).toContain('/accounts/:accountId')
    expect(SURFACES).toHaveLength(7)
  })

  it('keeps Market Trends, Map and Briefings out of the surface list', () => {
    const labels = SURFACES.map((s) => s.label)
    for (const reserved of ['Market Trends', 'Map', 'Briefings']) {
      expect(labels).not.toContain(reserved)
    }
    expect(RESERVED_DESTINATIONS.map((d) => d.label)).toEqual([
      'Market Trends',
      'Map',
      'Briefings',
    ])
  })

  it('marks exactly the surfaces PR 1 built as implemented', () => {
    expect(SURFACES.filter((s) => s.status === 'implemented').map((s) => s.label)).toEqual([
      'Daily Pulse',
      'Opportunities',
    ])
    expect(SURFACES.filter((s) => s.status === 'pr2').map((s) => s.label)).toEqual([
      'Company',
      'Facility',
      'Evidence detail',
      'Source Health & Coverage',
      'Saved Pursuits & Watches',
    ])
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
    ['/accounts/acc-1', 'Company'],
    ['/facilities/fac-1', 'Facility'],
    ['/evidence/ev-1', 'Evidence detail'],
    ['/admin/health', 'Source Health & Coverage'],
    ['/views', 'Saved Pursuits & Watches'],
  ])('renders the PR 2 placeholder at %s', async (path, label) => {
    renderApp(path)
    expect(await screen.findByRole('heading', { level: 1, name: label })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Arrives in roadmap PR 2' }))
      .toBeInTheDocument()
  })

  it.each(RESERVED_DESTINATIONS.map((d) => [d.path, d.label]))(
    'renders the reserved state at %s',
    async (path, label) => {
      renderApp(path)
      expect(await screen.findByRole('heading', { level: 1, name: label })).toBeInTheDocument()
      // Distinct wording from the PR 2 placeholder — different facts.
      expect(
        screen.getByRole('heading', { level: 2, name: 'Not part of Phase 1' }),
      ).toBeInTheDocument()
      expect(screen.queryByText('Arrives in roadmap PR 2')).toBeNull()
    },
  )

  it('does not offer a nav entry for a contextual surface', async () => {
    renderApp('/facilities/fac-1')
    await screen.findByRole('heading', { level: 1, name: 'Facility' })
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
