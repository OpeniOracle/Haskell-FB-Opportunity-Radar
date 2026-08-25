import type {
  DataSource,
} from '@/data/DataSource'
import type {
  Company,
  CompanySummary,
  EvidenceRecord,
  FacilityRecord,
  Opportunity,
  PulseSnapshot,
  SavedWorkspace,
  SourceHealthSnapshot,
  SurfaceState,
} from '@/types/domain'
import { fixtureMeta } from '@/data/fixtures/meta'
import { opportunityFixtures } from '@/data/fixtures/opportunities'
import { pulseFixture } from '@/data/fixtures/pulse'
import { companyFixtures } from '@/data/fixtures/companies'
import { facilityFixtures } from '@/data/fixtures/facilities'
import { evidenceFixtures } from '@/data/fixtures/evidence'
import { sourceHealthFixture } from '@/data/fixtures/health'
import { savedWorkspaceFixture } from '@/data/fixtures/views'

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

    async getCompanies(): Promise<SurfaceState<CompanySummary[]>> {
      return envelope<CompanySummary[]>(scenario, companyFixtures, {
        empty: 'No companies are being monitored yet.',
        unavailable: {
          reason:
            'The account list cannot be assembled because identity resolution has not completed. Nothing is required from you — it will retry on the next cycle.',
          blockedBy: 'Identity resolution pending',
        },
        degraded: {
          notice:
            'Coverage figures for two companies are from before the last cycle, so their gaps may already be closed.',
          affected: ['Example Confectionery Group', 'Example Pet Nutrition Company'],
        },
        stale: {
          notice:
            'No cycle has completed for over a day, so these are the last known account states.',
          asOf: '2026-08-15T06:15:00Z',
        },
      })
    },

    async getCompany(companyId: string): Promise<SurfaceState<Company>> {
      const company = companyFixtures.find((c) => c.id === companyId)
      if (!company) return missing('company', companyId)
      return envelope<Company>(scenario, company, {
        empty: 'This company has no recorded activity yet.',
        unavailable: {
          reason:
            'This company record cannot be assembled because identity resolution has not completed.',
          blockedBy: 'Identity resolution pending',
        },
        degraded: {
          notice:
            'One expected source has not reported this cycle, so the timeline below may be incomplete.',
          affected: company.coverage.missingSources,
        },
        stale: {
          notice: 'This is the last known state of the account, not current state.',
          asOf: '2026-08-15T06:15:00Z',
        },
      })
    },

    async getFacility(facilityId: string): Promise<SurfaceState<FacilityRecord>> {
      const facility = facilityFixtures.find((f) => f.id === facilityId)
      if (!facility) return missing('facility', facilityId)
      return envelope<FacilityRecord>(scenario, facility, {
        empty: 'Nothing has been recorded against this site yet.',
        unavailable: {
          reason:
            'This facility record cannot be shown because its identity has not been resolved.',
          blockedBy: 'Facility resolution pending',
        },
        degraded: {
          notice: 'One source covering this site has not reported this cycle.',
          affected: ['Regional permit index'],
        },
        stale: {
          notice: 'This is the last known state of the site, not current state.',
          asOf: '2026-08-15T06:15:00Z',
        },
      })
    },

    async getEvidence(evidenceId: string): Promise<SurfaceState<EvidenceRecord>> {
      const evidence = evidenceFixtures.find((e) => e.id === evidenceId)
      if (!evidence) return missing('evidence record', evidenceId)
      return envelope<EvidenceRecord>(scenario, evidence, {
        empty: 'This record carries no retained content.',
        unavailable: {
          reason:
            'The stored copy of this record cannot be read. The reference is preserved and nothing has been discarded.',
          blockedBy: 'Archived copy unreadable',
        },
        degraded: {
          notice:
            'The archived copy is older than the source page, so the excerpt may not match the current text.',
          affected: [evidence.sourceName],
        },
        stale: {
          notice: 'This record has not been re-checked against its source recently.',
          asOf: '2026-08-15T06:15:00Z',
        },
      })
    },

    async getSourceHealth(): Promise<SurfaceState<SourceHealthSnapshot>> {
      return envelope<SourceHealthSnapshot>(scenario, sourceHealthFixture, {
        empty: 'No sources are configured yet.',
        unavailable: {
          reason:
            'Health and coverage cannot be reported because the last cycle did not finish. Nothing is required from you.',
          blockedBy: 'Collection cycle did not complete',
        },
        degraded: {
          notice:
            'One connector reported partial success, so its coverage contribution this cycle is incomplete.',
          affected: ['Trade press index'],
        },
        stale: {
          notice: 'No cycle has completed for over a day; these are the last known figures.',
          asOf: '2026-08-15T06:15:00Z',
        },
      })
    },

    async getSavedWorkspace(): Promise<SurfaceState<SavedWorkspace>> {
      return envelope<SavedWorkspace>(scenario, savedWorkspaceFixture, {
        empty: 'You have not saved any views or watches yet.',
        unavailable: {
          reason:
            'Saved views cannot be listed in this preview session. Nothing has been lost — there is no stored copy to lose.',
          blockedBy: 'No persistence layer in Phase 1',
        },
        degraded: {
          notice:
            'One saved view references a filter that no longer matches anything, so its count may be wrong.',
          affected: ['Under-covered accounts'],
        },
        stale: {
          notice: 'Result counts were computed before the last cycle.',
          asOf: '2026-08-15T06:15:00Z',
        },
      })
    },
  }
}

/**
 * A record the caller asked for by id that does not exist.
 *
 * Returned as `unavailable` rather than thrown: an unknown id is a state a user
 * can be shown, and it must never fall through to a neighbouring record.
 */
function missing<T>(label: string, id: string): SurfaceState<T> {
  return {
    kind: 'unavailable',
    reason: `No ${label} matches that address. Nothing has been opened, and no other record has been shown in its place.`,
    blockedBy: `Unknown identifier: ${id || '(none)'}`,
    checkedAt: CHECKED_AT,
  }
}

/** The default instance used by the application. */
export const fixtureDataSource = createFixtureDataSource()
