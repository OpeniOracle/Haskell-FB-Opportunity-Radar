import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AuthLayout, FormError } from '@/auth/AuthLayout'
import { AuthPending } from '@/auth/RequireAuth'
import { useAuth } from '@/auth/authContext'
import {
  classifyCallback,
  consumeMicrosoftFlowMarker,
  returnPathFromCallback,
  type CallbackFlow,
} from '@/auth/microsoftSignIn'
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

/**
 * WHEN THE PAGE CANNOT TELL WHICH ERRAND THIS IS.
 *
 * A GoTrue error redirect carries `error` and `error_code` and does NOT carry
 * `type`, so a failed recovery arrives here indistinguishable from a failed
 * invitation. The previous code resolved that by defaulting to invitation
 * language, and a reviewer who had asked to set a password was told her
 * INVITATION was invalid -- a false statement about her own account, and a
 * confusing one for someone who was never invited by email in the first place.
 *
 * Neutral is not a worse message. It is the only true one available, and it
 * still tells the person exactly what to do next.
 */
const INDETERMINATE_COPY: FlowCopy = {
  noun: 'account link',
  linkFailureTitle: 'This account link cannot be used',
  linkFailureMessage:
    'This link is no longer valid. Links and codes can be used once, and they expire. Request a new link or code and try again.',
  linkFailureNote:
    'If you were setting or resetting a password, start again from "Set or reset your password" on the sign-in page.',
  serviceNote:
    'Once the service is back, request a new link or code and try again. Do not rely on this one still working.',
}

/**
 * A Microsoft sign-in that started but did not finish.
 *
 * Covers a spent or replayed authorization code, a code that belongs to another
 * browser's PKCE exchange, a mismatched state, and an exchange that Supabase
 * refused for a reason it does not disclose. One screen for all of them,
 * because the difference between "already used" and "not yours" is a fact about
 * somebody's sign-in attempt and the person reading this is not necessarily
 * that somebody.
 *
 * The instruction is always the same and always works: start again. A Microsoft
 * sign-in costs nothing to repeat, unlike an emailed link.
 */
const MICROSOFT_COPY: FlowCopy = {
  noun: 'Microsoft sign-in',
  linkFailureTitle: 'That Microsoft sign-in could not be completed',
  linkFailureMessage:
    'The Radar could not complete this Microsoft sign-in. Sign-in attempts can only be finished once, in the browser that started them.',
  linkFailureNote:
    'Go back to the sign-in page and choose "Continue with Microsoft" again. If you have a password, that still works too.',
  serviceNote:
    'Once the service is back, start the Microsoft sign-in again from the sign-in page.',
}

/**
 * Microsoft itself said no, and did not say why in terms this page may repeat.
 *
 * `error=access_denied` is what arrives when somebody presses Cancel, when
 * administrator consent has not been granted for the tenant, and when a
 * conditional-access policy refuses. The page cannot tell them apart and must
 * not guess — telling a reviewer "your administrator has not approved this"
 * when they simply pressed Cancel sends them to raise a ticket for nothing.
 *
 * So it states what happened, offers the two things that might work, and stops.
 */
