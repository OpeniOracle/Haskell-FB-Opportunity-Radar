import { describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderApp, fixtureSource } from '@/test/render'
import { setViewport } from '@/test/setup'
import { PRIMARY_SURFACES, RESERVED_DESTINATIONS, SURFACES } from '@/routes'
import { FIXTURE_NOW, relativeTime, setDisplayClock } from '@/lib/format'
import { OpportunityCard } from '@/components/OpportunityCard'
import { opportunityFixtures } from '@/data/fixtures/opportunities'
import { MemoryRouter } from 'react-router-dom'
import { render } from '@testing-library/react'
import type { DataSource } from '@/data/DataSource'
import type { Opportunity } from '@/types/domain'

/**
 * ROUTE-LEVEL SMOKE TESTS: every active navigation link goes somewhere useful.
 *
 * The condition this file exists for: a client demonstration where four of the
 * six navigation entries opened pages that were blank or non-functional. Each
 * of those pages "worked" — it rendered, it threw nothing, its own unit tests
 * passed — and every one of them was empty, because the data source returned an
 * object shaped like the surface expected with none of the fields populated.
 *
 * A test that asserts a page renders cannot catch that. These assert that a
 * page renders SOMETHING A READER CAN USE: a heading, and content under it that
 * is neither a placeholder nor an empty state.
 */

/** A heading and at least one substantive region under it. */
async function expectPopulated(label: string) {
  const heading = await screen.findByRole('heading', { level: 1, name: label })
  expect(heading).toBeInTheDocument()

  const main = screen.getByRole('main')
  /*
     The heading can arrive before the content: `/map` is a lazily-loaded chunk,
     and every surface resolves its data asynchronously. Waiting for the body to
     have substance is the assertion anyway — a page that renders its title and
     nothing else is precisely the condition this file exists to catch.
  */
  await waitFor(() => {
    const header = main.querySelector('.page-head')
    const body = [...main.children].filter((node) => node !== header)
    const text = body.map((node) => node.textContent ?? '').join(' ').trim()
    expect(text.length, `${label} rendered no content below its header`).toBeGreaterThan(80)
  })
  // Not a "not yet built" placeholder, and not a reserved chip.
  expect(within(main).queryByText(/not yet built/i)).toBeNull()
  expect(within(main).queryByText(/reserved for a later phase/i)).toBeNull()

  /*
     The page-head prose alone is not content. A blank surface still renders its
     title and subtitle — that is exactly what made the broken pages look
     plausible — so the assertion is on what comes AFTER the header.
  */
}

describe('every active navigation entry loads a populated surface', () => {
  it.each(PRIMARY_SURFACES.map((s) => [s.routes[0]!, s.label] as const))(
    '%s renders content, not a blank page',
    async (path, label) => {
      renderApp(path)
      await expectPopulated(label)
    },
  )

  it.each(
    SURFACES.flatMap((s) => s.routes)
      // Detail routes need an id and are covered by their own surface tests.
      // What matters here is that no registered route falls through.
      .filter((route) => !route.includes(':'))
      .map((route) => [route] as const),
  )('%s is registered and is not a placeholder', async (route) => {
    renderApp(route)
    expect(
      await screen.findByRole('heading', { level: 1 }),
      `${route} rendered no heading`,
    ).toBeInTheDocument()
    expect(screen.queryByText(/not yet built/i)).toBeNull()
  })

  it('offers no navigation entry that cannot be populated', () => {
    /* `/views` is the case. It was a primary entry whose page could only ever
       render its empty state, because nothing can write a saved pursuit. */
    expect(PRIMARY_SURFACES.map((s) => s.routes[0])).not.toContain('/views')
  })

  it('keeps Market Trends and Briefings visible and clearly Reserved', async () => {
    renderApp('/')
    const nav = await screen.findByRole('navigation', { name: 'Primary' })
    for (const destination of RESERVED_DESTINATIONS) {
      expect(
        within(nav).getByRole('link', { name: new RegExp(destination.label) }),
      ).toBeInTheDocument()
    }
    expect(within(nav).getAllByText('Reserved')).toHaveLength(2)
  })

  it('renders a reserved destination as reserved rather than as a broken page', async () => {
    renderApp('/trends')
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Market Trends' }),
    ).toBeInTheDocument()
    /* Present in both the rail and the page body — the point is that it says so
       somewhere a reader will see, not that it says so exactly once. */
    expect(screen.getAllByText(/later phase/i).length).toBeGreaterThan(0)
  })
})

describe('opportunity detail carries its source attribution', () => {
  it('shows the filing, the excerpt and the official link', async () => {
    renderApp('/opportunities/opp-fixture-1')
    await screen.findByRole('heading', { level: 1 })

    expect(screen.getByRole('heading', { level: 2, name: 'Source' })).toBeInTheDocument()
    expect(screen.getByText(/Illustrative excerpt/)).toBeInTheDocument()

    const official = screen.getByRole('link', { name: /Open the official filing/ })
    expect(official).toHaveAttribute('target', '_blank')
    // `noopener` matters on a link the opener does not control.
    expect(official.getAttribute('rel')).toContain('noopener')
  })

  it('shows a date, and says which kind of date it is', async () => {
    renderApp('/opportunities/opp-fixture-1')
    await screen.findByRole('heading', { level: 1 })
    /*
       THE FALLBACK. A derived opportunity has no forecast horizon, and the page
       used to render "No date given" while the filing date sat two joins away.
       It now shows the filing date — labelled a filing date, never promoted
       into a schedule.
    */
    expect(screen.getByText('Filing date')).toBeInTheDocument()
    expect(screen.queryByText(/No date given/i)).toBeNull()
  })
})

