import type { PulseSnapshot } from '@/types/domain'

/**
 * ILLUSTRATIVE FIXTURE DATA — NOT REAL INTELLIGENCE.
 *
 * No real account, connector, or run is represented. The numbers are chosen to
 * make the surface's structure legible, in particular the ADR 0010 separation:
 * `coverage` answers "are we watching enough of each account?" and
 * `connectorHealth` answers "are the sources working?". They are two independent
 * metric families and the surface must never merge them into one health number.
 *
 * Each change carries a `channel`. Market changes are commercial intelligence and
 * lead the page; system changes are platform operations and are filed underneath.
 * Two market changes are flagged `needsAttention` so the surface can open with the
 * two things worth acting on today rather than with the newest thing that moved.
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
      channel: 'market',
      tone: 'confirmed',
      title: 'Confirmed: aseptic filling and warehouse automation',
      detail:
        'A second independent publisher corroborated the announced scope. The project now names aseptic filling and warehouse automation together.',
      occurredAt: '2026-08-16T09:12:00Z',
      subjectLabel: 'Example Beverage Company — Southeast plant, Macon GA',
      needsAttention: true,
      actionHint: 'Highest-scoring open opportunity. Worth a pursuit decision this week.',
      opportunityId: 'opp-fixture-1',
    },
    {
      id: 'chg-fixture-3',
      kind: 'negative_signal',
      channel: 'market',
      tone: 'attention',
      title: 'Deferred — line modernization moved to On hold',
      detail:
        'The announced deferral gives no revised date. The opportunity has moved to On hold rather than being removed.',
      occurredAt: '2026-08-09T11:20:00Z',
      subjectLabel: 'Example Dairy Cooperative — North plant, Rochester MN',
      needsAttention: true,
      actionHint: 'Previously being pursued. Confirm whether to keep it warm or stand down.',
      opportunityId: 'opp-fixture-6',
    },
    {
      id: 'chg-fixture-2',
      kind: 'facility_resolved',
      channel: 'market',
      tone: 'developing',
      title: 'Site named — Elsmere, KY',
      detail:
        'A permit filing named the parcel, so the opportunity moved from a region-level guess to a located site.',
      occurredAt: '2026-08-14T07:05:00Z',
      subjectLabel: 'Example Spring Water Company',
      needsAttention: false,
      actionHint: null,
      opportunityId: 'opp-fixture-3',
    },
    {
      id: 'chg-fixture-4',
      kind: 'evidence_added',
      channel: 'market',
      tone: 'emerging',
      title: 'New lead — cold-storage expansion reported',
      detail:
        'One reference-only item. Not enough to promote on its own, so it sits as a lead to watch.',
      occurredAt: '2026-08-16T05:50:00Z',
      subjectLabel: 'Example Cold Chain Partners',
      needsAttention: false,
      actionHint: null,
      opportunityId: 'opp-fixture-5',
    },
    {
      id: 'chg-fixture-5',
      kind: 'coverage_degraded',
      channel: 'system',
      tone: 'attention',
      title: 'One account below expected coverage',
      detail:
        'A configured source returned nothing for two consecutive cycles. Coverage for this account is incomplete until it recovers.',
      occurredAt: '2026-08-15T22:40:00Z',
      subjectLabel: 'Example Confectionery Group',
      needsAttention: false,
      actionHint: null,
      opportunityId: null,
    },
    {
      id: 'chg-fixture-6',
      kind: 'source_recovered',
      channel: 'system',
      tone: 'neutral',
      title: 'Source recovered',
      detail: 'A source that failed its previous run completed normally.',
      occurredAt: '2026-08-17T06:15:00Z',
      subjectLabel: 'Regional permit index',
      needsAttention: false,
      actionHint: null,
      opportunityId: null,
    },
  ],
}
