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

/*
   INVITATION AND RECOVERY ARE DIFFERENT ERRANDS AND GET DIFFERENT WORDS.

   One set of sentences used to serve both, and it was written for invitations.
   Somebody who asked for a password reset, opened the emailed link and hit a
   service failure was told "Your invitation has not been used up by this" --
   about a link that was not an invitation, and with a promise the application
   cannot keep. Once GoTrue has verified or exchanged a link, whether it can be
   opened again is Supabase's business, not something this page knows.

   So recovery says "password reset link", and the safe instruction for a
   recovery failure is to REQUEST A NEW ONE once the service is back. That is
   true whether or not the old link survived, which is the property that matters
   when the page cannot tell.
*/
interface FlowCopy {
  readonly noun: string
  readonly linkFailureTitle: string
  readonly linkFailureMessage: string
  readonly linkFailureNote: string
  readonly serviceNote: string
}

const INVITATION_COPY: FlowCopy = {
  noun: 'invitation',
  linkFailureTitle: 'That invitation link cannot be used',
  linkFailureMessage:
    'This invitation link is no longer valid. Invitation links can be used once, and they expire. Ask your administrator to send a new one.',
  linkFailureNote:
    'If you already set a password, sign in normally — the invitation link is only needed once.',
  // An invitation that never reached redemption genuinely has not been spent,
  // because nothing was exchanged. This is the one case where saying so is safe.
  serviceNote:
    'Your invitation has not been used up by this. Wait a moment and open the link again, or reload this page.',
}

const RECOVERY_COPY: FlowCopy = {
  noun: 'password reset',
  linkFailureTitle: 'That password reset link cannot be used',
  linkFailureMessage:
    'This password reset link is no longer valid. Reset links can be used once, and they expire. Request a new one from the sign-in page.',
  linkFailureNote:
    'Password reset links are single-use. Requesting a new one is the way forward — it costs nothing and takes a moment.',
  // Deliberately NO claim that the link survived. This page cannot know.
  serviceNote:
    'Once the service is back, request a new password reset link from the sign-in page. Do not rely on this one still working — reset links are single-use, and this one may already have been spent.',
}

export function CallbackPage() {
  const navigate = useNavigate()
  const { adoptSession, port, status, message, reason } = useAuth()
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

  /*
    FOUR OUTCOMES, FOUR SCREENS.

    These used to be one screen -- "This account cannot be used", followed
    unconditionally by "ask your administrator to add the address to the
    invitation list". That advice is right for exactly one of them and actively
    misleading for the rest. When `/api/session` returned HTML because of a
    routing fault, an operator whose allowlist row was demonstrably present was
    sent to look for a missing row. The account was fine, the invitation was
    fine, and the deployment was broken.

    So a service failure now says so and says nothing about the allowlist.
  */
  /*
     Which errand this is. Read from the credential captured during render, so
     it is decided by what arrived in the URL rather than by anything that
     happened afterwards -- a recovery link that fails must not be described in
     invitation language just because the failure came late.
  */
  const copy: FlowCopy =
    capture.current.credentialType === 'recovery' ? RECOVERY_COPY : INVITATION_COPY

  if (status === 'error' && reason === 'service_unavailable') {
    return (
      <AuthLayout
        title="We could not verify your session"
        footer={
          <Link className="auth-shell__link" to="/login">
            Back to sign in
          </Link>
        }
      >
        <FormError id="callback-service-error">
          {message ??
            'The Radar could not reach the service that verifies sessions. This is a service problem, not a sign-in problem.'}
        </FormError>
        <p className="auth-card__note">
          {copy.serviceNote} If it keeps happening, tell your administrator that{' '}
          <code>/api/session</code> is not responding — there is nothing wrong with your account.
        </p>
      </AuthLayout>
    )
  }

  if (status === 'error' && reason === 'unconfigured') {
    return (
      <AuthLayout
        title="This deployment is not finished"
        footer={
          <Link className="auth-shell__link" to="/login">
            Back to sign in
          </Link>
        }
      >
        <FormError id="callback-unconfigured-error">
          {message ?? 'This deployment was built without a Supabase project, so nobody can sign in.'}
        </FormError>
        <p className="auth-card__note">
          Nothing is wrong with your invitation. This is for whoever deployed the site to fix.
        </p>
      </AuthLayout>
    )
  }

  // The link was good and the ACCOUNT was not. This is the one case where the
  // allowlist is genuinely the thing to go and look at.
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
        title={copy.linkFailureTitle}
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
        <FormError id="callback-link-error">{copy.linkFailureMessage}</FormError>
        <p className="auth-card__note">{copy.linkFailureNote}</p>
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
