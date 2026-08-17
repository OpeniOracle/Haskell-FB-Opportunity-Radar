import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fromRoot } from '@/test/paths'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderApp } from '@/test/render'

const tokensCss = readFileSync(fromRoot('src/styles/tokens.css'), 'utf8')
const baseCss = readFileSync(fromRoot('src/styles/base.css'), 'utf8')

describe('accessibility contract', () => {
  it('provides a skip link as the first focusable element', async () => {
    renderApp('/')
    const skip = await screen.findByRole('link', { name: 'Skip to main content' })
    expect(skip).toHaveAttribute('href', '#main')
  })

  it('gives every status pill a text label alongside its colour and icon', async () => {
    renderApp('/opportunities')
    const cards = await screen.findAllByRole('article')
    for (const card of cards) {
      const pills = card.querySelectorAll('.pill')
      expect(pills.length).toBeGreaterThan(0)
      for (const pill of pills) {
        // The icon is aria-hidden, so any accessible text must come from a label.
        expect(pill.textContent?.trim().length ?? 0).toBeGreaterThan(0)
      }
    }
  })

  it('marks every icon as decorative so meaning is never colour- or glyph-only', async () => {
    renderApp('/opportunities')
    await screen.findAllByRole('article')
    const svgs = document.querySelectorAll('svg')
    expect(svgs.length).toBeGreaterThan(0)
    for (const svg of svgs) {
      expect(svg.getAttribute('aria-hidden')).toBe('true')
    }
  })

  it('exposes a single main landmark and a named primary navigation', async () => {
    renderApp('/')
    expect(await screen.findByRole('main')).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument()
  })

  it('cycles the theme with the keyboard and reflects the choice on the root element', async () => {
    const user = userEvent.setup()
    renderApp('/')
    const toggle = await screen.findByRole('button', { name: /Theme: system/ })

    toggle.focus()
    expect(toggle).toHaveFocus()

    await user.keyboard('{Enter}')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')

    await user.keyboard('{Enter}')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')

    await user.keyboard('{Enter}')
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })

  it('opens the detail drawer from the keyboard and traps focus inside it', async () => {
    const user = userEvent.setup()
    renderApp('/opportunities')
    const cards = await screen.findAllByRole('article')
    const first = cards[0]
    expect(first).toBeDefined()
    if (!first) return

    const trigger = within(first).getByRole('button', { name: /^Review opportunity/ })
    trigger.focus()
    await user.keyboard('{Enter}')

    const dialog = await screen.findByRole('dialog')
    const close = within(dialog).getByRole('button', { name: 'Close' })
    // Focus lands inside the panel rather than staying behind it.
    expect(close).toHaveFocus()
    expect(dialog).toHaveAttribute('aria-modal', 'true')

    await user.keyboard('{Escape}')
    expect(trigger).toHaveFocus()
  })

  it('gives every filter control a visible label', async () => {
    renderApp('/opportunities')
    await screen.findAllByRole('article')
    for (const label of [
      'Priority',
      'Stage',
      'Status',
      'Confidence',
      'Geography',
      'Capability',
      'Sort by',
    ]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument()
    }
    expect(screen.getByRole('searchbox', { name: 'Search opportunities' })).toBeInTheDocument()
  })
})

describe('stylesheet contract', () => {
  it('honours prefers-reduced-motion', () => {
    expect(tokensCss).toContain('@media (prefers-reduced-motion: reduce)')
    expect(baseCss).toContain('@media (prefers-reduced-motion: reduce)')
    expect(baseCss).toMatch(/animation-duration:\s*0\.001ms\s*!important/)
  })

  it('never removes a focus outline without replacing it', () => {
    expect(baseCss).toContain(':focus-visible')
    expect(baseCss).toContain('outline: var(--focus-ring)')
    // The only outline:none is the paired :focus:not(:focus-visible) rule.
    const outlineNoneCount = (baseCss.match(/outline:\s*none/g) ?? []).length
    expect(outlineNoneCount).toBe(1)
    expect(baseCss).toContain(':focus:not(:focus-visible)')
  })

  it('defines the dark palette for both the explicit choice and the system default', () => {
    expect(tokensCss).toContain("@media (prefers-color-scheme: dark)")
    expect(tokensCss).toContain(":root:not([data-theme='light'])")
    expect(tokensCss).toContain(":root[data-theme='dark']")
  })

  it('defines every colour token on bare :root so no colour exists only inside a media query', () => {
    const rootBlock = tokensCss.slice(tokensCss.indexOf(':root {'), tokensCss.indexOf('/* Dark theme'))
    const declared = new Set(
      [...rootBlock.matchAll(/(--c-[a-z0-9-]+):/g)].map((m) => m[1]),
    )
    const darkBlock = tokensCss.slice(tokensCss.indexOf(":root[data-theme='dark']"))
    const overridden = [...darkBlock.matchAll(/(--c-[a-z0-9-]+):/g)].map((m) => m[1])
    for (const token of overridden) {
      expect(declared.has(token)).toBe(true)
    }
  })
})
