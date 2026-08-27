import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AuthLayout, FormError } from '@/auth/AuthLayout'
import { AuthPending } from '@/auth/RequireAuth'
import { useAuth } from '@/auth/authContext'
import {
  isInvitationOnboarding,
  parseUrlCredential,
  scrubCredentialFromHistory,
  type RedeemFailure,
} from '@/auth/urlCredentials'

/**
 * `/auth/callback` — where every emailed link lands.
 *
 * This is the page whose absence produced the reported symptom: Supabase
 * verified the invitation, redirected to the application, and the application
 * had nothing that read the credential in the URL. The user arrived signed out,
 * at a route that told them nothing, and was never asked for a password.
 *
 * The order of operations here is the design, and it is not arbitrary:
 *
 *   1. Read the credential out of `location` ONCE, DURING RENDER — before any
 *      effect, any paint, and any redirect a child could queue.
 *   2. Scrub it from the address bar and the history entry immediately —
 *      `replaceState`, so it is not one Back press away.
 *   3. Redeem it.
 *   4. Confirm the account is non-anonymous and still on the invitation
 *      allowlist (`adoptSession` does both — see `AuthProvider`).
 *   5. Send an invited user to set a password; send everyone else onward.
 *      NEVER to `/login`: an invited person has no password yet, and a login
 *      form is not a place to create one.
 *
 * Step 1 is ref-guarded so it happens exactly once. React StrictMode
 * double-invokes render in development, and a second read of an
 * already-scrubbed URL would find nothing and report a perfectly good
 * invitation as missing.
 *
 * NOTHING IS LOGGED AND NOTHING IS RENDERED. No token, no code, no hash, no
 * email address, no provider error text. The four failure reasons are
 * classified for behaviour and for tests, and they all produce the SAME
 * sentence: whether a link expired, was already used, or never existed are
 * facts about somebody's account, and the person holding a bad link is not
 * necessarily that somebody.
 */

const FAILURE_MESSAGE =
  'This link is no longer valid. Invitation and password links can be used once, and they expire. Ask your administrator to send a new one.'

export function CallbackPage() {
  const navigate = useNavigate()
  const { adoptSession, port, status, message } = useAuth()
  const started = useRef(false)
  const [failure, setFailure] = useState<RedeemFailure | null>(null)

  /*
    CAPTURED DURING RENDER, NOT IN AN EFFECT.

    A Supabase implicit invitation arrives as a URL FRAGMENT. A fragment is
    never sent to a server and is destroyed by any navigation -- so if anything
    routes before the credential is read, it is gone with no way to recover it
    and the person is handed a login form they cannot use, which is precisely
    the reported failure. An effect runs after the first paint and after any
    redirect a child may have queued during that render; reading here happens
    before either can occur.

    The ref makes it exactly once. React StrictMode double-invokes render in
    development, and a second read of an already-scrubbed URL would find nothing
    and report a perfectly good invitation as missing.
  */
  const capture = useRef<{
    credential: ReturnType<typeof parseUrlCredential>
    onboarding: boolean
    credentialType: string | null
  } | null>(null)
  if (capture.current === null) {
    const credential = parseUrlCredential(window.location.search, window.location.hash)
    capture.current = {
      credential,
      onboarding: isInvitationOnboarding(credential),
      // `none` carries no type; every other shape does.
      credentialType: credential.kind === 'none' ? null : credential.type,
    }
  }

  useEffect(() => {
    if (started.current) return
    started.current = true

    // 1. Already read, above, before anything could discard it.
    const { credential, onboarding, credentialType } = capture.current!

    // 2. Scrub before anything else can observe it.
    scrubCredentialFromHistory('/auth/callback')

    void (async () => {
      // 3. Redeem.
      const result = await port.redeem(credential)
      if (!result.ok) {
        setFailure(result.reason)
        return
      }

      // 4. Non-anonymous, and still invited. A refusal stops the flow here,
      //    with the provider's reason on screen — navigating onward would send
      //    a de-listed user to a form that bounces them and tells them nothing.
      const admitted = await adoptSession(result.session, { onboarding })
      if (!admitted) return

      // 5. Onward. `replace` throughout: the callback must not sit in history.
      //    A recovery link goes to the reset form, an invitation to onboarding,
      //    anything else straight into the application.
      const destination = onboarding
        ? '/auth/set-password'
        : credentialType === 'recovery'
          ? '/auth/reset-password'
          : '/'
      navigate(destination, { replace: true })
    })()
  }, [adoptSession, navigate, port])

  // The link was good and the account was not: say which, because this person
  // demonstrably holds a valid invitation and being told nothing is useless.
  if (status === 'error') {
    return (
      <AuthLayout
        title="This account cannot be used"
        footer={
          <Link className="auth-shell__link" to="/login">
            Back to sign in
          </Link>
        }
      >
        <FormError id="callback-standing-error">
          {message ?? 'This account is not on the invitation list for the Radar.'}
        </FormError>
        <p className="auth-card__note">
          The link itself was valid. Ask your administrator to add the address to the invitation
          list, then request a new invitation.
        </p>
      </AuthLayout>
    )
  }

  if (failure) {
    return (
      <AuthLayout
        title="That link cannot be used"
        footer={
          <Link className="auth-shell__link" to="/login">
            Back to sign in
          </Link>
        }
      >
        {/*
          A DEDICATED, NEUTRAL invitation error -- not a bounce to /login, which
          is what the broken flow did and which left the invited person to guess
          that the login form was where a password gets created. One sentence
          for expired, spent, malformed and missing alike: which one it was is a
          fact about somebody's account, and the person holding a bad link is
          not necessarily that somebody.
        */}
        <FormError id="callback-link-error">{FAILURE_MESSAGE}</FormError>
        <p className="auth-card__note">
          If you already set a password, sign in normally — the link is only needed once.
        </p>
        {/*
          The classification is carried in the markup for tests and for a
          support conversation, never as visible text. It names a category, not
          a token, an address or an account.
        */}
        <span className="visually-hidden" data-testid="callback-failure-reason">
          {failure}
        </span>
      </AuthLayout>
    )
  }

  return <AuthPending />
}
