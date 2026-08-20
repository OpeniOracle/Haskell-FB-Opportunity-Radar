import { describe, expect, it } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderApp, renderAppWithHistory } from '@/test/render'

/**
 * Company — `/accounts` and `/accounts/:accountId`.
 *
 * The assertions are deliberately about MEANING rather than layout: that a
 * provisional classification is excluded from a denominator, that an ownership
 * answer changes with the as-at date, that a blocked attribute is shown as
 * blocked rather than filled in.
 */
describe('company list', () => {
  it('lists every monitored company', async () => {
    renderApp('/accounts')
    await screen.findByRole('heading', { level: 1, name: 'Company' })
    const rows = screen.getAllByRole('article')
    expect(rows).toHaveLength(6)
    expect(screen.getByText('Example Beverage Company')).toBeInTheDocument()
  })

  it('narrows by search term', async () => {
    const user = userEvent.setup()
    renderApp('/accounts')
    await screen.findByRole('heading', { level: 1, name: 'Company' })

    await user.type(screen.getByRole('searchbox', { name: 'Search companies' }), 'confection')
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(1))
    expect(screen.getByText('Example Confectionery Group')).toBeInTheDocument()
  })

  it('filters to the under-covered accounts', async () => {
    const user = userEvent.setup()
    renderApp('/accounts')
    await screen.findByRole('heading', { level: 1, name: 'Company' })

    await user.selectOptions(screen.getByLabelText('Coverage'), 'below')
    const rows = await screen.findAllByRole('article')
    for (const row of rows) {
      expect(within(row).getByText('Below expected coverage')).toBeInTheDocument()
    }
  })

  it('filters by classification and by sector', async () => {
    const user = userEvent.setup()
    renderApp('/accounts')
    await screen.findByRole('heading', { level: 1, name: 'Company' })

    await user.selectOptions(screen.getByLabelText('Classification'), 'provisional')
    const rows = await screen.findAllByRole('article')
    for (const row of rows) {
      expect(within(row).getByText('Provisional classification')).toBeInTheDocument()
    }

    await user.selectOptions(screen.getByLabelText('Classification'), 'any')
    await user.selectOptions(screen.getByLabelText('Sector'), 'Confectionery')
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(1))
  })

  it('offers a recoverable state when the filters exclude everything', async () => {
    const user = userEvent.setup()
    renderApp('/accounts')
    await screen.findByRole('heading', { level: 1, name: 'Company' })

    await user.type(
      screen.getByRole('searchbox', { name: 'Search companies' }),
      'no-such-company',
    )
    expect(
      await screen.findByRole('heading', { level: 2, name: 'No companies match these filters' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/Nothing has been hidden/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Clear filters/ }))
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(6))
  })

  /**
   * D11 is approved provisionally, so a count the surface presents as a
   * denominator must say which population it counted. Two confirmed and four
   * provisional in the fixture set.
   */
  it('states which population counts toward relevance metrics', async () => {
    renderApp('/accounts')
    await screen.findByRole('heading', { level: 1, name: 'Company' })
    expect(
      screen.getByText(/count toward relevance metrics; 3 are\s+provisionally classified/),
    ).toBeInTheDocument()
  })

  it('never shows a tier or engagement value in a row', async () => {
    renderApp('/accounts')
    await screen.findByRole('heading', { level: 1, name: 'Company' })
    const main = screen.getByRole('main')
    expect(within(main).queryByText(/Target tier/)).toBeNull()
    expect(within(main).queryByText(/^Engagement$/)).toBeNull()
  })
})

