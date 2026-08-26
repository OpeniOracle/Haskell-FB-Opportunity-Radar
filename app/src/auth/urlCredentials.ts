/**
 * Reading the credential Supabase puts in the callback URL — and then removing it.
 *
 * WHY THIS EXISTS AT ALL.
 *
 * `supabaseClient.ts` sets `detectSessionInUrl: false`, deliberately: the client
 * would otherwise consume whatever it found in the address bar automatically,
 * anywhere in the application, and leave the token sitting in `location`. That
 * choice is right, but it means SOMETHING has to read the callback URL on
 * purpose. Until now nothing did — which is exactly why an accepted invitation
 * landed on an application that never asked for a password.
 *
 * THREE SHAPES, because Supabase emits three depending on the project's email
 * templates and flow settings, and a callback that handles one of them is a
 * callback that breaks the day a template changes:
 *
 *   fragment    `#access_token=…&refresh_token=…&type=invite`
 *               The classic implicit form. `/auth/v1/verify` redirects here.
 *   code        `?code=…`
 *               PKCE. Only completes in the browser that started the flow, so
 *               it appears for recovery links the user requested here, not for
 *               a server-generated invitation.
 *   token hash  `?token_hash=…&type=invite`
 *               What a template using `{{ .TokenHash }}` produces. Redeemed
 *               with `verifyOtp`, not by setting a session.
 *
 * Plus the failure shape, which arrives in EITHER the query or the fragment:
 *   `?error=access_denied&error_code=otp_expired&error_description=…`
 *
 * NOTHING HERE IS LOGGED. The parsed value is a live credential: a token in a
 * log line, an analytics event, an error message or rendered output is the same
 * disclosure as a token in a URL, just somewhere harder to clean up.
 */

export type CredentialType = 'invite' | 'recovery' | 'signup' | 'magiclink' | 'email_change' | null

export type UrlCredential =
  | { readonly kind: 'fragment'; readonly accessToken: string; readonly refreshToken: string; readonly type: CredentialType }
  | { readonly kind: 'code'; readonly code: string; readonly type: CredentialType }
  | { readonly kind: 'token_hash'; readonly tokenHash: string; readonly type: CredentialType }
  | { readonly kind: 'error'; readonly reason: RedeemFailure; readonly type: CredentialType }
  | { readonly kind: 'none' }

export type RedeemFailure = 'expired' | 'already_used' | 'malformed' | 'missing' | 'denied' | 'unknown'

function credentialType(raw: string | null): CredentialType {
  switch (raw) {
    case 'invite':
    case 'recovery':
    case 'signup':
    case 'magiclink':
    case 'email_change':
      return raw
    default:
      return null
  }
}

/**
 * Classify a failure Supabase reported, or a redemption that came back with an
 * error message.
 *
 * The classification is for BEHAVIOUR — an expired invitation and a spent one
 * lead to the same screen — and for tests. It is never shown to the user:
 * "expired" and "already used" and "never existed" are one answer to whoever is
 * holding the link, because the differences between them are facts about
 * another person's account.
 */
export function classifyFailure(code: string | null, description: string | null): RedeemFailure {
  const text = `${code ?? ''} ${description ?? ''}`.toLowerCase()
  if (!text.trim()) return 'unknown'
  if (text.includes('expired')) return 'expired'
  if (text.includes('already') || text.includes('used') || text.includes('consumed')) {
    return 'already_used'
  }
  if (text.includes('invalid') || text.includes('malformed') || text.includes('bad_')) {
    return 'malformed'
  }
  if (text.includes('access_denied') || text.includes('denied') || text.includes('forbidden')) {
    return 'denied'
  }
  return 'unknown'
}

function paramsFromHash(hash: string): URLSearchParams {
  return new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash)
}

/**
 * Parse the credential out of a location. Pure: takes strings, returns a value.
 *
 * The fragment is checked first because when both are present the fragment is
 * the one carrying a usable session.
 */
export function parseUrlCredential(search: string, hash: string): UrlCredential {
  const query = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  const fragment = paramsFromHash(hash)

  const type = credentialType(fragment.get('type') ?? query.get('type'))

  // Reported failures come back in whichever half the flow used.
  for (const source of [fragment, query]) {
    const error = source.get('error') ?? source.get('error_code')
    if (error) {
      return {
        kind: 'error',
        reason: classifyFailure(
          source.get('error_code') ?? source.get('error'),
          source.get('error_description'),
        ),
        type,
      }
    }
  }

  const accessToken = fragment.get('access_token')
  const refreshToken = fragment.get('refresh_token')
  if (accessToken && refreshToken) {
    return { kind: 'fragment', accessToken, refreshToken, type }
  }
  // An access token with no refresh token is a truncated or hand-edited link.
  // Treating it as usable would create a session that cannot be renewed.
  if (accessToken || refreshToken) {
    return { kind: 'error', reason: 'malformed', type }
  }

  const code = query.get('code')
  if (code) return { kind: 'code', code, type }

  const tokenHash = query.get('token_hash') ?? query.get('token')
  if (tokenHash) return { kind: 'token_hash', tokenHash, type }

  return { kind: 'none' }
}

/**
 * Remove the credential from the address bar and from the history entry.
 *
 * `replaceState`, not `pushState`: pushing would leave the credential-bearing
 * entry one Back press away, which is most of what this is trying to prevent.
 * The browser's session history, the referrer of any later request, and
 * anything the user copies out of the address bar are all cleaned by this one
 * call — and it happens before the page renders anything, so a screenshot or a
 * shared window never shows the token either.
 */
export function scrubCredentialFromHistory(pathname = '/auth/callback'): void {
  if (typeof window === 'undefined' || !window.history?.replaceState) return
  try {
    window.history.replaceState(window.history.state, '', pathname)
  } catch {
    // A router or a sandboxed frame may refuse. Not fatal: the redirect that
    // follows replaces the entry anyway.
  }
}

/** True when the credential means "this person has no password yet". */
export function isInvitationOnboarding(credential: UrlCredential): boolean {
  return (
    (credential.kind === 'fragment' ||
      credential.kind === 'code' ||
      credential.kind === 'token_hash') &&
    (credential.type === 'invite' || credential.type === 'signup')
  )
}
