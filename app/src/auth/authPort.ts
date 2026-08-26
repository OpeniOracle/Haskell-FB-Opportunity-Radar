/**
 * The authentication port.
 *
 * Everything the application needs from an identity provider, expressed as one
 * small interface, with a Supabase-backed implementation beside it.
 *
 * WHY A PORT. Two reasons, both practical rather than architectural taste:
 *
 *   1. Every flow below — an expired invitation, a spent invitation, a session
 *      that dies mid-visit, an account removed from the allowlist — is a thing
 *      that happens to a REAL project on a REAL day and cannot be produced on
 *      demand. Behind a port they are ordinary test inputs, so those paths are
 *      exercised rather than reasoned about.
 *   2. It keeps `supabase-js` out of every page. The pages speak in
 *      `AuthSession` and `SignInFailure`, so a client upgrade is one file.
 *
 * The port also fixes the vocabulary. `signInWithPassword` returns a
 * `SignInFailure` with a `code`, and the pages render ONE message for every
 * code — see `LoginPage`. Distinguishing "no such account" from "wrong
 * password" would answer, for anybody who asks, whether a given address holds
 * an account here.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSession as getServerSession } from '@/lib/apiClient'
import { supabaseBrowser } from '@/lib/supabaseClient'
import { classifyFailure, type RedeemFailure, type UrlCredential } from '@/auth/urlCredentials'

export interface AuthUser {
  readonly id: string
  readonly email: string | null
  readonly isAnonymous: boolean
}

export interface AuthSession {
  readonly accessToken: string
  readonly user: AuthUser
  /** Seconds since the epoch, when the provider reported one. */
  readonly expiresAt: number | null
}

export type AuthChangeEvent =
  | 'INITIAL_SESSION'
  | 'SIGNED_IN'
  | 'SIGNED_OUT'
  | 'TOKEN_REFRESHED'
  | 'USER_UPDATED'
  | 'PASSWORD_RECOVERY'

export interface SignInFailure {
  /** For behaviour and for tests. Never rendered — see `LoginPage`. */
  readonly code: 'invalid_credentials' | 'rate_limited' | 'not_invited' | 'unavailable' | 'unknown'
  readonly retryAfterSeconds?: number
}

export type RedeemResult =
  | { readonly ok: true; readonly session: AuthSession }
  | { readonly ok: false; readonly reason: RedeemFailure }

/** Whether the address behind a session is still on `auth_invite_allowlist`. */
export type InvitationStanding = 'invited' | 'not_invited' | 'unknown'

export interface AuthPort {
  /** False when the build was never pointed at a project. */
  readonly configured: boolean
  getSession(): Promise<AuthSession | null>
  /** Returns an unsubscribe function. */
  onAuthStateChange(
    handler: (event: AuthChangeEvent, session: AuthSession | null) => void,
  ): () => void
  signInWithPassword(
    email: string,
    password: string,
  ): Promise<{ ok: true; session: AuthSession } | { ok: false; failure: SignInFailure }>
  signOut(): Promise<void>
  updatePassword(password: string): Promise<{ ok: true } | { ok: false; message: string }>
  sendRecoveryEmail(email: string, redirectTo: string): Promise<void>
  redeem(credential: UrlCredential): Promise<RedeemResult>
  /**
   * Asked of the SERVER, because it cannot be asked of the browser: migration
   * 0016 revokes `auth_invite_allowlist` from `authenticated`, so a browser
   * session cannot read the list it is on. `/api/session` answers the one bit.
   */
  confirmStanding(accessToken: string): Promise<InvitationStanding>
  /**
   * OPTIONAL, and NOT implemented by the Supabase port.
   *
   * "Do you already know the answer, without a round trip?" A real provider
   * never does — `getSession()` reads persisted storage asynchronously and
   * `confirmStanding()` is an HTTP call — so in production these are absent,
   * the provider starts in `loading`, and `RequireAuth` renders nothing until
   * the answer arrives. That is the no-flash guarantee and nothing here weakens
   * it.
   *
   * The test fake implements them so that a surface test, whose subject is a
   * surface rather than the gate, gets its first paint authenticated instead of
   * awaiting a microtask six hundred times over. The asynchronous path still
   * runs and still confirms — this is a PRE-FILL, never a replacement — and
   * `authGate.test.tsx` deliberately uses a port without them, so the pending
   * state is proven against production semantics rather than the shortcut.
   */
  peekSession?(): AuthSession | null
  peekStanding?(accessToken: string): InvitationStanding | null
}

// ---------------------------------------------------------------------------

interface SupabaseSessionShape {
  access_token?: string
  expires_at?: number
  user?: { id?: string; email?: string | null; is_anonymous?: boolean }
}

export function toAuthSession(raw: SupabaseSessionShape | null | undefined): AuthSession | null {
  if (!raw?.access_token || !raw.user?.id) return null
  return {
    accessToken: raw.access_token,
    expiresAt: typeof raw.expires_at === 'number' ? raw.expires_at : null,
    user: {
      id: raw.user.id,
      email: raw.user.email ?? null,
      // An anonymous session is signed in with nobody behind it. The database
      // refuses to create such an account (migration 0016); the gate refuses to
      // accept one even if the platform ever issued it.
      isAnonymous: raw.user.is_anonymous === true || !raw.user.email,
    },
  }
}

