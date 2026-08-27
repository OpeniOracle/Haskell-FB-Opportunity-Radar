import { describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderApp } from '@/test/render'

/**
 * The filter, sort and local-action behaviour as a user experiences it — driven
 * through the real controls rather than by calling the pure helpers, which are
 * covered separately in `opportunityFilters.test.ts`.
 */

async function titles() {
  const cards = await screen.findAllByRole('article')
  return cards.map((c) => within(c).getByRole('heading', { level: 3 }).textContent)
}

describe('search and filters', () => {
  it('narrows the list as the user types and updates the results count', async () => {
    const user = userEvent.setup()
    renderApp('/opportunities')
    await screen.findAllByRole('article')

    await user.type(
      await screen.findByRole('searchbox', { name: 'Search opportunities' }),
      'dairy',
    )

    expect(await titles()).toEqual([
      'Line modernization placed on hold after an announced deferral',
    ])
    const results = screen.getByRole('status')
    expect(results).toHaveTextContent('1 of 6 opportunities')
    expect(within(results).getByText(/filtered/)).toBeInTheDocument()
  })

  it('filters by each control', async () => {
    const user = userEvent.setup()
    renderApp('/opportunities')
    await screen.findAllByRole('article')

    await user.selectOptions(screen.getByLabelText('Stage'), 'confirmed')
    expect(await titles()).toHaveLength(2)

    await user.selectOptions(screen.getByLabelText('Stage'), 'any')
    await user.selectOptions(screen.getByLabelText('Priority'), 'critical')
    expect(await titles()).toEqual([
      'Aseptic filling line and warehouse automation at Southeast plant',
    ])

    await user.selectOptions(screen.getByLabelText('Priority'), 'any')
    await user.selectOptions(screen.getByLabelText('Geography'), 'KY')
    expect(await titles()).toHaveLength(1)

    await user.selectOptions(screen.getByLabelText('Geography'), 'any')
    await user.selectOptions(screen.getByLabelText('Capability'), 'Process systems')
    expect(await titles()).toHaveLength(2)

    await user.selectOptions(screen.getByLabelText('Capability'), 'any')
    await user.selectOptions(screen.getByLabelText('Confidence'), 'low')
    expect(await titles()).toHaveLength(1)

    await user.selectOptions(screen.getByLabelText('Confidence'), 'any')
    await user.selectOptions(screen.getByLabelText('Status'), 'on_hold')
    expect(await titles()).toHaveLength(1)
  })

  it('offers only statuses that exist in the data', async () => {
    renderApp('/opportunities')
    await screen.findAllByRole('article')
    const options = within(screen.getByLabelText('Status'))
      .getAllByRole('option')
      .map((o) => o.textContent)
    expect(options).toContain('On hold')
    // No status option that would return an empty list.
    expect(options).not.toContain('Closed — won')
  })

  it('shows an explicit no-match state rather than a blank list', async () => {
    const user = userEvent.setup()
    renderApp('/opportunities')
    await screen.findAllByRole('article')

    await user.type(
      await screen.findByRole('searchbox', { name: 'Search opportunities' }),
      'zzzznomatch',
    )
    expect(
      await screen.findByRole('heading', { name: 'No opportunities match these filters' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/Nothing has been hidden/)).toBeInTheDocument()
    expect(screen.queryByRole('article')).toBeNull()
  })

  it('clears every filter at once and re-enables the full list', async () => {
    const user = userEvent.setup()
    renderApp('/opportunities')
    await screen.findAllByRole('article')

    const clear = screen.getByRole('button', { name: /Clear filters/ })
    expect(clear).toBeDisabled()

    await user.selectOptions(screen.getByLabelText('Stage'), 'confirmed')
    await user.type(
      await screen.findByRole('searchbox', { name: 'Search opportunities' }),
      'beverage',
    )
    expect(clear).toBeEnabled()

    await user.click(clear)
    expect(await titles()).toHaveLength(6)
    expect(clear).toBeDisabled()
  })
})

describe('sorting', () => {
  it('reorders the list by newest evidence and by expected timing', async () => {
    const user = userEvent.setup()
    renderApp('/opportunities')
    const byPriority = await titles()

    await user.selectOptions(screen.getByLabelText('Sort by'), 'newest_evidence')
    const byEvidence = await titles()
    expect(byEvidence).not.toEqual(byPriority)
    expect(byEvidence[0]).toBe(
      'Aseptic filling line and warehouse automation at Southeast plant',
    )

    await user.selectOptions(screen.getByLabelText('Sort by'), 'expected_timing')
    const byTiming = await titles()
    expect(byTiming[0]).toBe(
      'Aseptic filling line and warehouse automation at Southeast plant',
    )
    expect(byTiming[1]).toBe(
      'Water withdrawal application filed for a greenfield bottling site',
    )
    // The undated opportunity sorts last rather than being given a fake date.
    expect(byTiming[byTiming.length - 1]).toBe(
      'Line modernization placed on hold after an announced deferral',
    )
  })

  it('keeps sorting available while filters are applied', async () => {
    const user = userEvent.setup()
    renderApp('/opportunities')
    await screen.findAllByRole('article')

    await user.selectOptions(screen.getByLabelText('Capability'), 'Process systems')
    await user.selectOptions(screen.getByLabelText('Sort by'), 'newest_evidence')
    expect(await titles()).toEqual([
      'Aseptic filling line and warehouse automation at Southeast plant',
      'Line modernization placed on hold after an announced deferral',
    ])
  })
})

describe('local preview actions', () => {
  it('records a decision on the card and states that it is not saved', async () => {
    const user = userEvent.setup()
    renderApp('/opportunities')
    const first = (await screen.findAllByRole('article'))[0]
    expect(first).toBeDefined()
    if (!first) return

    const pursue = within(first).getByRole('button', { name: 'Pursue' })
    expect(pursue).toHaveAttribute('aria-pressed', 'false')

    await user.click(pursue)
    expect(pursue).toHaveAttribute('aria-pressed', 'true')
    expect(within(first).getByText('Marked to pursue')).toBeInTheDocument()
    expect(within(first).getByText(/preview only, not saved/)).toBeInTheDocument()
  })

  it('offers all four actions and lets a misclick be undone', async () => {
    const user = userEvent.setup()
    renderApp('/opportunities')
    const first = (await screen.findAllByRole('article'))[0]
    expect(first).toBeDefined()
    if (!first) return

    for (const label of ['Pursue', 'Watch', 'Assign', 'Dismiss']) {
      expect(within(first).getByRole('button', { name: label })).toBeEnabled()
    }

    const watch = within(first).getByRole('button', { name: 'Watch' })
    await user.click(watch)
    expect(watch).toHaveAttribute('aria-pressed', 'true')
    await user.click(watch)
    expect(watch).toHaveAttribute('aria-pressed', 'false')
  })

  it('shares one decision between the card and the drawer', async () => {
    const user = userEvent.setup()
    renderApp('/opportunities')
    const first = (await screen.findAllByRole('article'))[0]
    expect(first).toBeDefined()
    if (!first) return

    await user.click(within(first).getByRole('button', { name: 'Dismiss' }))
    await user.click(within(first).getByRole('button', { name: /^Review opportunity/ }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('button', { name: 'Dismiss' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('states once, above the list, that nothing is persisted', async () => {
    renderApp('/opportunities')
    await screen.findAllByRole('article')

    // Said once for the whole list rather than repeated on all six cards.
    expect(screen.getAllByText(/^Preview only/)).toHaveLength(1)
    expect(
      screen.getByText(/Pursue, Watch, Assign and Dismiss are not saved/),
    ).toBeInTheDocument()

    // Scoped to the surface: "Saved Pursuits & Watches" is a navigation entry,
    // not a persistence claim about a decision.
    const main = screen.getByRole('main')
    for (const node of within(main).getAllByText(/saved/i)) {
      expect(node.textContent).toMatch(/not saved/i)
    }
  })
})

describe('illustrative treatment', () => {
  it('keeps one compact note beside the results count and drops the large panel', async () => {
    renderApp('/opportunities')
    await screen.findAllByRole('article')

    expect(screen.getByText('Fictional examples — not market intelligence')).toBeInTheDocument()
    expect(screen.queryByText('These are not real opportunities')).toBeNull()
    // The persistent ribbon is still the primary marker.
    expect(screen.getByRole('note')).toHaveTextContent('Illustrative data')
  })
})
