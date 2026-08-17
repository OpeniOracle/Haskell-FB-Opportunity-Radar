import { describe, expect, it } from 'vitest'
import { opportunityFixtures } from '@/data/fixtures/opportunities'
import {
  ANY,
  DEFAULT_QUERY,
  UNRESOLVED_LOCATION,
  activeFilterCount,
  applyQuery,
  capabilityOptions,
  filterOpportunities,
  priorityBand,
  regionOptions,
  sortOpportunities,
  type OpportunityQuery,
} from '@/lib/opportunityFilters'

const query = (patch: Partial<OpportunityQuery> = {}): OpportunityQuery => ({
  ...DEFAULT_QUERY,
  ...patch,
})

describe('search', () => {
  it('matches on account name', () => {
    const result = filterOpportunities(opportunityFixtures, query({ search: 'Dairy' }))
    expect(result).toHaveLength(1)
    expect(result[0]?.organization.canonicalName).toBe('Example Dairy Cooperative')
  })

  it('matches on project title, location and capability', () => {
    expect(filterOpportunities(opportunityFixtures, query({ search: 'aseptic' }))).toHaveLength(1)
    expect(filterOpportunities(opportunityFixtures, query({ search: 'Elsmere' }))).toHaveLength(1)
    expect(
      filterOpportunities(opportunityFixtures, query({ search: 'cold storage' })),
    ).toHaveLength(1)
  })

  it('is case- and whitespace-insensitive', () => {
    expect(
      filterOpportunities(opportunityFixtures, query({ search: '  BEVERAGE  ' })),
    ).toHaveLength(1)
  })

  it('returns nothing rather than everything when there is no match', () => {
    expect(
      filterOpportunities(opportunityFixtures, query({ search: 'zzzznomatch' })),
    ).toHaveLength(0)
  })
})

describe('filters', () => {
  it('filters by priority band', () => {
    const critical = filterOpportunities(opportunityFixtures, query({ priority: 'critical' }))
    expect(critical.every((o) => o.scores.finalScore >= 85)).toBe(true)
    expect(critical).toHaveLength(1)
  })

  it('filters by stage, status and confidence', () => {
    expect(
      filterOpportunities(opportunityFixtures, query({ stage: 'confirmed' })),
    ).toHaveLength(2)
    expect(
      filterOpportunities(opportunityFixtures, query({ status: 'on_hold' })),
    ).toHaveLength(1)
    expect(
      filterOpportunities(opportunityFixtures, query({ confidence: 'low' })),
    ).toHaveLength(1)
  })

  it('filters by geography, including the unresolved bucket', () => {
    expect(filterOpportunities(opportunityFixtures, query({ region: 'KY' }))).toHaveLength(1)
    const unresolved = filterOpportunities(
      opportunityFixtures,
      query({ region: UNRESOLVED_LOCATION }),
    )
    expect(unresolved).toHaveLength(2)
    expect(unresolved.every((o) => o.facility === null)).toBe(true)
  })

  it('filters by capability', () => {
    const result = filterOpportunities(
      opportunityFixtures,
      query({ capability: 'Process systems' }),
    )
    expect(result).toHaveLength(2)
    expect(result.every((o) => o.capabilities.includes('Process systems'))).toBe(true)
  })

  it('combines filters conjunctively', () => {
    const result = filterOpportunities(
      opportunityFixtures,
      query({ stage: 'developing', status: 'on_hold' }),
    )
    expect(result).toHaveLength(1)
    expect(result[0]?.id).toBe('opp-fixture-6')
  })

  it('returns everything when nothing is selected', () => {
    expect(filterOpportunities(opportunityFixtures, query())).toHaveLength(
      opportunityFixtures.length,
    )
  })

  it('counts active filters for the clear affordance', () => {
    expect(activeFilterCount(query())).toBe(0)
    expect(activeFilterCount(query({ search: 'x', stage: 'confirmed' }))).toBe(2)
    // Sort is not a filter and must not be counted as one.
    expect(activeFilterCount(query({ sort: 'newest_evidence' }))).toBe(0)
  })
})

describe('sorting', () => {
  it('sorts by priority score, highest first', () => {
    const scores = sortOpportunities(opportunityFixtures, 'priority').map(
      (o) => o.scores.finalScore,
    )
    expect(scores).toEqual([...scores].sort((a, b) => b - a))
  })

  it('sorts by newest evidence, most recent first', () => {
    const dates = sortOpportunities(opportunityFixtures, 'newest_evidence').map(
      (o) => o.evidence.newestRetrievedAt,
    )
    expect(dates).toEqual([...dates].sort((a, b) => b.localeCompare(a)))
  })

  it('sorts by expected timing, soonest first, with undated last', () => {
    const sorted = sortOpportunities(opportunityFixtures, 'expected_timing')
    const dated = sorted.filter((o) => o.horizon.start !== null)
    const undated = sorted.filter((o) => o.horizon.start === null)

    const starts = dated.map((o) => o.horizon.start as string)
    expect(starts).toEqual([...starts].sort())
    // An opportunity with no recorded date is never given an invented position.
    expect(sorted.slice(dated.length)).toEqual(undated)
  })

  it('does not mutate the input array', () => {
    const before = opportunityFixtures.map((o) => o.id)
    sortOpportunities(opportunityFixtures, 'expected_timing')
    expect(opportunityFixtures.map((o) => o.id)).toEqual(before)
  })
})

describe('priority bands', () => {
  it('maps scores to bands at the documented thresholds', () => {
    expect(priorityBand(92)).toBe('critical')
    expect(priorityBand(85)).toBe('critical')
    expect(priorityBand(84)).toBe('high')
    expect(priorityBand(70)).toBe('high')
    expect(priorityBand(69)).toBe('moderate')
    expect(priorityBand(50)).toBe('moderate')
    expect(priorityBand(49)).toBe('low')
  })
})

describe('derived options', () => {
  it('derives regions from the data and appends the unresolved bucket', () => {
    const regions = regionOptions(opportunityFixtures)
    expect(regions).toContain('GA')
    expect(regions).toContain('KY')
    expect(regions[regions.length - 1]).toBe(UNRESOLVED_LOCATION)
  })

  it('derives a sorted, de-duplicated capability list', () => {
    const capabilities = capabilityOptions(opportunityFixtures)
    expect(capabilities).toEqual([...new Set(capabilities)].sort())
    expect(capabilities).toContain('Process systems')
  })
})

describe('applyQuery', () => {
  it('filters and then sorts', () => {
    const result = applyQuery(
      opportunityFixtures,
      query({ capability: 'Process systems', sort: 'priority' }),
    )
    expect(result).toHaveLength(2)
    expect(result[0]?.scores.finalScore).toBeGreaterThan(result[1]?.scores.finalScore ?? 0)
  })

  it('leaves the source array untouched', () => {
    const before = opportunityFixtures.map((o) => o.id)
    applyQuery(opportunityFixtures, query({ sort: 'newest_evidence' }))
    expect(opportunityFixtures.map((o) => o.id)).toEqual(before)
  })

  it('never invents a value the data does not contain', () => {
    expect(query().priority).toBe(ANY)
  })
})
