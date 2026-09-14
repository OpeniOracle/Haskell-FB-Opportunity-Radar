import { describe, expect, it, vi } from 'vitest'
import { screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderApp, fixtureSource } from '@/test/render'
import { setViewport } from '@/test/setup'
import { signedOut } from '@/test/authFake'
import { spyglassFixture } from '@/data/fixtures/spyglass'
import { FIXTURE_NOW } from '@/lib/format'
import {
  MAX_PRIMARY_WIDGETS,
  SPYGLASS_DASHBOARD_ORIGINS,
  SPYGLASS_EMBED_ORIGINS,
  dashboardUrlProblem,
  isApprovedDashboardUrl,
  isApprovedEmbedUrl,
} from '@/lib/spyglass'
import type { DataSource } from '@/data/DataSource'
import type { SpyglassSnapshot } from '@/types/domain'

/*
 * THE ONE THING THIS SURFACE MUST NEVER DO IS CALL AN EMBED LIVE.
 *
 * Zignal's documentation is explicit that embeddable widgets support neither
 * realtime nor data refresh — an embed shows the data that existed when the
 * snippet was generated, permanently. A month-old sentiment chart presented as
 * current coverage of a client's brand is worse than no chart, so these tests
 * hold the line between the live dashboard LINK and the frozen snapshot FRAMES.
 */

function withSpyglass(snapshot: SpyglassSnapshot): DataSource {
  return {
    ...fixtureSource(undefined),
    getSpyglass: async () => ({
      kind: 'ready',
      data: snapshot,
      checkedAt: FIXTURE_NOW.toISOString(),
    }),
  }
}

describe('authentication', () => {
  it('is behind the gate like every other surface', async () => {
    renderApp('/media', { auth: signedOut() })
    expect(await screen.findByRole('heading', { name: /sign in/i })).toBeInTheDocument()
    // The configuration must not reach an unauthenticated visitor at all.
    expect(screen.queryByText(/zign\.al/)).toBeNull()
    expect(screen.queryByText('Open live dashboard')).toBeNull()
  })
})

describe('the live dashboard link', () => {
  it('opens the configured destination in a new tab, named as external', async () => {
    renderApp('/media')
    await screen.findByRole('heading', { level: 1, name: 'Spyglass media intelligence' })

    const link = screen.getByRole('link', { name: /Open live dashboard/ })
    expect(link).toHaveAttribute('href', spyglassFixture.settings.dashboardUrl)
    expect(link).toHaveAttribute('target', '_blank')
    expect(link.getAttribute('rel')).toContain('noopener')
    expect(link.getAttribute('rel')).toContain('noreferrer')
    // A screen-reader user is told where it goes and that it leaves the page.
    expect(link.textContent).toMatch(/external Spyglass destination, opens in a new tab/)
  })

  it('is not hardcoded — it comes from the data source', async () => {
    const moved: SpyglassSnapshot = {
      ...spyglassFixture,
      settings: {
        ...spyglassFixture.settings,
        dashboardUrl: 'https://app.zignallabs.com/dashboards/elsewhere',
      },
    }
    renderApp('/media', { data: withSpyglass(moved) })
    await screen.findByRole('heading', { level: 1, name: 'Spyglass media intelligence' })
    expect(screen.getByRole('link', { name: /Open live dashboard/ })).toHaveAttribute(
      'href',
      'https://app.zignallabs.com/dashboards/elsewhere',
    )
  })

  it('appears on Daily Pulse as a pointer, not as a panel', async () => {
    renderApp('/')
    await screen.findByRole('heading', { level: 1, name: 'Daily Pulse' })
    const main = screen.getByRole('main')
    const link = within(main).getByRole('link', { name: /Spyglass media intelligence/ })
    expect(link).toHaveAttribute('href', '/media')
    // Nothing is embedded on Daily Pulse.
    expect(document.querySelectorAll('iframe')).toHaveLength(0)
    expect(screen.getByText(/not part of the counts above/)).toBeInTheDocument()
  })
})

