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
    expect(
      within(section).getAllByRole('link', { name: 'Review opportunity' }).length,
    ).toBe(2)
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
  it('keeps the three metrics with short notes', async () => {
    renderApp('/')
    expect(await screen.findByRole('heading', { name: /Changes/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Account coverage/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Connector health/ })).toBeInTheDocument()

    expect(screen.getByText('Market changes since your last visit')).toBeInTheDocument()
    expect(screen.getByText('Accounts fully covered')).toBeInTheDocument()
    expect(screen.getByText('Sources healthy')).toBeInTheDocument()
  })

  it('moves the long account list behind a disclosure', async () => {
    const user = userEvent.setup()
    renderApp('/')
    await screen.findByRole('heading', { name: /Account coverage/ })

    const summary = screen.getByText('4 below expected')
    // Behind a disclosure, not printed onto the card.
    expect((summary.closest('details') as HTMLDetailsElement).open).toBe(false)
    await user.click(summary)
    const details = summary.closest('details') as HTMLDetailsElement
    expect(within(details).getByText('Example Confectionery Group')).toBeInTheDocument()
    expect(within(details).getAllByRole('listitem')).toHaveLength(4)
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
