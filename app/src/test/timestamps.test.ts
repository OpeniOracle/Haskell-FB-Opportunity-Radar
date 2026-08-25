import { describe, expect, it } from 'vitest'
import {
  FIXTURE_NOW,
  INVALID_INSTANT,
  absoluteDate,
  absoluteDateTime,
  isFutureInstant,
  relativeTime,
} from '@/lib/format'
import { companyFixtures } from '@/data/fixtures/companies'
import { evidenceFixtures } from '@/data/fixtures/evidence'
import { facilityFixtures } from '@/data/fixtures/facilities'
import { sourceHealthFixture } from '@/data/fixtures/health'
import { savedWorkspaceFixture } from '@/data/fixtures/views'

const NOW = new Date('2026-08-17T08:00:00Z')
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs).toISOString()

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * The regression tests for B1.
 *
 * A timestamp ten months in the future rendered as "just now", because the gap
 * was computed as `now - then` and anything under a minute fell into the
 * present tense. Direction was silently discarded. These tests exist so it
 * cannot be discarded again.
 */
describe('relativeTime — direction is never dropped', () => {
  it('renders past instants as "X ago"', () => {
    expect(relativeTime(at(-2 * HOUR), NOW)).toBe('2 hr ago')
    expect(relativeTime(at(-23 * HOUR), NOW)).toBe('23 hr ago')
    expect(relativeTime(at(-3 * DAY), NOW)).toBe('3 days ago')
    expect(relativeTime(at(-7 * DAY), NOW)).toBe('1 week ago')
  })

  it('renders future instants as "in X"', () => {
    expect(relativeTime(at(2 * HOUR), NOW)).toBe('in 2 hr')
    expect(relativeTime(at(23 * HOUR), NOW)).toBe('in 23 hr')
    expect(relativeTime(at(3 * DAY), NOW)).toBe('in 3 days')
    expect(relativeTime(at(7 * DAY), NOW)).toBe('in 1 week')
    expect(relativeTime(at(5 * MINUTE), NOW)).toBe('in 5 min')
  })

  it('never renders a future instant in the present tense', () => {
    // The exact defect: +10 months once produced "just now".
    const tenMonths = relativeTime('2027-06-30T00:00:00Z', NOW)
    expect(tenMonths).not.toBe('just now')
    expect(tenMonths).not.toMatch(/ago/)
  })

  it('distinguishes a sub-minute future value from now and from the past', () => {
    expect(relativeTime(at(0), NOW)).toBe('just now')
    expect(relativeTime(at(-10 * SECOND), NOW)).toBe('just now')
    expect(relativeTime(at(10 * SECOND), NOW)).toBe('in under a minute')
    expect(relativeTime(at(SECOND), NOW)).toBe('in under a minute')
    // One second of clock skew must not read as the present.
    expect(relativeTime(at(SECOND), NOW)).not.toBe('just now')
  })

  it('survives clock skew in both directions', () => {
    // A collector whose clock is 20s behind sees "now" as slightly ahead of it.
    const behind = new Date(NOW.getTime() - 20 * SECOND)
    expect(relativeTime(NOW.toISOString(), behind)).toBe('in under a minute')
    // 20s ahead reads as the present, not as the past.
    const ahead = new Date(NOW.getTime() + 20 * SECOND)
    expect(relativeTime(NOW.toISOString(), ahead)).toBe('just now')
    // Larger skew keeps its direction and rounds normally.
    const wayBehind = new Date(NOW.getTime() - 45 * SECOND)
    expect(relativeTime(NOW.toISOString(), wayBehind)).toBe('in 1 min')
  })

  it('falls back to an absolute date beyond the useful relative range, both ways', () => {
    expect(relativeTime(at(-200 * DAY), NOW)).toMatch(/^\d{1,2} \w+ \d{4}$/)
    expect(relativeTime(at(200 * DAY), NOW)).toMatch(/^\d{1,2} \w+ \d{4}$/)
  })

  it('returns an honest fallback for an unreadable value rather than a relative time', () => {
    for (const bad of ['', 'not-a-date', 'null', '2026-13-45T99:99:99Z']) {
      expect(relativeTime(bad, NOW)).toBe(INVALID_INSTANT)
      expect(absoluteDate(bad)).toBe(INVALID_INSTANT)
      expect(absoluteDateTime(bad)).toBe(INVALID_INSTANT)
      // Never echo a malformed payload back as though it were a date.
      expect(relativeTime(bad, NOW)).not.toBe(bad)
    }
  })
})

