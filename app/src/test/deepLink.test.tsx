import { describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { navigate, renderApp, renderAppWithHistory } from '@/test/render'
import { pulseFixture } from '@/data/fixtures/pulse'
import { opportunityFixtures } from '@/data/fixtures/opportunities'
import {
  OPPORTUNITY_PARAM,
  opportunityLink,
} from '@/lib/opportunityFilters'

/**
 * Deep linking from Daily Pulse into one opportunity.
 *
 * Drawer state lives in the URL, so these tests assert the address as well as
 * the DOM: a link that opens the right record but leaves the URL unchanged would
 * be neither shareable nor reload-safe, and the back button would have nothing
 * to return to.
 */

const attention = pulseFixture.changesSinceLastVisit.filter(
  (c) => c.channel === 'market' && c.needsAttention,
)

function currentUrl() {
  return `${window.location.pathname}${window.location.search}`
}

describe('Daily Pulse review links', () => {
  it('has an opportunity id on every attention item that offers a link', () => {
    expect(attention).toHaveLength(2)
    for (const change of attention) {
      expect(change.opportunityId).toBeTruthy()
      // The id must resolve, or the link would open nothing.
      expect(
        opportunityFixtures.some((o) => o.id === change.opportunityId),
      ).toBe(true)
    }
  })

  it('targets the specific opportunity, not the general list', async () => {
    renderApp('/')
    const heading = await screen.findByRole('heading', { name: 'Needs attention today' })
    const section = heading.closest('section') as HTMLElement
    const links = within(section).getAllByRole('link', { name: /^Review opportunity/ })

    expect(links).toHaveLength(2)
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      '/opportunities?opportunity=opp-fixture-1',
      '/opportunities?opportunity=opp-fixture-6',
    ])
    // Regression guard: the defect was a link to the bare list.
    for (const link of links) {
      expect(link.getAttribute('href')).not.toBe('/opportunities')
    }
  })

  it('opens the correct drawer for each attention item in turn', async () => {
    for (const [index, change] of attention.entries()) {
      const user = userEvent.setup()
      const view = renderApp('/')
      const heading = await screen.findByRole('heading', { name: 'Needs attention today' })
      const section = heading.closest('section') as HTMLElement
      const link = within(section).getAllByRole('link', { name: /^Review opportunity/ })[index]
      expect(link).toBeDefined()
      if (!link) return

      await user.click(link)

      const dialog = await screen.findByRole('dialog')
      const expected = opportunityFixtures.find((o) => o.id === change.opportunityId)
      expect(expected).toBeDefined()
      expect(within(dialog).getByRole('heading', { level: 2 })).toHaveTextContent(
        expected?.title as string,
      )
      view.unmount()
    }
  })

  it('carries an existing query parameter through the link', async () => {
    renderApp('/?state=degraded')
    const heading = await screen.findByRole('heading', { name: 'Needs attention today' })
    const section = heading.closest('section') as HTMLElement
    const link = within(section).getAllByRole('link', { name: /^Review opportunity/ })[0]

    // The fixture state previewer must survive following the link.
    expect(link?.getAttribute('href')).toContain('state=degraded')
    expect(link?.getAttribute('href')).toContain('opportunity=opp-fixture-1')
  })
})

describe('query-driven drawer', () => {
  it('opens the named opportunity on a direct load', async () => {
    renderApp('/opportunities?opportunity=opp-fixture-3')
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('heading', { level: 2 })).toHaveTextContent(
      'Water withdrawal application filed for a greenfield bottling site',
    )
  })

  it('is reload-safe — the same URL reproduces the same drawer', async () => {
    const url = opportunityLink('opp-fixture-4')
    const first = renderApp(url)
    const firstTitle = (await screen.findByRole('dialog')).textContent
    first.unmount()

    // A reload is a fresh mount at the same address; no in-memory state carries over.
    renderApp(url)
    const second = await screen.findByRole('dialog')
    expect(second.textContent).toBe(firstTitle)
    expect(within(second).getByRole('heading', { level: 2 })).toHaveTextContent(
      'Innovation centre expected to open by spring 2029',
    )
  })

  it('writes the id into the URL when opened from a card', async () => {
    const user = userEvent.setup()
    renderAppWithHistory('/opportunities')
    const first = (await screen.findAllByRole('article'))[0]
    expect(first).toBeDefined()
    if (!first) return

    await user.click(within(first).getByRole('button', { name: /^Review opportunity/ }))
    await screen.findByRole('dialog')
    expect(currentUrl()).toBe('/opportunities?opportunity=opp-fixture-1')
  })

  it('opens a record the current filters would hide', async () => {
    const user = userEvent.setup()
    renderAppWithHistory('/opportunities')
    await screen.findAllByRole('article')

    // Narrow the list to one opportunity, then deep-link to a different one that
    // the active filter excludes. The drawer resolves against the full set.
    await user.selectOptions(screen.getByLabelText('Priority'), 'critical')
    expect(await screen.findAllByRole('article')).toHaveLength(1)

    navigate(opportunityLink('opp-fixture-6'))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('heading', { level: 2 })).toHaveTextContent(
      'Line modernization placed on hold after an announced deferral',
    )
    // The filter is untouched — the deep link did not silently widen the list.
    expect(screen.getAllByRole('article')).toHaveLength(1)
  })

  it('exposes the parameter name from one place', () => {
    expect(OPPORTUNITY_PARAM).toBe('opportunity')
    expect(opportunityLink('opp-fixture-1')).toBe(
      '/opportunities?opportunity=opp-fixture-1',
    )
  })
})

