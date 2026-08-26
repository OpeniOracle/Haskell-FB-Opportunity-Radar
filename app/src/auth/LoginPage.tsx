import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { AuthLayout, FormError } from '@/auth/AuthLayout'
import { useAuth } from '@/auth/authContext'
import { returnPathFromSearch } from '@/auth/returnPath'

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
  const { status, signIn } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()

  const emailId = useId()
  const passwordId = useId()
  const errorId = useId()
  const emailRef = useRef<HTMLInputElement>(null)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const returnTo = returnPathFromSearch(location.search)
  const sessionEnded = (location.state as { from?: string } | null)?.from === 'expired'

  useEffect(() => {
    emailRef.current?.focus()
  }, [])

  // Someone who is already signed in has no business on this page; bouncing
  // them keeps a stale bookmark from looking like a sign-out.
  if (status === 'authenticated') return <Navigate to={returnTo} replace />

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
        <Link className="auth-shell__link" to="/forgot-password">
          Forgot your password?
        </Link>
      }
    >
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
