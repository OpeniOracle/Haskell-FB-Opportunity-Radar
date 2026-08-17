import { describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import { renderApp } from '@/test/render'
import { opportunityFixtures } from '@/data/fixtures/opportunities'
import { SCORE_CAPS } from '@/types/domain'

describe('opportunity cards', () => {
  it('ranks by final score, highest first', async () => {
    renderApp('/opportunities')
    const cards = await screen.findAllByRole('article')
    const expected = [...opportunityFixtures]
      .sort((a, b) => b.scores.finalScore - a.scores.finalScore)
      .map((o) => o.title)
    expect(cards.map((c) => within(c).getByRole('heading', { level: 3 }).textContent)).toEqual(
      expected,
    )
  })

  it('shows stage, status, and confidence as separate indicators', async () => {
    renderApp('/opportunities')
    const cards = await screen.findAllByRole('article')
    const first = cards[0]
    expect(first).toBeDefined()
    if (!first) return
    expect(within(first).getByText('Confirmed')).toBeInTheDocument()
    expect(within(first).getByText('New')).toBeInTheDocument()
    expect(within(first).getByText('high confidence')).toBeInTheDocument()
  })

  it('labels a provisional scope classification rather than presenting it as settled', async () => {
    renderApp('/opportunities')
    expect(await screen.findByText('Provisional classification')).toBeInTheDocument()
  })

  it('states when a timing interval was inferred rather than stated', async () => {
    renderApp('/opportunities')
    expect(await screen.findByText(/Timing is inferred, not stated/)).toBeInTheDocument()
  })

  it('keeps the score explanation available behind disclosure on every card', async () => {
    renderApp('/opportunities')
    const cards = await screen.findAllByRole('article')
    for (const card of cards) {
      expect(within(card).getByText('How this score was reached')).toBeInTheDocument()
    }
  })

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
