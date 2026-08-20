import { describe, expect, it } from 'vitest'
import { companyFixtures } from '@/data/fixtures/companies'
import {
  controllingParentAsOf,
  countsTowardRelevanceMetrics,
  intervalLabel,
  intervalNotation,
  isActiveOn,
  operatorAsOf,
  relationshipsAsOf,
  retainedStakesAsOf,
} from '@/lib/ownership'

/**
 * ADR 0005's accepted corollary (D18): relationships are time-bounded and
 * evidence-backed. Only that corollary is implemented — the conservative
 * resolution ladder is still Proposed pending G-4 and is not tested here
 * because it is not built.
 *
 * The boundary date is where the whole convention lives, so it is tested from
 * both sides rather than only in the middle of an interval.
 */
describe('half-open intervals — [from, to)', () => {
  const interval = { fromDate: '2025-02-17', toDate: '2027-06-30' }

  it('includes the from date', () => {
    expect(isActiveOn(interval, '2025-02-17')).toBe(true)
  })

  it('excludes the to date', () => {
    expect(isActiveOn(interval, '2027-06-30')).toBe(false)
  })

  it('covers the day before the to date', () => {
    expect(isActiveOn(interval, '2027-06-29')).toBe(true)
  })

  it('excludes the day before the from date', () => {
    expect(isActiveOn(interval, '2025-02-16')).toBe(false)
  })

  it('treats a null bound as open in that direction', () => {
    expect(isActiveOn({ fromDate: null, toDate: '2020-01-01' }, '1999-01-01')).toBe(true)
    expect(isActiveOn({ fromDate: '2020-01-01', toDate: null }, '2999-01-01')).toBe(true)
    expect(isActiveOn({ fromDate: null, toDate: null }, '2026-08-17')).toBe(true)
  })

  it('renders the exclusivity rather than implying it', () => {
    expect(intervalLabel(interval)).toBe('2025-02-17 until 2027-06-30')
    expect(intervalNotation(interval)).toBe('[2025-02-17, 2027-06-30)')
    expect(intervalNotation({ fromDate: '2027-06-30', toDate: null })).toBe(
      '[2027-06-30, ∞)',
    )
  })
})

/**
 * The fixture history, which is invented to exercise the rules:
 *
 *   [2018-04-01, 2025-02-17)  Example Holdings Group    parent_subsidiary
 *   [2025-02-17, 2027-06-30)  Example Pacific Holdings  parent_subsidiary
 *   [2027-06-30,        ∞ )   Example Pacific Holdings  minority_interest 18.4%
 */
describe('the multi-event ownership fixture', () => {
  const company = companyFixtures.find((c) => c.id === 'org-fixture-2')!

  it('returns exactly one answer on the handover date', () => {
    // The exclusive upper bound is what makes this one and not two.
    const onHandover = relationshipsAsOf(company.relationships, '2025-02-17')
    expect(onHandover).toHaveLength(1)
    expect(onHandover[0]?.counterpartyName).toBe('Example Pacific Holdings')
  })

  it('returns exactly one answer on the demerger date', () => {
    const onDemerger = relationshipsAsOf(company.relationships, '2027-06-30')
    expect(onDemerger).toHaveLength(1)
    expect(onDemerger[0]?.relationship).toBe('minority_interest')
  })

  it('resolves the controlling parent differently at three different dates', () => {
    expect(controllingParentAsOf(company.relationships, '2020-01-01')?.counterpartyName)
      .toBe('Example Holdings Group')
    expect(controllingParentAsOf(company.relationships, '2026-08-17')?.counterpartyName)
      .toBe('Example Pacific Holdings')
    // After the demerger there is no controlling parent at all.
    expect(controllingParentAsOf(company.relationships, '2027-07-01')).toBeNull()
  })

  it('keeps a retained minority interest visible after control ends', () => {
    const stakes = retainedStakesAsOf(company.relationships, '2027-07-01')
    expect(stakes).toHaveLength(1)
    expect(stakes[0]?.counterpartyName).toBe('Example Pacific Holdings')
    expect(stakes[0]?.ownershipPercent).toBe(18.4)
    expect(stakes[0]?.ownershipPercentBasis).toBe('approximate')
  })

  it('does not treat a retained stake as control', () => {
    // The demerger is not a clean termination, and it is also not a parent
    // relationship. Both halves of that have to hold at once.
    const after = relationshipsAsOf(company.relationships, '2027-07-01')
    expect(after).toHaveLength(1)
    expect(controllingParentAsOf(company.relationships, '2027-07-01')).toBeNull()
  })

  it('records the separation as a company-level event, never a facility one', () => {
    const separation = company.timeline.find(
      (entry) => entry.title === 'Operational separation completed',
    )
    expect(separation?.scope).toBe('organization')
    // Writing it against a plant would manufacture the claim once per plant.
    expect(separation?.facilityId).toBeNull()
  })
})

describe('operator resolution', () => {
  it('prefers an explicit operating relationship over the brand owner', () => {
    const company = companyFixtures.find((c) => c.id === 'org-fixture-1')!
    expect(operatorAsOf(company, '2026-08-17')).toEqual({
      name: 'Example Regional Bottling LLC',
      via: 'franchise_bottler',
    })
  })

  it('falls back to the brand owner when no operator is recorded', () => {
    const company = companyFixtures.find((c) => c.id === 'org-fixture-3')!
    expect(operatorAsOf(company, '2026-08-17')).toEqual({
      name: 'Example Consumer Brands PLC',
      via: 'brand_owner',
    })
  })

  it('answers differently before the operating agreement began', () => {
    const company = companyFixtures.find((c) => c.id === 'org-fixture-1')!
    expect(operatorAsOf(company, '2018-12-31').via).toBe('brand_owner')
  })
})

/** D11 is approved PROVISIONALLY, so the exclusion has to be real, not cosmetic. */
describe('relevance-metric eligibility (D11)', () => {
  it('excludes provisionally classified companies', () => {
    expect(countsTowardRelevanceMetrics({ scopeClassStatus: 'provisional' })).toBe(false)
    expect(countsTowardRelevanceMetrics({ scopeClassStatus: 'confirmed' })).toBe(true)
  })

  it('leaves at least one of each in the fixture set so the surface can show both', () => {
    const eligible = companyFixtures.filter(countsTowardRelevanceMetrics)
    expect(eligible.length).toBeGreaterThan(0)
    expect(eligible.length).toBeLessThan(companyFixtures.length)
  })
})
