import { describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderApp } from '@/test/render'
import { setViewport } from '@/test/setup'
import {
  PRIMARY_SURFACES,
  RESERVED_DESTINATIONS,
  SURFACES,
  reservedAccessibleName,
} from '@/routes'

/**
 * The navigation carried its meaning visually and nowhere else.
 *
 * "Surfaces" and "Later phases" were plain spans, so the grouping existed only
 * on screen, and the "Reserved" chip was `aria-hidden`, so the accessibility
 * tree announced `"Market Trends"`, `"Map"` and `"Briefings"` exactly like the
 * five working surfaces. A screen-reader user moving link by link had nothing to
 * distinguish a built surface from a reserved position.
 */
describe('navigation groups are programmatically labelled', () => {
  it('exposes both groups by name', async () => {
    renderApp('/')
    await screen.findByRole('navigation', { name: 'Primary' })

    expect(screen.getByRole('group', { name: 'Surfaces' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Later phases' })).toBeInTheDocument()
  })

  it('puts the five working surfaces in one group and the three reserved in the other', async () => {
    renderApp('/')
    await screen.findByRole('navigation', { name: 'Primary' })

    const surfaces = within(screen.getByRole('group', { name: 'Surfaces' }))
    const later = within(screen.getByRole('group', { name: 'Later phases' }))

    expect(surfaces.getAllByRole('link')).toHaveLength(5)
    expect(later.getAllByRole('link')).toHaveLength(3)
  })

  it('associates each label with its group rather than merely preceding it', async () => {
    renderApp('/')
    await screen.findByRole('navigation', { name: 'Primary' })

    for (const [name, id] of [
      ['Surfaces', 'nav-group-surfaces'],
      ['Later phases', 'nav-group-later'],
    ]) {
      const group = screen.getByRole('group', { name })
      expect(group).toHaveAttribute('aria-labelledby', id)
      expect(document.getElementById(id!)?.textContent?.trim()).toBe(name)
    }
  })
})

describe('working destinations keep their plain names', () => {
  it.each(PRIMARY_SURFACES.map((s) => [s.label]))('%s is announced unchanged', async (label) => {
    renderApp('/')
    const nav = await screen.findByRole('navigation', { name: 'Primary' })
    // Exact name: no suffix, no decoration, nothing added by this change.
    expect(within(nav).getByRole('link', { name: label as string })).toBeInTheDocument()
  })
})

describe('reserved destinations announce their later-phase status', () => {
  it.each(RESERVED_DESTINATIONS.map((d) => [d.label]))(
    '%s carries the reserved clause',
    async (label) => {
      renderApp('/')
      const nav = await screen.findByRole('navigation', { name: 'Primary' })
      const expected = reservedAccessibleName(label as string)

      expect(expected).toBe(`${label}, reserved for a later phase`)
      expect(within(nav).getByRole('link', { name: expected })).toBeInTheDocument()
      // And it is no longer reachable by the bare label alone.
      expect(within(nav).queryByRole('link', { name: label as string })).toBeNull()
    },
  )

  it('keeps the visible chip out of aria-hidden', async () => {
    renderApp('/')
    await screen.findByRole('navigation', { name: 'Primary' })

    const chips = document.querySelectorAll('.nav__link--reserved .nav__tag')
    expect(chips).toHaveLength(3)
    for (const chip of chips) {
      expect(chip.getAttribute('aria-hidden')).toBeNull()
      expect(chip.textContent?.trim()).toBe('Reserved')
    }
  })

  it('satisfies label-in-name: the visible words appear in the accessible name', async () => {
    renderApp('/')
    await screen.findByRole('navigation', { name: 'Primary' })

    for (const destination of RESERVED_DESTINATIONS) {
      const name = reservedAccessibleName(destination.label).toLowerCase()
      expect(name).toContain(destination.label.toLowerCase())
      expect(name).toContain('reserved')
    }
  })

  it('does not mark an operable link as disabled', async () => {
    renderApp('/')
    await screen.findByRole('navigation', { name: 'Primary' })
    // The links work and open an explanatory page, so aria-disabled would lie.
    expect(document.querySelectorAll('[aria-disabled]')).toHaveLength(0)
  })
})

describe('reserved destinations stay outside the seven Phase 1 surfaces', () => {
  it('is unchanged by the accessible-name work', () => {
    const labels = SURFACES.map((s) => s.label)
    for (const destination of RESERVED_DESTINATIONS) {
      expect(labels).not.toContain(destination.label)
    }
    expect(SURFACES).toHaveLength(7)
    expect(RESERVED_DESTINATIONS).toHaveLength(3)
  })
})

describe('keyboard access', () => {
  it('reaches a reserved destination and opens its explanatory page', async () => {
    const user = userEvent.setup()
    renderApp('/')
    const nav = await screen.findByRole('navigation', { name: 'Primary' })

    const link = within(nav).getByRole('link', {
      name: reservedAccessibleName('Market Trends'),
    })
    link.focus()
    expect(link).toHaveFocus()

    await user.keyboard('{Enter}')
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Market Trends' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 2, name: 'Not part of Phase 1' }),
    ).toBeInTheDocument()
  })
})

describe('landmarks', () => {
  it('renders exactly one Primary navigation on a wide screen', async () => {
    renderApp('/')
    await screen.findByRole('navigation', { name: 'Primary' })
    expect(screen.getAllByRole('navigation', { name: 'Primary' })).toHaveLength(1)
    expect(document.querySelectorAll('nav nav')).toHaveLength(0)
  })

  it('renders exactly one Primary navigation on a narrow screen', async () => {
    setViewport('narrow')
    renderApp('/')
    await screen.findByRole('navigation', { name: 'Primary' })

    expect(screen.getAllByRole('navigation', { name: 'Primary' })).toHaveLength(1)
    // The reserved menu is its own labelled landmark, not a second "Primary"
    // and not nested inside one.
    expect(screen.getByRole('navigation', { name: 'Later phases' })).toBeInTheDocument()
    expect(document.querySelectorAll('nav nav')).toHaveLength(0)
  })

  it('announces the reserved clause identically in the narrow menu', async () => {
    const user = userEvent.setup()
    setViewport('narrow')
    renderApp('/')
    await screen.findByRole('navigation', { name: 'Primary' })

    await user.click(screen.getByRole('button', { name: /Later/ }))
    const menu = screen.getByRole('navigation', { name: 'Later phases' })
    for (const destination of RESERVED_DESTINATIONS) {
      expect(
        within(menu).getByRole('link', { name: reservedAccessibleName(destination.label) }),
      ).toBeInTheDocument()
    }
  })
})

describe('no duplicate accessible names in the navigation', () => {
  it.each([['wide'], ['narrow']] as const)('at %s width', async (width) => {
    if (width === 'narrow') setViewport('narrow')
    renderApp('/')
    await screen.findByRole('navigation', { name: 'Primary' })

    const names = [...document.querySelectorAll('nav a')].map(
      (a) => a.getAttribute('aria-label') ?? a.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    )
    expect(new Set(names).size).toBe(names.length)
  })
})

/**
 * Six state-preview links all pointed at the same pathname and differed only by
 * `?state=`, which NavLink ignores when deciding it is active — so every one of
 * them announced `aria-current="page"` at once.
 */
describe('current-page semantics are unambiguous', () => {
  it('marks exactly one navigation destination as the current page', async () => {
    renderApp('/opportunities')
    await screen.findByRole('navigation', { name: 'Primary' })

    const current = [...document.querySelectorAll('nav a[aria-current="page"]')]
    expect(current).toHaveLength(1)
    expect(current[0]?.textContent).toContain('Opportunities')
  })

  it('marks exactly one state preview as current, and only when selected', async () => {
    const user = userEvent.setup()
    renderApp('/opportunities')
    await screen.findByRole('navigation', { name: 'Primary' })

    await user.click(screen.getByText('Preview surface states'))
    const marked = [...document.querySelectorAll('.nav__state-link[aria-current]')]
    expect(marked).toHaveLength(1)
    expect(marked[0]?.textContent).toBe('ready')
  })

  it('moves the marker when a different state is selected', async () => {
    const user = userEvent.setup()
    renderApp('/opportunities?state=degraded')
    await screen.findByRole('navigation', { name: 'Primary' })

    await user.click(screen.getByText('Preview surface states'))
    const marked = [...document.querySelectorAll('.nav__state-link[aria-current]')]
    expect(marked).toHaveLength(1)
    expect(marked[0]?.textContent).toBe('degraded')
  })
})
