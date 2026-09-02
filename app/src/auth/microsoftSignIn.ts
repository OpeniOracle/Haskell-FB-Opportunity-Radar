/**
 * "Continue with Microsoft" — the parts that are decisions rather than plumbing.
 *
 * Pure functions over strings. No network, no Supabase client, no `window`
 * except through the two explicit session-marker helpers at the bottom, so
 * every rule here is testable without a browser or a provider.
 *
 * THE ONE THING THIS FILE DOES NOT DO IS AUTHORIZE ANYBODY. Microsoft answers
 * "who is this"; `auth_invite_allowlist`, re-read by the server on every
 * request, answers "may they be here". Nothing below grants access on the
 * strength of a tenant, a directory or an email domain — see
 * `netlify/functions/_shared/emailIdentity.ts` for the enforcing half.
 */
import { safeReturnPath, RETURN_PARAM } from '@/auth/returnPath'

/**
 * Supabase's provider slug for Microsoft Entra ID.
 *
 * `azure`, not `microsoft`: Supabase's social-login provider kept the original
 * name through the Azure AD → Entra ID rename. This is the SOCIAL LOGIN
 * provider — the project consuming Microsoft as an identity provider. It is not
 * "OAuth Server", which would make Supabase an identity provider FOR other
 * applications and is a different feature that stays off.
 */
export const MICROSOFT_PROVIDER = 'azure'

/**
 * The scopes requested, and nothing beyond them.
 *
 * `email` is the one that matters: without it the token carries no address,
 * the account cannot be matched to an allowlist row, and the sign-in is
 * useless. `openid` and `profile` are what make it an OpenID Connect sign-in
 * and give a display name.
 *
 * There is deliberately NO Microsoft Graph scope here. The application reads
 * nothing from Microsoft beyond who is signing in — no directory, no mail, no
 * group membership — because it authorizes from its own allowlist and a
 * permission that is never used is a permission that can only ever be misused.
 */
export const MICROSOFT_SCOPES = 'openid email profile'

/**
 * The marker that says "this callback is a Microsoft sign-in".
 *
 * A PKCE recovery link and an OAuth authorization-code callback BOTH arrive as
 * `?code=…`, and telling them apart matters: they lead to different pages and
 * they need different words when they fail. Guessing between them is what
 * produced a password reset being announced as an expired invitation, and this
 * file will not repeat that.
 *
 * So the flow is marked in two independent places and read positively:
 *
 *   1. `sessionStorage`, set immediately before the redirect. Authoritative,
 *      because only this browser tab could have set it, and it is cleared on
 *      the way out so it cannot describe a later, unrelated callback.
 *   2. `?flow=microsoft` on the callback URL, which survives a storage-less
 *      browser and a session restore.
 *
 * Neither is a security control and neither is treated as one — the credential
 * is redeemed the same way whichever marker is present, and authorization is
 * unchanged. They decide which SCREEN and which WORDS the person gets.
 */
export const MICROSOFT_FLOW_PARAM = 'flow'
export const MICROSOFT_FLOW_VALUE = 'microsoft'
const FLOW_MARKER_KEY = 'radar.auth.microsoft-flow'

/**
 * Build the callback URL handed to Supabase as `redirectTo`.
 *
 * The return path is passed through `safeReturnPath` HERE, before it is ever
 * sent to a provider — not only when it comes back. A `?next=` that arrived on
 * the login page is attacker-supplied, and the moment it is embedded in a
 * redirect URL it becomes something the provider will send a freshly
 * authenticated person to. Sanitising only on the way back would leave a window
 * in which the unsafe value existed in a URL that Microsoft echoes.
 *
 * The result is always same-origin and always `/auth/callback`. The only
 * variable part is a path within this application.
 */
export function microsoftRedirectUrl(origin: string, returnTo?: string | null): string {
  const url = new URL('/auth/callback', origin)
  url.searchParams.set(MICROSOFT_FLOW_PARAM, MICROSOFT_FLOW_VALUE)

  const next = safeReturnPath(returnTo)
  // `/` is the default and adds nothing but a longer URL.
  if (next !== '/') url.searchParams.set(RETURN_PARAM, next)

  return url.toString()
}

/**
 * What kind of callback this is.
 *
 * POSITIVELY ESTABLISHED, with `indeterminate` as a real answer rather than a
 * fallback that guesses. Every value here maps to its own screen, and
 * `indeterminate` maps to neutral language that is true whatever actually
 * happened.
 */
export type CallbackFlow =
  /** A Microsoft authorization code came back, and this browser started it. */
  | 'microsoft'
  /** Microsoft reported a refusal — cancelled, consent missing, policy blocked. */
  | 'microsoft_refusal'
  | 'invitation'
  | 'recovery'
  /** A refusal from somewhere, with nothing saying which flow it belonged to. */
  | 'provider_refusal'
  /** Nothing arrived at all. A bookmark, a stripped link, a direct visit. */
  | 'absent'
  /** A credential arrived carrying nothing that says what it is for. */
  | 'indeterminate'

