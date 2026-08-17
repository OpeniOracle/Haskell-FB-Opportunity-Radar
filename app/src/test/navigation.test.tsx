import { describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import { renderApp } from '@/test/render'
import { setViewport } from '@/test/setup'
import { PRIMARY_ROUTES } from '@/routes'

describe('wide-screen navigation', () => {
  it('renders the side rail with a full label per destination', async () => {
    renderApp('/')
    const nav = await screen.findByRole('navigation', { name: 'Primary' })
    for (const route of PRIMARY_ROUTES) {
      expect(within(nav).getByRole('link', { name: new RegExp(route.label) })).toBeInTheDocument()
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
    for (const route of PRIMARY_ROUTES) {
      const link = within(nav).getByRole('link', { name: new RegExp(route.shortLabel) })
      expect(link.textContent?.trim()).toContain(route.shortLabel)
    }
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
    expect(screen.getByRole('searchbox', { name: 'Search opportunities' })).toBeVisible()
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