describe('relative time is measured against the real clock', () => {
  it('does not call a moment in the recent past a moment in the future', () => {
    /*
       THE PRODUCTION BUG, IN ONE ASSERTION.

       `relativeTime` defaulted to `FIXTURE_NOW` — 17 August 2026 — so a filing
       collected on 14 September rendered "in 4 weeks". The default is now the
       real clock; the preview asks for the frozen one explicitly.
    */
    setDisplayClock(null)
    const anHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    expect(relativeTime(anHourAgo)).toBe('1 hr ago')
    expect(relativeTime(anHourAgo)).not.toMatch(/^in /)

    const today = new Date().toISOString()
    expect(relativeTime(today)).not.toMatch(/^in /)
  })

  it('still honours a frozen clock when one is installed', () => {
    setDisplayClock(() => FIXTURE_NOW)
    const anHourBeforeFixtureNow = new Date(FIXTURE_NOW.getTime() - 3_600_000).toISOString()
    expect(relativeTime(anHourBeforeFixtureNow)).toBe('1 hr ago')
  })

  it('reports a genuinely future instant as future, in both clocks', () => {
    setDisplayClock(null)
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    expect(relativeTime(tomorrow)).toMatch(/^in /)
  })
})

describe('unfinished workflow controls appear nowhere', () => {
  it.each(PRIMARY_SURFACES.map((s) => [s.routes[0]!, s.label] as const))(
    '%s offers no preview-only control',
    async (path) => {
      renderApp(path)
      await screen.findByRole('heading', { level: 1 })
      const main = screen.getByRole('main')
      for (const label of ['Pursue', 'Watch', 'Assign', 'Dismiss']) {
        expect(within(main).queryByRole('button', { name: label })).toBeNull()
      }
      expect(within(main).queryByText(/preview only/i)).toBeNull()
    },
  )
})

describe('empty scoring is a sentence, not five empty bars', () => {
  function unscored(): Opportunity {
    const base = opportunityFixtures[0]!
    return {
      ...base,
      scores: {
        haskellFit: null,
        projectMaturity: null,
        potentialScope: null,
        timingMomentum: null,
        accountStrategy: null,
        rawScore: null,
        confidenceMultiplier: null,
        finalScore: null,
      },
    }
  }

  it('renders no score bar at all when nothing has been scored', () => {
    render(
      <MemoryRouter>
        <OpportunityCard opportunity={unscored()} onReview={() => {}} />
      </MemoryRouter>,
    )
    expect(screen.getByText('Awaiting analyst prioritization')).toBeInTheDocument()
    expect(document.querySelectorAll('.score-row__bar')).toHaveLength(0)
  })
})

describe('desktop and mobile both render every active surface', () => {
  it.each(PRIMARY_SURFACES.map((s) => [s.routes[0]!, s.label] as const))(
    '%s renders at narrow width',
    async (path, label) => {
      setViewport('narrow')
      renderApp(path)
      await expectPopulated(label)
      // The bottom navigation replaces the rail, and still carries every entry.
      const navs = await screen.findAllByRole('navigation', { name: 'Primary' })
      expect(navs.length).toBeGreaterThan(0)
    },
  )

  it('carries every primary entry in the bottom navigation', async () => {
    setViewport('narrow')
    renderApp('/')
    const navs = await screen.findAllByRole('navigation', { name: 'Primary' })
    const bottom = navs.find((n) => n.classList.contains('bottom-nav'))!
    expect(within(bottom).getAllByRole('link')).toHaveLength(PRIMARY_SURFACES.length)
  })
})

describe('one failing surface does not take the others down', () => {
  it('renders Opportunities normally while Spyglass is unavailable', async () => {
    /*
       Spyglass is a third-party integration. A Zignal outage, a revoked embed
       or an unconfigured deployment must be a condition on ONE page — the
       Radar's own collected data is not touched by any of them.
    */
    const base = fixtureSource(undefined)
    const brokenSpyglass: DataSource = {
      ...base,
      getSpyglass: async () => ({
        kind: 'unavailable',
        reason: 'Spyglass could not be reached.',
        blockedBy: 'service',
        checkedAt: FIXTURE_NOW.toISOString(),
      }),
    }

    renderApp('/opportunities', { data: brokenSpyglass })
    await expectPopulated('Opportunities')
    expect((await screen.findAllByRole('article')).length).toBeGreaterThan(0)
  })

  it('says so on the Spyglass page itself, and nowhere else', async () => {
    const base = fixtureSource(undefined)
    const brokenSpyglass: DataSource = {
      ...base,
      getSpyglass: async () => ({
        kind: 'unavailable',
        reason: 'Spyglass could not be reached.',
        blockedBy: 'service',
        checkedAt: FIXTURE_NOW.toISOString(),
      }),
    }
    renderApp('/media', { data: brokenSpyglass })
    expect(await screen.findByText(/Spyglass could not be reached/)).toBeInTheDocument()
  })
})

describe('navigation is keyboard reachable on the surfaces this pass added', () => {
  it('reaches the Map and Spyglass entries by keyboard from the rail', async () => {
    const user = userEvent.setup()
    renderApp('/')
    const nav = await screen.findByRole('navigation', { name: 'Primary' })

    for (const label of ['Map', 'Spyglass media intelligence']) {
      const link = within(nav).getByRole('link', { name: label })
      link.focus()
      expect(link).toHaveFocus()
      await user.keyboard('{Enter}')
    }
  })
})
