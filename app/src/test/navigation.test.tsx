import { describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderApp } from '@/test/render'
import { setViewport } from '@/test/setup'
import { PRIMARY_SURFACES, RESERVED_DESTINATIONS } from '@/routes'

describe('wide-screen navigation', () => {
  it('renders the side rail with a full label per destination', async () => {
    renderApp('/')
    const nav = await screen.findByRole('navigation', { name: 'Primary' })
    for (const surface of PRIMARY_SURFACES) {
      expect(
        within(nav).getByRole('link', { name: new RegExp(surface.label) }),
      ).toBeInTheDocument()
    }
    // Reserved positions are visible but grouped apart from the Phase 1 surfaces.
    for (const destination of RESERVED_DESTINATIONS) {
      expect(
        within(nav).getByRole('link', { name: new RegExp(destination.label) }),
      ).toBeInTheDocument()
    }
    expect(screen.queryByRole('button', { name: /Theme: system/ })).toBeInTheDocument()
  })
})

describe('narrow-screen navigation', () => {
  it('replaces the icon-only bar with labelled bottom navigation', async () => {
    setViewport('narrow')
    renderApp('/')

    const nav = await screen.findByRole('navigation', { name: 'Primary' })
    expect(nav).toHaveClass('bottom-nav')

    // Every destination carries visible text, not just an icon.
    for (const surface of PRIMARY_SURFACES) {
      const link = within(nav).getByRole('link', { name: new RegExp(surface.shortLabel) })
      expect(link.textContent?.trim()).toContain(surface.shortLabel)
    }
    expect(within(nav).getAllByRole('link')).toHaveLength(5)
  })

  it('keeps exactly one primary landmark', async () => {
    setViewport('narrow')
    renderApp('/')
    await screen.findByRole('navigation', { name: 'Primary' })
    expect(screen.getAllByRole('navigation', { name: 'Primary' })).toHaveLength(1)
  })

  it('marks the current destination', async () => {
    setViewport('narrow')
    renderApp('/opportunities')
    const nav = await screen.findByRole('navigation', { name: 'Primary' })
    const current = within(nav).getByRole('link', { current: 'page' })
    expect(current).toHaveTextContent('Opportunities')
  })

  it('keeps the brand mark and theme control reachable', async () => {
    setViewport('narrow')
    renderApp('/')
    expect(await screen.findByText('Haskell')).toBeInTheDocument()
    // The visible label is hidden at this width, so the accessible name must carry it.
    expect(screen.getByRole('button', { name: /Theme: system/ })).toBeInTheDocument()
  })

  it('does not render the side rail at the same time', async () => {
    setViewport('narrow')
    renderApp('/')
    await screen.findByRole('navigation', { name: 'Primary' })
    expect(document.querySelector('.nav')).toBeNull()
  })
})

describe('narrow-screen filters', () => {
  it('folds the seven filter controls behind a summary on a phone', async () => {
    setViewport('narrow')
    renderApp('/opportunities')
    await screen.findAllByRole('article')

    // Search stays out in the open; the rest starts folded away so an
    // opportunity is visible without scrolling past the controls.
    expect(await screen.findByRole('searchbox', { name: 'Search opportunities' })).toBeVisible()
    const summary = screen.getByText('Filters and sort')
    expect((summary.closest('details') as HTMLDetailsElement).open).toBe(false)
  })

  it('leaves the controls expanded on a wide screen', async () => {
    renderApp('/opportunities')
    await screen.findAllByRole('article')
    const summary = screen.getByText('Filters and sort')
    expect((summary.closest('details') as HTMLDetailsElement).open).toBe(true)
  })
})


describe('reserved destinations', () => {
  it('groups them apart from the Phase 1 surfaces on a wide screen', async () => {
    renderApp('/')
    const nav = await screen.findByRole('navigation', { name: 'Primary' })
    expect(within(nav).getByText('Surfaces')).toBeInTheDocument()
    expect(within(nav).getByText('Later phases')).toBeInTheDocument()
    expect(within(nav).getAllByText('Reserved')).toHaveLength(3)
  })

  it('keeps them reachable from a labelled menu on a phone', async () => {
    const user = userEvent.setup()
    setViewport('narrow')
    renderApp('/')
    await screen.findByRole('navigation', { name: 'Primary' })

    const menu = screen.getByRole('navigation', { name: 'Later phases' })
    const toggle = within(menu).getByRole('button', { name: /Later/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    for (const destination of RESERVED_DESTINATIONS) {
      expect(
        within(menu).getByRole('link', { name: new RegExp(destination.label) }),
      ).toBeInTheDocument()
    }
  })

  it('does not put a reserved destination in the bottom bar', async () => {
    setViewport('narrow')
    renderApp('/')
    const nav = await screen.findByRole('navigation', { name: 'Primary' })
    for (const destination of RESERVED_DESTINATIONS) {
      expect(within(nav).queryByText(destination.shortLabel)).toBeNull()
    }
  })
})
