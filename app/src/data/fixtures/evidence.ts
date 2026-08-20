import type { EvidenceRecord } from '@/types/domain'

/**
 * ILLUSTRATIVE FIXTURE DATA — NOT REAL INTELLIGENCE.
 *
 * Fictional sources about fictional companies. The set exists to exercise the
 * three rules the Evidence surface has to honour:
 *
 *   ADR 0004 (D15, Accepted)  — a date is never shown more precisely than the
 *                               source stated it, and publication time is not
 *                               the same value as retrieval time.
 *   ADR 0012 (D24, Accepted)  — a correction SUPERSEDES; the earlier record stays
 *                               readable and is reachable from the later one.
 *   ADR 0006 (D19, Proposed/Open) — access mode is recorded and displayed. No
 *                               promotion rule is implemented from it.
 *
 * `ev-fixture-2` supersedes `ev-fixture-1`. Both remain in the fixture set,
 * because the whole point is that nothing is deleted.
 */
export const evidenceFixtures: EvidenceRecord[] = [
  {
    id: 'ev-fixture-1',
    title: 'Example Beverage Company announces Southeast plant investment',
    sourceName: 'Example Beverage Company newsroom',
    publisher: 'Example Beverage Company',
    publishedAt: {
      rawExpression: '11 August 2026',
      start: '2026-08-11',
      end: '2026-08-11',
      precision: 'exact_day',
      basis: 'stated',
      inferenceNote: null,
    },
    retrievedAt: '2026-08-11T14:02:00Z',
    excerpt:
      'The company will add aseptic filling capacity and warehouse automation at its Southeast plant, with construction beginning in the first quarter of 2027.',
    locator: 'newsroom/2026/southeast-plant-investment#paragraph-3',
    accessMode: 'structured_primary',
    subjectTiming: {
      rawExpression: 'the first quarter of 2027',
      start: '2027-01-01',
      end: '2027-03-31',
      precision: 'quarter',
      basis: 'stated',
      inferenceNote: null,
    },
    assertions: [
      {
        id: 'as-1-a',
        statement:
          'Aseptic filling capacity and warehouse automation will be added at the Southeast plant.',
        basis: 'source_fact',
        inferenceNote: null,
      },
      {
        id: 'as-1-b',
        statement:
          'The combined scope is likely to pull process systems, packaging systems and material handling into one project.',
        basis: 'system_inference',
        inferenceNote:
          'Derived from the capability taxonomy applied to the announced scope. The source does not characterise the project this way.',
      },
    ],
    relatedCompany: {
      id: 'org-fixture-1',
      label: 'Example Beverage Company',
      detail: 'Brand owner',
    },
    relatedFacility: {
      id: 'fac-fixture-1',
      label: 'Example Beverage Southeast Plant',
      detail: 'Macon, GA',
    },
    relatedOpportunity: {
      id: 'opp-fixture-1',
      label: 'Aseptic filling line and warehouse automation at Southeast plant',
      detail: 'Confirmed',
    },
    relatedClaim: null,
    corrections: [
      {
        relationship: 'supersedes',
        evidenceId: 'ev-fixture-2',
        evidenceTitle: 'Corrected construction start date for the Southeast plant',
        occurredAt: '2026-08-16T09:12:00Z',
        note:
          'A later release from the same publisher gave an exact construction start date, replacing the quarter originally stated.',
      },
    ],
    supersededByEvidenceId: 'ev-fixture-2',
  },
  {
    id: 'ev-fixture-2',
    title: 'Corrected construction start date for the Southeast plant',
    sourceName: 'Example Beverage Company newsroom',
    publisher: 'Example Beverage Company',
    publishedAt: {
      rawExpression: '16 August 2026',
      start: '2026-08-16',
      end: '2026-08-16',
      precision: 'exact_day',
      basis: 'stated',
      inferenceNote: null,
    },
    retrievedAt: '2026-08-16T09:12:00Z',
    excerpt:
      'Correcting our release of 11 August: construction at the Southeast plant begins 14 March 2027.',
    locator: 'newsroom/2026/southeast-plant-correction#paragraph-1',
    accessMode: 'structured_primary',
    subjectTiming: {
      rawExpression: 'construction begins 14 March 2027',
      start: '2027-03-14',
      end: '2027-03-14',
      precision: 'exact_day',
      basis: 'stated',
      inferenceNote: null,
    },
    assertions: [
      {
        id: 'as-2-a',
        statement: 'Construction begins on 14 March 2027.',
        basis: 'source_fact',
        inferenceNote: null,
      },
    ],
    relatedCompany: {
      id: 'org-fixture-1',
      label: 'Example Beverage Company',
      detail: 'Brand owner',
    },
    relatedFacility: {
      id: 'fac-fixture-1',
      label: 'Example Beverage Southeast Plant',
      detail: 'Macon, GA',
    },
    relatedOpportunity: {
      id: 'opp-fixture-1',
      label: 'Aseptic filling line and warehouse automation at Southeast plant',
      detail: 'Confirmed',
    },
    relatedClaim: null,
    corrections: [
      {
        relationship: 'corrects',
        evidenceId: 'ev-fixture-1',
        evidenceTitle: 'Example Beverage Company announces Southeast plant investment',
        occurredAt: '2026-08-11T14:02:00Z',
        note:
          'The earlier release stated a quarter. It remains readable and is not deleted; the presented view simply selects this record.',
      },
    ],
    supersededByEvidenceId: null,
  },
  {
    id: 'ev-fixture-3',
    title: 'Innovation centre programme update',
    sourceName: 'Example Consumer Brands PLC investor page',
    publisher: 'Example Consumer Brands PLC',
    publishedAt: {
      rawExpression: 'August 2026',
      start: '2026-08-01',
      end: '2026-08-31',
      // The publisher dated this to a month. It must never render as 1 August.
      precision: 'month',
      basis: 'stated',
      inferenceNote: null,
    },
    retrievedAt: '2026-08-11T16:30:00Z',
    excerpt:
      'The innovation centre is expected to be fully operational by spring 2029.',
    locator: 'investors/programme-update-2026#innovation-centre',
    accessMode: 'archived_full_text',
    subjectTiming: {
      rawExpression: 'by spring 2029',
      start: '2029-03-01',
      end: '2029-05-31',
      precision: 'season',
      basis: 'stated',
      inferenceNote: null,
    },
    assertions: [
      {
        id: 'as-3-a',
        statement: 'The innovation centre is expected to be operational by spring 2029.',
        basis: 'source_fact',
        inferenceNote: null,
      },
    ],
    relatedCompany: {
      id: 'org-fixture-3',
      label: 'Example Consumer Brands PLC',
      detail: 'Brand owner · provisional classification',
    },
    relatedFacility: {
      id: 'fac-fixture-4',
      label: 'Example Global Innovation Centre',
      detail: 'New Haven, CT',
    },
    relatedOpportunity: {
      id: 'opp-fixture-4',
      label: 'Innovation centre fit-out',
      detail: 'Emerging',
    },
    relatedClaim: null,
    corrections: [],
    supersededByEvidenceId: null,
  },
  {
    id: 'ev-fixture-4',
    title: 'Water withdrawal application filed',
    sourceName: 'Regional permit index',
    publisher: 'Example County water authority',
    publishedAt: {
      rawExpression: '14 August 2026',
      start: '2026-08-14',
      end: '2026-08-14',
      precision: 'exact_day',
      basis: 'stated',
      inferenceNote: null,
    },
    retrievedAt: '2026-08-14T07:05:00Z',
    excerpt: null,
    locator: 'permits/2026/WD-118-42',
    // Reference-only: the body is not retained, and the surface says so plainly.
    accessMode: 'reference_only',
    subjectTiming: null,
    assertions: [
      {
        id: 'as-4-a',
        statement:
          'A water withdrawal application names Example Regional Bottling LLC as the applicant.',
        basis: 'source_fact',
        inferenceNote: null,
      },
      {
        id: 'as-4-b',
        statement: 'The applicant operates the site rather than owning the brand.',
        basis: 'system_inference',
        inferenceNote:
          'Derived from the franchise-bottler relationship recorded against Example Beverage Company. The filing itself does not state the relationship.',
      },
    ],
    relatedCompany: {
      id: 'org-fixture-1',
      label: 'Example Beverage Company',
      detail: 'Brand owner',
    },
    relatedFacility: {
      id: 'fac-fixture-2',
      label: 'Proposed site — county parcel filing',
      detail: 'Elsmere, KY · candidate',
    },
    relatedOpportunity: null,
    relatedClaim: {
      id: 'claim-fixture-2',
      label: 'Applicant named on a water withdrawal filing',
      detail: 'Staged for review',
    },
    corrections: [],
    supersededByEvidenceId: null,
  },
  {
    id: 'ev-fixture-5',
    title: 'Ownership change filing',
    sourceName: 'Example regulatory filings index',
    publisher: 'Example filings authority',
    publishedAt: {
      rawExpression: '2025',
      start: '2025-01-01',
      end: '2025-12-31',
      // Year precision. Rendering this as 1 January 2025 is the exact failure
      // ADR 0004 exists to prevent.
      precision: 'year',
      basis: 'stated',
      inferenceNote: null,
    },
    retrievedAt: '2026-08-01T09:00:00Z',
    excerpt:
      'Records the transfer of Example Meals & Sauces Co. from Example Holdings Group to Example Pacific Holdings.',
    locator: 'filings/2025/EX-OWN-4412',
    accessMode: 'structured_primary',
    subjectTiming: {
      rawExpression: '17 February 2025',
      start: '2025-02-17',
      end: '2025-02-17',
      precision: 'exact_day',
      basis: 'stated',
      inferenceNote: null,
    },
    assertions: [
      {
        id: 'as-5-a',
        statement: 'Control transferred on 17 February 2025.',
        basis: 'source_fact',
        inferenceNote: null,
      },
    ],
    relatedCompany: {
      id: 'org-fixture-2',
      label: 'Example Meals & Sauces Co.',
      detail: 'Independent operating company',
    },
    relatedFacility: null,
    relatedOpportunity: null,
    relatedClaim: null,
    corrections: [],
    supersededByEvidenceId: null,
  },
  {
    id: 'ev-fixture-6',
    title: 'Demerger completion notice',
    sourceName: 'Example Pacific Holdings investor relations',
    publisher: 'Example Pacific Holdings',
    publishedAt: {
      rawExpression: '30 June 2027',
      start: '2027-06-30',
      end: '2027-06-30',
      precision: 'exact_day',
      basis: 'stated',
      inferenceNote: null,
    },
    retrievedAt: '2027-06-30T18:40:00Z',
    excerpt:
      'The demerger completed on 30 June 2027. Example Pacific Holdings retains approximately 18.4% of the demerged business, to be sold down over time.',
    locator: 'investors/2027/demerger-completion#paragraph-2',
    accessMode: 'structured_primary',
    subjectTiming: {
      rawExpression: '30 June 2027',
      start: '2027-06-30',
      end: '2027-06-30',
      precision: 'exact_day',
      basis: 'stated',
      inferenceNote: null,
    },
    assertions: [
      {
        id: 'as-6-a',
        statement: 'The demerger completed on 30 June 2027.',
        basis: 'source_fact',
        inferenceNote: null,
      },
      {
        id: 'as-6-b',
        statement: 'Approximately 18.4% was retained by the former parent.',
        basis: 'source_fact',
        inferenceNote: null,
      },
      {
        id: 'as-6-c',
        statement:
          'The separation is not a complete termination of the relationship.',
        basis: 'system_inference',
        inferenceNote:
          'Follows from the retained stake. Recorded so the account timeline does not read as a clean break.',
      },
    ],
    relatedCompany: {
      id: 'org-fixture-2',
      label: 'Example Meals & Sauces Co.',
      detail: 'Independent operating company',
    },
    relatedFacility: null,
    relatedOpportunity: null,
    relatedClaim: null,
    corrections: [],
    supersededByEvidenceId: null,
  },
  {
    id: 'ev-fixture-7',
    title: 'Cold-storage expansion reported',
    sourceName: 'Trade press index',
    publisher: 'Example Trade Weekly',
    publishedAt: {
      rawExpression: '16 August 2026',
      start: '2026-08-16',
      end: '2026-08-16',
      precision: 'exact_day',
      basis: 'stated',
      inferenceNote: null,
    },
    retrievedAt: '2026-08-16T05:50:00Z',
    excerpt: null,
    locator: null,
    // Metadata only: neither body nor locator was retained.
    accessMode: 'metadata_only',
    subjectTiming: {
      rawExpression: null,
      start: '2028-01-01',
      end: '2028-12-31',
      precision: 'year',
      basis: 'inferred',
      inferenceNote:
        'No timing stated. Interval inferred from the reported lease term; recorded as an inference, not a source fact.',
    },
    assertions: [
      {
        id: 'as-7-a',
        statement: 'A cold-storage expansion was reported.',
        basis: 'source_fact',
        inferenceNote: null,
      },
    ],
    relatedCompany: {
      id: 'org-fixture-6',
      label: 'Example Cold Chain Partners',
      detail: 'Third-party logistics · provisional classification',
    },
    relatedFacility: null,
    relatedOpportunity: {
      id: 'opp-fixture-5',
      label: 'Cold-storage expansion',
      detail: 'Emerging',
    },
    relatedClaim: {
      id: 'claim-fixture-9',
      label: 'Reported cold-storage expansion',
      detail: 'Staged for review',
    },
    corrections: [],
    supersededByEvidenceId: null,
  },
]