describe('isFutureInstant', () => {
  it('is true only strictly after now', () => {
    expect(isFutureInstant(at(SECOND), NOW)).toBe(true)
    expect(isFutureInstant(at(0), NOW)).toBe(false)
    expect(isFutureInstant(at(-SECOND), NOW)).toBe(false)
  })

  it('treats an unreadable value as not-future rather than guessing', () => {
    expect(isFutureInstant('not-a-date', NOW)).toBe(false)
  })
})

/**
 * Fixture integrity.
 *
 * Every field below records something that has ALREADY happened, so a value
 * later than `FIXTURE_NOW` is a fault by definition. Planned, projected and
 * scheduled values live in `TemporalValue` horizons and are deliberately not
 * covered here — those are allowed to be in the future.
 */
describe('fixture integrity against FIXTURE_NOW', () => {
  const completed: [string, string][] = []
  for (const c of companyFixtures) {
    completed.push([`company ${c.id} latestActivityAt`, c.latestActivityAt])
    completed.push([`company ${c.id} coverage.lastCheckedAt`, c.coverage.lastCheckedAt])
  }
  for (const e of evidenceFixtures) {
    completed.push([`evidence ${e.id} retrievedAt`, e.retrievedAt])
    e.corrections.forEach((k, i) =>
      completed.push([`evidence ${e.id} correction[${i}].occurredAt`, k.occurredAt]),
    )
  }
  completed.push(['health lastCycleCompletedAt', sourceHealthFixture.lastCycleCompletedAt])
  for (const c of sourceHealthFixture.connectors) {
    completed.push([`connector ${c.id} lastRunAt`, c.lastRunAt])
    if (c.lastSuccessfulCollectionAt)
      completed.push([`connector ${c.id} lastSuccessfulCollectionAt`, c.lastSuccessfulCollectionAt])
    if (c.maintenance)
      completed.push([`connector ${c.id} maintenance.openedAt`, c.maintenance.openedAt])
    c.runHistory.forEach((r) =>
      completed.push([`connector ${c.id} run ${r.id} startedAt`, r.startedAt]),
    )
  }
  for (const r of sourceHealthFixture.coverage) {
    completed.push([`coverage ${r.companyId} lastCheckedAt`, r.coverage.lastCheckedAt])
  }
  for (const v of savedWorkspaceFixture.views) completed.push([`view ${v.id} createdAt`, v.createdAt])
  for (const w of savedWorkspaceFixture.watches) completed.push([`watch ${w.id} addedAt`, w.addedAt])

  it('covers a meaningful number of instants', () => {
    expect(completed.length).toBeGreaterThan(40)
  })

  it.each(completed)('%s is readable and not in the future', (_label, iso) => {
    const t = new Date(iso)
    expect(Number.isNaN(t.getTime())).toBe(false)
    expect(t.getTime()).toBeLessThanOrEqual(FIXTURE_NOW.getTime())
  })

  /**
   * Timeline entries describing something that HAS happened. A horizon on an
   * opportunity may be in the future; "Operational separation completed" may not.
   */
  it('dates every completed timeline event in the past', () => {
    const entries = [
      ...companyFixtures.flatMap((c) => c.timeline),
      ...facilityFixtures.flatMap((f) => f.timeline),
    ].filter((e) => e.kind === 'ownership' || e.kind === 'operational')

    expect(entries.length).toBeGreaterThan(0)
    for (const entry of entries) {
      const start = entry.occurredOn.start
      expect(start, entry.title).toBeTruthy()
      expect(new Date(start as string).getTime(), entry.title).toBeLessThanOrEqual(
        FIXTURE_NOW.getTime(),
      )
    }
  })

  it('still allows a planned event to be in the future', () => {
    // The point of the guard is direction-awareness, not banning future dates.
    const planned = evidenceFixtures
      .map((e) => e.subjectTiming)
      .filter((t): t is NonNullable<typeof t> => t !== null)
      .filter((t) => t.start !== null && new Date(t.start).getTime() > FIXTURE_NOW.getTime())
    expect(planned.length).toBeGreaterThan(0)
  })
})
