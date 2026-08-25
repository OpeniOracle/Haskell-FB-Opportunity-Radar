import { describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import { renderApp, renderAt } from '@/test/render'
import { FutureTimestampWarning, RecordedAt } from '@/components/RecordedAt'
import { CoverageCard } from '@/components/CoverageCard'
import { FIXTURE_NOW } from '@/lib/format'

const at = (ms: number) => new Date(FIXTURE_NOW.getTime() + ms).toISOString()
const DAY = 86_400_000

/**
 * Surface-level cover for the third B1 protection.
 *
 * Correcting the fixtures and the formatter is not enough on its own: live data
 * will eventually deliver a future retrieval time from a skewed collector or a
 * source with a bad date. When it does, the interface has to name it as a fault
 * rather than render it as an ordinary time.
 */
describe('future timestamps on completed-work fields', () => {
  it('warns and keeps the absolute value when the instant is in the future', () => {
    renderAt(<RecordedAt iso={at(300 * DAY)} prefix="Last activity" />)
    expect(screen.getByText(/Future timestamp detected/)).toBeInTheDocument()
    // Retained for inspection, not merely reported.
    expect(screen.getByText(/recorded as 13 June 2027/)).toBeInTheDocument()
    // And the relative rendering keeps its direction.
    expect(screen.getByText(/Last activity/).textContent).toMatch(/13 June 2027|in /)
  })

  it('says nothing for an ordinary past instant', () => {
    renderAt(<RecordedAt iso={at(-2 * 3_600_000)} prefix="Last checked" />)
    expect(screen.getByText(/Last checked 2 hr ago/)).toBeInTheDocument()
    expect(screen.queryByText(/Future timestamp detected/)).toBeNull()
  })

  it('says nothing at exactly now', () => {
    renderAt(<RecordedAt iso={at(0)} />)
    expect(screen.queryByText(/Future timestamp detected/)).toBeNull()
  })

  it('warns even one second into the future', () => {
    renderAt(<FutureTimestampWarning iso={at(1000)} />)
    expect(screen.getByText(/Future timestamp detected/)).toBeInTheDocument()
  })

  it('does not warn on an unreadable value, which is a different fault', () => {
    renderAt(<FutureTimestampWarning iso="not-a-date" />)
    expect(screen.queryByText(/Future timestamp detected/)).toBeNull()
  })

  it('renders an unreadable instant honestly rather than as a relative time', () => {
    renderAt(<RecordedAt iso="not-a-date" prefix="Last checked" />)
    expect(screen.getByText(/Last checked Date unavailable/)).toBeInTheDocument()
    expect(screen.queryByText(/ago/)).toBeNull()
    expect(screen.queryByText(/just now/)).toBeNull()
  })

  it('flags a future coverage check inside the coverage card', () => {
    renderAt(
      <CoverageCard
        coverage={{
          expectedSources: ['A', 'B'],
          observedSources: ['A'],
          missingSources: ['B'],
          lastCheckedAt: at(40 * DAY),
          gapReason: 'Illustrative gap.',
        }}
      />,
    )
    expect(screen.getByText(/Future timestamp detected/)).toBeInTheDocument()
  })
})

/**
 * The corrected fixtures, asserted through the rendered surfaces rather than
 * only through the data. This is the exact string the review found.
 */
describe('the shipped fixtures no longer render a future instant as the present', () => {
  it('does not say "just now" anywhere on the account list', async () => {
    renderApp('/accounts')
    await screen.findByRole('heading', { level: 1, name: 'Company' })
    const main = screen.getByRole('main')
    expect(main.textContent).not.toMatch(/Last activity just now/)
    expect(within(main).queryByText(/Future timestamp detected/)).toBeNull()
  })

  it('reports the corrected last activity as a past time', async () => {
    renderApp('/accounts')
    await screen.findByRole('heading', { level: 1, name: 'Company' })
    const row = screen.getByRole('article', { name: /Example Meals & Sauces Co./ })
    expect(within(row).getByText(/Last activity/).textContent).toMatch(
      /ago|\d{1,2} \w+ \d{4}/,
    )
  })

  it('shows no fault warning on any of the seven surfaces', async () => {
    for (const route of [
      '/',
      '/opportunities',
      '/accounts',
      '/accounts/org-fixture-2',
      '/facilities/fac-fixture-1',
      '/evidence/ev-fixture-6',
      '/admin/health',
      '/views',
    ]) {
      const view = renderApp(route)
      await screen.findByRole('main')
      expect(
        screen.queryByText(/Future timestamp detected/),
        `${route} renders a future instant`,
      ).toBeNull()
      view.unmount()
    }
  })
})