function classifySignInError(message: string, status?: number): SignInFailure {
  const text = message.toLowerCase()
  if (status === 429 || text.includes('rate limit') || text.includes('too many')) {
    return { code: 'rate_limited' }
  }
  if (text.includes('invalid login') || text.includes('invalid credentials') || status === 400) {
    return { code: 'invalid_credentials' }
  }
  if (status === 0 || text.includes('failed to fetch') || text.includes('network')) {
    return { code: 'unavailable' }
  }
  return { code: 'unknown' }
}

/**
 * The real port.
 *
 * `client` is passed in rather than imported so that a caller can build one
 * against a different project; `browserAuthPort()` is the ordinary path.
 */
export function supabaseAuthPort(client: SupabaseClient): AuthPort {
  return {
    configured: true,

    async getSession() {
      const { data } = await client.auth.getSession()
      return toAuthSession(data.session as SupabaseSessionShape | null)
    },

    onAuthStateChange(handler) {
      const { data } = client.auth.onAuthStateChange((event, session) => {
        handler(event as AuthChangeEvent, toAuthSession(session as SupabaseSessionShape | null))
      })
      return () => data.subscription.unsubscribe()
    },

    async signInWithPassword(email, password) {
      const { data, error } = await client.auth.signInWithPassword({ email, password })
      if (error) {
        return {
          ok: false,
          failure: classifySignInError(error.message, (error as { status?: number }).status),
        }
      }
      const session = toAuthSession(data.session as SupabaseSessionShape | null)
      if (!session) return { ok: false, failure: { code: 'unknown' } }
      return { ok: true, session }
    },

    async signOut() {
      // `local` scope: end THIS browser's session. A global sign-out would end
      // the person's other devices too, which is not what a Sign out control in
      // one window means.
      await client.auth.signOut({ scope: 'local' })
    },

    async updatePassword(password) {
      const { error } = await client.auth.updateUser({ password })
      if (error) {
        // The provider's own policy message is useful here and contains no
        // secret — it is about the password just typed, not about the account.
        return { ok: false, message: error.message }
      }
      return { ok: true }
    },

    async sendRecoveryEmail(email, redirectTo) {
      // The result is deliberately discarded. Whether an address has an account
      // is not something this endpoint may reveal, so the caller always shows
      // the same confirmation.
      await client.auth.resetPasswordForEmail(email, { redirectTo })
    },

    async redeem(credential) {
      if (credential.kind === 'none') return { ok: false, reason: 'missing' }
      if (credential.kind === 'error') return { ok: false, reason: credential.reason }

      try {
        if (credential.kind === 'fragment') {
          const { data, error } = await client.auth.setSession({
            access_token: credential.accessToken,
            refresh_token: credential.refreshToken,
          })
          if (error) return { ok: false, reason: classifyFailure(null, error.message) }
          const session = toAuthSession(data.session as SupabaseSessionShape | null)
          return session ? { ok: true, session } : { ok: false, reason: 'unknown' }
        }

        if (credential.kind === 'code') {
          const { data, error } = await client.auth.exchangeCodeForSession(credential.code)
          if (error) return { ok: false, reason: classifyFailure(null, error.message) }
          const session = toAuthSession(data.session as SupabaseSessionShape | null)
          return session ? { ok: true, session } : { ok: false, reason: 'unknown' }
        }

        const { data, error } = await client.auth.verifyOtp({
          token_hash: credential.tokenHash,
          type: (credential.type ?? 'invite') as 'invite',
        })
        if (error) return { ok: false, reason: classifyFailure(null, error.message) }
        const session = toAuthSession(data.session as SupabaseSessionShape | null)
        return session ? { ok: true, session } : { ok: false, reason: 'unknown' }
      } catch {
        // A thrown error here would otherwise reach an error boundary and might
        // render the credential inside a stack trace.
        return { ok: false, reason: 'unknown' }
      }
    },

    async confirmStanding(accessToken) {
      const result = await getServerSession(accessToken)
      if (!result.ok) {
        // A 401 is an answer: the server refused this session.
        if (result.error.status === 401 || result.error.status === 403) return 'not_invited'
        return 'unknown'
      }
      return result.value.invited && !result.value.isAnonymous ? 'invited' : 'not_invited'
    },
  }
}

/**
 * A port for a build that was never pointed at a project.
 *
 * Fails closed and says so, rather than throwing at module scope. A blank page
 * tells a reviewer nothing; "not configured" tells them exactly one thing.
 */
export const unconfiguredAuthPort: AuthPort = {
  configured: false,
  getSession: async () => null,
  onAuthStateChange: () => () => {},
  signInWithPassword: async () => ({ ok: false, failure: { code: 'unavailable' } }),
  signOut: async () => {},
  updatePassword: async () => ({ ok: false, message: 'Authentication is not configured.' }),
  sendRecoveryEmail: async () => {},
  redeem: async () => ({ ok: false, reason: 'unknown' }),
  confirmStanding: async () => 'unknown',
}

let cachedPort: AuthPort | null = null

export function browserAuthPort(): AuthPort {
  if (cachedPort) return cachedPort
  const client = supabaseBrowser()
  cachedPort = client ? supabaseAuthPort(client) : unconfiguredAuthPort
  return cachedPort
}
