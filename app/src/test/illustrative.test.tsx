import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { renderApp } from '@/test/render'
import { ROUTES } from '@/routes'

/**
 * The illustrative-data marker is a hard requirement of this milestone, not a
 * nicety: a fixture mistaken for a finding is the worst failure this preview
 * could produce. So it is asserted on EVERY route, including placeholders and the
 * not-found page.
 */
describe('illustrative data marking', () => {
  const paths = [
    ...ROUTES.map((r) => r.path.replace(':opportunityId', 'x').replace(':accountId', 'x')),
    '/no-such-surface',
  ]

  it.each(paths)('shows the persistent banner at %s', async (path) => {
    renderApp(path)
    const note = await screen.findByRole('note')
    expect(note).toHaveTextContent('Illustrative data')
    expect(note).toHaveTextContent(/No real company, project, evidence/)
  })

  it('gives Opportunities the prominent block treatment as well as the banner', async () => {
    renderApp('/opportunities')
    expect(
      await screen.findByRole('heading', { name: 'These are not real opportunities' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('note')).toHaveTextContent('Illustrative data')
  })

  it('does not give Daily Pulse the block treatment reserved for Opportunities', async () => {
    renderApp('/')
    await screen.findByRole('heading', { level: 1, name: 'Daily Pulse' })
    expect(screen.queryByRole('heading', { name: 'These are not real opportunities' })).toBeNull()
  })
})
