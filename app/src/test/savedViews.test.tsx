import { describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderApp, renderAppWithHistory } from '@/test/render'

/**
 * Saved Pursuits & Watches — `/views`.
 *
 * Every mechanic here is local to the preview session. The tests below check
 * both halves of that: the affordances genuinely work, AND nothing is written
 * anywhere. A control that appears to save but does not is worse than no
 * control, so the surface has to say which one it is.
 */
describe('saved views', () => {
  it('lists saved views with the filters they carry', async () => {
    renderApp('/views')
    await screen.findByRole('heading', { level: 1, name: 'Saved Pursuits & Watches' })

    expect(screen.getByText('Confirmed, Southeast')).toBeInTheDocument()
    expect(screen.getByText('Stage: Confirmed')).toBeInTheDocument()
    expect(screen.getByText('Geography: GA')).toBeInTheDocument()
    expect(screen.getByText('Sort: Priority score')).toBeInTheDocument()
  })

  it('navigates back to the surface a view belongs to', async () => {
    const user = userEvent.setup()
    renderApp('/views')
    await screen.findByRole('heading', { level: 1, name: 'Saved Pursuits & Watches' })

    const card = screen.getByText('Under-covered accounts').closest('li')!
    expect(within(card).getByRole('link', { name: /Open view/ })).toHaveAttribute(
      'href',
      '/accounts',
    )

    await user.click(within(card).getByRole('link', { name: /Open view/ }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Company' })).toBeInTheDocument()
  })

  it('renames a view for the session', async () => {
    const user = userEvent.setup()
    renderApp('/views')
    await screen.findByRole('heading', { level: 1, name: 'Saved Pursuits & Watches' })

    const card = screen.getByText('Confirmed, Southeast').closest('li')!
    await user.click(within(card).getByRole('button', { name: 'Rename' }))

    const input = screen.getByRole('textbox', { name: /Rename/ })
    await user.clear(input)
    await user.type(input, 'Southeast, ready to call')
    await user.click(screen.getByRole('button', { name: 'Save name' }))

    expect(await screen.findByText('Southeast, ready to call')).toBeInTheDocument()
    expect(screen.queryByText('Confirmed, Southeast')).toBeNull()
  })

  it('abandons a rename on cancel', async () => {
    const user = userEvent.setup()
    renderApp('/views')
    await screen.findByRole('heading', { level: 1, name: 'Saved Pursuits & Watches' })

    const card = screen.getByText('Confirmed, Southeast').closest('li')!
    await user.click(within(card).getByRole('button', { name: 'Rename' }))
    await user.type(screen.getByRole('textbox', { name: /Rename/ }), ' edited')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(await screen.findByText('Confirmed, Southeast')).toBeInTheDocument()
  })

  it('deletes a view and can restore the illustrative set', async () => {
    const user = userEvent.setup()
    renderApp('/views')
    await screen.findByRole('heading', { level: 1, name: 'Saved Pursuits & Watches' })

    const card = screen.getByText('Process systems pipeline').closest('li')!
    await user.click(within(card).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(screen.queryByText('Process systems pipeline')).toBeNull())

    await user.click(screen.getByRole('button', { name: /Restore the illustrative set/ }))
    expect(await screen.findByText('Process systems pipeline')).toBeInTheDocument()
  })

  it('offers a recoverable empty state when every view is removed', async () => {
    const user = userEvent.setup()
    renderApp('/views')
    await screen.findByRole('heading', { level: 1, name: 'Saved Pursuits & Watches' })

    for (const name of ['Confirmed, Southeast', 'Process systems pipeline', 'Under-covered accounts']) {
      const card = screen.getByText(name).closest('li')!
      await user.click(within(card).getByRole('button', { name: 'Delete' }))
    }

    expect(
      await screen.findByRole('heading', { level: 2, name: 'No saved views in this session' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/Reload the page, or use/)).toBeInTheDocument()
  })
})

describe('watched records', () => {
  it('lists watched companies, facilities and opportunities', async () => {
    renderApp('/views')
    await screen.findByRole('heading', { level: 1, name: 'Saved Pursuits & Watches' })

    const watches = screen.getByRole('heading', {
      level: 2,
      name: 'Watched records',
    }).closest('section')!
    expect(within(watches).getByText('Company')).toBeInTheDocument()
    expect(within(watches).getByText('Facility')).toBeInTheDocument()
    expect(within(watches).getByText('Opportunity')).toBeInTheDocument()
    expect(within(watches).getAllByRole('listitem')).toHaveLength(3)
  })

  it('links each watch back to the record it represents', async () => {
    renderApp('/views')
    await screen.findByRole('heading', { level: 1, name: 'Saved Pursuits & Watches' })

    expect(
      screen.getByRole('link', { name: 'Example Meals & Sauces Co.' }),
    ).toHaveAttribute('href', '/accounts/org-fixture-2')
    expect(
      screen.getByRole('link', { name: 'Proposed site — county parcel filing' }),
    ).toHaveAttribute('href', '/facilities/fac-fixture-2')
    expect(
      screen.getByRole('link', {
        name: 'Aseptic filling line and warehouse automation at Southeast plant',
      }),
    ).toHaveAttribute('href', '/opportunities/opp-fixture-1')
  })

  it('opens the watched record', async () => {
    const user = userEvent.setup()
    renderApp('/views')
    await screen.findByRole('heading', { level: 1, name: 'Saved Pursuits & Watches' })

    await user.click(screen.getByRole('link', { name: 'Proposed site — county parcel filing' }))
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Proposed site — county parcel filing',
      }),
    ).toBeInTheDocument()
  })

  it('stops watching for the session', async () => {
    const user = userEvent.setup()
    renderApp('/views')
    await screen.findByRole('heading', { level: 1, name: 'Saved Pursuits & Watches' })

    const card = screen.getByText('Example Meals & Sauces Co.').closest('li')!
    await user.click(within(card).getByRole('button', { name: 'Stop watching' }))
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: 'Example Meals & Sauces Co.' })).toBeNull(),
    )
  })
})

