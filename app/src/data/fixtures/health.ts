import { companyFixtures } from '@/data/fixtures/companies'
import type { SourceHealthSnapshot } from '@/types/domain'

/**
 * ILLUSTRATIVE FIXTURE DATA — NOT REAL INTELLIGENCE.
 *
 * Two independent metric families, per ADR 0010 (Proposed; D17 Open). The
 * separation is the point of the fixture: **every connector below is healthy or
 * recovering, and Example Confectionery Group is still below its expected
 * coverage.** A surface that reported one number would call this a green day.
 *
 * Failure history is appended rather than overwritten — a connector that failed
 * and recovered still shows the failure, because a health trend that silently
 * rewrites itself cannot be trusted.
 */
export const sourceHealthFixture: SourceHealthSnapshot = {
  lastCycleCompletedAt: '2026-08-17T06:15:00Z',
  connectors: [
    {
      id: 'conn-edgar',
      name: 'SEC EDGAR',
      state: 'healthy',
      lastRunAt: '2026-08-17T06:10:00Z',
      lastOutcome: 'success',
      consecutiveFailures: 0,
      lastSuccessfulCollectionAt: '2026-08-17T06:10:00Z',
      freshnessHours: 2,
      expectedCadenceHours: 24,
      runHistory: [
        { id: 'r-edgar-3', startedAt: '2026-08-17T06:10:00Z', outcome: 'success', note: '4 filings collected.' },
        { id: 'r-edgar-2', startedAt: '2026-08-16T06:10:00Z', outcome: 'success', note: '1 filing collected.' },
        { id: 'r-edgar-1', startedAt: '2026-08-15T06:10:00Z', outcome: 'success', note: 'No new filings.' },
      ],
      maintenance: null,
    },
    {
      id: 'conn-newsroom',
      name: 'Company newsrooms',
      state: 'healthy',
      lastRunAt: '2026-08-17T06:12:00Z',
      lastOutcome: 'success',
      consecutiveFailures: 0,
      lastSuccessfulCollectionAt: '2026-08-17T06:12:00Z',
      freshnessHours: 2,
      expectedCadenceHours: 12,
      runHistory: [
        { id: 'r-news-3', startedAt: '2026-08-17T06:12:00Z', outcome: 'success', note: '6 items across 11 newsrooms.' },
        { id: 'r-news-2', startedAt: '2026-08-16T18:12:00Z', outcome: 'success', note: '2 items.' },
        { id: 'r-news-1', startedAt: '2026-08-16T06:12:00Z', outcome: 'success', note: '3 items.' },
      ],
      maintenance: null,
    },
    {
      id: 'conn-fsis',
      name: 'FSIS MPI establishments',
      state: 'healthy',
      lastRunAt: '2026-08-17T06:14:00Z',
      lastOutcome: 'success',
      consecutiveFailures: 0,
      lastSuccessfulCollectionAt: '2026-08-17T06:14:00Z',
      freshnessHours: 2,
      expectedCadenceHours: 168,
      runHistory: [
        { id: 'r-fsis-2', startedAt: '2026-08-17T06:14:00Z', outcome: 'success', note: 'Establishment list unchanged.' },
        { id: 'r-fsis-1', startedAt: '2026-08-10T06:14:00Z', outcome: 'success', note: 'Establishment list unchanged.' },
      ],
      maintenance: null,
    },
    {
      id: 'conn-permits',
      name: 'Regional permit index',
      state: 'healthy',
      lastRunAt: '2026-08-17T06:15:00Z',
      lastOutcome: 'success',
      consecutiveFailures: 0,
      lastSuccessfulCollectionAt: '2026-08-17T06:15:00Z',
      freshnessHours: 2,
      expectedCadenceHours: 24,
      // Recovered — and the failures stay on the record.
      runHistory: [
        { id: 'r-perm-4', startedAt: '2026-08-17T06:15:00Z', outcome: 'success', note: 'Recovered. 3 filings collected.' },
        { id: 'r-perm-3', startedAt: '2026-08-16T06:15:00Z', outcome: 'failure', note: 'Upstream returned 503.' },
        { id: 'r-perm-2', startedAt: '2026-08-15T06:15:00Z', outcome: 'failure', note: 'Upstream returned 503.' },
        { id: 'r-perm-1', startedAt: '2026-08-14T06:15:00Z', outcome: 'success', note: '1 filing collected.' },
      ],
      maintenance: null,
    },
    {
      id: 'conn-trade',
      name: 'Trade press index',
      state: 'degraded',
      lastRunAt: '2026-08-17T06:09:00Z',
      lastOutcome: 'partial_success',
      consecutiveFailures: 0,
      lastSuccessfulCollectionAt: '2026-08-16T06:09:00Z',
      freshnessHours: 24,
      expectedCadenceHours: 12,
      runHistory: [
        { id: 'r-trade-3', startedAt: '2026-08-17T06:09:00Z', outcome: 'partial_success', note: 'Minimum-content validation failed on 4 of 19 items; those were parked rather than stored.' },
        { id: 'r-trade-2', startedAt: '2026-08-16T18:09:00Z', outcome: 'partial_success', note: 'Minimum-content validation failed on 3 of 17 items.' },
        { id: 'r-trade-1', startedAt: '2026-08-16T06:09:00Z', outcome: 'success', note: '15 items collected.' },
      ],
      maintenance: null,
    },
    {
      id: 'conn-incentives',
      name: 'State incentive announcements',
      state: 'action_required',
      lastRunAt: '2026-08-17T06:05:00Z',
      lastOutcome: 'failure',
      consecutiveFailures: 5,
      lastSuccessfulCollectionAt: '2026-08-12T06:05:00Z',
      freshnessHours: 120,
      expectedCadenceHours: 24,
      runHistory: [
        { id: 'r-inc-3', startedAt: '2026-08-17T06:05:00Z', outcome: 'failure', note: 'Page structure changed; extraction produced no records.' },
        { id: 'r-inc-2', startedAt: '2026-08-16T06:05:00Z', outcome: 'failure', note: 'Page structure changed; extraction produced no records.' },
        { id: 'r-inc-1', startedAt: '2026-08-12T06:05:00Z', outcome: 'success', note: '2 announcements collected.' },
      ],
      // A bounded engineering task, never routine data entry.
      maintenance: {
        task: 'Update the extraction rules for the changed page structure, then test and resume.',
        openedAt: '2026-08-15T09:00:00Z',
      },
    },
  ],
  coverage: companyFixtures.map((company) => ({
    companyId: company.id,
    companyName: company.canonicalName,
    coverage: company.coverage,
  })),
}
