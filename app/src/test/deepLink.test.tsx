import { describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderApp, renderAppWithHistory } from '@/test/render'
import { pulseFixture } from '@/data/fixtures/pulse'
import { opportunityFixtures } from '@/data/fixtures/opportunities'
import {
  LEGACY_OPPORTUNITY_PARAM,
  opportunityDetailPath,
} from '@/lib/opportunityFilters'

/**
 * Deep linking into one opportunity.
 *
 * `10_DESIGN_RESPONSE.md` §5.3: "Deep links always resolve to the full page so a
 * brief or Teams alert lands somewhere shareable." The drawer stays for
 * in-session triage but holds no URL state, so no shared address can land on a
 * list with a panel over it.
 */

const attention = pulseFixture.changesSinceLastVisit.filter(
  (c) => c.channel === 'market' && c.needsAttention,
)

function currentUrl() {
  return `${window.location.pathname}${window.location.search}`
}

describe('Daily Pulse review links', () => {
  it('targets the full page, not the list and not a drawer parameter', async () => {
    renderApp('/')
    const heading = await screen.findByRole('heading', { name: 'Needs attention today' })
    const section = heading.closest('section') as HTMLElement
    const links = within(section).getAllByRole('link', { name: /^Review opportunity/ })

    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      '/opportunities/opp-fixture-1',
      '/opportunities/opp-fixture-6',
    ])
    for (const link of links) {
      expect(link.getAttribute('href')).not.toContain(LEGACY_OPPORTUNITY_PARAM)
      expect(link.getAttribute('href')).not.toBe('/opportunities')
    }
  })

  it('opens the correct full page for each attention item', async () => {
    for (const [index, change] of attention.entries()) {
      const user = userEvent.setup()
      const view = renderApp('/')
      const heading = await screen.findByRole('heading', { name: 'Needs attention today' })
      const section = heading.closest('section') as HTMLElement
      const link = within(section).getAllByRole('link', { name: /^Review opportunity/ })[index]
      expect(link).toBeDefined()
      if (!link) return

      await user.click(link)

      const expected = opportunityFixtures.find((o) => o.id === change.opportunityId)
      expect(
        await screen.findByRole('heading', { level: 1, name: expected?.title }),
      ).toBeInTheDocument()
      // The full page, not a dialog over the list.
      expect(screen.queryByRole('dialog')).toBeNull()
      view.unmount()
    }
  })

  it('carries an existing query parameter through the link', async () => {
    renderApp('/?state=degraded')
    const heading = await screen.findByRole('heading', { name: 'Needs attention today' })
    const section = heading.closest('section') as HTMLElement
    const link = within(section).getAllByRole('link', { name: /^Review opportunity/ })[0]

    expect(link?.getAttribute('href')).toBe('/opportunities/opp-fixture-1?state=degraded')
  })
})

describe('the full detail page', () => {
  it('renders on a direct load', async () => {
    renderApp('/opportunities/opp-fixture-3')
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Water withdrawal application filed for a greenfield bottling site',
      }),
    ).toBeInTheDocument()
  })

  it('is reload-safe — the same address reproduces the same page', async () => {
    const url = opportunityDetailPath('opp-fixture-4')
    const first = renderApp(url)
    const firstHeading = (
      await screen.findByRole('heading', { level: 1 })
    ).textContent
    first.unmount()

    renderApp(url)
    expect((await screen.findByRole('heading', { level: 1 })).textContent).toBe(firstHeading)
    expect(firstHeading).toBe('Innovation centre expected to open by spring 2029')
  })

  it('preserves every disclosure the drawer offers', async () => {
    renderApp('/opportunities/opp-fixture-1')
    await screen.findByRole('heading', { level: 1 })

    for (const section of [
      'Assessment',
      'Confidence',
      'How this score was reached',
      'Evidence',
      'Capability match',
      'Decision',
    ]) {
      expect(screen.getByRole('heading', { level: 2, name: section })).toBeInTheDocument()
    }
    expect(screen.getByText('Evidence strength')).toBeInTheDocument()
    expect(screen.getByText('Assessment type')).toBeInTheDocument()
    expect(screen.getByText('Confidence level')).toBeInTheDocument()
    expect(screen.getByText('Independent publishers')).toBeInTheDocument()
    expect(screen.getByText('Expected timing')).toBeInTheDocument()
    expect(screen.getByText(/exact date/)).toBeInTheDocument()
  })

  it('shows attribution and caveats on the records that carry them', async () => {
    renderApp('/opportunities/opp-fixture-3')
    await screen.findByRole('heading', { level: 1 })
    expect(
      screen.getByRole('heading', { level: 2, name: 'Ownership and operator' }),
    ).toBeInTheDocument()

    renderApp('/opportunities/opp-fixture-5')
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Timing caveat' }),
    ).toBeInTheDocument()
  })

  it('offers local preview actions that are still not persisted', async () => {
    const user = userEvent.setup()
    renderApp('/opportunities/opp-fixture-1')
    await screen.findByRole('heading', { level: 1 })

    const pursue = screen.getByRole('button', { name: 'Pursue' })
    await user.click(pursue)
    expect(pursue).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText(/preview only, not saved/i)).toBeInTheDocument()
  })

  it('fails safe on an unknown identifier', async () => {
    renderApp('/opportunities/opp-does-not-exist')
    expect(
      await screen.findByRole('heading', { level: 2, name: 'No such opportunity' }),
    ).toBeInTheDocument()
    // No neighbouring record shown in its place.
    expect(screen.queryByRole('heading', { level: 1, name: /Aseptic/ })).toBeNull()
  })

  it('offers a way back to the list', async () => {
    renderApp('/opportunities/opp-fixture-1')
    expect(
      await screen.findByRole('link', { name: /All opportunities/ }),
    ).toHaveAttribute('href', '/opportunities')
  })
})

