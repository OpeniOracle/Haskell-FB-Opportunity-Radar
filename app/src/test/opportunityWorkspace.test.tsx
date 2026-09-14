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

/*
 * THESE TESTS USED TO ASSERT THAT PURSUE, WATCH, ASSIGN AND DISMISS WORKED AS A
 * PREVIEW. They now assert that they are not there at all.
 *
 * The controls held a decision in component state, discarded it on reload, and
 * said so in small print. That is an honest demonstration in a design preview
 * and a broken promise in front of a client: the first thing anyone does with a
 * list of opportunities is mark one, and being told afterwards that it was not
 * saved is worse than never having been offered.
 *
 * Nothing can write them. `user_read_state` carries a SELECT grant and a
 * per-user read policy, and no grant or policy admits an insert. So they are
 * gone, with the surface that listed them, until there is a table to write to.
 */
describe('unfinished workflow controls are absent, not disabled', () => {
  it('offers no pursuit action on a card', async () => {
    renderApp('/opportunities')
    const first = (await screen.findAllByRole('article'))[0]
    expect(first).toBeDefined()
    if (!first) return

    for (const label of ['Pursue', 'Watch', 'Assign', 'Dismiss']) {
      expect(within(first).queryByRole('button', { name: label })).toBeNull()
    }
  })

  it('offers no pursuit action in the drawer either', async () => {
    const user = userEvent.setup()
    renderApp('/opportunities')
    const first = (await screen.findAllByRole('article'))[0]
    expect(first).toBeDefined()
    if (!first) return

    await user.click(within(first).getByRole('button', { name: /^Review opportunity/ }))
    const dialog = await screen.findByRole('dialog')
    for (const label of ['Pursue', 'Watch', 'Assign', 'Dismiss']) {
      expect(within(dialog).queryByRole('button', { name: label })).toBeNull()
    }
  })

  it('says "preview only" nowhere on the surface', async () => {
    renderApp('/opportunities')
    await screen.findAllByRole('article')

    /*
       The phrase itself is the assertion. A disabled control with an
       explanation is still a control that does nothing, and the explanation is
       what made it feel acceptable to ship.
    */
    const main = screen.getByRole('main')
    expect(within(main).queryByText(/preview only/i)).toBeNull()
    expect(within(main).queryByText(/not saved/i)).toBeNull()
    expect(within(main).queryByText(/reset on reload/i)).toBeNull()
  })
})
