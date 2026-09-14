/**
 * Path builders for the seven Phase 1 surfaces.
 *
 * Centralised so a route rename is one edit, and so the fixture state previewer
 * (`?state=`) survives every hop between surfaces rather than being dropped at
 * the first link that forgot to carry it.
 */
function withSearch(path: string, search: string): string {
  if (!search) return path
  const params = new URLSearchParams(search)
  // Never carry a record-scoped parameter onto a different record.
  params.delete('opportunity')
  params.delete('asOf')
  const query = params.toString()
  return query ? `${path}?${query}` : path
}

export const companyListPath = (search = '') => withSearch('/accounts', search)

export const companyPath = (companyId: string, search = '') =>
  withSearch(`/accounts/${encodeURIComponent(companyId)}`, search)

export const facilityPath = (facilityId: string, search = '') =>
  withSearch(`/facilities/${encodeURIComponent(facilityId)}`, search)

export const evidencePath = (evidenceId: string, search = '') =>
  withSearch(`/evidence/${encodeURIComponent(evidenceId)}`, search)

export const sourceHealthPath = (search = '') => withSearch('/admin/health', search)

export const mapPath = (search = '') => withSearch('/map', search)

export const mediaPath = (search = '') => withSearch('/media', search)

/*
 * `savedViewsPath` is gone with `/views`. Nothing can write a saved pursuit, so
 * the route was removed rather than left pointing at a page that could only ever
 * be empty. A helper for an address that no longer resolves is how a dead link
 * gets reintroduced by autocomplete.
 */

/** The shareable address for one opportunity. */
export const opportunityPath = (opportunityId: string, search = '') =>
  withSearch(`/opportunities/${encodeURIComponent(opportunityId)}`, search)

/**
 * The as-at date an ownership question is asked on.
 *
 * Carried in the URL so a shared link reproduces the same attribution — which is
 * the whole point of as-at-date resolution: "who operated this site" has a
 * different correct answer depending on when you ask.
 */
export const AS_OF_PARAM = 'asOf'

export function parseAsOf(search: string, fallback: string): string {
  const raw = new URLSearchParams(search).get(AS_OF_PARAM)
  return raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : fallback
}
