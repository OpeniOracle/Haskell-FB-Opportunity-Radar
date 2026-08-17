import { describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import { renderApp } from '@/test/render'
import { CONTEXTUAL_ROUTES, PRIMARY_ROUTES, ROUTES } from '@/routes'

describe('route structure', () => {
  it('declares seven surfaces across five primary entries and two contextual routes', () => {
    expect(ROUTES).toHaveLength(7)
    expect(PRIMARY_ROUTES).toHaveLength(5)
    expect(CONTEXTUAL_ROUTES).toHaveLength(2)
  })

  it('implements exactly the two surfaces in scope for this milestone', () => {
    const implemented = ROUTES.filter((r) => r.implemented).map((r) => r.path)
    expect(implemented).toEqual(['/', '/opportunities'])
  })

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

  it.each(
    ROUTES.filter((r) => !r.implemented && r.placement === 'primary').map((r) => [
      r.path,
      r.label,
    ]),
  )('renders a named placeholder at %s', async (path, label) => {
    renderApp(path)
    expect(await screen.findByRole('heading', { level: 1, name: label })).toBeInTheDocument()
    expect(screen.getByText(/Scheduled for/)).toBeInTheDocument()
  })

  it('renders contextual routes without listing them in the nav rail', async () => {
    renderApp('/opportunities/opp-fixture-1')
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Opportunity detail' }),
    ).toBeInTheDocument()

    const nav = screen.getByRole('navigation', { name: 'Primary' })
    expect(within(nav).queryByRole('link', { name: /Opportunity detail/ })).toBeNull()
  })

  it('shows an explicit not-found state rather than redirecting', async () => {
    renderApp('/no-such-surface')
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Page not found' }),
    ).toBeInTheDocument()
  })

  it('lists every primary route in the nav rail', async () => {
    renderApp('/')
    const nav = await screen.findByRole('navigation', { name: 'Primary' })
    for (const route of PRIMARY_ROUTES) {
      expect(
        within(nav).getByRole('link', { name: new RegExp(route.label) }),
      ).toBeInTheDocument()
    }
  })
})
