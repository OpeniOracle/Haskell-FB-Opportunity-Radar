import { createContext, useContext } from 'react'
import type { AuthPort, AuthSession, SignInFailure } from '@/auth/authPort'

/**
 * The authentication context and its types, kept apart from the provider.
 *
 * Not an architectural flourish: React Fast Refresh only preserves state for a
 * module that exports components and nothing else, so a hook living beside
 * `AuthProvider` would make every edit to either one remount the whole
 * application during development.
 */

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated' | 'expired' | 'error'

/**
 * WHY the `error` state was reached. Present only in that state.
 *
 * These are not interchangeable and must never be presented as if they were.
 * `not_invited` is a fact about the account and the fix is an administrator
 * adding a row; `service_unavailable` is a fact about the deployment and the
 * fix is waiting or repairing it. Telling somebody their allowlist row is
 * missing when the real problem was that `/api/session` returned HTML sends
 * them to an administrator who will look at a row that is already there and
 * find nothing wrong -- which is exactly what happened.
 *
 * The distinction already existed in `AuthProvider`'s messages. What was
 * missing was carrying it far enough for the callback page to render a
 * different SCREEN, rather than one screen with a different sentence in it.
 */
export type AuthErrorReason = 'not_invited' | 'service_unavailable' | 'unconfigured'

export interface AuthState {
  readonly status: AuthStatus
  readonly session: AuthSession | null
  /** Present only in the `error` state. Safe to render; never a credential. */
  readonly message: string | null
  /** Present only in the `error` state. Decides which screen is shown. */
  readonly reason: AuthErrorReason | null
  /** True between the invitation being redeemed and a password being set. */
  readonly onboarding: boolean
}

export interface AuthContextValue extends AuthState {
  readonly port: AuthPort
  signIn(
    email: string,
    password: string,
  ): Promise<{ ok: true } | { ok: false; failure: SignInFailure }>
  signOut(): Promise<void>
  /**
   * Adopt a session the callback page has just redeemed.
   *
   * Returns whether it was ADMITTED. The callback must not navigate onward on
   * a session the gate has just refused — doing so sends a de-listed user to a
   * password form that immediately bounces them, and the reason never reaches
   * the screen.
   */
  adoptSession(session: AuthSession, options?: { onboarding?: boolean }): Promise<boolean>
  /** Leave onboarding once a password has been set. */
  completeOnboarding(): void
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) {
    throw new Error('useAuth was called outside AuthProvider. Every route is inside it.')
  }
  return value
}