const MICROSOFT_REFUSAL_COPY: FlowCopy = {
  noun: 'Microsoft sign-in',
  linkFailureTitle: 'Microsoft did not complete the sign-in',
  linkFailureMessage:
    'Microsoft returned without signing you in. That happens if the sign-in was cancelled, or if your organization has not approved the Radar for use with Microsoft accounts.',
  linkFailureNote:
    'Try "Continue with Microsoft" once more. If it stops here again, sign in with your password instead and tell your administrator that the Radar needs approval in your Microsoft tenant.',
  serviceNote:
    'Once the service is back, start the Microsoft sign-in again from the sign-in page.',
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
    flow: CallbackFlow
    next: string
  } | null>(null)
  if (capture.current === null) {
    const { search, hash } = window.location
    const credential = parseUrlCredential(search, hash)
    capture.current = {
      credential,
      onboarding: isInvitationOnboarding(credential),
      /*
         WHICH ERRAND THIS IS, ESTABLISHED POSITIVELY.

         `consumeMicrosoftFlowMarker` reads AND removes the session marker, so it
         describes exactly one returning navigation. Read here, inside the
         ref-guarded capture, for the same reason the credential is: it must
         happen before any effect, any paint and any redirect a child could
         queue — and exactly once, because a second read would find the marker
         already spent and report a genuine Microsoft callback as something else.
      */
      flow: classifyCallback({ search, hash, microsoftFlowStarted: consumeMicrosoftFlowMarker() }),
      /*
         Where to go afterwards, sanitised AGAIN on arrival.

         It was already sanitised before it was sent to Microsoft. Doing it twice
         is not belt and braces for its own sake: what comes back arrives from
         outside, through a provider, and treating a value as safe because an
         earlier version of it was checked is how open redirects survive.
      */
      next: returnPathFromCallback(search),
    }
  }

  useEffect(() => {
    if (started.current) return
    started.current = true

    // 1. Already read, above, before anything could discard it.
    const { credential, onboarding, flow, next } = capture.current!

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

      /*
        5. Onward. `replace` throughout: the callback must not sit in history.

        An invitation goes to onboarding, a recovery link to the reset form, and
        a Microsoft sign-in to wherever the person was heading when the gate
        stopped them — which is the whole point of carrying `next` through the
        provider and back. `next` was sanitised on the way out and again on the
        way in, and `safeReturnPath` resolves anything it does not like to `/`,
        so the worst case here is the home page rather than somebody else's
        domain.
      */
      const destination = onboarding
        ? '/auth/set-password'
        : flow === 'recovery'
          ? '/auth/reset-password'
          : flow === 'microsoft'
            ? next
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
  /*
    POSITIVELY ESTABLISHED, OR NEUTRAL. There is no branch here that guesses.

    Every flow the classifier can return is listed, so adding a seventh is a
    type error rather than a silent fall through to somebody else's wording.
    `absent`, `indeterminate` and a refusal that never said which flow it
    belonged to all resolve to neutral language — which is not a worse message,
    it is the only true one available.
  */
  const COPY_FOR_FLOW: Record<CallbackFlow, FlowCopy> = {
    microsoft: MICROSOFT_COPY,
    microsoft_refusal: MICROSOFT_REFUSAL_COPY,
    invitation: INVITATION_COPY,
    recovery: RECOVERY_COPY,
    provider_refusal: INDETERMINATE_COPY,
    absent: INDETERMINATE_COPY,
    indeterminate: INDETERMINATE_COPY,
  }
  const flow = capture.current.flow
  const copy: FlowCopy = COPY_FOR_FLOW[flow]
  const isMicrosoft = flow === 'microsoft' || flow === 'microsoft_refusal'

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

  /*
    AUTHENTICATED, AND STILL NOT ALLOWED IN.

    Microsoft — or an emailed link — proved who this is. The allowlist then said
    no. That is the design working, not a fault: identity is not authorization,
    and this is the screen where the difference becomes visible to a person.

    THE MICROSOFT WORDING IS DELIBERATELY GENERIC. A successful Microsoft
    sign-in can be performed by anybody in either tenant, so this screen is
    reachable by people who are not reviewers and were never meant to be. Saying
    "your address is not on the invitation list" would confirm to any of them
    that a list exists, that theirs is not on it, and — run against a few
    addresses — which ones are. So the Microsoft case says only that access was
    not granted.

    The emailed-link case keeps its more specific wording: reaching it requires
    a link that was addressed to a particular person, so the audience is not the
    same and the extra sentence is genuinely useful to them.
  */
  if (status === 'error') {
    return isMicrosoft ? (
      <AuthLayout
        title="You are signed in, but not authorized"
        footer={
          <Link className="auth-shell__link" to="/login">
            Back to sign in
          </Link>
        }
      >
        <FormError id="callback-standing-error">
          This Microsoft account is not authorized to use the Opportunity Radar.
        </FormError>
        <p className="auth-card__note">
          Signing in with Microsoft proves who you are. Access to the Radar is granted separately,
          to named reviewers. If you should have access, ask your administrator to arrange it.
        </p>
      </AuthLayout>
    ) : (
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
        {/*
          Which FLOW this was, alongside which failure it was. Both name a
          category and neither names a token, an address or an account. Together
          they are what turns "it did not work" into an answerable support
          question without anybody having to paste a URL into a chat window.
        */}
        <span className="visually-hidden" data-testid="callback-flow">
          {flow}
        </span>
      </AuthLayout>
    )
  }

  return <AuthPending />
}
