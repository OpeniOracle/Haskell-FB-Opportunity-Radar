import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { AuthLayout, FormError } from '@/auth/AuthLayout'
import { useAuth } from '@/auth/authContext'
import { markMicrosoftFlowStarted, microsoftRedirectUrl } from '@/auth/microsoftSignIn'
import { returnPathFromSearch } from '@/auth/returnPath'

/**
 * Microsoft's brand mark: four squares, in their four fixed colours.
 *
 * Drawn inline rather than fetched. A remote image on a sign-in page is a
 * third-party request made before anybody has signed in, it would need a
 * `img-src` grant in a content-security policy that currently needs none, and
 * it puts the page's appearance in somebody else's hands.
 *
 * The colours are Microsoft's and are not themed. Their brand guidance requires
 * the mark to sit on a neutral surface, which is why the button below is a
 * surface-coloured button with a strong border rather than an accent-filled
 * one — the accent fill would put the logo on a background it may not be shown
 * on, and would hurt its contrast in both themes.
 *
 * `aria-hidden`, because the button already says "Continue with Microsoft" in
 * text. A screen reader announcing a logo as well would say it twice.
 */
function MicrosoftMark() {
  return (
    <svg
      className="auth-provider__mark"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="1" y="1" width="10" height="10" fill="#F25022" />
      <rect x="13" y="1" width="10" height="10" fill="#7FBA00" />
      <rect x="1" y="13" width="10" height="10" fill="#00A4EF" />
      <rect x="13" y="13" width="10" height="10" fill="#FFB900" />
    </svg>
  )
}

/**
 * One message for every way starting a Microsoft sign-in can fail.
 *
 * The provider being unreachable, the project having no Azure credentials, and
 * a refused redirect are the same answer to somebody standing at a sign-in
 * page: it did not start, and it is not their fault. What they need is the
 * password form immediately below, which is why the sentence points at it.
 */
const MICROSOFT_START_FAILED =
  'Microsoft sign-in could not be started. This is not a problem with your account — you can use your password below, or try again shortly.'

/**
 * Email and password. No third option, and no way to make an account.
 *
 * ONE FAILURE MESSAGE, for every cause. "No such account", "wrong password" and
 * "that account was removed" are one answer, because the differences between
 * them are facts about who holds an account here — and this application's whole
 * access model is that the roster is not public. A form that says "unknown
 * email" is an account-enumeration endpoint with a friendly face on it.
 *
 * The only failure reported differently is rate limiting, and only because a
 * user who is being throttled needs to know that waiting is the fix. It reveals
 * nothing: it is a fact about this browser's recent behaviour, not about any
 * account.
 *
 * RATE LIMITING is Supabase's, not ours. GoTrue throttles repeated failures per
 * address and per IP, which is the right layer for it — a limiter implemented
 * in the page is one page reload away from being reset. What this page does is
 * surface the outcome honestly and stop resubmitting into it.
 */
const GENERIC_FAILURE = 'That email address and password combination was not accepted.'