describe('administrator-only editing', () => {
  it('offers the editor to an administrator', async () => {
    renderApp('/media')
    await screen.findByRole('heading', { level: 1, name: 'Spyglass media intelligence' })
    expect(screen.getByText('Change the Spyglass dashboard')).toBeInTheDocument()
  })

  it('offers nothing to a non-administrator', async () => {
    const viewer = withSpyglass({ ...spyglassFixture, viewerIsAdministrator: false })
    renderApp('/media', { data: viewer })
    await screen.findByRole('heading', { level: 1, name: 'Spyglass media intelligence' })
    expect(screen.queryByText('Change the Spyglass dashboard')).toBeNull()
  })

  it('reports a refused write rather than reporting success', async () => {
    /*
       THE FAILURE MODE THAT MATTERS.

       A non-administrator's UPDATE is not an ERROR: the row-level policy filters
       the row out, so PostgREST reports success having changed nothing.
       Reporting that as saved is how somebody discovers a week later that the
       dashboard never moved. The write path checks the returned row count.
    */
    const user = userEvent.setup()
    const refusing: DataSource = {
      ...withSpyglass(spyglassFixture),
      setSpyglassDashboard: async () => ({
        ok: false,
        reason:
          'Nothing was changed. Editing the Spyglass dashboard requires an application administrator.',
      }),
    }
    renderApp('/media', { data: refusing })
    await screen.findByRole('heading', { level: 1, name: 'Spyglass media intelligence' })

    await user.click(screen.getByText('Change the Spyglass dashboard'))
    await user.click(screen.getByRole('button', { name: /Save dashboard address/ }))
    expect(await screen.findByText(/requires an application administrator/)).toBeInTheDocument()
  })

  it('refuses an unapproved origin before it reaches the database', async () => {
    const user = userEvent.setup()
    const save = vi.fn(async () => ({ ok: true }))
    const source: DataSource = { ...withSpyglass(spyglassFixture), setSpyglassDashboard: save }

    renderApp('/media', { data: source })
    await screen.findByRole('heading', { level: 1, name: 'Spyglass media intelligence' })
    await user.click(screen.getByText('Change the Spyglass dashboard'))

    const input = screen.getByRole('textbox', { name: /Dashboard address/ })
    await user.clear(input)
    await user.type(input, 'https://example.invalid/not-zignal')
    await user.click(screen.getByRole('button', { name: /Save dashboard address/ }))

    expect(await screen.findByText(/approved Spyglass destinations/)).toBeInTheDocument()
    expect(save).not.toHaveBeenCalled()
  })
})

describe('URL validation', () => {
  it('accepts only the approved dashboard origins', () => {
    expect(isApprovedDashboardUrl('https://zign.al/urgnr9l3')).toBe(true)
    expect(isApprovedDashboardUrl('https://app.zignallabs.com/dashboards/1')).toBe(true)
    expect(isApprovedDashboardUrl('https://evil.example/zign.al')).toBe(false)
    expect(isApprovedDashboardUrl('https://zign.al.evil.example/x')).toBe(false)
  })

  it('rejects a protocol-relative address explicitly', () => {
    /*
       `//embeddable-widgets.zignallabs.com/x` has the right HOST and inherits
       whatever scheme the page is on. `new URL()` with a base resolves it
       happily, which is why the check is a literal `https://` prefix test rather
       than a parse-then-compare-origin.
    */
    expect(isApprovedEmbedUrl('//embeddable-widgets.zignallabs.com/x')).toBe(false)
    expect(dashboardUrlProblem('//zign.al/x')).toMatch(/protocol-relative/i)
  })

  it('rejects plain http and other schemes', () => {
    expect(isApprovedDashboardUrl('http://zign.al/x')).toBe(false)
    expect(isApprovedEmbedUrl('javascript:alert(1)')).toBe(false)
    expect(isApprovedEmbedUrl('data:text/html,<h1>x</h1>')).toBe(false)
    expect(dashboardUrlProblem('http://zign.al/x')).toMatch(/must start with https/i)
  })

  it('accepts only the approved embed origins', () => {
    for (const origin of SPYGLASS_EMBED_ORIGINS) {
      expect(isApprovedEmbedUrl(`${origin}/abc?theme=Light`)).toBe(true)
    }
    expect(isApprovedEmbedUrl('https://zignallabs.com/abc')).toBe(false)
    expect(isApprovedEmbedUrl('https://embeddable-widgets.zignallabs.com.evil.example/a')).toBe(
      false,
    )
  })

  it('names the approved destinations when it refuses one', () => {
    const problem = dashboardUrlProblem('https://example.invalid/x')!
    for (const origin of SPYGLASS_DASHBOARD_ORIGINS) {
      expect(problem).toContain(origin)
    }
  })
})

