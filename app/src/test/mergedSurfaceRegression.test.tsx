import { describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderApp, renderAppWithHistory } from '@/test/render'
import { opportunityFixtures } from '@/data/fixtures/opportunities'
import { pulseFixture } from '@/data/fixtures/pulse'

/**
 * Regression cover for the three surfaces merged before this milestone.
 *
 * This PR adds five surfaces, a shared link module, a heading anchor inside two
 * result lists, and an `empty` branch on the opportunity detail page. None of
 * that may change how Daily Pulse, Opportunities or Opportunity detail behave,
 * so the approved behaviour is asserted here directly rather than inferred from
 * the fact that the other suites still pass.
 */
describe('Daily Pulse still behaves as approved', () => {
  it('opens on the root route with its three-part structure intact', async () => {
    renderApp('/')
    expect(await screen.findByRole('heading', { level: 1, name: 'Daily Pulse' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Needs attention today' })).toBeInTheDocument()
  })

  it('still deep-links each review link to its own opportunity', async () => {
    renderApp('/')
    const heading = await screen.findByRole('heading', { name: 'Needs attention today' })
    const section = heading.closest('section') as HTMLElement
    const links = within(section).getAllByRole('link', { name: /^Review opportunity/ })

    const expected = pulseFixture.changesSinceLastVisit
      .filter((c) => c.channel === 'market' && c.needsAttention)
      .map((c) => `/opportunities/${c.opportunityId}`)
    expect(links.map((l) => l.getAttribute('href'))).toEqual(expected)
  })

  it('lands on the full page, never a drawer, from a pulse link', async () => {
    const user = userEvent.setup()
    renderAppWithHistory('/')
    const heading = await screen.findByRole('heading', { name: 'Needs attention today' })
    const section = heading.closest('section') as HTMLElement

    await user.click(within(section).getAllByRole('link', { name: /^Review opportunity/ })[0]!)
    await screen.findByRole('heading', { level: 1, name: opportunityFixtures[0]?.title })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(window.location.pathname).toBe('/opportunities/opp-fixture-1')
  })
})

describe('Opportunities still behaves as approved', () => {
  it('lists every opportunity and reports the count', async () => {
    renderApp('/opportunities')
    await screen.findByRole('heading', { level: 1, name: 'Opportunities' })
    expect(screen.getAllByRole('article')).toHaveLength(opportunityFixtures.length)
    expect(
      screen.getByText(String(opportunityFixtures.length), { selector: 'strong' }),
    ).toBeInTheDocument()
  })

  it('adds no visible heading to the results list', async () => {
    renderApp('/opportunities')
    await screen.findByRole('heading', { level: 1, name: 'Opportunities' })
    // The anchor added for heading order is visually hidden, so the approved
    // layout is unchanged.
    const anchor = screen.getByRole('heading', { level: 2, name: 'Matching opportunities' })
    expect(anchor).toHaveClass('visually-hidden')
  })

  it('still filters, and still recovers from a filter that excludes everything', async () => {
    const user = userEvent.setup()
    renderApp('/opportunities')
    await screen.findAllByRole('article')

    await user.type(
      screen.getByRole('searchbox', { name: 'Search opportunities' }),
      'zzzz-no-match',
    )
    expect(
      await screen.findByRole('heading', {
        level: 2,
        name: 'No opportunities match these filters',
      }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Clear filters/ }))
    await waitFor(() =>
      expect(screen.getAllByRole('article')).toHaveLength(opportunityFixtures.length),
    )
  })

  it('still opens the drawer in place and returns focus on close', async () => {
    const user = userEvent.setup()
    renderApp('/opportunities')
    const cards = await screen.findAllByRole('article')
    const trigger = within(cards[0]!).getByRole('button', { name: /^Review opportunity/ })

    trigger.focus()
    await user.keyboard('{Enter}')
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')

    await user.keyboard('{Escape}')
    expect(trigger).toHaveFocus()
  })

  it('still redirects the legacy drawer address to the full page', async () => {
    renderAppWithHistory('/opportunities?opportunity=opp-fixture-3')
    await waitFor(() =>
      expect(window.location.pathname).toBe('/opportunities/opp-fixture-3'),
    )
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('still keeps local decisions local', async () => {
    const user = userEvent.setup()
    renderApp('/opportunities')
    const cards = await screen.findAllByRole('article')
    expect(
      within(cards[0]!).getByRole('button', { name: /Pursue/ }),
    ).toBeInTheDocument()
    await user.click(within(cards[0]!).getByRole('button', { name: /Pursue/ }))
    expect(screen.getByText(/not saved and reset on\s+reload/)).toBeInTheDocument()
  })
})

describe('Opportunity detail still behaves as approved', () => {
  it('renders the same body the drawer renders', async () => {
    renderApp('/opportunities/opp-fixture-1')
    const heading = await screen.findByRole('heading', {
      level: 1,
      name: opportunityFixtures[0]?.title,
    })
    expect(heading).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /All opportunities/ })).toHaveAttribute(
      'href',
      '/opportunities',
    )
  })

  it('still reports an unknown id without falling through to another record', async () => {
    renderApp('/opportunities/opp-does-not-exist')
    expect(
      await screen.findByRole('heading', { level: 2, name: 'No such opportunity' }),
    ).toBeInTheDocument()
    expect(screen.queryByText(opportunityFixtures[0]!.title)).toBeNull()
  })

  /** New in this milestone, and distinct from "no such opportunity". */
  it('distinguishes an empty set from an unmatched identifier', async () => {
    renderApp('/opportunities/opp-fixture-1?state=empty')
    expect(
      await screen.findByRole('heading', { level: 2, name: 'No opportunities to open' }),
    ).toBeInTheDocument()
    expect(screen.queryByText('No such opportunity')).toBeNull()
  })
})

describe('the shared link module leaves merged routes alone', () => {
  it('keeps the drawer’s route to the shareable address unchanged', async () => {
    const user = userEvent.setup()
    renderApp('/opportunities?state=degraded')
    const cards = await screen.findAllByRole('article')
    await user.click(within(cards[0]!).getByRole('button', { name: /^Review opportunity/ }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('link', { name: /Open full detail/ })).toHaveAttribute(
      'href',
      '/opportunities/opp-fixture-1?state=degraded',
    )
  })

  it('does not add an as-at parameter to a surface that has no as-at date', async () => {
    renderAppWithHistory('/opportunities')
    await screen.findAllByRole('article')
    expect(window.location.search).not.toContain('asOf')
  })
})