describe('invalid identifiers fail safe', () => {
  it.each([
    ['unknown id', '/opportunities?opportunity=opp-does-not-exist'],
    ['empty value', '/opportunities?opportunity='],
    ['injection-shaped value', '/opportunities?opportunity=%22%5D%2Cscript'],
  ])('opens nothing for an %s', async (_label, url) => {
    renderApp(url)
    // The list still renders; no drawer, and crucially no neighbouring record.
    expect(await screen.findAllByRole('article')).toHaveLength(6)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('opens nothing when the parameter is absent', async () => {
    renderApp('/opportunities')
    await screen.findAllByRole('article')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('does not fall through to the first opportunity', async () => {
    renderApp('/opportunities?opportunity=opp-fixture-999')
    await screen.findAllByRole('article')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByText('Assessment')).toBeNull()
  })
})

describe('closing the drawer', () => {
  it('removes the parameter without leaving the application', async () => {
    const user = userEvent.setup()
    renderAppWithHistory('/opportunities?opportunity=opp-fixture-1')
    const dialog = await screen.findByRole('dialog')

    await user.click(within(dialog).getByRole('button', { name: 'Close' }))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(currentUrl()).toBe('/opportunities')
    // Still on Opportunities, with the list intact.
    expect(screen.getByRole('heading', { level: 1, name: 'Opportunities' })).toBeInTheDocument()
    expect(screen.getAllByRole('article')).toHaveLength(6)
  })

  it('closes on Escape and on the scrim, with the same result', async () => {
    const user = userEvent.setup()
    const view = renderAppWithHistory('/opportunities?opportunity=opp-fixture-1')
    await screen.findByRole('dialog')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(currentUrl()).toBe('/opportunities')
    view.unmount()

    renderAppWithHistory('/opportunities?opportunity=opp-fixture-1')
    await screen.findByRole('dialog')
    await user.click(screen.getByRole('button', { name: 'Close opportunity detail' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(currentUrl()).toBe('/opportunities')
  })

  it('keeps any other parameter when it removes its own', async () => {
    const user = userEvent.setup()
    renderAppWithHistory('/opportunities?state=stale&opportunity=opp-fixture-1')
    const dialog = await screen.findByRole('dialog')

    await user.click(within(dialog).getByRole('button', { name: 'Close' }))
    expect(currentUrl()).toBe('/opportunities?state=stale')
  })
})

describe('browser back', () => {
  it('returns to Daily Pulse after following an attention link', async () => {
    const user = userEvent.setup()
    renderAppWithHistory('/')
    const heading = await screen.findByRole('heading', { name: 'Needs attention today' })
    const section = heading.closest('section') as HTMLElement

    await user.click(
      within(section).getAllByRole('link', { name: /^Review opportunity/ })[0] as HTMLElement,
    )
    await screen.findByRole('dialog')

    window.history.back()

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Daily Pulse' }),
    ).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('closes a card-opened drawer without leaving Opportunities', async () => {
    const user = userEvent.setup()
    renderAppWithHistory('/opportunities')
    const first = (await screen.findAllByRole('article'))[0]
    expect(first).toBeDefined()
    if (!first) return

    await user.click(within(first).getByRole('button', { name: /^Review opportunity/ }))
    await screen.findByRole('dialog')

    window.history.back()

    // The heading never changed, so wait for the drawer itself to go.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(
      screen.getByRole('heading', { level: 1, name: 'Opportunities' }),
    ).toBeInTheDocument()
    expect(currentUrl()).toBe('/opportunities')
  })
})

describe('focus handling', () => {
  it('moves focus into the drawer on a direct load', async () => {
    renderApp('/opportunities?opportunity=opp-fixture-1')
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('button', { name: 'Close' })).toHaveFocus()
  })

  it('returns focus to the matching card when the drawer was opened by a URL', async () => {
    const user = userEvent.setup()
    renderApp('/opportunities?opportunity=opp-fixture-6')
    const dialog = await screen.findByRole('dialog')

    await user.click(within(dialog).getByRole('button', { name: 'Close' }))

    // Not the document body, and not the first card — the one that was open.
    const target = document.querySelector('[data-review-for="opp-fixture-6"]')
    expect(target).toHaveFocus()
  })

  it('returns focus to the trigger when the drawer was opened by a click', async () => {
    const user = userEvent.setup()
    renderApp('/opportunities')
    const first = (await screen.findAllByRole('article'))[0]
    expect(first).toBeDefined()
    if (!first) return

    const trigger = within(first).getByRole('button', { name: /^Review opportunity/ })
    await user.click(trigger)
    await screen.findByRole('dialog')
    await user.keyboard('{Escape}')

    expect(trigger).toHaveFocus()
  })
})