describe('drawer to full page', () => {
  it('opens the drawer from a card without touching the URL', async () => {
    const user = userEvent.setup()
    renderAppWithHistory('/opportunities')
    const first = (await screen.findAllByRole('article'))[0]
    expect(first).toBeDefined()
    if (!first) return

    await user.click(within(first).getByRole('button', { name: /^Review opportunity/ }))
    await screen.findByRole('dialog')

    // In-session affordance: the address is unchanged, so it cannot be shared
    // into a state that reopens a panel.
    expect(currentUrl()).toBe('/opportunities')
  })

  it('navigates from the drawer to the full page', async () => {
    const user = userEvent.setup()
    renderAppWithHistory('/opportunities')
    const first = (await screen.findAllByRole('article'))[0]
    expect(first).toBeDefined()
    if (!first) return

    await user.click(within(first).getByRole('button', { name: /^Review opportunity/ }))
    const dialog = await screen.findByRole('dialog')

    await user.click(within(dialog).getByRole('link', { name: /Open full detail/ }))

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Aseptic filling line and warehouse automation at Southeast plant',
      }),
    ).toBeInTheDocument()
    expect(currentUrl()).toBe('/opportunities/opp-fixture-1')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('closes the drawer with Escape and returns focus to the trigger', async () => {
    const user = userEvent.setup()
    renderApp('/opportunities')
    const first = (await screen.findAllByRole('article'))[0]
    expect(first).toBeDefined()
    if (!first) return

    const trigger = within(first).getByRole('button', { name: /^Review opportunity/ })
    await user.click(trigger)
    await screen.findByRole('dialog')
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(trigger).toHaveFocus()
  })
})

describe('legacy drawer address', () => {
  it('redirects an already-shared ?opportunity= link to the full page', async () => {
    renderAppWithHistory('/opportunities?opportunity=opp-fixture-6')
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Line modernization placed on hold after an announced deferral',
      }),
    ).toBeInTheDocument()
    expect(currentUrl()).toBe('/opportunities/opp-fixture-6')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('keeps any other parameter across the redirect', async () => {
    renderAppWithHistory('/opportunities?state=stale&opportunity=opp-fixture-1')
    await screen.findByRole('heading', { level: 1, name: /Aseptic/ })
    expect(currentUrl()).toBe('/opportunities/opp-fixture-1?state=stale')
  })
})

describe('browser navigation', () => {
  it('returns to Daily Pulse on Back, and forward again', async () => {
    const user = userEvent.setup()
    renderAppWithHistory('/')
    const heading = await screen.findByRole('heading', { name: 'Needs attention today' })
    const section = heading.closest('section') as HTMLElement

    await user.click(
      within(section).getAllByRole('link', { name: /^Review opportunity/ })[0] as HTMLElement,
    )
    await screen.findByRole('heading', { level: 1, name: /Aseptic/ })

    window.history.back()
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Daily Pulse' }),
    ).toBeInTheDocument()

    window.history.forward()
    expect(await screen.findByRole('heading', { level: 1, name: /Aseptic/ })).toBeInTheDocument()
  })

  it('returns to the list on Back from a full page opened via the drawer', async () => {
    const user = userEvent.setup()
    renderAppWithHistory('/opportunities')
    const first = (await screen.findAllByRole('article'))[0]
    expect(first).toBeDefined()
    if (!first) return

    await user.click(within(first).getByRole('button', { name: /^Review opportunity/ }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('link', { name: /Open full detail/ }))
    await screen.findByRole('heading', { level: 1, name: /Aseptic/ })

    window.history.back()
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Opportunities' }),
    ).toBeInTheDocument()
    expect(currentUrl()).toBe('/opportunities')
  })

  it('does not leave the legacy address in history', async () => {
    renderAppWithHistory('/')
    await screen.findByRole('heading', { level: 1, name: 'Daily Pulse' })

    window.history.pushState({}, '', '/opportunities?opportunity=opp-fixture-1')
    window.dispatchEvent(new PopStateEvent('popstate'))
    await screen.findByRole('heading', { level: 1, name: /Aseptic/ })

    // The redirect replaced, so Back reaches Daily Pulse rather than bouncing
    // through the dead address.
    window.history.back()
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Daily Pulse' }),
    ).toBeInTheDocument()
  })
})

describe('focus', () => {
  it('moves focus into the drawer on open', async () => {
    const user = userEvent.setup()
    renderApp('/opportunities')
    const first = (await screen.findAllByRole('article'))[0]
    expect(first).toBeDefined()
    if (!first) return

    await user.click(within(first).getByRole('button', { name: /^Review opportunity/ }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('button', { name: 'Close' })).toHaveFocus()
  })
})