export function LoginPage() {
  const { status, signIn, port } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()

  const emailId = useId()
  const passwordId = useId()
  const errorId = useId()
  const providerErrorId = useId()
  const emailRef = useRef<HTMLInputElement>(null)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [providerError, setProviderError] = useState<string | null>(null)
  const [redirecting, setRedirecting] = useState(false)

  const returnTo = returnPathFromSearch(location.search)
  const sessionEnded = (location.state as { from?: string } | null)?.from === 'expired'

  useEffect(() => {
    /*
       Focus stays on the email field even when the Microsoft button is present
       and comes first.

       Moving it to the button would mean that somebody who types their address
       out of habit -- which is what everybody with a password does -- types it
       into nothing. The button is first in the DOM, so it is first in the tab
       order and one Shift+Tab away; the field that is focused is the one people
       are about to use.
    */
    emailRef.current?.focus()
  }, [])

  // Someone who is already signed in has no business on this page; bouncing
  // them keeps a stale bookmark from looking like a sign-out.
  if (status === 'authenticated') return <Navigate to={returnTo} replace />

  async function onMicrosoft() {
    if (busy || redirecting) return
    setProviderError(null)
    setRedirecting(true)

    /*
       The marker goes down BEFORE the redirect, because after it there is no
       "after" -- the page is gone. It records one fact, "a Microsoft sign-in
       left from this tab", so that the callback can say so positively instead
       of inferring it from a `?code=` that a password-recovery link produces
       just as readily.
    */
    markMicrosoftFlowStarted()

    const result = await port.signInWithMicrosoft(
      microsoftRedirectUrl(window.location.origin, returnTo),
    )

    // Reached only when the redirect never happened; otherwise the browser has
    // already left this page.
    if (!result.ok) {
      setRedirecting(false)
      setProviderError(MICROSOFT_START_FAILED)
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setError(null)

    if (!email.trim() || !password) {
      setError(GENERIC_FAILURE)
      return
    }

    setBusy(true)
    const result = await signIn(email, password)
    setBusy(false)

    if (result.ok) {
      navigate(returnTo, { replace: true })
      return
    }

    if (result.failure.code === 'not_invited') {
      // Reached ONLY after the password was accepted, so this discloses nothing
      // to anyone who does not already hold the credentials — and it matters:
      // telling someone whose access was withdrawn that their password is wrong
      // sends them round a reset loop that cannot possibly help.
      setError(
        'That password was correct, but this account is no longer on the invitation list for the Radar. Contact your administrator.',
      )
      setPassword('')
      return
    }
    if (result.failure.code === 'rate_limited') {
      setError('Too many attempts. Wait a minute before trying again.')
      return
    }
    if (result.failure.code === 'unavailable') {
      setError('The Radar could not be reached. This is not a problem with your password.')
      return
    }
    setError(GENERIC_FAILURE)
    setPassword('')
  }

  return (
    <AuthLayout
      title="Sign in"
      lede={
        sessionEnded
          ? 'Your session ended. Sign in again to continue where you left off.'
          : 'The Opportunity Radar is private to invited Openi and Haskell reviewers.'
      }
      footer={
        /*
          "Set OR RESET", because for some people this is activation.

          An account created by administrator pre-provisioning exists with no
          password at all. Its owner has never had one to forget, and "Forgot
          your password?" is a door they would not think to try. The route is
          unchanged and so is the behaviour -- what changes is that the label
          now describes both errands, which is the honest description of what
          the page does.

          The page itself cannot tell the two apart, and must not: whether an
          address has a password yet is a fact about somebody's account.
        */
        <Link className="auth-shell__link" to="/forgot-password">
          Set or reset your password
        </Link>
      }
    >
      {port.microsoftEnabled ? (
        <section className="auth-provider" aria-labelledby={`${providerErrorId}-heading`}>
          {/*
            A heading a screen reader can land on, so the two ways of signing in
            are two named regions rather than one undifferentiated pile of
            controls. Visually hidden: sighted users get the same structure from
            the button, the note and the divider.
          */}
          <h2 className="visually-hidden" id={`${providerErrorId}-heading`}>
            Sign in with your organization account
          </h2>

          <button
            className="btn auth-provider__button"
            type="button"
            onClick={onMicrosoft}
            disabled={busy || redirecting}
            aria-describedby={providerError ? providerErrorId : undefined}
          >
            <MicrosoftMark />
            <span>{redirecting ? 'Opening Microsoft…' : 'Continue with Microsoft'}</span>
          </button>

          {providerError ? <FormError id={providerErrorId}>{providerError}</FormError> : null}

          {/*
            THE SECOND SENTENCE IS THE IMPORTANT ONE.

            Somebody at Haskell with a working Microsoft account will reasonably
            assume that a "Continue with Microsoft" button means their Microsoft
            account is what grants access. It is not, and finding that out from
            a refusal after signing in is a worse way to learn it than reading
            it here first.
          */}
          <p className="auth-card__note auth-provider__note">
            Approved Haskell and Openi reviewers can use their organizational Microsoft account.
            Access stays limited to individually authorized reviewers — a Microsoft account on its
            own does not grant it.
          </p>

          <p className="auth-provider__divider">
            <span className="auth-provider__divider-label">
              or sign in with a password
            </span>
          </p>
        </section>
      ) : null}

      <form className="auth-form" onSubmit={onSubmit} noValidate>
        <div className="auth-form__field">
          <label className="auth-form__label" htmlFor={emailId}>
            Email address
          </label>
          <input
            className="auth-form__input"
            id={emailId}
            ref={emailRef}
            name="email"
            type="email"
            autoComplete="username"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            aria-describedby={error ? errorId : undefined}
            aria-invalid={error ? true : undefined}
          />
        </div>

        <div className="auth-form__field">
          <label className="auth-form__label" htmlFor={passwordId}>
            Password
          </label>
          <input
            className="auth-form__input"
            id={passwordId}
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-describedby={error ? errorId : undefined}
            aria-invalid={error ? true : undefined}
          />
        </div>

        {error ? <FormError id={errorId}>{error}</FormError> : null}

        <button className="btn btn--primary auth-form__submit" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </AuthLayout>
  )
}
