import { describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderApp } from '@/test/render'
import { pulseFixture } from '@/data/fixtures/pulse'

/**
 * Daily Pulse must lead with commercial intelligence and file platform
 * operations underneath. These tests assert the separation structurally, so a
 * later change cannot quietly promote a connector recovery back above a
 * confirmed project.
 */
describe('daily pulse structure', () => {
  it('opens with what needs attention today', async () => {
    renderApp('/')
    const heading = await screen.findByRole('heading', { name: 'Needs attention today' })
    expect(heading).toBeInTheDocument()

    const section = heading.closest('section')
    expect(section).not.toBeNull()
    expect(within(section as HTMLElement).getAllByRole('article')).toHaveLength(2)
  })

  it('gives each attention item a reason to act and a way to act', async () => {
    renderApp('/')
    const heading = await screen.findByRole('heading', { name: 'Needs attention today' })
    const section = heading.closest('section') as HTMLElement

    expect(
      within(section).getByText(/Worth a pursuit decision this week/),
    ).toBeInTheDocument()
    // The accessible name now names WHICH opportunity, so two identical-looking
    // links are distinguishable to a screen-reader user.
    const links = within(section).getAllByRole('link', { name: /^Review opportunity/ })
    expect(links).toHaveLength(2)
    expect(links[0]).toHaveAccessibleName(/Example Beverage Company/)
  })

  it('places market changes in the primary feed', async () => {
    renderApp('/')
    const heading = await screen.findByRole('heading', { name: 'Other market changes' })
    const section = heading.closest('section') as HTMLElement

    expect(within(section).getByText(/Site named/)).toBeInTheDocument()
    expect(within(section).getByText(/New lead/)).toBeInTheDocument()
    // System notices must not appear in the commercial feed.
    expect(within(section).queryByText(/Source recovered/)).toBeNull()
    expect(within(section).queryByText(/below expected coverage/)).toBeNull()
  })

  it('files system notices in their own compact section', async () => {
    renderApp('/')
    const summary = await screen.findByText('Coverage and system notices')
    const details = summary.closest('details') as HTMLDetailsElement

    expect(within(details).getByText('Source recovered')).toBeInTheDocument()
    expect(within(details).getByText(/below expected coverage/)).toBeInTheDocument()
    // Confirmed projects must not be demoted into the operations section.
    expect(within(details).queryByText(/Aseptic/)).toBeNull()
  })

  it('opens the system section only because something needs action', async () => {
    renderApp('/')
    const summary = await screen.findByText('Coverage and system notices')
    const details = summary.closest('details') as HTMLDetailsElement

    // The fixture has one connector needing action, so it starts open.
    expect(pulseFixture.connectorHealth.actionRequired).toBeGreaterThan(0)
    expect(details.open).toBe(true)
    expect(within(details.querySelector('summary') as HTMLElement).getByText(/needs action/))
      .toBeInTheDocument()
  })

  it('keeps every change in exactly one of the two channels', () => {
    for (const change of pulseFixture.changesSinceLastVisit) {
      expect(['market', 'system']).toContain(change.channel)
    }
    const system = pulseFixture.changesSinceLastVisit.filter((c) => c.channel === 'system')
    expect(system.map((c) => c.kind).sort()).toEqual([
      'coverage_degraded',
      'source_recovered',
    ])
  })
})

describe('summary metrics', () => {
  /*
     THE METRICS ARE COUNTS OF ROWS NOW, AND THERE ARE FOUR.

     The page led with three figures derived from `change_events`, which is
     empty in production — so a database holding 39 evidence records, 13 signals
     and 5 opportunities rendered as a page of zeroes. The counts are now
     opportunities, signals, evidence and source health: each one the size of a
     result set, each one checkable.
  */
  it('leads with four live counts, each with a short note', async () => {
    renderApp('/')
    expect(await screen.findByRole('heading', { name: /Opportunities/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Signals/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Evidence/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Source health/ })).toBeInTheDocument()

    expect(screen.getByText('Derived from collected filings')).toBeInTheDocument()
    expect(screen.getByText('Enabled sources healthy')).toBeInTheDocument()
    // "New" is meaningless without a window, and the window is stated.
    expect(screen.getByText(/New in the last 7 days/)).toBeInTheDocument()
  })

  it('moves the source list behind a disclosure', async () => {
    const user = userEvent.setup()
    renderApp('/')
    await screen.findByRole('heading', { name: /Source health/ })

    const summary = screen.getByText(/degraded, .* needs\s+action/)
    const details = summary.closest('details') as HTMLDetailsElement
    expect(details.open).toBe(false)
    await user.click(summary)
    expect(details.open).toBe(true)
    expect(within(details).getAllByRole('listitem').length).toBeGreaterThan(0)
  })

  it('names the under-covered accounts rather than only counting them', async () => {
    renderApp('/')
    await screen.findByRole('heading', { name: /Account coverage/ })
    expect(screen.getByText(/Below expected: /)).toBeInTheDocument()
  })

  it('preserves the coverage / connector-health distinction', async () => {
    const user = userEvent.setup()
    renderApp('/')
    const summary = await screen.findByText(/degraded,.*needs\s*action/)
    await user.click(summary)
    expect(
      screen.getByText(/Connector health is whether the sources are working/),
    ).toBeInTheDocument()
  })
})

describe('caught-up state', () => {
  it('uses the approved wording', async () => {
    renderApp('/?state=empty')
    expect(
      await screen.findByRole('heading', { name: 'You’re caught up' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('No material changes have been identified since your last visit.'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/Nothing has changed since your last visit/)).toBeNull()
  })
})
