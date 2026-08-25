import type { FacilityRecord } from '@/types/domain'

/**
 * ILLUSTRATIVE FIXTURE DATA — NOT REAL INTELLIGENCE.
 *
 * All sites are fictional. The set exercises the distinctions the surface has to
 * make: confirmed versus candidate resolution, deterministic versus
 * source-provided identifiers, an operator that differs from the brand owner,
 * and a company-level event borrowed for context but never asserted as a
 * facility event.
 */
export const facilityFixtures: FacilityRecord[] = [
  {
    id: 'fac-fixture-1',
    name: 'Example Beverage Southeast Plant',
    organizationId: 'org-fixture-1',
    organizationName: 'Example Beverage Company',
    addressLine: '1400 Example Industrial Parkway',
    locality: 'Macon',
    region: 'GA',
    facilityType: 'Beverage production',
    operatingStatus: 'operating',
    resolution: 'confirmed',
    candidateReason: null,
    identifiers: [
      { scheme: 'FSIS establishment', value: 'EST-EX-4471', origin: 'deterministic' },
      { scheme: 'EPA FRS', value: 'FRS-EX-88213004', origin: 'deterministic' },
      { scheme: 'Company site code', value: 'SE-01', origin: 'source_provided' },
    ],
    evidence: [
      {
        id: 'ev-fixture-1',
        label: 'Example Beverage Company announces Southeast plant investment',
        detail: 'Company newsroom · 11 August 2026 · superseded',
      },
      {
        id: 'ev-fixture-2',
        label: 'Corrected construction start date for the Southeast plant',
        detail: 'Company newsroom · 16 August 2026',
      },
    ],
    opportunities: [
      {
        id: 'opp-fixture-1',
        label: 'Aseptic filling line and warehouse automation at Southeast plant',
        detail: 'Confirmed',
      },
    ],
    timeline: [
      {
        id: 'ftl-1-a',
        scope: 'facility',
        kind: 'evidence',
        title: 'Construction start announced',
        detail: 'Announced scope names aseptic filling and warehouse automation.',
        occurredOn: {
          rawExpression: 'construction begins 14 March 2027',
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
  {
    id: 'fac-fixture-2',
    name: 'Proposed site — county parcel filing',
    organizationId: 'org-fixture-1',
    organizationName: 'Example Beverage Company',
    addressLine: 'Parcel 118-42, Example County',
    locality: 'Elsmere',
    region: 'KY',
    facilityType: 'Bottling (proposed)',
    operatingStatus: 'announced',
    // The candidate case: an address exists but nothing corroborates it.
    resolution: 'candidate',
    candidateReason:
      'The address appears in a single permit filing and has not been corroborated by an independent source or matched to a registry identifier. It is held as a candidate rather than merged into a confirmed facility.',
    identifiers: [
      { scheme: 'County parcel', value: '118-42', origin: 'source_provided' },
    ],
    evidence: [
      {
        id: 'ev-fixture-4',
        label: 'Water withdrawal application filed',
        detail: 'Regional permit index · 14 August 2026 · reference only',
      },
    ],
    opportunities: [],
    timeline: [],
  },
  {
    id: 'fac-fixture-3',
    name: 'Example Meals North Plant',
    organizationId: 'org-fixture-2',
    organizationName: 'Example Meals & Sauces Co.',
    addressLine: '9 Example Mill Road',
    locality: 'Rochester',
    region: 'MN',
    facilityType: 'Prepared foods',
    operatingStatus: 'operating',
    resolution: 'confirmed',
    candidateReason: null,
    identifiers: [
      { scheme: 'FSIS establishment', value: 'EST-EX-2210', origin: 'deterministic' },
    ],
    evidence: [
      {
        id: 'ev-fixture-5',
        label: 'Ownership change filing',
        detail: 'Example regulatory filings index · dated to 2024',
      },
      {
        id: 'ev-fixture-6',
        label: 'Demerger completion notice',
        detail: 'Investor relations · 19 February 2026',
      },
    ],
    opportunities: [],
    timeline: [
      {
        id: 'ftl-3-a',
        scope: 'facility',
        kind: 'evidence',
        title: 'Line modernization reported',
        detail: 'Trade press reported a line modernization under evaluation.',
        occurredOn: {
          rawExpression: 'during 2026',
          start: '2026-01-01',
          end: '2026-12-31',
          precision: 'year',
          basis: 'stated',
          inferenceNote: null,
        },
        evidenceId: 'ev-fixture-5',
        facilityId: 'fac-fixture-3',
      },
    ],
  },
  {
    id: 'fac-fixture-4',
    name: 'Example Global Innovation Centre',
    organizationId: 'org-fixture-3',
    organizationName: 'Example Consumer Brands PLC',
    addressLine: '200 Example Research Way',
    locality: 'New Haven',
    region: 'CT',
    facilityType: 'Research and development',
    operatingStatus: 'under_construction',
    resolution: 'confirmed',
    candidateReason: null,
    identifiers: [
      { scheme: 'Company site code', value: 'RD-02', origin: 'source_provided' },
    ],
    evidence: [
      {
        id: 'ev-fixture-3',
        label: 'Innovation centre programme update',
        detail: 'Investor page · dated to August 2026',
      },
    ],
    opportunities: [
      {
        id: 'opp-fixture-4',
        label: 'Innovation centre fit-out',
        detail: 'Emerging',
      },
    ],
    timeline: [
      {
        id: 'ftl-4-a',
        scope: 'facility',
        kind: 'evidence',
        title: 'Expected to be operational',
        detail: 'The source stated a season, not a date.',
        occurredOn: {
          rawExpression: 'expected to be fully operational by spring 2029',
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
    id: 'fac-fixture-5',
    name: 'Example Pet Nutrition Midwest Plant',
    organizationId: 'org-fixture-5',
    organizationName: 'Example Pet Nutrition Company',
    addressLine: null,
    locality: null,
    region: 'IA',
    facilityType: 'Pet food production',
    operatingStatus: 'unknown',
    resolution: 'candidate',
    candidateReason:
      'Only a state-level location has been reported. No street address, registry identifier, or corroborating source has been found, so the site remains unresolved.',
    identifiers: [],
    evidence: [],
    opportunities: [],
    timeline: [],
  },
]
