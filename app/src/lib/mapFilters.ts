/**
 * Filtering for the map. Pure functions over the markers already loaded.
 *
 * Kept out of the component for the same reason `opportunityFilters` is: the
 * filter logic is the part worth testing directly, and a map is an awkward place
 * to assert against.
 */
import type { MapMarker, MapLocationType } from '@/types/domain'

export const ANY = 'any' as const

export type PlacementFilter = 'any' | 'confirmed' | 'approximate'

export interface MapQuery {
  company: string
  opportunityType: string
  confidence: string
  stage: string
  placement: PlacementFilter
}

export const DEFAULT_MAP_QUERY: MapQuery = {
  company: ANY,
  opportunityType: ANY,
  confidence: ANY,
  stage: ANY,
  placement: ANY,
}

/**
 * Is this marker a project, rather than account context?
 *
 * The distinction the whole surface rests on, written once so a filter, a legend
 * and a marker style cannot each decide it differently.
 */
export function isProjectMarker(marker: MapMarker): boolean {
  return (
    marker.locationType === 'confirmed_project_site' ||
    marker.locationType === 'approximate_project_area'
  )
}

export const LOCATION_TYPE_LABEL: Record<MapLocationType, string> = {
  confirmed_project_site: 'Project site named in the filing',
  approximate_project_area: 'Approximate area — the filing named a city or state only',
  known_company_facility: 'Known company facility',
  corporate_headquarters: 'Corporate headquarters — account context, not a project site',
}

export const LOCATION_TYPE_SHORT: Record<MapLocationType, string> = {
  confirmed_project_site: 'Project site',
  approximate_project_area: 'Approximate area',
  known_company_facility: 'Company facility',
  corporate_headquarters: 'Headquarters',
}

export function applyMapQuery(markers: MapMarker[], query: MapQuery): MapMarker[] {
  return markers.filter((marker) => {
    if (query.company !== ANY && marker.organizationName !== query.company) return false

    if (query.placement === 'confirmed' && marker.locationType !== 'confirmed_project_site') {
      return false
    }
    if (query.placement === 'approximate' && marker.locationType !== 'approximate_project_area') {
      return false
    }

    /*
       THE OPPORTUNITY FILTERS APPLY TO OPPORTUNITY MARKERS ONLY.

       A headquarters has no stage and no confidence, so filtering by either
       must exclude it rather than silently keep it — a head office surviving a
       "high confidence only" filter would be the surface asserting exactly what
       it exists to deny.
    */
    const opportunityFiltered =
      query.opportunityType !== ANY || query.confidence !== ANY || query.stage !== ANY
    if (opportunityFiltered && !marker.opportunity) return false

    if (marker.opportunity) {
      if (query.opportunityType !== ANY && marker.opportunity.opportunityType !== query.opportunityType) {
        return false
      }
      if (query.confidence !== ANY && marker.opportunity.confidenceLevel !== query.confidence) {
        return false
      }
      if (query.stage !== ANY && marker.opportunity.stage !== query.stage) return false
    }

    return true
  })
}

export function activeMapFilterCount(query: MapQuery): number {
  return Object.values(query).filter((value) => value !== ANY).length
}

export function companyOptions(markers: MapMarker[]): string[] {
  return [...new Set(markers.map((m) => m.organizationName))].sort()
}

export function opportunityTypeOptions(markers: MapMarker[]): string[] {
  return [
    ...new Set(
      markers
        .map((m) => m.opportunity?.opportunityType)
        .filter((v): v is string => Boolean(v)),
    ),
  ].sort()
}
