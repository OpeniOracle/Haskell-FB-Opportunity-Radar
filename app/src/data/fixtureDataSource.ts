import type {
  DataSource,
} from '@/data/DataSource'
import type {
  Opportunity,
  PulseSnapshot,
  SurfaceState,
} from '@/types/domain'
import { fixtureMeta } from '@/data/fixtures/meta'
import { opportunityFixtures } from '@/data/fixtures/opportunities'
import { pulseFixture } from '@/data/fixtures/pulse'

/**
 * The fixture-backed DataSource. This is the ONLY implementation in PR 1.
 *
 * It makes no network call of any kind — there is no `fetch` in this file and
 * ESLint's `no-restricted-globals` would fail CI if one appeared. The async
 * signature exists because PR 9's API implementation will need it, not because
 * anything here is remote.
 *
 * ## Scenarios
 *
 * The five non-happy surface states are not hypothetical: they are selectable so
 * a stakeholder can actually look at them during review. Append `?state=<name>`
 * to any route — `loading`, `empty`, `degraded`, `stale`, `unavailable` — and the
 * source returns that envelope instead of `ready`. With no parameter the
 * behaviour is `ready`, which is what the default preview shows.
 */
export type FixtureScenario =
  | 'ready'
  | 'loading'
  | 'empty'
  | 'degraded'
  | 'stale'
  | 'unavailable'

const SCENARIOS: readonly FixtureScenario[] = [
  'ready',
  'loading',
  'empty',
  'degraded',
  'stale',
  'unavailable',
]

export function isFixtureScenario(value: string | null): value is FixtureScenario {
  return value !== null && (SCENARIOS as readonly string[]).includes(value)
}

export function parseScenario(search: string): FixtureScenario {
  const raw = new URLSearchParams(search).get('state')
  return isFixtureScenario(raw) ? raw : 'ready'
}

/**
 * Envelope construction is shared so Pulse and Opportunities cannot drift into
 * describing the same condition two different ways.
 */
function envelope<T>(
  scenario: FixtureScenario,
  data: T,
  copy: {
    empty: string
    unavailable: { reason: string; blockedBy: string }
    degraded: { notice: string; affected: string[] }
    stale: { notice: string; asOf: string }
  },
): SurfaceState<T> {
  // Every state carries the time of the last check, including the ones that
  // have no data to show.
  const checkedAt = CHECKED_AT

  switch (scenario) {
    case 'loading':
      return { kind: 'loading', checkedAt }
    case 'empty':
      return { kind: 'empty', reason: copy.empty, checkedAt }
    case 'unavailable':
      return {
        kind: 'unavailable',
        reason: copy.unavailable.reason,
        blockedBy: copy.unavailable.blockedBy,
        checkedAt,
      }
    case 'degraded':
      return {
        kind: 'degraded',
        data,
        notice: copy.degraded.notice,
        affected: copy.degraded.affected,
        checkedAt,
      }
    case 'stale':
      return {
        kind: 'stale',
        data,
        notice: copy.stale.notice,
        asOf: copy.stale.asOf,
        checkedAt,
      }
    case 'ready':
      return { kind: 'ready', data, checkedAt }
  }
}

/** When the platform last attempted a collection cycle. */
const CHECKED_AT = '2026-08-17T06:15:00Z'

export function createFixtureDataSource(
  scenario: FixtureScenario = 'ready',
): DataSource {
  return {
    meta: fixtureMeta,

    async getPulse(): Promise<SurfaceState<PulseSnapshot>> {
      // State copy answers four questions in order: what happened, do you need
      // to act, what happens next, and when this was last checked (`checkedAt`,
      // added by `envelope`). Technical causes go in `blockedBy`, never in the
      // headline.
      return envelope<PulseSnapshot>(scenario, pulseFixture, {
        empty: 'No material changes have been identified since your last visit.',
        unavailable: {
          reason:
            'The last collection cycle did not finish, so today’s changes have not been assembled. Nothing is required from you — the next cycle will retry automatically.',
          blockedBy: 'Collection cycle did not complete',
        },
        degraded: {
          notice:
            'One source has failed twice, so a few accounts may be missing changes. What is shown is accurate but incomplete.',
          affected: ['Example Confectionery Group', 'Regional permit index'],
        },
        stale: {
          notice:
            'No cycle has completed for over a day, so this is the last good snapshot rather than current state.',
          asOf: '2026-08-15T06:15:00Z',
        },
      })
    },

    async getOpportunities(): Promise<SurfaceState<Opportunity[]>> {
      return envelope<Opportunity[]>(scenario, opportunityFixtures, {
        empty: 'There are no open opportunities to review.',
        unavailable: {
          reason:
            'Opportunities have not been ranked yet, so the list cannot be shown. Nothing is required from you — ranking is queued and will run automatically.',
          blockedBy: 'Scoring run pending',
        },
        degraded: {
          notice:
            'Two opportunities were ranked before their newest evidence arrived, so their position may change.',
          affected: ['Example Snack Foods, Inc.', 'Example Cold Chain Partners'],
        },
        stale: {
          notice:
            'These rankings are from the last completed run. Newer evidence has arrived but has not been scored yet.',
          asOf: '2026-08-15T06:15:00Z',
        },
      })
    },
  }
}

/** The default instance used by the application. */
export const fixtureDataSource = createFixtureDataSource()
