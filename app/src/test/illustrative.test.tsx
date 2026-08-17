import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { renderApp } from '@/test/render'
import { ROUTES } from '@/routes'

/**
 * The striped ribbon is the persistent marker and must appear on every view,
 * including placeholders and the not-found page. The large duplicate panel on
 * Opportunities has been replaced by a compact contextual note — one marker in
 * the chrome, one beside the results, and nothing said twice.
 */
describe('illustrative data marking', () => {
  const paths = [
    ...ROUTES.map((r) => r.path.replace(':opportunityId', 'x').replace(':accountId', 'x')),
    '/no-such-surface',
  ]

  it.each(paths)('shows the persistent ribbon at %s', async (path) => {
    renderApp(path)
    const note = await screen.findByRole('note')
    expect(note).toHaveTextContent('Illustrative data')
    expect(note).toHaveTextContent(/no real company, project, or evidence/)
  })

  it('adds one compact contextual note on Opportunities', async () => {
    renderApp('/opportunities')
    await screen.findAllByRole('article')
    expect(
      screen.getByText('Fictional examples — not market intelligence'),
    ).toBeInTheDocument()
  })

  it('no longer renders the large duplicate disclaimer panel', async () => {
    renderApp('/opportunities')
    await screen.findAllByRole('article')
    expect(screen.queryByText('These are not real opportunities')).toBeNull()
    expect(screen.queryByText(/Do not use anything on this page as/)).toBeNull()
  })

  it('marks Daily Pulse too, without a second panel', async () => {
    renderApp('/')
    await screen.findByRole('heading', { level: 1, name: 'Daily Pulse' })
    expect(screen.getByRole('note')).toHaveTextContent('Illustrative data')
    expect(
      screen.getByText('Fictional examples — not market intelligence'),
    ).toBeInTheDocument()
  })
})
