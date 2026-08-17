import { describe, expect, it } from 'vitest'
import { formatTemporal, precisionLabel, relativeTime } from '@/lib/format'
import type { TemporalValue } from '@/types/domain'

function temporal(partial: Partial<TemporalValue>): TemporalValue {
  return {
    rawExpression: null,
    start: null,
    end: null,
    precision: 'unknown',
    basis: 'unknown',
    inferenceNote: null,
    ...partial,
  }
}

/**
 * These are the regression tests for D15 / ADR 0004.
 *
 * The `season` precision exists because "by spring 2029" was once stored as
 * 2029-03-31 and then displayed as a hard date. The first test below is the one
 * that would have caught it.
 */
describe('temporal formatting', () => {
  it('never renders a season as a specific day', () => {
    const value = temporal({
      rawExpression: 'expected to be fully operational by spring 2029',
      start: '2029-03-01',
      end: '2029-05-31',
      precision: 'season',
      basis: 'stated',
    })
    const rendered = formatTemporal(value)
    expect(rendered).toBe('expected to be fully operational by spring 2029')
    expect(rendered).not.toMatch(/31|March 2029\b.*\d{1,2}/)
  })

  it('falls back to the season name when no raw expression was captured', () => {
    expect(
      formatTemporal(temporal({ start: '2029-03-01', precision: 'season', basis: 'stated' })),
    ).toBe('Spring 2029')
  })

  it('renders each precision at its own granularity', () => {
    expect(
      formatTemporal(temporal({ start: '2027-03-14', precision: 'exact_day' })),
    ).toBe('14 March 2027')
    expect(formatTemporal(temporal({ start: '2027-04-01', precision: 'quarter' }))).toBe(
      'Q2 2027',
    )
    expect(formatTemporal(temporal({ start: '2027-07-01', precision: 'half_year' }))).toBe(
      'Second half of 2027',
    )
    expect(formatTemporal(temporal({ start: '2028-01-01', precision: 'year' }))).toBe('2028')
  })

  it('says so plainly when no date was recorded', () => {
    expect(formatTemporal(temporal({ precision: 'unknown' }))).toBe('No date given')
  })

  it('marks an inferred basis in the precision label', () => {
    expect(
      precisionLabel(temporal({ start: '2028-01-01', precision: 'year', basis: 'inferred' })),
    ).toBe('year precision, inferred')
    expect(
      precisionLabel(temporal({ start: '2028-01-01', precision: 'year', basis: 'stated' })),
    ).toBe('year precision')
  })
})

describe('relative time', () => {
  const now = new Date('2026-08-17T08:00:00Z')

  it('is deterministic against the fixture reference instant', () => {
    expect(relativeTime('2026-08-17T06:15:00Z', now)).toBe('2 hr ago')
    expect(relativeTime('2026-08-16T09:12:00Z', now)).toBe('23 hr ago')
    expect(relativeTime('2026-08-14T17:02:00Z', now)).toBe('3 days ago')
    expect(relativeTime('2026-08-09T11:20:00Z', now)).toBe('1 week ago')
  })
})
