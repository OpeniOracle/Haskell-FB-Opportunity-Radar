import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fromRoot } from '@/test/paths'

/**
 * WCAG 2.1 contrast checks against the token file itself.
 *
 * Running these in CI rather than eyeballing a screenshot means D10 can replace
 * the palette later and the check still holds. Every text/background pair used by
 * a status indicator is asserted, in BOTH themes, because a status that is
 * readable in light and mushy in dark is a status you will misread at 7am.
 *
 * Thresholds: 4.5:1 for body text, 3:1 for the large numerals and for the
 * non-text borders that carry the status boundary.
 */

const css = readFileSync(fromRoot('src/styles/tokens.css'), 'utf8')

function block(marker: string, end?: string): Record<string, string> {
  const start = css.indexOf(marker)
  if (start === -1) throw new Error(`Token block not found: ${marker}`)
  const stop = end ? css.indexOf(end, start) : css.length
  const slice = css.slice(start, stop === -1 ? css.length : stop)
  const tokens: Record<string, string> = {}
  for (const match of slice.matchAll(/(--[a-z0-9-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/g)) {
    const [, name, value] = match
    if (name && value && !(name in tokens)) tokens[name] = value
  }
  return tokens
}

const light = block(':root {', '/* Dark theme')
const dark = block(":root[data-theme='dark']")

function toRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '')
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean.slice(0, 6)
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ]
}

function luminance(hex: string): number {
  const channels = toRgb(hex).map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  const [r, g, b] = channels as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

const TEXT_PAIRS: [string, string][] = [
  ['--c-text', '--c-ground'],
  ['--c-text', '--c-surface'],
  ['--c-text', '--c-surface-sunken'],
  ['--c-text-secondary', '--c-ground'],
  ['--c-text-secondary', '--c-surface'],
  ['--c-accent', '--c-ground'],
  ['--c-accent', '--c-surface'],
  ['--c-accent', '--c-accent-soft'],
  ['--c-confirmed', '--c-confirmed-bg'],
  ['--c-developing', '--c-developing-bg'],
  ['--c-emerging', '--c-emerging-bg'],
  ['--c-attention', '--c-attention-bg'],
  ['--c-neutral-status', '--c-neutral-status-bg'],
  ['--c-illustrative', '--c-illustrative-bg'],
  ['--c-text-inverse', '--c-accent'],
]

// WCAG 1.4.11: the boundary of an interactive control needs 3:1. Divider
// borders (--c-border / --c-border-strong) are decorative separation and are
// deliberately not asserted here — they never delimit a control.
const LARGE_OR_NON_TEXT_PAIRS: [string, string][] = [
  ['--c-text-muted', '--c-ground'],
  ['--c-text-muted', '--c-surface'],
  ['--c-text-muted', '--c-surface-sunken'],
  ['--c-border-interactive', '--c-surface'],
  ['--c-border-interactive', '--c-ground'],
  ['--c-border-interactive', '--c-surface-sunken'],
]

describe.each([
  ['light', light],
  ['dark', dark],
] as const)('%s theme contrast', (themeName, tokens) => {
  it.each(TEXT_PAIRS)('%s on %s meets 4.5:1', (fg, bg) => {
    const fgValue = tokens[fg]
    const bgValue = tokens[bg]
    expect(fgValue, `${fg} missing from ${themeName}`).toBeDefined()
    expect(bgValue, `${bg} missing from ${themeName}`).toBeDefined()
    expect(ratio(fgValue as string, bgValue as string)).toBeGreaterThanOrEqual(4.5)
  })

  it.each(LARGE_OR_NON_TEXT_PAIRS)('%s on %s meets 3:1', (fg, bg) => {
    const fgValue = tokens[fg]
    const bgValue = tokens[bg]
    expect(fgValue, `${fg} missing from ${themeName}`).toBeDefined()
    expect(bgValue, `${bg} missing from ${themeName}`).toBeDefined()
    expect(ratio(fgValue as string, bgValue as string)).toBeGreaterThanOrEqual(3)
  })
})