describe('snapshots are never called live', () => {
  it('shows the generation time on every widget, prominently', async () => {
    renderApp('/media')
    await screen.findByRole('heading', { level: 1, name: 'Spyglass media intelligence' })
    const stamps = screen.getAllByText(/^Snapshot generated /)
    expect(stamps).toHaveLength(Math.min(MAX_PRIMARY_WIDGETS, spyglassFixture.widgets.length))
  })

  it('uses the word "live" only for the dashboard link', async () => {
    renderApp('/media')
    await screen.findByRole('heading', { level: 1, name: 'Spyglass media intelligence' })

    /*
       The rule is not "never say live" — the page has to say the dashboard IS
       live, and has to say the snapshots are not. What must never appear is
       "live" attached to a snapshot, a widget, or the figures on one.
    */
    const main = screen.getByRole('main')
    const text = main.textContent ?? ''
    expect(text).not.toMatch(/live (snapshot|widget|chart|figures|data)/i)
    expect(text).not.toMatch(/(snapshot|widget)s? (is|are) live/i)
    // And the honest statement is present.
    expect(text).toMatch(/The dashboard is live; the snapshots below are not/)

    // Every card carries its generation time.
    for (const card of main.querySelectorAll('.spyglass-card')) {
      expect(card.textContent).toMatch(/Snapshot generated /)
    }
  })

  it('shows no more than three snapshots on the main surface', async () => {
    const many: SpyglassSnapshot = {
      ...spyglassFixture,
      widgets: [
        ...spyglassFixture.widgets,
        {
          ...spyglassFixture.widgets[0]!,
          id: 'widget-fixture-4',
          title: 'Share of voice',
          displayOrder: 40,
        },
      ],
    }
    renderApp('/media', { data: withSpyglass(many) })
    await screen.findByRole('heading', { level: 1, name: 'Spyglass media intelligence' })

    const grids = document.querySelectorAll('.spyglass-grid')
    expect(grids[0]!.querySelectorAll('.spyglass-card')).toHaveLength(MAX_PRIMARY_WIDGETS)
    // The fourth is still reachable, below, behind a disclosure.
    expect(screen.getByText(/1 further snapshot/)).toBeInTheDocument()
  })
})

describe('embeds are framed safely, or not at all', () => {
  it('drops any widget whose origin is not approved', async () => {
    const tampered: SpyglassSnapshot = {
      ...spyglassFixture,
      widgets: [
        {
          ...spyglassFixture.widgets[0]!,
          id: 'widget-bad',
          title: 'Injected',
          embedUrl: 'https://example.invalid/evil',
        },
        ...spyglassFixture.widgets,
      ],
    }
    renderApp('/media', { data: withSpyglass(tampered) })
    await screen.findByRole('heading', { level: 1, name: 'Spyglass media intelligence' })
    expect(screen.queryByText('Injected')).toBeNull()
  })

  it('stores and renders no administrator-supplied HTML', async () => {
    renderApp('/media')
    await screen.findByRole('heading', { level: 1, name: 'Spyglass media intelligence' })
    /* Every frame is built from a validated URL. There is no snippet field on
       the type, so there is nothing to inject through. */
    for (const frame of document.querySelectorAll('iframe')) {
      expect(isApprovedEmbedUrl(frame.getAttribute('src') ?? '')).toBe(true)
      expect(frame.getAttribute('sandbox')).toBe('')
      expect(frame.getAttribute('loading')).toBe('lazy')
      expect(frame.getAttribute('referrerpolicy')).toBe('strict-origin-when-cross-origin')
    }
  })

  it('names the snapshot and its date in the frame title', async () => {
    renderApp('/media')
    await screen.findByRole('heading', { level: 1, name: 'Spyglass media intelligence' })
    for (const frame of document.querySelectorAll('iframe')) {
      expect(frame.getAttribute('title')).toMatch(/Spyglass snapshot generated/)
    }
  })
})

