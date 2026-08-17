import { describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderApp } from '@/test/render'
import { opportunityFixtures } from '@/data/fixtures/opportunities'
import { SCORE_CAPS } from '@/types/domain'

async function cards() {
  return screen.findAllByRole('article')
}

describe('compact card', () => {
  it('ranks by final score, highest first', async () => {
    renderApp('/opportunities')
    const expected = [...opportunityFixtures]
      .sort((a, b) => b.scores.finalScore - a.scores.finalScore)
      .map((o) => o.title)
    expect(
      (await cards()).map((c) => within(c).getByRole('heading', { level: 3 }).textContent),
    ).toEqual(expected)
  })

  it('shows the decision-critical attributes on the card', async () => {
    renderApp('/opportunities')
    const first = (await cards())[0]
    expect(first).toBeDefined()
    if (!first) return

    // Account, priority + band, stage, status, confidence, timing, capability,
    // evidence count and newest evidence date — all without opening anything.
    expect(within(first).getByText('Example Beverage Company')).toBeInTheDocument()
    expect(within(first).getByText('92')).toBeInTheDocument()
    expect(within(first).getByText('Critical')).toBeInTheDocument()
    expect(within(first).getByText('Confirmed')).toBeInTheDocument()
    expect(within(first).getByText('New')).toBeInTheDocument()
    expect(within(first).getByText('high confidence')).toBeInTheDocument()
    expect(within(first).getByText(/Macon, GA/)).toBeInTheDocument()
    expect(within(first).getByText(/construction begins 14 March 2027/)).toBeInTheDocument()
    expect(within(first).getByText(/Process systems/)).toBeInTheDocument()
    expect(within(first).getByText(/6 evidence · newest/)).toBeInTheDocument()
  })

  it('names the unresolved-location state rather than leaving it blank', async () => {
    renderApp('/opportunities')
    const unresolved = (await cards()).filter((c) =>
      within(c).queryByText('Location not resolved'),
    )
    expect(unresolved).toHaveLength(2)
  })

  it('keeps the detail off the card', async () => {
    renderApp('/opportunities')
    await cards()
    // Score breakdown, confidence axes and publisher counts belong in the drawer.
    expect(screen.queryByText('How this score was reached')).toBeNull()
    expect(screen.queryByText('Evidence strength')).toBeNull()
    expect(screen.queryByText(/independent publishers/)).toBeNull()
    expect(screen.queryByText(/Timing is inferred, not stated/)).toBeNull()
  })

  it('offers a working review action, not a disabled one', async () => {
    renderApp('/opportunities')
    const first = (await cards())[0]
    expect(first).toBeDefined()
    if (!first) return
    const review = within(first).getByRole('button', { name: /^Review opportunity/ })
    expect(review).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Open account' })).toBeNull()
  })
})

describe('detail drawer', () => {
  it('opens with the full assessment and closes again', async () => {
    const user = userEvent.setup()
    renderApp('/opportunities')
    const first = (await cards())[0]
    expect(first).toBeDefined()
    if (!first) return

    await user.click(within(first).getByRole('button', { name: /^Review opportunity/ }))
    const dialog = await screen.findByRole('dialog')

    expect(within(dialog).getByText('Assessment')).toBeInTheDocument()
    expect(within(dialog).getByText('Confidence')).toBeInTheDocument()
    expect(within(dialog).getByText('Evidence strength')).toBeInTheDocument()
    expect(within(dialog).getByText('Assessment type')).toBeInTheDocument()
    expect(within(dialog).getByText('Confidence level')).toBeInTheDocument()
    expect(within(dialog).getByText('How this score was reached')).toBeInTheDocument()
    expect(within(dialog).getByText('Independent publishers')).toBeInTheDocument()
    expect(within(dialog).getByText('Capability match')).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closes on Escape and returns focus to the trigger', async () => {
    const user = userEvent.setup()
    renderApp('/opportunities')
    const first = (await cards())[0]
    expect(first).toBeDefined()
    if (!first) return

    const trigger = within(first).getByRole('button', { name: /^Review opportunity/ })
    await user.click(trigger)
    await screen.findByRole('dialog')

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(trigger).toHaveFocus()
  })

  it('explains operator attribution only where an operator exists', async () => {
    const user = userEvent.setup()
    renderApp('/opportunities')
    await cards()

    const withOperator = screen.getByRole('button', {
      name: /Water withdrawal application/,
    })
    await user.click(withOperator)
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Ownership and operator')).toBeInTheDocument()
    await user.keyboard('{Escape}')

    await user.click(screen.getByRole('button', { name: /Aseptic filling line/ }))
    const second = await screen.findByRole('dialog')
    expect(within(second).queryByText('Ownership and operator')).toBeNull()
  })

  it('shows the timing caveat and provisional classification in the drawer', async () => {
    const user = userEvent.setup()
    renderApp('/opportunities')
    await cards()

    await user.click(screen.getByRole('button', { name: /cold-storage expansion/ }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Timing caveat')).toBeInTheDocument()
    expect(within(dialog).getByText(/Reference-only evidence caps strength/)).toBeInTheDocument()
    await user.keyboard('{Escape}')

    await user.click(screen.getByRole('button', { name: /Innovation centre/ }))
    const second = await screen.findByRole('dialog')
    expect(within(second).getByText('Account classification')).toBeInTheDocument()
  })
})

describe('fixture integrity', () => {
  it('never renders a component score above its published cap', () => {
    for (const opportunity of opportunityFixtures) {
      for (const [key, cap] of Object.entries(SCORE_CAPS)) {
        const value = opportunity.scores[key as keyof typeof SCORE_CAPS]
        expect(value).toBeGreaterThanOrEqual(0)
        expect(value).toBeLessThanOrEqual(cap)
      }
    }
  })

  it('respects the confidence guardrails in every fixture', () => {
    for (const { confidence } of opportunityFixtures) {
      if (confidence.assessmentType === 'inference') {
        expect(confidence.confidenceLevel).not.toBe('high')
      }
      if (confidence.assessmentType === 'hypothesis') {
        expect(confidence.confidenceLevel).toBe('low')
      }
      if (confidence.evidenceStrength === 'indicative') {
        expect(confidence.confidenceLevel).not.toBe('high')
      }
    }
  })

  it('uses only fictional organizations', () => {
    for (const { organization } of opportunityFixtures) {
      expect(organization.canonicalName).toMatch(/^Example /)
    }
  })
})
