import type { PulseSnapshot } from '@/types/domain'

/**
 * ILLUSTRATIVE FIXTURE DATA — NOT REAL INTELLIGENCE.
 *
 * No real account, connector, or run is represented. The numbers are chosen to
 * make the surface's structure legible, in particular the ADR 0010 separation:
 * `coverage` answers "are we watching enough of each account?" and
 * `connectorHealth` answers "are the sources working?". They are two independent
 * metric families and the surface must never merge them into one health number.
 */
export const pulseFixture: PulseSnapshot = {
  coverage: {
    accountsMonitored: 15,
    accountsAtOrAboveExpected: 11,
    accountsBelowExpected: 4,
    // Named, not just counted — a coverage gap you cannot name is not actionable.
    accountsUncovered: [
      'Example Confectionery Group',
      'Example Pet Nutrition Company',
      'Example Dairy International',
      'Example Bottled Water Company',
    ],
  },
  connectorHealth: {
    sourcesEnabled: 9,
    healthy: 7,
    degraded: 1,
    actionRequired: 1,
    lastCycleCompletedAt: '2026-08-17T06:15:00Z',
  },
  lastVisitAt: '2026-08-14T17:02:00Z',
  generatedAt: '2026-08-17T06:15:00Z',
  changesSinceLastVisit: [
    {
      id: 'chg-fixture-1',
      kind: 'stage_promoted',
      tone: 'confirmed',
      title: 'Promoted to Confirmed',
      detail:
        'A second independent publisher corroborated the announced scope, which met the promotion rule rather than a scorer deciding on its own.',
      occurredAt: '2026-08-16T09:12:00Z',
      subjectLabel: 'Example Beverage Company — Southeast plant',
    },
    {
      id: 'chg-fixture-2',
      kind: 'facility_resolved',
      tone: 'developing',
      title: 'Facility resolved to a named site',
      detail:
        'A permit filing named the parcel, so the opportunity moved from a region-level guess to a located site.',
      occurredAt: '2026-08-14T07:05:00Z',
      subjectLabel: 'Example Spring Water Company — Elsmere, KY',
    },
    {
      id: 'chg-fixture-3',
      kind: 'negative_signal',
      tone: 'attention',
      title: 'Deferral recorded — moved to On hold',
      detail:
        'The project was not deleted. The original evidence stays readable and the deferral is recorded as a state change, so the account timeline still explains what happened.',
      occurredAt: '2026-08-09T11:20:00Z',
      subjectLabel: 'Example Dairy Cooperative — North plant',
    },
    {
      id: 'chg-fixture-4',
      kind: 'evidence_added',
      tone: 'emerging',
      title: 'New evidence attached',
      detail:
        'One reference-only item was captured. It cannot lift confidence past low on its own, and the card says so.',
      occurredAt: '2026-08-16T05:50:00Z',
      subjectLabel: 'Example Cold Chain Partners',
    },
    {
      id: 'chg-fixture-5',
      kind: 'coverage_degraded',
      tone: 'attention',
      title: 'Source below expected coverage',
      detail:
        'One configured source returned nothing for two consecutive cycles. This is a coverage fact about an account, tracked separately from whether the connector itself is healthy.',
      occurredAt: '2026-08-15T22:40:00Z',
      subjectLabel: 'Example Confectionery Group',
    },
    {
      id: 'chg-fixture-6',
      kind: 'source_recovered',
      tone: 'neutral',
      title: 'Source recovered',
      detail:
        'A source that failed its previous run completed normally. Recorded so the health trend is not silently rewritten.',
      occurredAt: '2026-08-17T06:15:00Z',
      subjectLabel: 'Regional permit index',
    },
  ],
}
