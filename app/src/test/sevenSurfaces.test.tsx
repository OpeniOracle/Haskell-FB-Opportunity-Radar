import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fromRoot } from '@/test/paths'
import { renderApp } from '@/test/render'
import { setViewport } from '@/test/setup'

const baseCss = readFileSync(fromRoot('src/styles/base.css'), 'utf8')

/**
 * E-A5 — responsive and accessibility validation across ALL SEVEN surfaces.
 *
 * PR 1 validated two of them. These assertions run the same contract over every
 * surface in the inventory, so a surface added later cannot quietly ship without
 * a heading, a landmark, a label on every control, or a mobile layout.
 */
const EVERY_SURFACE: [string, string][] = [
  ['/', 'Daily Pulse'],
  ['/opportunities', 'Opportunities'],
  ['/opportunities/opp-fixture-1', 'Opportunity detail'],
  ['/accounts', 'Company list'],
  ['/accounts/org-fixture-2', 'Company detail'],
  ['/facilities/fac-fixture-1', 'Facility detail'],
  ['/evidence/ev-fixture-1', 'Evidence detail'],
  ['/admin/health', 'Source Health & Coverage'],
  ['/views', 'Saved Pursuits & Watches'],
]

describe('document structure on every surface', () => {
  it.each(EVERY_SURFACE)('%s (%s) has one main landmark and one h1', async (route) => {
    renderApp(route)
    const main = await screen.findByRole('main')
    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(within(main).getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })

  it.each(EVERY_SURFACE)('%s (%s) never skips a heading level', async (route) => {
    renderApp(route)
    await screen.findByRole('main')
    const levels = [...screen.getByRole('main').querySelectorAll('h1,h2,h3,h4')].map((h) =>
      Number(h.tagName.slice(1)),
    )
    let previous = 1
    for (const level of levels) {
      expect(level).toBeLessThanOrEqual(previous + 1)
      previous = level
    }
  })

  it.each(EVERY_SURFACE)('%s (%s) marks every icon decorative', async (route) => {
    renderApp(route)
    await screen.findByRole('main')
    const svgs = screen.getByRole('main').querySelectorAll('svg')
    for (const svg of svgs) {
      expect(svg.getAttribute('aria-hidden')).toBe('true')
    }
  })

  it.each(EVERY_SURFACE)('%s (%s) gives every status pill a text label', async (route) => {
    renderApp(route)
    await screen.findByRole('main')
    for (const pill of screen.getByRole('main').querySelectorAll('.pill')) {
      expect(pill.textContent?.trim().length ?? 0).toBeGreaterThan(0)
    }
  })

  it.each(EVERY_SURFACE)('%s (%s) gives every control an accessible name', async (route) => {
    renderApp(route)
    await screen.findByRole('main')
    const main = screen.getByRole('main')
    const controls = main.querySelectorAll('button, a[href], input, select')
    for (const control of controls) {
      const name =
        control.getAttribute('aria-label') ??
        control.getAttribute('title') ??
        control.textContent?.trim() ??
        ''
      const labelled =
        name.length > 0 ||
        control.closest('label') !== null ||
        control.getAttribute('aria-labelledby') !== null
      expect(labelled, `${route}: ${control.outerHTML.slice(0, 90)}`).toBe(true)
    }
  })
})

describe('keyboard reachability on every surface', () => {
  it.each(EVERY_SURFACE)('%s (%s) starts with the skip link', async (route) => {
    const user = userEvent.setup()
    renderApp(route)
    await screen.findByRole('main')

    await user.tab()
    expect(screen.getByRole('link', { name: 'Skip to main content' })).toHaveFocus()
  })

  it.each(EVERY_SURFACE)('%s (%s) reaches its content by tabbing', async (route) => {
    const user = userEvent.setup()
    renderApp(route)
    const main = await screen.findByRole('main')

    // Walk far enough to leave the shell, then confirm focus is inside main and
    // that focus never landed on something the user cannot see a name for.
    let reached = false
    for (let i = 0; i < 60 && !reached; i += 1) {
      await user.tab()
      if (main.contains(document.activeElement)) reached = true
    }
    const interactive = main.querySelectorAll('button, a[href], input, select, summary')
    if (interactive.length > 0) expect(reached).toBe(true)
  })

  it('operates the as-at control entirely from the keyboard', async () => {
    const user = userEvent.setup()
    renderApp('/accounts/org-fixture-2?asOf=2027-07-01')
    await screen.findByRole('heading', { level: 1, name: 'Example Meals & Sauces Co.' })

    const reset = screen.getByRole('button', { name: 'Reset to today' })
    reset.focus()
    await user.keyboard('{Enter}')
    expect(
      await screen.findByText('Controlling parent as at 2026-08-17'),
    ).toBeInTheDocument()
  })

  it('reaches and opens a connector run history without a mouse', async () => {
    const user = userEvent.setup()
    renderApp('/admin/health')
    await screen.findByRole('heading', { level: 1, name: 'Source Health & Coverage' })

    const permits = screen.getByRole('article', { name: 'Regional permit index' })
    const summary = within(permits).getByText(/Run history/)
    const details = summary.closest('details') as HTMLDetailsElement
    expect(details.open).toBe(false)

    // A native <summary> is focusable, which is why the disclosure is a <details>
    // rather than a div with a click handler. jsdom does not implement the
    // Enter-to-toggle behaviour browsers give <summary>, so the toggle itself is
    // driven here and verified in the manual keyboard walkthrough.
    summary.focus()
    expect(summary).toHaveFocus()
    await user.click(summary)
    expect(details.open).toBe(true)
  })

  it('renames a saved view entirely from the keyboard', async () => {
    const user = userEvent.setup()
    renderApp('/views')
    await screen.findByRole('heading', { level: 1, name: 'Saved Pursuits & Watches' })

    const card = screen.getByText('Confirmed, Southeast').closest('li')!
    const rename = within(card).getByRole('button', { name: 'Rename' })
    rename.focus()
    await user.keyboard('{Enter}')

    // The input takes focus, and Enter commits without reaching for the mouse.
    const input = screen.getByRole('textbox', { name: /Rename/ })
    expect(input).toHaveFocus()
    await user.keyboard('{Control>}a{/Control}Southeast shortlist{Enter}')
    expect(await screen.findByText('Southeast shortlist')).toBeInTheDocument()
  })

  it('abandons a rename on Escape', async () => {
    const user = userEvent.setup()
    renderApp('/views')
    await screen.findByRole('heading', { level: 1, name: 'Saved Pursuits & Watches' })

    const card = screen.getByText('Confirmed, Southeast').closest('li')!
    await user.click(within(card).getByRole('button', { name: 'Rename' }))
    await user.keyboard('{Escape}')

    expect(await screen.findByText('Confirmed, Southeast')).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: /Rename/ })).toBeNull()
  })
})

