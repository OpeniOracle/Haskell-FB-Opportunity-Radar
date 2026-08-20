import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { renderApp } from '@/test/render'
import { RESERVED_DESTINATIONS, SURFACES } from '@/routes'

/**
 * The striped ribbon is the persistent marker and must appear on every view,
 * including placeholders and the not-found page. The large duplicate panel on
 * Opportunities has been replaced by a compact contextual note — one marker in
 * the chrome, one beside the results, and nothing said twice.
 */
describe('illustrative data marking', () => {
  const paths = [
    ...SURFACES.flatMap((s) => s.routes).map((r) =>
      r
        .replace(':opportunityId', 'opp-fixture-1')
        .replace(':accountId', 'x')
        .replace(':facilityId', 'x')
        .replace(':evidenceId', 'x'),
    ),
    ...RESERVED_DESTINATIONS.map((d) => d.path),
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

/**
 * The five surfaces added in roadmap PR 2 carry the same contextual marker as
 * the two merged ones — one in the chrome, one beside the content, nothing said
 * twice. The routes above exercise the unknown-record state; these use real
 * fixture ids so the marker is asserted against rendered content.
 */
describe('illustrative marking on the record surfaces', () => {
  it.each([
    ['/accounts', 'Company'],
    ['/accounts/org-fixture-1', 'Example Beverage Company'],
    ['/facilities/fac-fixture-1', 'Example Beverage Southeast Plant'],
    ['/evidence/ev-fixture-1', 'Example Beverage Company announces Southeast plant investment'],
    ['/admin/health', 'Source Health & Coverage'],
    ['/views', 'Saved Pursuits & Watches'],
  ])('marks %s beside its content', async (path, heading) => {
    renderApp(path)
    await screen.findByRole('heading', { level: 1, name: heading })
    expect(screen.getByRole('note')).toHaveTextContent('Illustrative data')
    expect(
      screen.getByText('Fictional examples — not market intelligence'),
    ).toBeInTheDocument()
  })
})
