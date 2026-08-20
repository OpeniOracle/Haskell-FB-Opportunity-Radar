import type { Company, UnavailableAttribute } from '@/types/domain'

/**
 * ILLUSTRATIVE FIXTURE DATA — NOT REAL INTELLIGENCE.
 *
 * Every organization is fictional and named `Example …`. No real pilot account,
 * facility, corporate history, or activity appears here, and no real
 * reorganization has been paraphrased into a fictional one — the ownership
 * history below is invented to exercise the half-open interval rules, not to
 * stand in for anything that happened.
 *
 * Seeding the 15 real pilot identities belongs to E-B8 / roadmap PR 7 against a
 * database, and reaches a surface only at E-C3 / roadmap PR 9.
 */

/**
 * D14-L is blocked pending external legal review, and plan §13 names exactly
 * what that blocks. These three attributes are shared by every company because
 * the blocker is the same for all of them, and because writing the reason once
 * makes it impossible for one fixture to quietly acquire a value.
 */
const TIER_UNAVAILABLE: UnavailableAttribute = {
  available: false,
  reason: 'Target tier is derived from licensed event-marketing data.',
  blockedBy: 'D14-L — event-data licence review is not complete',
}

const ENGAGEMENT_UNAVAILABLE: UnavailableAttribute = {
  available: false,
  reason: 'Engagement observations are derived from licensed event-marketing data.',
  blockedBy: 'D14-L — event-data licence review is not complete',
}

const ACCOUNT_STRATEGY_UNAVAILABLE: UnavailableAttribute = {
  available: false,
  reason:
    'The account-strategy score depends on tier, Highest Value status and engagement.',
  blockedBy: 'D14-L — event-data licence review is not complete',
}

