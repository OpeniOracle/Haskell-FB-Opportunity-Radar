import { describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderApp } from '@/test/render'

/**
 * Facility — `/facilities/:facilityId`, a contextual surface.
 *
 * Two distinctions carry the page: candidate versus confirmed resolution, and
 * company-level versus site-level events. Both are about not asserting more than
 * the evidence supports.
 */
describe('facility detail', () => {
  it('is reached from the company rather than from navigation', async () => {
    const user = userEvent.setup()
    renderApp('/accounts/org-fixture-1')
    await screen.findByRole('heading', { level: 1, name: 'Example Beverage Company' })

    await user.click(
      screen.getByRole('link', { name: /Example Beverage Southeast Plant/ }),
    )
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Example Beverage Southeast Plant' }),
    ).toBeInTheDocument()

    // And it links back to where it came from.
    expect(
      screen.getAllByRole('link', { name: 'Example Beverage Company' }).length,
    ).toBeGreaterThan(0)
  })

  it('shows a confirmed site as confirmed', async () => {
    renderApp('/facilities/fac-fixture-1')
    await screen.findByRole('heading', { level: 1, name: 'Example Beverage Southeast Plant' })

    expect(screen.getByText('Confirmed facility')).toBeInTheDocument()
    expect(screen.queryByText('Candidate facility')).toBeNull()
    expect(screen.getByText('Operating')).toBeInTheDocument()
  })

  /** ADR 0005: unresolved is a valid terminal state, recorded as a success. */
  it('shows a candidate site as visually and textually distinct', async () => {
    renderApp('/facilities/fac-fixture-2')
    await screen.findByRole('heading', {
      level: 1,
      name: 'Proposed site — county parcel filing',
    })

    expect(screen.getByText('Candidate facility')).toBeInTheDocument()
    // The verdict leads, in one line, before any explanation.
    const verdict = screen.getByText('Candidate location, not yet confirmed')
    expect(verdict).toHaveClass('notice__verdict')
    // The reasoning is immediately below it, not hidden.
    expect(screen.getByText(/a successful outcome,\s+not an error/)).toBeInTheDocument()
    expect(document.querySelector('.detail--candidate')).not.toBeNull()
  })

  it('explains an unresolved site instead of guessing at one', async () => {
    renderApp('/facilities/fac-fixture-5')
    await screen.findByRole('heading', {
      level: 1,
      name: 'Example Pet Nutrition Midwest Plant',
    })

    expect(screen.getByText(/Only a state-level location has been reported/))
      .toBeInTheDocument()
    expect(
      screen.getByText('No identifier has been matched. This is why the site is a candidate.'),
    ).toBeInTheDocument()
  })

  it('distinguishes a registry match from a value a source simply asserted', async () => {
    renderApp('/facilities/fac-fixture-1')
    await screen.findByRole('heading', { level: 1, name: 'Example Beverage Southeast Plant' })

    expect(screen.getAllByText('Deterministic (registry)')).toHaveLength(2)
    expect(screen.getAllByText('Source-provided')).toHaveLength(1)
  })

  it('attributes the operator as at a date', async () => {
    renderApp('/facilities/fac-fixture-1')
    await screen.findByRole('heading', { level: 1, name: 'Example Beverage Southeast Plant' })
    expect(screen.getByText('Operator as at 2026-08-17')).toBeInTheDocument()
  })

  /**
   * The rule from the schema delta: a company milestone may be displayed for
   * context, but writing it against each plant "would manufacture that claim
   * once per plant."
   */
  it('carries only site-level events on the site timeline', async () => {
    renderApp('/facilities/fac-fixture-3')
    await screen.findByRole('heading', { level: 1, name: 'Example Meals North Plant' })

    expect(screen.getByText('Line modernization reported')).toBeInTheDocument()
    expect(screen.queryByText('Operational separation completed')).toBeNull()
    expect(screen.queryByText('Demerged; former parent retained approximately 18.4%')).toBeNull()
  })

  it('says where the company-level events actually live', async () => {
    renderApp('/facilities/fac-fixture-3')
    await screen.findByRole('heading', { level: 1, name: 'Example Meals North Plant' })

    expect(screen.getByText(/would manufacture that claim once\s+per plant/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'company timeline' })).toHaveAttribute(
      'href',
      '/accounts/org-fixture-2',
    )
  })

  it('reports an empty site timeline rather than leaving a blank section', async () => {
    renderApp('/facilities/fac-fixture-2')
    await screen.findByRole('heading', {
      level: 1,
      name: 'Proposed site — county parcel filing',
    })
    expect(screen.getByText('No site-level events have been recorded.')).toBeInTheDocument()
    expect(screen.getByText('No opportunities reference this site.')).toBeInTheDocument()
  })

  it('shows an unknown facility id as unavailable', async () => {
    renderApp('/facilities/no-such-site')
    expect(await screen.findByText(/No facility matches that address/)).toBeInTheDocument()
    expect(screen.getByText(/Unknown identifier: no-such-site/)).toBeInTheDocument()
  })

  it('reaches evidence from a site event', async () => {
    const user = userEvent.setup()
    renderApp('/facilities/fac-fixture-1')
    await screen.findByRole('heading', { level: 1, name: 'Example Beverage Southeast Plant' })

    const timelineLinks = screen.getAllByRole('link', { name: 'View evidence' })
    await user.click(timelineLinks[0]!)
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Example Beverage Company announces Southeast plant investment',
      }),
    ).toBeInTheDocument()
  })
})

describe('facility navigation placement', () => {
  it('has no primary navigation entry', async () => {
    renderApp('/facilities/fac-fixture-1')
    await screen.findByRole('heading', { level: 1, name: 'Example Beverage Southeast Plant' })
    const nav = screen.getByRole('navigation', { name: 'Primary' })
    expect(within(nav).queryByRole('link', { name: /Facility/ })).toBeNull()
  })
})
