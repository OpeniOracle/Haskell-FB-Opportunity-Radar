import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { screen, within } from '@testing-library/react'
import { fromRoot } from '@/test/paths'
import { renderApp } from '@/test/render'
import { setViewport } from '@/test/setup'

const baseCss = readFileSync(fromRoot('src/styles/base.css'), 'utf8')

/**
 * The regression tests for B2.
 *
 * `.state__checked` is `white-space: nowrap` and about 180px wide. In a
 * non-wrapping flex row it held that width and squeezed the message to ~74px at
 * 320px — sixteen lines of two words each, in the one state where reading the
 * message matters most. It affected every surface, because the notice is shared.
 *
 * jsdom has no layout engine, so the geometry is asserted as a stylesheet
 * contract; the measured widths are verified against the real build separately.
 */
describe('shared notice layout', () => {
  it('lets the notice row wrap so the timestamp can drop below the message', () => {
    const rule = baseCss.slice(baseCss.indexOf('.notice {'), baseCss.indexOf('.notice--'))
    expect(rule).toMatch(/flex-wrap:\s*wrap/)
  })

  it('gives the message a minimum column so the timestamp cannot starve it', () => {
    expect(baseCss).toMatch(
      /\.notice > div,\s*\n\.notice > span \{[^}]*flex:\s*1 1 22ch/,
    )
    expect(baseCss).toMatch(/\.notice > div,\s*\n\.notice > span \{[^}]*min-width:\s*0/)
  })

  it('keeps the timestamp at its natural size instead of letting it shrink', () => {
    const rule = baseCss.slice(baseCss.indexOf('.notice .state__checked'))
    expect(rule.slice(0, 120)).toMatch(/flex:\s*0 0 auto/)
  })

  it('does not solve the squeeze by shrinking the text', () => {
    // The fix must not reach for a smaller font. --fs-small stays the notice size.
    const rule = baseCss.slice(baseCss.indexOf('.notice {'), baseCss.indexOf('.notice--'))
    expect(rule).toMatch(/font-size:\s*var\(--fs-small\)/)
    expect(rule).not.toMatch(/font-size:\s*var\(--fs-label\)/)
  })
})

/**
 * The notice is shared, so the content contract is asserted on every surface
 * rather than on one. Both halves must survive: hiding the timestamp to make
 * room would also have "fixed" the width.
 */
const SURFACES_WITH_NOTICE = [
  '/',
  '/opportunities',
  '/opportunities/opp-fixture-1',
  '/accounts',
  '/accounts/org-fixture-1',
  '/facilities/fac-fixture-1',
  '/evidence/ev-fixture-1',
  '/admin/health',
  '/views',
]

describe('degraded notice keeps both message and timestamp', () => {
  it.each(SURFACES_WITH_NOTICE)('on %s at desktop width', async (route) => {
    renderApp(`${route}?state=degraded`)
    const notice = await screen.findByText(/Partial coverage/)
    const row = notice.closest('.notice') as HTMLElement
    expect(row).not.toBeNull()
    expect(within(row).getByText(/Last checked/)).toBeInTheDocument()
    expect(row.textContent?.length ?? 0).toBeGreaterThan(60)
  })

  it.each(SURFACES_WITH_NOTICE)('on %s at narrow width', async (route) => {
    setViewport('narrow')
    renderApp(`${route}?state=degraded`)
    const notice = await screen.findByText(/Partial coverage/)
    const row = notice.closest('.notice') as HTMLElement
    // Nothing is dropped on small screens — the timestamp moves, it does not hide.
    expect(within(row).getByText(/Last checked/)).toBeInTheDocument()
    expect(row.querySelector('.state__checked')).not.toBeNull()
  })
})

describe('stale notice shares the same layout', () => {
  it('keeps its message and timestamp too', async () => {
    renderApp('/accounts?state=stale')
    const notice = await screen.findByText(/Showing data from/)
    const row = notice.closest('.notice') as HTMLElement
    expect(within(row).getByText(/Last checked/)).toBeInTheDocument()
  })
})
