import { describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderApp, renderAppWithHistory } from '@/test/render'

/**
 * Moving between records.
 *
 * Every one of these addresses is shareable, so each has to survive being pasted
 * cold — and the parameters a URL carries have to be the ones that belong to the
 * record being opened, never the ones left over from the record you came from.
 */
function currentUrl() {
  return `${window.location.pathname}${window.location.search}`
}

describe('deep links resolve on a cold load', () => {
  it.each([
    ['/accounts/org-fixture-2', 'Example Meals & Sauces Co.'],
    ['/facilities/fac-fixture-3', 'Example Meals North Plant'],
    ['/evidence/ev-fixture-6', 'Demerger completion notice'],
  ])('%s opens the record it names', async (route, heading) => {
    renderAppWithHistory(route)
    expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeInTheDocument()
    expect(currentUrl()).toBe(route)
  })

  it('reproduces an as-at date from a pasted address', async () => {
    renderAppWithHistory('/accounts/org-fixture-2?asOf=2027-07-01')
    await screen.findByRole('heading', { level: 1, name: 'Example Meals & Sauces Co.' })

    // The whole point of URL-carried attribution: the same link, the same answer.
    expect(screen.getByText('Controlling parent as at 2027-07-01')).toBeInTheDocument()
    expect(screen.getByDisplayValue('2027-07-01')).toBeInTheDocument()
  })

  it('ignores a malformed as-at date rather than rendering a broken one', async () => {
    renderApp('/accounts/org-fixture-2?asOf=not-a-date')
    await screen.findByRole('heading', { level: 1, name: 'Example Meals & Sauces Co.' })
    expect(screen.getByText('Controlling parent as at 2026-08-17')).toBeInTheDocument()
  })
})

describe('record-scoped parameters do not leak across records', () => {
  it('drops the as-at date when moving to a different record', async () => {
    const user = userEvent.setup()
    renderAppWithHistory('/accounts/org-fixture-1?asOf=2020-01-01')
    await screen.findByRole('heading', { level: 1, name: 'Example Beverage Company' })

    await user.click(
      screen.getByRole('link', { name: /Example Beverage Southeast Plant/ }),
    )
    await screen.findByRole('heading', { level: 1, name: 'Example Beverage Southeast Plant' })

    // A date chosen for one company is not an answer about another record.
    expect(currentUrl()).toBe('/facilities/fac-fixture-1')
  })

  it('carries the state previewer across every hop', async () => {
    const user = userEvent.setup()
    renderAppWithHistory('/accounts?state=stale')
    await screen.findByRole('heading', { level: 1, name: 'Company' })

    const row = screen.getByRole('article', { name: /Example Beverage Company/ })
    await user.click(within(row).getByRole('link', { name: /Open company/ }))
    await screen.findByRole('heading', { level: 1, name: 'Example Beverage Company' })
    expect(currentUrl()).toBe('/accounts/org-fixture-1?state=stale')
  })
})

describe('walking the record graph', () => {
  it('goes company → facility → evidence → back to the company', async () => {
    const user = userEvent.setup()
    renderApp('/accounts/org-fixture-1')
    await screen.findByRole('heading', { level: 1, name: 'Example Beverage Company' })

    await user.click(
      screen.getByRole('link', { name: /Example Beverage Southeast Plant/ }),
    )
    await screen.findByRole('heading', { level: 1, name: 'Example Beverage Southeast Plant' })

    await user.click(
      screen.getByRole('link', {
        name: /Example Beverage Company announces Southeast plant investment/,
      }),
    )
    await screen.findByRole('heading', {
      level: 1,
      name: 'Example Beverage Company announces Southeast plant investment',
    })

    await user.click(
      screen.getByRole('link', { name: /Example Beverage Company\s+Brand owner/ }),
    )
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Example Beverage Company' }),
    ).toBeInTheDocument()
  })

  it('reaches a company from a coverage row on Source Health', async () => {
    const user = userEvent.setup()
    renderApp('/admin/health')
    await screen.findByRole('heading', { level: 1, name: 'Source Health & Coverage' })

    await user.click(screen.getByRole('link', { name: 'Example Confectionery Group' }))
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Example Confectionery Group' }),
    ).toBeInTheDocument()
  })

  it('returns to the account list from a company', async () => {
    const user = userEvent.setup()
    renderApp('/accounts/org-fixture-1')
    await screen.findByRole('heading', { level: 1, name: 'Example Beverage Company' })

    await user.click(screen.getByRole('link', { name: 'All companies' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Company' })).toBeInTheDocument()
  })

  it('goes back through the browser rather than trapping the user', async () => {
    const user = userEvent.setup()
    renderAppWithHistory('/accounts/org-fixture-1')
    await screen.findByRole('heading', { level: 1, name: 'Example Beverage Company' })

    await user.click(
      screen.getByRole('link', { name: /Example Beverage Southeast Plant/ }),
    )
    await screen.findByRole('heading', { level: 1, name: 'Example Beverage Southeast Plant' })

    window.history.back()
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1, name: 'Example Beverage Company' }))
        .toBeInTheDocument(),
    )
  })
})
