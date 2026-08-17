import type { Opportunity } from '@/types/domain'

/**
 * ILLUSTRATIVE FIXTURE DATA — NOT REAL INTELLIGENCE.
 *
 * Every organization here is fictional. The naming follows the convention the
 * design package itself established in `schemas/sample-opportunity.json`
 * ("Example Beverage Company"), so no reader can mistake a fixture for a finding
 * about a real Haskell target account. No real company activity, evidence, or
 * project appears anywhere in this file.
 *
 * The fixtures are chosen to exercise the design rather than to look plausible.
 * Between them they cover:
 *   - all three lifecycle stages
 *   - six of the nine temporal precisions, including `season` and an INFERRED basis
 *   - the authoritative + inference + moderate combination that ADR 0009 exists for
 *   - a provisional scope classification (D11)
 *   - a reference-only evidence ceiling (ADR 0006)
 *   - an on-hold opportunity closed down by a negative signal
 */
export const opportunityFixtures: Opportunity[] = [
  {
    id: 'opp-fixture-1',
    title: 'Aseptic filling line and warehouse automation at Southeast plant',
    organization: {
      id: 'org-fixture-1',
      canonicalName: 'Example Beverage Company',
      operatorName: null,
      scopeClass: 'fnb_core',
      scopeClassStatus: 'confirmed',
    },
    facility: {
      id: 'fac-fixture-1',
      name: 'Example Beverage Southeast Plant',
      locality: 'Macon',
      region: 'GA',
    },
    stage: 'confirmed',
    status: 'new',
    confidence: {
      evidenceStrength: 'authoritative',
      assessmentType: 'observed_fact',
      confidenceLevel: 'high',
    },
    horizon: {
      rawExpression: 'construction begins 14 March 2027',
      start: '2027-03-14',
      end: '2027-03-14',
      precision: 'exact_day',
      basis: 'stated',
      inferenceNote: null,
    },
    whyItMatters:
      'The announced scope names aseptic filling and warehouse automation together, which is the combination that pulls in process systems, packaging systems and material handling on one project rather than three.',
    capabilities: ['Process systems', 'Packaging systems', 'Material handling'],
    scores: {
      haskellFit: 29,
      projectMaturity: 23,
      potentialScope: 16,
      timingMomentum: 14,
      accountStrategy: 10,
      rawScore: 92,
      confidenceMultiplier: 1,
      finalScore: 92,
    },
    evidence: {
      count: 6,
      independentPublishers: 3,
      newestRetrievedAt: '2026-08-16T09:12:00Z',
      strongestAccessMode: 'structured_primary',
    },
    lastMaterialChangeAt: '2026-08-16T09:12:00Z',
  },
  {
    id: 'opp-fixture-2',
    title: 'Capital allocation names a new snack network without naming a site',
    organization: {
      id: 'org-fixture-2',
      canonicalName: 'Example Snack Foods, Inc.',
      operatorName: null,
      scopeClass: 'fnb_core',
      scopeClassStatus: 'confirmed',
    },
    facility: null,
    stage: 'developing',
    status: 'watching',
    confidence: {
      // The combination a single confidence enum cannot express: the filing is
      // beyond question, our reading of what it implies is not.
      evidenceStrength: 'authoritative',
      assessmentType: 'inference',
      confidenceLevel: 'moderate',
    },
    horizon: {
      rawExpression: 'in the second half of 2027',
      start: '2027-07-01',
      end: '2027-12-31',
      precision: 'half_year',
      basis: 'stated',
      inferenceNote: null,
    },
    whyItMatters:
      'A filing allocates capital to a named snack network but stops short of a site. The document is authoritative; the conclusion that it becomes a plant project is ours, and is scored as an inference.',
    capabilities: ['Planning and consulting', 'Architecture and facility design'],
    scores: {
      haskellFit: 22,
      projectMaturity: 14,
      potentialScope: 15,
      timingMomentum: 9,
      accountStrategy: 8,
      rawScore: 68,
      confidenceMultiplier: 0.8,
      finalScore: 54,
    },
    evidence: {
      count: 2,
      independentPublishers: 1,
      newestRetrievedAt: '2026-08-15T14:40:00Z',
      strongestAccessMode: 'structured_primary',
    },
    lastMaterialChangeAt: '2026-08-15T14:40:00Z',
  },
  {
    id: 'opp-fixture-3',
    title: 'Water withdrawal application filed for a greenfield bottling site',
    organization: {
      id: 'org-fixture-3',
      canonicalName: 'Example Spring Water Company',
      operatorName: 'Example Regional Bottling LLC',
      scopeClass: 'fnb_core',
      scopeClassStatus: 'confirmed',
    },
    facility: {
      id: 'fac-fixture-3',
      name: 'Proposed site — county parcel filing',
      locality: 'Elsmere',
      region: 'KY',
    },
    stage: 'developing',
    status: 'pursue',
    confidence: {
      evidenceStrength: 'authoritative',
      assessmentType: 'observed_fact',
      confidenceLevel: 'high',
    },
    horizon: {
      rawExpression: 'construction expected in Q2 2027',
      start: '2027-04-01',
      end: '2027-06-30',
      precision: 'quarter',
      basis: 'stated',
      inferenceNote: null,
    },
    whyItMatters:
      'A permit filing names an operating entity that is not the brand owner. The project is attributed to the operator as at the filing date, which is what keeps the account timeline honest.',
    capabilities: ['Industrial water and wastewater', 'Utilities and refrigeration'],
    scores: {
      haskellFit: 26,
      projectMaturity: 19,
      potentialScope: 14,
      timingMomentum: 12,
      accountStrategy: 7,
      rawScore: 78,
      confidenceMultiplier: 1,
      finalScore: 78,
    },
    evidence: {
      count: 4,
      independentPublishers: 2,
      newestRetrievedAt: '2026-08-14T07:05:00Z',
      strongestAccessMode: 'structured_primary',
    },
    lastMaterialChangeAt: '2026-08-14T07:05:00Z',
  },
  {
    id: 'opp-fixture-4',
    title: 'Innovation centre expected to open by spring 2029',
    organization: {
      id: 'org-fixture-4',
      canonicalName: 'Example Consumer Brands PLC',
      operatorName: null,
      // Provisional classification (D11) — rendered as provisional in the UI.
      scopeClass: 'fnb_adjacent',
      scopeClassStatus: 'provisional',
    },
    facility: {
      id: 'fac-fixture-4',
      name: 'Example Global Innovation Centre',
      locality: 'New Haven',
      region: 'CT',
    },
    stage: 'confirmed',
    status: 'watching',
    confidence: {
      evidenceStrength: 'authoritative',
      assessmentType: 'observed_fact',
      confidenceLevel: 'high',
    },
    horizon: {
      // The case that added `season` to the precision enum. The interface must
      // render "spring 2029", never a fabricated 31 March.
      rawExpression: 'expected to be fully operational by spring 2029',
      start: '2029-03-01',
      end: '2029-05-31',
      precision: 'season',
      basis: 'stated',
      inferenceNote: null,
    },
    whyItMatters:
      'An R&D building rather than a production plant, so the capability match is architecture and construction rather than process or packaging. The account classification is provisional and excluded from relevance metrics.',
    capabilities: ['Architecture and facility design', 'Construction and commissioning'],
    scores: {
      haskellFit: 17,
      projectMaturity: 21,
      potentialScope: 12,
      timingMomentum: 6,
      accountStrategy: 6,
      rawScore: 62,
      confidenceMultiplier: 1,
      finalScore: 62,
    },
    evidence: {
      count: 3,
      independentPublishers: 2,
      newestRetrievedAt: '2026-08-11T16:30:00Z',
      strongestAccessMode: 'archived_full_text',
    },
    lastMaterialChangeAt: '2026-08-11T16:30:00Z',
  },
  {
    id: 'opp-fixture-5',
    title: 'Regional press reports a cold-storage expansion, link-only',
    organization: {
      id: 'org-fixture-5',
      canonicalName: 'Example Cold Chain Partners',
      operatorName: null,
      scopeClass: 'fnb_core',
      scopeClassStatus: 'confirmed',
    },
    facility: null,
    stage: 'emerging',
    status: 'new',
    confidence: {
      // Reference-only evidence caps strength at indicative (ADR 0006), which in
      // turn caps confidence at low for a hypothesis (ADR 0009).
      evidenceStrength: 'indicative',
      assessmentType: 'hypothesis',
      confidenceLevel: 'low',
    },
    horizon: {
      rawExpression: 'sometime in 2028',
      start: '2028-01-01',
      end: '2028-12-31',
      precision: 'year',
      basis: 'inferred',
      inferenceNote:
        'No timing stated. Interval inferred from the reported lease term; recorded as an inference, not a source fact.',
    },
    whyItMatters:
      'Discovery surfaced this within hours, and it cannot be promoted on this evidence alone. It is a lead worth watching, not a project — and the card says so rather than implying otherwise.',
    capabilities: ['Cold storage and ASRS'],
    scores: {
      haskellFit: 18,
      projectMaturity: 6,
      potentialScope: 11,
      timingMomentum: 5,
      accountStrategy: 5,
      rawScore: 45,
      confidenceMultiplier: 0.6,
      finalScore: 27,
    },
    evidence: {
      count: 1,
      independentPublishers: 1,
      newestRetrievedAt: '2026-08-16T05:50:00Z',
      strongestAccessMode: 'reference_only',
    },
    lastMaterialChangeAt: '2026-08-16T05:50:00Z',
  },
  {
    id: 'opp-fixture-6',
    title: 'Line modernization placed on hold after an announced deferral',
    organization: {
      id: 'org-fixture-6',
      canonicalName: 'Example Dairy Cooperative',
      operatorName: null,
      scopeClass: 'fnb_core',
      scopeClassStatus: 'confirmed',
    },
    facility: {
      id: 'fac-fixture-6',
      name: 'Example Dairy North Plant',
      locality: 'Rochester',
      region: 'MN',
    },
    stage: 'developing',
    status: 'on_hold',
    confidence: {
      evidenceStrength: 'corroborated',
      assessmentType: 'observed_fact',
      confidenceLevel: 'moderate',
    },
    horizon: {
      rawExpression: 'deferred, no revised date given',
      start: null,
      end: null,
      precision: 'unknown',
      basis: 'unknown',
      inferenceNote: null,
    },
    whyItMatters:
      'A negative signal moved this to on hold rather than deleting it. The original evidence stays readable and the deferral is recorded as a state, so the account timeline still explains what happened.',
    capabilities: ['Process systems', 'Automation and controls'],
    scores: {
      haskellFit: 24,
      projectMaturity: 11,
      potentialScope: 13,
      timingMomentum: 2,
      accountStrategy: 7,
      rawScore: 57,
      confidenceMultiplier: 0.8,
      finalScore: 46,
    },
    evidence: {
      count: 5,
      independentPublishers: 3,
      newestRetrievedAt: '2026-08-09T11:20:00Z',
      strongestAccessMode: 'archived_full_text',
    },
    lastMaterialChangeAt: '2026-08-09T11:20:00Z',
  },
]
