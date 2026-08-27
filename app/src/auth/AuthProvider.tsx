import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { browserAuthPort, type AuthPort, type AuthSession } from '@/auth/authPort'
import {
  AuthContext,
  type AuthContextValue,
  type AuthState,
} from '@/auth/authContext'

/**
 * One place that knows whether anybody is signed in.
 *
 * FIVE STATES, not two. "Signed in or not" collapses three situations that call
 * for different screens, and collapsing them is how an application ends up
 * flashing its contents at a stranger:
 *
 *   loading          The restore is in flight. NOTHING may render — see
 *                    `RequireAuth`. This is the state that exists specifically
 *                    so there is no moment where the answer is "not yet known"
 *                    and the application renders anyway.
 *   authenticated    A live session belonging to a non-anonymous account that
 *                    is still on the invitation allowlist.
 *   unauthenticated  No session. The ordinary arrival state.
 *   expired          There WAS a session and it went away without the user
 *                    asking. Distinguished from `unauthenticated` so the login
 *                    page can say "your session ended" instead of silently
 *                    appearing over the work someone was doing.
 *   error            The provider could not be reached, or the build was never
 *                    pointed at a project. Not the same as "signed out", and it
 *                    must not be reported as one: an outage that looks like a
 *                    sign-out sends people to type their password at a page
 *                    that cannot check it.
 *
 * ALLOWLIST MEMBERSHIP IS RE-ASKED, never taken from the token. A token minted
 * before someone was removed stays cryptographically valid for its full life,
 * so `confirmStanding` runs on every session establishment and a removed account
 * is signed straight back out. The server half of the same rule — which is what
 * actually protects the data — is migration 0015's row-level security and the
 * evidence proxy's session check; this is the half that stops a removed user
 * seeing an application shell they can no longer load anything into.
 */

const NOT_INVITED_MESSAGE =
  'This account is not on the invitation list for the Radar. Contact your administrator.'
const UNREACHABLE_MESSAGE =
  'The Radar could not verify your session. This is a service problem, not a sign-in problem — try again shortly.'
const UNCONFIGURED_MESSAGE =
  'This deployment was built without a Supabase project, so nobody can sign in. See docs/ENVIRONMENT.md.'

