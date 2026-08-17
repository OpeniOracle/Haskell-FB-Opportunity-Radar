import type {
  ConfidenceLevel,
  Opportunity,
  OpportunityStage,
  OpportunityStatus,
  PriorityBand,
} from '@/types/domain'

/**
 * Filtering and sorting for the Opportunities surface.
 *
 * Pure functions over an array, deliberately kept out of the components. They
 * run entirely in the browser against whatever the `DataSource` returned, so
 * this is frontend-only work with no query, no endpoint, and no backend
 * dependency of any kind. When PR 9 introduces the API these same functions can
 * either stay client-side or be mirrored server-side; nothing here presumes one.
 */

export const ANY = 'any' as const

export interface OpportunityQuery {
  search: string
  priority: PriorityBand | typeof ANY
  stage: OpportunityStage | typeof ANY
  status: OpportunityStatus | typeof ANY
  confidence: ConfidenceLevel | typeof ANY
  region: string
  capability: string
  sort: SortKey
}

export type SortKey = 'priority' | 'newest_evidence' | 'expected_timing'

export const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'priority', label: 'Priority score' },
  { value: 'newest_evidence', label: 'Newest evidence' },
  { value: 'expected_timing', label: 'Expected timing' },
]

export const DEFAULT_QUERY: OpportunityQuery = {
  search: '',
  priority: ANY,
  stage: ANY,
  status: ANY,
  confidence: ANY,
  region: ANY,
  capability: ANY,
  sort: 'priority',
}

/** Label used wherever an opportunity has no resolved facility. */
export const UNRESOLVED_LOCATION = 'Location not resolved'

/* ---------------------------------------------------------------- Priority */

/**
 * Score-to-band thresholds.
 *
 * D9 has not set acceptance targets, so these are presentational bands for
 * reading a list — not a scoring rule and not a promotion threshold.
 */
export function priorityBand(finalScore: number): PriorityBand {
  if (finalScore >= 85) return 'critical'
  if (finalScore >= 70) return 'high'
  if (finalScore >= 50) return 'moderate'
  return 'low'
}

export const PRIORITY_LABEL: Record<PriorityBand, string> = {
  critical: 'Critical priority',
  high: 'High priority',
  moderate: 'Moderate priority',
  low: 'Low priority',
}

export const PRIORITY_SHORT: Record<PriorityBand, string> = {
  critical: 'Critical',
  high: 'High',
  moderate: 'Moderate',
  low: 'Low',
}

/* ------------------------------------------------------- Option derivation */

/** Regions present in the data, plus the unresolved bucket when it occurs. */
export function regionOptions(opportunities: Opportunity[]): string[] {
  const regions = new Set<string>()
  let hasUnresolved = false
  for (const o of opportunities) {
    const region = o.facility?.region
    if (region) regions.add(region)
    else hasUnresolved = true
  }
  const sorted = [...regions].sort()
  return hasUnresolved ? [...sorted, UNRESOLVED_LOCATION] : sorted
}

export function capabilityOptions(opportunities: Opportunity[]): string[] {
  const capabilities = new Set<string>()
  for (const o of opportunities) for (const c of o.capabilities) capabilities.add(c)
  return [...capabilities].sort()
}

/* ------------------------------------------------------------------ Search */

function searchCorpus(o: Opportunity): string {
  return [
    o.title,
    o.organization.canonicalName,
    o.organization.operatorName ?? '',
    o.facility?.name ?? '',
    o.facility?.locality ?? '',
    o.facility?.region ?? '',
    o.capabilities.join(' '),
    o.whyItMatters,
  ]
    .join(' ')
    .toLowerCase()
}

/* ------------------------------------------------------------------ Filter */

export function filterOpportunities(
  opportunities: Opportunity[],
  query: OpportunityQuery,
): Opportunity[] {
  const term = query.search.trim().toLowerCase()

  return opportunities.filter((o) => {
    if (term && !searchCorpus(o).includes(term)) return false
    if (query.priority !== ANY && priorityBand(o.scores.finalScore) !== query.priority) {
      return false
    }
    if (query.stage !== ANY && o.stage !== query.stage) return false
    if (query.status !== ANY && o.status !== query.status) return false
    if (query.confidence !== ANY && o.confidence.confidenceLevel !== query.confidence) {
      return false
    }
    if (query.region !== ANY) {
      const region = o.facility?.region ?? null
      const matches =
        query.region === UNRESOLVED_LOCATION ? region === null : region === query.region
      if (!matches) return false
    }
    if (query.capability !== ANY && !o.capabilities.includes(query.capability)) return false
    return true
  })
}

/* -------------------------------------------------------------------- Sort */

export function sortOpportunities(
  opportunities: Opportunity[],
  sort: SortKey,
): Opportunity[] {
  const sorted = [...opportunities]

  switch (sort) {
    case 'priority':
      return sorted.sort((a, b) => b.scores.finalScore - a.scores.finalScore)

    case 'newest_evidence':
      return sorted.sort((a, b) =>
        b.evidence.newestRetrievedAt.localeCompare(a.evidence.newestRetrievedAt),
      )

    case 'expected_timing':
      // Soonest first. An opportunity with no recorded date sorts last rather
      // than being given an invented position at either end.
      return sorted.sort((a, b) => {
        const left = a.horizon.start
        const right = b.horizon.start
        if (left === null && right === null) {
          return b.scores.finalScore - a.scores.finalScore
        }
        if (left === null) return 1
        if (right === null) return -1
        return left.localeCompare(right)
      })
  }
}

export function applyQuery(
  opportunities: Opportunity[],
  query: OpportunityQuery,
): Opportunity[] {
  return sortOpportunities(filterOpportunities(opportunities, query), query.sort)
}

/** How many filters are active, for the "clear" affordance and the results line. */
export function activeFilterCount(query: OpportunityQuery): number {
  let count = 0
  if (query.search.trim()) count += 1
  for (const key of ['priority', 'stage', 'status', 'confidence', 'region', 'capability'] as const) {
    if (query[key] !== ANY) count += 1
  }
  return count
}
