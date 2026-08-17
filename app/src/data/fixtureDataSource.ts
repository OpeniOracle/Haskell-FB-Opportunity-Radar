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
  switch (scenario) {
    case 'loading':
      return { kind: 'loading' }
    case 'empty':
      return { kind: 'empty', reason: copy.empty }
    case 'unavailable':
      return {
        kind: 'unavailable',
        reason: copy.unavailable.reason,
        blockedBy: copy.unavailable.blockedBy,
      }
    case 'degraded':
      return {
        kind: 'degraded',
        data,
        notice: copy.degraded.notice,
        affected: copy.degraded.affected,
      }
    case 'stale':
      return { kind: 'stale', data, notice: copy.stale.notice, asOf: copy.stale.asOf }
    case 'ready':
      return { kind: 'ready', data }
  }
}

export function createFixtureDataSource(
  scenario: FixtureScenario = 'ready',
): DataSource {
  return {
    meta: fixtureMeta,

    async getPulse(): Promise<SurfaceState<PulseSnapshot>> {
      return envelope<PulseSnapshot>(scenario, pulseFixture, {
        empty:
          'Nothing has changed across the monitored accounts since your last visit. This is a real answer, not a failure — the surface says so rather than showing an empty list.',
        unavailable: {
          reason:
            'The daily pulse cannot be assembled because the most recent collection cycle did not complete.',
          blockedBy: 'Collection cycle incomplete',
        },
        degraded: {
          notice:
            'One source failed its last two runs, so coverage for the accounts below is incomplete. What is shown is accurate; it is not complete.',
          affected: ['Example Confectionery Group', 'Regional permit index'],
        },
        stale: {
          notice:
            'No collection cycle has completed in the last 26 hours. You are looking at the last good snapshot, not current state.',
          asOf: '2026-08-15T06:15:00Z',
        },
      })
    },

    async getOpportunities(): Promise<SurfaceState<Opportunity[]>> {
      return envelope<Opportunity[]>(scenario, opportunityFixtures, {
        empty:
          'No opportunities match the current view. Nothing has been hidden or filtered away silently.',
        unavailable: {
          reason:
            'Opportunities cannot be listed because scoring has not run against the current taxonomy version.',
          blockedBy: 'Scoring run pending',
        },
        degraded: {
          notice:
            'Scores below were computed before the most recent evidence arrived for two opportunities. Rankings may shift once scoring re-runs.',
          affected: [
            'Example Snack Foods, Inc.',
            'Example Cold Chain Partners',
          ],
        },
        stale: {
          notice:
            'These rankings are from the last completed scoring run. Newer evidence has been collected but not yet scored.',
          asOf: '2026-08-15T06:15:00Z',
        },
      })
    },
  }
}

/** The default instance used by the application. */
export const fixtureDataSource = createFixtureDataSource()