export function AuthProvider({
  children,
  port: injected,
}: {
  children: ReactNode
  /** Supplied by tests. Production uses the browser port. */
  port?: AuthPort
}) {
  const port = useMemo(() => injected ?? browserAuthPort(), [injected])

  /**
   * `loading` in production, always: the browser port has no synchronous path
   * and cannot have one. See `AuthPort.peekSession` for why the seam exists and
   * what it does not weaken — the asynchronous restore below runs either way.
   */
  const [state, setState] = useState<AuthState>(() => {
    const peeked = port.peekSession?.()
    if (
      peeked &&
      !peeked.user.isAnonymous &&
      port.peekStanding?.(peeked.accessToken) === 'invited'
    ) {
      return { status: 'authenticated', session: peeked, message: null, reason: null, onboarding: false }
    }
    return { status: 'loading', session: null, message: null, reason: null, onboarding: false }
  })

  /** So a sign-out the user asked for is not reported as an expiry. */
  const deliberateSignOut = useRef(false)
  /** So an expiry can be told from never having been signed in. */
  const everHadSession = useRef(false)
  const mounted = useRef(true)

  /**
   * Accept a session only if the server still recognises the account.
   *
   * Returns the state to move to. A `not_invited` answer signs the session out
   * rather than leaving it half-live: a session the application refuses to use
   * but the browser still holds is a confusing thing to leave lying around.
   */
  const admit = useCallback(
    async (session: AuthSession, onboarding: boolean): Promise<AuthState> => {
      if (session.user.isAnonymous) {
        await port.signOut()
        return {
          status: 'error',
          session: null,
          message: NOT_INVITED_MESSAGE,
          reason: 'not_invited',
          onboarding: false,
        }
      }
      const standing = await port.confirmStanding(session.accessToken)
      if (standing === 'not_invited') {
        deliberateSignOut.current = true
        await port.signOut()
        return {
          status: 'error',
          session: null,
          message: NOT_INVITED_MESSAGE,
          reason: 'not_invited',
          onboarding: false,
        }
      }
      if (standing === 'unknown') {
        // Fail closed on the UI, but do NOT destroy the session: the server
        // being unreachable is not evidence about this person's access.
        return {
          status: 'error',
          session: null,
          message: UNREACHABLE_MESSAGE,
          reason: 'service_unavailable',
          onboarding: false,
        }
      }
      everHadSession.current = true
      return { status: 'authenticated', session, message: null, reason: null, onboarding }
    },
    [port],
  )

  useEffect(() => {
    mounted.current = true

    if (!port.configured) {
      setState({
        status: 'error',
        session: null,
        message: UNCONFIGURED_MESSAGE,
        reason: 'unconfigured',
        onboarding: false,
      })
      return () => {
        mounted.current = false
      }
    }

    let cancelled = false

    void (async () => {
      try {
        const existing = await port.getSession()
        if (cancelled || !mounted.current) return
        if (!existing) {
          setState({
            status: 'unauthenticated',
            session: null,
            message: null,
            reason: null,
            onboarding: false,
          })
          return
        }
        const next = await admit(existing, false)
        if (cancelled || !mounted.current) return
        setState(next)
      } catch {
        if (cancelled || !mounted.current) return
        setState({
          status: 'error',
          session: null,
          message: UNREACHABLE_MESSAGE,
          reason: 'service_unavailable',
          onboarding: false,
        })
      }
    })()

    const unsubscribe = port.onAuthStateChange((event, session) => {
      if (!mounted.current) return

      if (event === 'SIGNED_OUT' || !session) {
        const wasExpiry = everHadSession.current && !deliberateSignOut.current
        deliberateSignOut.current = false
        everHadSession.current = false
        setState({
          status: wasExpiry ? 'expired' : 'unauthenticated',
          session: null,
          message: null,
          reason: null,
          onboarding: false,
        })
        return
      }

      if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
        // Already admitted; refresh the token in place without a round trip.
        setState((current) =>
          current.status === 'authenticated' ? { ...current, session } : current,
        )
        return
      }

      // SIGNED_IN / INITIAL_SESSION / PASSWORD_RECOVERY: re-admit.
      void (async () => {
        const next = await admit(session, event === 'PASSWORD_RECOVERY')
        if (mounted.current) setState(next)
      })()
    })

    return () => {
      cancelled = true
      mounted.current = false
      unsubscribe()
    }
  }, [port, admit])

  const signIn = useCallback<AuthContextValue['signIn']>(
    async (email, password) => {
      const result = await port.signInWithPassword(email.trim(), password)
      if (!result.ok) return result
      const next = await admit(result.session, false)
      if (mounted.current) setState(next)
      if (next.status !== 'authenticated') {
        return { ok: false, failure: { code: 'not_invited' } }
      }
      return { ok: true }
    },
    [port, admit],
  )

  const signOut = useCallback(async () => {
    deliberateSignOut.current = true
    await port.signOut()
    // Set the state directly rather than waiting for the provider's event. The
    // protected UI must be gone the moment the control is pressed, not one
    // network round trip later.
    if (mounted.current) {
      everHadSession.current = false
      setState({
            status: 'unauthenticated',
            session: null,
            message: null,
            reason: null,
            onboarding: false,
          })
    }
  }, [port])

  const adoptSession = useCallback<AuthContextValue['adoptSession']>(
    async (session, options) => {
      const next = await admit(session, options?.onboarding ?? false)
      if (mounted.current) setState(next)
      return next.status === 'authenticated'
    },
    [admit],
  )

  const completeOnboarding = useCallback(() => {
    if (mounted.current) setState((current) => ({ ...current, onboarding: false }))
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({ ...state, port, signIn, signOut, adoptSession, completeOnboarding }),
    [state, port, signIn, signOut, adoptSession, completeOnboarding],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