export interface CallbackFlowInput {
  readonly search: string
  readonly hash: string
  /** Whether THIS browser started a Microsoft sign-in. */
  readonly microsoftFlowStarted?: boolean
}

function params(search: string, hash: string): { query: URLSearchParams; fragment: URLSearchParams } {
  return {
    query: new URLSearchParams(search.startsWith('?') ? search.slice(1) : search),
    fragment: new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash),
  }
}

export function classifyCallback(input: CallbackFlowInput): CallbackFlow {
  const { query, fragment } = params(input.search, input.hash)

  const markedMicrosoft =
    input.microsoftFlowStarted === true ||
    query.get(MICROSOFT_FLOW_PARAM) === MICROSOFT_FLOW_VALUE ||
    fragment.get(MICROSOFT_FLOW_PARAM) === MICROSOFT_FLOW_VALUE

  /*
     A REFUSAL THE PROVIDER REPORTED, in whichever half the flow used.

     Checked early because it is the one shape that carries no credential at
     all: `?error=access_denied` is what arrives when somebody presses Cancel on
     the Microsoft consent screen, when an administrator has not granted
     consent, and when a conditional-access policy refuses. Those are different
     events with the same shape, and this application is not entitled to tell
     them apart for the person holding the browser — so they get one screen,
     and it does not speculate about which happened.

     The marker still matters here: knowing the refusal belongs to a Microsoft
     sign-in lets the page name Microsoft, which is the difference between "that
     did not work" and "the thing you just pressed Cancel on did not work".
  */
  const type = fragment.get('type') ?? query.get('type')
  const statedFlow: CallbackFlow | null =
    type === 'invite' || type === 'signup'
      ? 'invitation'
      : type === 'recovery'
        ? 'recovery'
        : null

  for (const source of [fragment, query]) {
    if (source.get('error') ?? source.get('error_code')) {
      /*
         A STATED TYPE STILL WINS OVER THE GENERIC REFUSAL.

         GoTrue's error redirects usually carry no `type`, which is the whole
         reason this classifier exists. But an invitation link that fails
         sometimes DOES say `type=invite`, and when it does, the person is
         holding an invitation and should be told about an invitation. Neutral
         language is the answer to not knowing — it is not better than knowing.

         The Microsoft marker outranks it, because a `?flow=microsoft` callback
         is one this browser demonstrably started and no emailed link can claim.
      */
      if (markedMicrosoft) return 'microsoft_refusal'
      return statedFlow ?? 'provider_refusal'
    }
  }

  const hasCode = Boolean(query.get('code'))
  const hasTokenHash = Boolean(query.get('token_hash') ?? query.get('token'))
  const hasFragmentSession = Boolean(fragment.get('access_token') || fragment.get('refresh_token'))

  // The marker only means something when a credential actually arrived with it.
  // A bare `?flow=microsoft` is somebody typing in the address bar.
  if (markedMicrosoft && hasCode) return 'microsoft'

  if (statedFlow) return statedFlow

  if (!hasCode && !hasTokenHash && !hasFragmentSession) return 'absent'

  /*
     A CREDENTIAL WITH NOTHING SAYING WHAT IT IS FOR.

     Not an invitation by default. That default is exactly the bug that told a
     reviewer her password reset was an expired invitation — a false statement
     about her own account, made because the code had to say something and
     invitation was first in the list.
  */
  return 'indeterminate'
}

// ---------------------------------------------------------------------------
// The session marker. The only two functions here that touch the browser.
// ---------------------------------------------------------------------------

/**
 * Record that a Microsoft sign-in is starting, immediately before the redirect.
 *
 * `sessionStorage`, not `localStorage`: this describes one navigation in one
 * tab and has no business outliving the tab. Failures are swallowed — a browser
 * with storage disabled still signs in, it just falls back to the `?flow=`
 * marker for its wording.
 *
 * Nothing identifying is stored. Not the address, not the return path, not a
 * token — one constant whose only meaning is "a redirect left from here".
 */
export function markMicrosoftFlowStarted(): void {
  try {
    window.sessionStorage?.setItem(FLOW_MARKER_KEY, '1')
  } catch {
    // Private mode, a blocked origin, a quota. Not fatal.
  }
}

/**
 * Read the marker AND remove it, in one step.
 *
 * Consuming rather than peeking is the point: the marker describes exactly one
 * returning navigation. Left behind, it would make the next unrelated callback
 * in the same tab claim to be a Microsoft sign-in.
 */
export function consumeMicrosoftFlowMarker(): boolean {
  try {
    const present = window.sessionStorage?.getItem(FLOW_MARKER_KEY) === '1'
    window.sessionStorage?.removeItem(FLOW_MARKER_KEY)
    return present
  } catch {
    return false
  }
}

/** Read the return path a Microsoft callback carried, sanitised again on arrival. */
export function returnPathFromCallback(search: string): string {
  const query = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  return safeReturnPath(query.get(RETURN_PARAM))
}