export const companyFixtures: Company[] = [
  {
    id: 'org-fixture-1',
    canonicalName: 'Example Beverage Company',
    parentName: null,
    role: 'Brand owner',
    sectors: ['Beverage', 'Aseptic'],
    scopeClass: 'fnb_core',
    scopeClassStatus: 'confirmed',
    aliases: ['Example Beverage Co.', 'EBC'],
    facilityCount: 2,
    openOpportunityCount: 1,
    latestActivityAt: '2026-08-16T09:12:00Z',
    coverage: {
      expectedSources: ['SEC EDGAR', 'Company newsroom', 'FSIS MPI', 'Regional permit index'],
      observedSources: ['SEC EDGAR', 'Company newsroom', 'FSIS MPI', 'Regional permit index'],
      missingSources: [],
      lastCheckedAt: '2026-08-17T06:15:00Z',
      gapReason: null,
    },
    targetTier: TIER_UNAVAILABLE,
    engagement: ENGAGEMENT_UNAVAILABLE,
    accountStrategyScore: ACCOUNT_STRATEGY_UNAVAILABLE,
    relationships: [
      {
        id: 'rel-1-a',
        counterpartyId: 'org-fixture-7',
        counterpartyName: 'Example Regional Bottling LLC',
        relationship: 'franchise_bottler',
        ownershipPercent: null,
        ownershipPercentBasis: null,
        fromDate: '2019-01-01',
        toDate: null,
        evidenceId: 'ev-fixture-4',
        note: 'Operates the Macon plant under a territory agreement.',
      },
    ],
    facilities: [
      {
        id: 'fac-fixture-1',
        label: 'Example Beverage Southeast Plant',
        detail: 'Macon, GA · Operating',
      },
      {
        id: 'fac-fixture-2',
        label: 'Proposed site — county parcel filing',
        detail: 'Elsmere, KY · Candidate',
      },
    ],
    openOpportunities: [
      {
        id: 'opp-fixture-1',
        label: 'Aseptic filling line and warehouse automation at Southeast plant',
        detail: 'Confirmed',
      },
    ],
    timeline: [
      {
        id: 'tl-1-a',
        scope: 'organization',
        kind: 'evidence',
        title: 'Aseptic filling and warehouse automation announced',
        detail:
          'Announced scope names aseptic filling and warehouse automation on one project.',
        occurredOn: {
          rawExpression: '14 March 2027',
          start: '2027-03-14',
          end: '2027-03-14',
          precision: 'exact_day',
          basis: 'stated',
          inferenceNote: null,
        },
        evidenceId: 'ev-fixture-1',
        facilityId: 'fac-fixture-1',
      },
    ],
  },

  /**
   * The ownership-history fixture.
   *
   * Four events, three relationship rows, one retained stake:
   *
   *   [2018-04-01, 2025-02-17)  Example Holdings Group — parent_subsidiary
   *   [2025-02-17, 2027-06-30)  Example Pacific Holdings — parent_subsidiary
   *   [2027-06-30,        ∞ )   Example Pacific Holdings — minority_interest 18.400%
   *
   * The 2027-06-30 demerger is NOT a clean termination: the former parent
   * retained a stake. Recording only the ended parent edge would assert a
   * complete separation that did not happen and would lose a holding large
   * enough to matter commercially. That is why `minority_interest` exists.
   *
   * The operational-separation milestone in the timeline is an ORGANIZATION-level
   * event. It is not an ownership edge and must never be written against a
   * facility — no fixture evidence says any individual site changed hands that
   * day, and asserting it per plant would manufacture that claim once per plant.
   */
  {
    id: 'org-fixture-2',
    canonicalName: 'Example Meals & Sauces Co.',
    parentName: null,
    role: 'Independent operating company',
    sectors: ['Prepared foods', 'Sauces'],
    scopeClass: 'fnb_core',
    scopeClassStatus: 'confirmed',
    aliases: ['Example Meals', 'EM&S'],
    facilityCount: 1,
    openOpportunityCount: 0,
    latestActivityAt: '2027-06-30T00:00:00Z',
    coverage: {
      expectedSources: ['SEC EDGAR', 'Company newsroom', 'FSIS MPI'],
      observedSources: ['SEC EDGAR', 'Company newsroom'],
      missingSources: ['FSIS MPI'],
      lastCheckedAt: '2026-08-17T06:15:00Z',
      gapReason:
        'No FSIS MPI establishment record has been matched to this company since the demerger.',
    },
    targetTier: TIER_UNAVAILABLE,
    engagement: ENGAGEMENT_UNAVAILABLE,
    accountStrategyScore: ACCOUNT_STRATEGY_UNAVAILABLE,
    relationships: [
      {
        id: 'rel-2-a',
        counterpartyId: 'org-fixture-8',
        counterpartyName: 'Example Holdings Group',
        relationship: 'parent_subsidiary',
        ownershipPercent: null,
        ownershipPercentBasis: null,
        fromDate: '2018-04-01',
        toDate: '2025-02-17',
        evidenceId: 'ev-fixture-5',
        note: 'Original parent. Ended when the business was sold.',
      },
      {
        id: 'rel-2-b',
        counterpartyId: 'org-fixture-9',
        counterpartyName: 'Example Pacific Holdings',
        relationship: 'parent_subsidiary',
        ownershipPercent: null,
        ownershipPercentBasis: null,
        fromDate: '2025-02-17',
        toDate: '2027-06-30',
        evidenceId: 'ev-fixture-5',
        note: 'Acquired the business; control ended at the demerger.',
      },
      {
        id: 'rel-2-c',
        counterpartyId: 'org-fixture-9',
        counterpartyName: 'Example Pacific Holdings',
        relationship: 'minority_interest',
        ownershipPercent: 18.4,
        ownershipPercentBasis: 'approximate',
        fromDate: '2027-06-30',
        toDate: null,
        evidenceId: 'ev-fixture-6',
        note:
          'Retained at the demerger, to be sold down over time. The separation was not a complete termination.',
      },
    ],
    facilities: [
      {
        id: 'fac-fixture-3',
        label: 'Example Meals North Plant',
        detail: 'Rochester, MN · Operating',
      },
    ],
    openOpportunities: [],
    timeline: [
      {
        id: 'tl-2-a',
        scope: 'organization',
        kind: 'ownership',
        title: 'Acquired by Example Pacific Holdings',
        detail: 'Control transferred from Example Holdings Group.',
        occurredOn: {
          rawExpression: '17 February 2025',
          start: '2025-02-17',
          end: '2025-02-17',
          precision: 'exact_day',
          basis: 'stated',
          inferenceNote: null,
        },
        evidenceId: 'ev-fixture-5',
        facilityId: null,
      },
      {
        id: 'tl-2-b',
        scope: 'organization',
        kind: 'operational',
        title: 'Operational separation completed',
        detail:
          'Company-level milestone. No fixture evidence states that any individual site changed hands on this date, so it is not recorded against a facility.',
        occurredOn: {
          rawExpression: '1 January 2027',
          start: '2027-01-01',
          end: '2027-01-01',
          precision: 'exact_day',
          basis: 'stated',
          inferenceNote: null,
        },
        evidenceId: 'ev-fixture-6',
        facilityId: null,
      },
      {
        id: 'tl-2-c',
        scope: 'organization',
        kind: 'ownership',
        title: 'Demerged; former parent retained approximately 18.4%',
        detail:
          'Control ended and a minority interest began on the same date. The half-open interval is what keeps that from reading as either an overlap or a gap.',
        occurredOn: {
          rawExpression: '30 June 2027',
          start: '2027-06-30',
          end: '2027-06-30',
          precision: 'exact_day',
          basis: 'stated',
          inferenceNote: null,
        },
        evidenceId: 'ev-fixture-6',
        facilityId: null,
      },
    ],
  },

  {
    id: 'org-fixture-3',
    canonicalName: 'Example Consumer Brands PLC',
    parentName: null,
    role: 'Brand owner',
    sectors: ['Consumer packaged goods'],
    scopeClass: 'fnb_adjacent',
    // D11: provisional, and excluded from relevance metrics until confirmed.
    scopeClassStatus: 'provisional',
    aliases: ['Example Consumer Brands'],
    facilityCount: 1,
    openOpportunityCount: 1,
    latestActivityAt: '2026-08-11T16:30:00Z',
    coverage: {
      expectedSources: ['Company newsroom', 'Regional permit index'],
      observedSources: ['Company newsroom', 'Regional permit index'],
      missingSources: [],
      lastCheckedAt: '2026-08-17T06:15:00Z',
      gapReason: null,
    },
    targetTier: TIER_UNAVAILABLE,
    engagement: ENGAGEMENT_UNAVAILABLE,
    accountStrategyScore: ACCOUNT_STRATEGY_UNAVAILABLE,
    relationships: [],
    facilities: [
      {
        id: 'fac-fixture-4',
        label: 'Example Global Innovation Centre',
        detail: 'New Haven, CT · Under construction',
      },
    ],
    openOpportunities: [
      {
        id: 'opp-fixture-4',
        label: 'Innovation centre fit-out',
        detail: 'Emerging',
      },
    ],
    timeline: [
      {
        id: 'tl-3-a',
        scope: 'organization',
        kind: 'evidence',
        title: 'Innovation centre announced',
        detail: 'An R&D building rather than a production plant.',
        occurredOn: {
          rawExpression: 'by spring 2029',
          start: '2029-03-01',
          end: '2029-05-31',
          precision: 'season',
          basis: 'stated',
          inferenceNote: null,
        },
        evidenceId: 'ev-fixture-3',
        facilityId: 'fac-fixture-4',
      },
    ],
  },

  {
    id: 'org-fixture-4',
    canonicalName: 'Example Confectionery Group',
    parentName: null,
    role: 'Brand owner',
    sectors: ['Confectionery'],
    scopeClass: 'fnb_core',
    scopeClassStatus: 'confirmed',
    aliases: [],
    facilityCount: 0,
    openOpportunityCount: 0,
    latestActivityAt: '2026-08-15T22:40:00Z',
    // The case that matters: every connector is healthy, and this company is
    // still under-covered.
    coverage: {
      expectedSources: ['SEC EDGAR', 'Company newsroom', 'FSIS MPI'],
      observedSources: ['SEC EDGAR'],
      missingSources: ['Company newsroom', 'FSIS MPI'],
      lastCheckedAt: '2026-08-17T06:15:00Z',
      gapReason:
        'The configured newsroom endpoint returned no items for two consecutive cycles, and no FSIS establishment has been matched. The connectors themselves are healthy.',
    },
    targetTier: TIER_UNAVAILABLE,
    engagement: ENGAGEMENT_UNAVAILABLE,
    accountStrategyScore: ACCOUNT_STRATEGY_UNAVAILABLE,
    relationships: [],
    facilities: [],
    openOpportunities: [],
    timeline: [],
  },

  {
    id: 'org-fixture-5',
    canonicalName: 'Example Pet Nutrition Company',
    parentName: 'Example Holdings Group',
    role: 'Subsidiary',
    sectors: ['Pet nutrition'],
    scopeClass: 'fnb_adjacent',
    scopeClassStatus: 'provisional',
    aliases: ['Example Pet Nutrition'],
    facilityCount: 1,
    openOpportunityCount: 0,
    latestActivityAt: '2026-07-30T10:00:00Z',
    coverage: {
      expectedSources: ['Company newsroom', 'FSIS MPI'],
      observedSources: ['Company newsroom'],
      missingSources: ['FSIS MPI'],
      lastCheckedAt: '2026-08-17T06:15:00Z',
      gapReason: 'No establishment record has been matched to this company.',
    },
    targetTier: TIER_UNAVAILABLE,
    engagement: ENGAGEMENT_UNAVAILABLE,
    accountStrategyScore: ACCOUNT_STRATEGY_UNAVAILABLE,
    relationships: [
      {
        id: 'rel-5-a',
        counterpartyId: 'org-fixture-8',
        counterpartyName: 'Example Holdings Group',
        relationship: 'parent_subsidiary',
        ownershipPercent: null,
        ownershipPercentBasis: null,
        fromDate: '2016-09-01',
        toDate: null,
        evidenceId: null,
        note: null,
      },
    ],
    facilities: [
      {
        id: 'fac-fixture-5',
        label: 'Example Pet Nutrition Midwest Plant',
        detail: 'IA · Candidate, status unknown',
      },
    ],
    openOpportunities: [],
    timeline: [],
  },

  {
    id: 'org-fixture-6',
    canonicalName: 'Example Cold Chain Partners',
    parentName: null,
    role: 'Third-party logistics',
    sectors: ['Cold storage'],
    scopeClass: 'fnb_adjacent',
    scopeClassStatus: 'provisional',
    aliases: [],
    facilityCount: 0,
    openOpportunityCount: 1,
    latestActivityAt: '2026-08-16T05:50:00Z',
    coverage: {
      expectedSources: ['Regional permit index', 'Trade press index'],
      observedSources: ['Trade press index'],
      missingSources: ['Regional permit index'],
      lastCheckedAt: '2026-08-17T06:15:00Z',
      gapReason: 'The permit index does not cover this jurisdiction.',
    },
    targetTier: TIER_UNAVAILABLE,
    engagement: ENGAGEMENT_UNAVAILABLE,
    accountStrategyScore: ACCOUNT_STRATEGY_UNAVAILABLE,
    relationships: [],
    facilities: [],
    openOpportunities: [
      {
        id: 'opp-fixture-5',
        label: 'Cold-storage expansion',
        detail: 'Emerging',
      },
    ],
    timeline: [],
  },
]

/** Counterparties that appear only as the other end of a relationship. */
export const counterpartyNames: Record<string, string> = {
  'org-fixture-7': 'Example Regional Bottling LLC',
  'org-fixture-8': 'Example Holdings Group',
  'org-fixture-9': 'Example Pacific Holdings',
}