/**
 * The two constraints that make this surface honest.
 */
describe('local-session-only behaviour', () => {
  it('says plainly that nothing is saved outside the preview session', async () => {
    renderApp('/views')
    await screen.findByRole('heading', { level: 1, name: 'Saved Pursuits & Watches' })

    expect(
      screen.getByText(/Changes are not saved outside this preview session/),
    ).toBeInTheDocument()
    expect(screen.getByText(/There is no storage behind this screen/)).toBeInTheDocument()
  })

  it('writes nothing to localStorage when an action is taken', async () => {
    const user = userEvent.setup()
    renderApp('/views')
    await screen.findByRole('heading', { level: 1, name: 'Saved Pursuits & Watches' })

    const before = window.localStorage.length
    const card = screen.getByText('Confirmed, Southeast').closest('li')!
    await user.click(within(card).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(screen.queryByText('Confirmed, Southeast')).toBeNull())

    expect(window.localStorage.length).toBe(before)
  })

  it('discards session changes on reload', async () => {
    const user = userEvent.setup()
    const { unmount } = renderAppWithHistory('/views')
    await screen.findByRole('heading', { level: 1, name: 'Saved Pursuits & Watches' })

    const card = screen.getByText('Confirmed, Southeast').closest('li')!
    await user.click(within(card).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(screen.queryByText('Confirmed, Southeast')).toBeNull())

    // A reload is a fresh mount against the same fixture.
    unmount()
    renderAppWithHistory('/views')
    expect(await screen.findByText('Confirmed, Southeast')).toBeInTheDocument()
  })

  /** D8 is Open. Nothing here may model an owner, a share, or an approval. */
  it('models no ownership, sharing, assignment or approval', async () => {
    renderApp('/views')
    await screen.findByRole('heading', { level: 1, name: 'Saved Pursuits & Watches' })

    const main = screen.getByRole('main')
    for (const term of [/shared with/i, /assigned to/i, /approve/i, /owner:/i]) {
      expect(within(main).queryByText(term)).toBeNull()
    }
    expect(screen.getByText(/does not model an\s+owner, a shared state, an assignee or an approval step/))
      .toBeInTheDocument()
  })
})
