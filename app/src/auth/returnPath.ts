/**
 * Where a user goes after signing in.
 *
 * The return path arrives in a query string, which means it is attacker-supplied
 * even when the link looks internal. An unchecked `?next=` is an open redirect:
 * a link to OUR login page that lands the user on somebody else's, on a domain
 * they half-recognise, immediately after they were asked to type a password.
 *
 * So this is an allowlist by SHAPE, not a denylist of bad values. Anything that
 * is not plainly a path within this application resolves to the home page. A
 * refusal is silent by design — telling the caller their redirect was rejected
 * only tells an attacker which spelling to try next.
 */

export const DEFAULT_RETURN_PATH = '/'

/** The query parameter both the gate and the login page use. */
export const RETURN_PARAM = 'next'

/**
 * Routes it is never useful to return to.
 *
 * Returning to `/login` after signing in produces a loop, and returning to a
 * one-shot credential route (`/auth/callback`) replays a link whose token has
 * already been spent.
 */
const NEVER_RETURN_TO = ['/login', '/forgot-password', '/auth/']

export function isSafeReturnPath(candidate: string | null | undefined): boolean {
  if (!candidate) return false
  // Control characters, including the tab and newline that some parsers strip
  // and others do not — the disagreement between them is the vulnerability.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(candidate)) return false
  if (!candidate.startsWith('/')) return false
  // `//evil.example` and `/\evil.example` are both protocol-relative URLs to
  // another host once a browser resolves them.
  if (candidate.startsWith('//') || candidate.startsWith('/\\')) return false
  if (candidate.includes('\\')) return false
  // A scheme anywhere means this is not the path it is pretending to be.
  if (/^[a-z][a-z0-9+.-]*:/i.test(candidate)) return false
  if (NEVER_RETURN_TO.some((prefix) => candidate === prefix || candidate.startsWith(prefix))) {
    return false
  }
  return true
}

/** The candidate if it is safe, otherwise the home page. Never throws. */
export function safeReturnPath(candidate: string | null | undefined): string {
  return isSafeReturnPath(candidate) ? (candidate as string) : DEFAULT_RETURN_PATH
}

/** Build the login address that will send a user back where they were going. */
export function loginPathFor(location: { pathname: string; search: string }): string {
  const attempted = `${location.pathname}${location.search}`
  if (!isSafeReturnPath(attempted) || attempted === DEFAULT_RETURN_PATH) return '/login'
  return `/login?${RETURN_PARAM}=${encodeURIComponent(attempted)}`
}

/** Read the return path out of a login page's own query string. */
export function returnPathFromSearch(search: string): string {
  return safeReturnPath(new URLSearchParams(search).get(RETURN_PARAM))
}