describe('company detail', () => {
  it('opens the company a row links to', async () => {
    const user = userEvent.setup()
    renderApp('/accounts')
    await screen.findByRole('heading', { level: 1, name: 'Company' })

    const row = screen.getByRole('article', { name: /Example Meals & Sauces Co./ })
    await user.click(within(row).getByRole('link', { name: /Open company/ }))

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Example Meals & Sauces Co.' }),
    ).toBeInTheDocument()
  })

  it('resolves ownership as at today by default', async () => {
    renderApp('/accounts/org-fixture-2')
    await screen.findByRole('heading', { level: 1, name: 'Example Meals & Sauces Co.' })

    expect(screen.getByText('Controlling parent as at 2026-08-17')).toBeInTheDocument()
    const parent = screen.getByText('Controlling parent as at 2026-08-17').parentElement!
    expect(within(parent).getByText('Example Pacific Holdings')).toBeInTheDocument()
  })

  /** The as-at date is the organising idea of the surface, so it is URL-carried. */
  it('re-resolves ownership when the as-at date moves past the demerger', async () => {
    renderApp('/accounts/org-fixture-2?asOf=2027-07-01')
    await screen.findByRole('heading', { level: 1, name: 'Example Meals & Sauces Co.' })

    const parentRow = screen.getByText('Controlling parent as at 2027-07-01').parentElement!
    expect(within(parentRow).getByText('None — independent')).toBeInTheDocument()

    const stakeRow = screen.getByText('Retained stakes as at 2027-07-01').parentElement!
    expect(within(stakeRow).getByText(/Example Pacific Holdings — 18.4% \(approximate\)/))
      .toBeInTheDocument()
  })

  it('answers the demerger date itself with the retained stake, not the parent', async () => {
    renderApp('/accounts/org-fixture-2?asOf=2027-06-30')
    await screen.findByRole('heading', { level: 1, name: 'Example Meals & Sauces Co.' })

    const parentRow = screen.getByText('Controlling parent as at 2027-06-30').parentElement!
    expect(within(parentRow).getByText('None — independent')).toBeInTheDocument()
  })

  it('writes the chosen date into the address so a shared link reproduces it', async () => {
    renderAppWithHistory('/accounts/org-fixture-2')
    await screen.findByRole('heading', { level: 1, name: 'Example Meals & Sauces Co.' })

    // A native date input takes a whole value, not keystrokes.
    fireEvent.change(screen.getByLabelText('Attribution as at'), {
      target: { value: '2027-07-01' },
    })

    await waitFor(() => expect(window.location.search).toContain('asOf=2027-07-01'))
    expect(await screen.findByRole('button', { name: 'Reset to today' })).toBeInTheDocument()
    expect(screen.getByText('Controlling parent as at 2027-07-01')).toBeInTheDocument()
  })

  it('lists every relationship with its half-open interval, ended ones included', async () => {
    renderApp('/accounts/org-fixture-2')
    await screen.findByRole('heading', { level: 1, name: 'Example Meals & Sauces Co.' })

    expect(screen.getByText('[2018-04-01, 2025-02-17)')).toBeInTheDocument()
    expect(screen.getByText('[2025-02-17, 2027-06-30)')).toBeInTheDocument()
    expect(screen.getByText('[2027-06-30, ∞)')).toBeInTheDocument()
    expect(screen.getByText(/Retained minority interest/)).toBeInTheDocument()
    // The ended edges are listed, not hidden — a demerger with a retained stake
    // is not a clean termination and a current-edges-only list would say it was.
    expect(screen.getAllByText('Not in force').length).toBe(2)
    expect(screen.getAllByText('In force').length).toBe(1)
  })

  it('marks a provisional classification and states the exclusion', async () => {
    renderApp('/accounts/org-fixture-3')
    await screen.findByRole('heading', { level: 1, name: 'Example Consumer Brands PLC' })

    expect(screen.getAllByText('Provisional classification').length).toBeGreaterThan(0)
    expect(screen.getByText(/excluded from relevance metrics/)).toBeInTheDocument()
  })

  /**
   * D14-L. These fields must be present and empty. A fixture value here would
   * imply the licence question is settled, which is exactly what the blocker
   * says it is not.
   */
  it('shows tier, engagement and account-strategy score as unavailable, never populated', async () => {
    renderApp('/accounts/org-fixture-1')
    await screen.findByRole('heading', { level: 1, name: 'Example Beverage Company' })

    for (const label of ['Target tier', 'Engagement', 'Account-strategy score']) {
      const field = screen.getByText(label).parentElement!
      expect(within(field).getByText('Not available')).toBeInTheDocument()
      expect(within(field).getByText(/D14-L/)).toBeInTheDocument()
    }
    expect(screen.getByText(/an external\s+licence review that has not concluded/))
      .toBeInTheDocument()
  })

  it('names coverage gaps rather than only counting them', async () => {
    renderApp('/accounts/org-fixture-4')
    await screen.findByRole('heading', { level: 1, name: 'Example Confectionery Group' })

    const missing = screen.getByText('Missing').parentElement!
    expect(within(missing).getByText('Company newsroom, FSIS MPI')).toBeInTheDocument()
    expect(screen.getByText(/The connectors themselves are healthy/)).toBeInTheDocument()
  })

  it('reports no resolved facilities as an outcome, not a failure', async () => {
    renderApp('/accounts/org-fixture-4')
    await screen.findByRole('heading', { level: 1, name: 'Example Confectionery Group' })

    expect(
      screen.getByRole('heading', { level: 3, name: 'No facilities resolved yet' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/merged into the nearest plausible plant/)).toBeInTheDocument()
  })

  it('labels each timeline entry with the scope of the claim it makes', async () => {
    renderApp('/accounts/org-fixture-2')
    await screen.findByRole('heading', { level: 1, name: 'Example Meals & Sauces Co.' })

    expect(screen.getAllByText('Company-level').length).toBe(3)
    expect(screen.queryByText('Site-level')).toBeNull()
  })

  it('shows an unknown company id as unavailable rather than a neighbouring record', async () => {
    renderApp('/accounts/no-such-company')
    expect(
      await screen.findByText(/No company matches that address/),
    ).toBeInTheDocument()
    expect(screen.getByText(/Unknown identifier: no-such-company/)).toBeInTheDocument()
    expect(screen.queryByText('Example Beverage Company')).toBeNull()
  })
})