describe('narrow viewport on every surface', () => {
  it.each(EVERY_SURFACE)('%s (%s) renders with the bottom navigation', async (route) => {
    setViewport('narrow')
    renderApp(route)

    const nav = await screen.findByRole('navigation', { name: 'Primary' })
    expect(nav).toHaveClass('bottom-nav')
    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(
      within(screen.getByRole('main')).getAllByRole('heading', { level: 1 }),
    ).toHaveLength(1)
  })
})

/**
 * The stylesheet has to actually contain the narrow-screen rules; a test that
 * only renders in jsdom cannot see a media query.
 */
describe('responsive stylesheet contract', () => {
  it('reflows every multi-column layout added in this milestone', () => {
    const narrow = baseCss.slice(baseCss.indexOf('@media (max-width: 900px)'))
    for (const selector of [
      '.company-row',
      '.saved-card',
      '.ownership__row',
      '.connector-list',
      '.run',
    ]) {
      expect(narrow, selector).toContain(selector)
    }
  })

  it('never lets a fixed grid column survive into the narrow layout', () => {
    const narrow = baseCss.slice(baseCss.indexOf('@media (max-width: 900px)'))
    // The ownership row's four-column grid is the one that would overflow.
    expect(narrow).toMatch(/\.ownership__row\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/)
  })

  it('keeps wide content inside its own scroll container rather than the page', () => {
    expect(baseCss).toMatch(/word-break:\s*break-all/)
  })

  /**
   * Both of these were real 320px overflows found by driving the built page in a
   * browser: a `1fr` grid column sized by its content, and a status pill that
   * would not wrap away from its heading.
   */
  it('caps the text column of an attention row so it cannot size the grid', () => {
    const narrow = baseCss.slice(baseCss.indexOf('@media (max-width: 900px)'))
    expect(narrow).toMatch(/\.attention\s*\{[^}]*grid-template-columns:\s*auto minmax\(0, 1fr\)/)
    expect(narrow).toMatch(/\.attention__body\s*\{[^}]*min-width:\s*0/)
  })

  it('lets a connector name and its state pill wrap onto separate lines', () => {
    expect(baseCss).toMatch(/\.connector__head\s*\{[^}]*flex-wrap:\s*wrap/)
    expect(baseCss).toMatch(/\.connector__name\s*\{[^}]*min-width:\s*0/)
  })
})

/**
 * An id is an address, not a name.
 *
 * Rendering `fac-fixture-3` where a plant belongs asks a business-development
 * user to memorise the key space, which is the opposite of what a related-records
 * list is for. No fixture identifier may appear as visible link text on any
 * surface.
 */
describe('records are named, not addressed', () => {
  const RECORD_SURFACES = [
    '/accounts/org-fixture-1',
    '/accounts/org-fixture-2',
    '/facilities/fac-fixture-1',
    '/facilities/fac-fixture-3',
    '/evidence/ev-fixture-1',
    '/evidence/ev-fixture-4',
    '/views',
  ]

  it.each(RECORD_SURFACES)('shows no raw fixture identifier at %s', async (route) => {
    renderApp(route)
    await screen.findByRole('main')
    const text = screen.getByRole('main').textContent ?? ''
    expect(text).not.toMatch(/\b(org|fac|ev|opp|claim)-fixture-\d/)
  })

  it('keeps the identifier available as the address and the title', async () => {
    renderApp('/accounts/org-fixture-1')
    await screen.findByRole('heading', { level: 1, name: 'Example Beverage Company' })

    const link = screen.getByRole('link', {
      name: /Example Beverage Southeast Plant\s+Macon, GA · Operating/,
    })
    expect(link).toHaveAttribute('href', '/facilities/fac-fixture-1')
    expect(link).toHaveAttribute('title', 'fac-fixture-1')
  })

  it('gives every related record a line of context, not just a name', async () => {
    renderApp('/facilities/fac-fixture-1')
    await screen.findByRole('heading', { level: 1, name: 'Example Beverage Southeast Plant' })

    for (const link of screen.getByRole('main').querySelectorAll('.record-link')) {
      expect(link.querySelector('.record-link__label')?.textContent).toBeTruthy()
      expect(link.querySelector('.record-link__detail')?.textContent).toBeTruthy()
    }
  })
})