describe('loading and fallback', () => {
  it('announces a loading state while a frame is pending', async () => {
    renderApp('/media')
    await screen.findByRole('heading', { level: 1, name: 'Spyglass media intelligence' })
    const statuses = screen.getAllByRole('status')
    expect(statuses.some((n) => /Loading the .* snapshot/.test(n.textContent ?? ''))).toBe(true)
  })

  it('falls back to the dashboard when a frame never displays', async () => {
    /*
       DRIVEN BY THE GRACE TIMER, WHICH IS THE SIGNAL THAT ACTUALLY EXISTS.

       A frame refused by `X-Frame-Options` — the most likely failure, and the
       one a corporate network produces — fires NO event at all. Neither `load`
       nor `error` arrives, so a timer is the only way to notice, and it is what
       this asserts. `shouldAdvanceTime` keeps real microtasks flowing so the
       render that follows is not starved.
    */
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      renderApp('/media')
      await screen.findByRole('heading', { level: 1, name: 'Spyglass media intelligence' })
      await waitFor(() => expect(document.querySelectorAll('iframe').length).toBeGreaterThan(0))

      await vi.advanceTimersByTimeAsync(9000)

      await waitFor(() =>
        expect(screen.getAllByText(/could not be displayed/).length).toBeGreaterThan(0),
      )
      expect(
        screen.getAllByRole('link', { name: /Open live dashboard instead/ }).length,
      ).toBeGreaterThan(0)
      expect(
        screen.getAllByText(/Nothing else on the Radar is affected/).length,
      ).toBeGreaterThan(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('says plainly when nothing has been configured', async () => {
    const none = withSpyglass({ ...spyglassFixture, widgets: [] })
    renderApp('/media', { data: none })
    await screen.findByRole('heading', { level: 1, name: 'Spyglass media intelligence' })
    expect(screen.getByText(/No snapshots are configured/)).toBeInTheDocument()
    // The live dashboard is unaffected and still offered.
    expect(screen.getByRole('link', { name: /Open live dashboard/ })).toBeInTheDocument()
  })

  it('renders the surface when Spyglass itself is unavailable', async () => {
    const broken: DataSource = {
      ...fixtureSource(undefined),
      getSpyglass: async () => ({
        kind: 'unavailable',
        reason: 'The Spyglass configuration could not be read.',
        blockedBy: 'configuration',
        checkedAt: FIXTURE_NOW.toISOString(),
      }),
    }
    renderApp('/media', { data: broken })
    expect(
      await screen.findByText(/The Spyglass configuration could not be read/),
    ).toBeInTheDocument()
  })
})

describe('the CSV boundary is stated on the page', () => {
  it('says an embedded widget is not evidence', async () => {
    renderApp('/media')
    await screen.findByRole('heading', { level: 1, name: 'Spyglass media intelligence' })
    expect(screen.getByText(/Spyglass is not evidence/)).toBeInTheDocument()
    expect(screen.getByText(/reviewed CSV import/)).toBeInTheDocument()
  })
})

describe('themes and layout', () => {
  it('renders in the dark theme without losing the as-of stamps', async () => {
    document.documentElement.setAttribute('data-theme', 'dark')
    renderApp('/media')
    await screen.findByRole('heading', { level: 1, name: 'Spyglass media intelligence' })
    expect(screen.getAllByText(/^Snapshot generated /).length).toBeGreaterThan(0)
  })

  it('renders in the light theme', async () => {
    document.documentElement.setAttribute('data-theme', 'light')
    renderApp('/media')
    await screen.findByRole('heading', { level: 1, name: 'Spyglass media intelligence' })
    expect(screen.getAllByText(/^Snapshot generated /).length).toBeGreaterThan(0)
  })

  it('renders at narrow width', async () => {
    setViewport('narrow')
    renderApp('/media')
    await screen.findByRole('heading', { level: 1, name: 'Spyglass media intelligence' })
    expect(screen.getByRole('link', { name: /Open live dashboard/ })).toBeInTheDocument()
    expect(screen.getAllByText(/^Snapshot generated /).length).toBeGreaterThan(0)
  })
})

describe('no credential reaches the browser', () => {
  it('carries no key or token in any rendered attribute', async () => {
    renderApp('/media')
    await screen.findByRole('heading', { level: 1, name: 'Spyglass media intelligence' })
    const html = screen.getByRole('main').innerHTML
    expect(html).not.toMatch(/api_key/i)
    expect(html).not.toMatch(/embed[_-]?token/i)
    expect(html).not.toMatch(/secret/i)
    expect(html).not.toMatch(/sb_secret/i)
  })
})
