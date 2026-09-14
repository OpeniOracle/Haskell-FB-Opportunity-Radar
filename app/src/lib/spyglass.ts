/**
 * What a Spyglass URL is allowed to be, in the browser.
 *
 * The same rule exists as a CHECK constraint in migration 0024 and as a
 * `frame-src` entry in the generated CSP. Three independent enforcement points
 * for one rule, because each of them fails differently: the constraint stops a
 * bad row being stored, the CSP stops a bad frame being loaded, and this stops
 * an administrator being told their edit worked when the database is about to
 * refuse it.
 *
 * PROTOCOL-RELATIVE URLS ARE REFUSED EXPLICITLY. `//embeddable-widgets.zignallabs.com/x`
 * has the right host and inherits the page's scheme, and `new URL()` with a base
 * resolves it happily. It is not a URL this application accepts, and the literal
 * `https://` prefix check is what says so.
 */

/** Origins that may be framed. Mirrored in `generate-headers.mjs`. */
export const SPYGLASS_EMBED_ORIGINS = [
  'https://embeddable-widgets.zignallabs.com',
  'https://embeddable-widgets.staging.zignallabs.com',
] as const

/** Origins the live dashboard may point at. */
export const SPYGLASS_DASHBOARD_ORIGINS = [
  'https://zign.al',
  'https://app.zignallabs.com',
] as const

function matchesOrigin(url: string, origins: readonly string[]): boolean {
  // A literal prefix test, deliberately. Parsing first and comparing `origin`
  // afterwards accepts `//host/x` and a handful of other shapes that are not
  // absolute https URLs at all.
  if (!url.startsWith('https://')) return false
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:') return false
  return origins.some((origin) => parsed.origin === origin)
}

export function isApprovedEmbedUrl(url: string): boolean {
  return matchesOrigin(url, SPYGLASS_EMBED_ORIGINS)
}

export function isApprovedDashboardUrl(url: string): boolean {
  return matchesOrigin(url, SPYGLASS_DASHBOARD_ORIGINS)
}

/** Why a URL was refused, in words an administrator can act on. */
export function dashboardUrlProblem(url: string): string | null {
  const trimmed = url.trim()
  if (!trimmed) return 'Enter a dashboard address.'
  if (trimmed.startsWith('//')) {
    return 'A protocol-relative address is not accepted. Start with https://.'
  }
  if (!trimmed.startsWith('https://')) return 'The address must start with https://.'
  if (!isApprovedDashboardUrl(trimmed)) {
    return `Only ${SPYGLASS_DASHBOARD_ORIGINS.join(' and ')} are approved Spyglass destinations.`
  }
  return null
}

/**
 * How many snapshots belong on the main surface.
 *
 * Three. More than that and the page becomes a wall of frozen charts competing
 * with the live dashboard link that is the actual way to see current data.
 */
export const MAX_PRIMARY_WIDGETS = 3
