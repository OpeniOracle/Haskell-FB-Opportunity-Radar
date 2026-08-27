import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { AuthLayout, FormError, FormNotice } from '@/auth/AuthLayout'
import { useAuth } from '@/auth/authContext'

/**
 * `/forgot-password` — request a link, to set a password or to reset one.
 *
 * THE ANSWER IS ALWAYS THE SAME. Whether an address has an account here is not
 * something this page may reveal, so a request for an invited address and a
 * request for a stranger's address produce identical output: the same
 * sentence, the same shape, the same visible timing. Anything else turns the
 * form into a way of testing whether a colleague — or a competitor's employee —
 * has access to the Radar.
 *
 * The email itself is only sent to an existing user; that is Supabase's
 * behaviour and it is the correct one. The point is that the PAGE does not
 * disclose which case occurred.
 *
 * Recovery links land at `/auth/callback` like every other emailed link, and
 * that page routes a `type=recovery` credential to `/auth/reset-password`. One
 * doorway for every credential in an email means one place where a token is
 * read, scrubbed from history, and never logged.
 */
/*
   ONE SENTENCE FOR THREE DIFFERENT SITUATIONS.

   This page serves an invited user who forgot a password, a PRE-PROVISIONED
   user who has never had one, and a stranger with no account at all. The
   answer is identical in all three, because the differences between them are
   facts about who holds an account here -- and this application's whole access
   model is that the roster is not public.

   "set or reset" rather than "reset": for a pre-provisioned account this link
   is initial activation, and someone who has never had a password should not
   have to guess that a reset is what they need.
*/
const SAME_ANSWER =
  'If that address has an account on the Radar, a link to set or reset your password is on its way. It expires shortly and can be used once.'

export function ForgotPasswordPage() {
  const { port } = useAuth()
  const emailId = useId()
  const errorId = useId()
  const emailRef = useRef<HTMLInputElement>(null)

  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    emailRef.current?.focus()
  }, [])

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setError(null)

    const trimmed = email.trim()
    // The one thing this page will say no to is an empty box, which reveals
    // nothing about anybody.
    if (!trimmed) {
      setError('Enter your approved email address.')
      return
    }

    setBusy(true)
    try {
      await port.sendRecoveryEmail(
        trimmed,
        `${window.location.origin}/auth/callback`,
      )
    } catch {
      // Even a failure gets the same answer. A visible difference between "sent"
      // and "failed" is the enumeration channel this page exists to close.
    }
    setBusy(false)
    setSent(true)
  }

  if (sent) {
    return (
      <AuthLayout
        title="Check your email"
        footer={
          <Link className="auth-shell__link" to="/login">
            Back to sign in
          </Link>
        }
      >
        <FormNotice>{SAME_ANSWER}</FormNotice>
        <p className="auth-card__note">
          Nothing arrived? The Radar is access-controlled, so an address that has not been
          approved will not receive anything. Ask your administrator.
        </p>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title="Set or reset your password"
      lede="Enter your approved Openi or Haskell address and we will email you a link."
      footer={
        <Link className="auth-shell__link" to="/login">
          Back to sign in
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

        {error ? <FormError id={errorId}>{error}</FormError> : null}

        <button className="btn btn--primary auth-form__submit" type="submit" disabled={busy}>
          {busy ? 'Sending…' : 'Email me a link'}
        </button>
      </form>
    </AuthLayout>
  )
}
