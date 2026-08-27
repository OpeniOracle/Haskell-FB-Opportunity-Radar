import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { AuthLayout, FormError } from '@/auth/AuthLayout'
import { useAuth } from '@/auth/authContext'

/**
 * The first half of password recovery: prove you received the email.
 *
 * WHY A CODE AND NOT A LINK. A link in an email is fetched before the recipient
 * sees it. Corporate mail security opens every URL in a message to check it,
 * and a single-use recovery token is spent by whoever fetches it first — so the
 * person who clicks arrives second and is told their own link is invalid. That
 * is not a hypothetical: it is what this project's auth logs show, twice, with
 * a HEAD request carrying no user agent and GETs from different addresses and
 * platforms arriving within seconds of the email being generated.
 *
 * A code cannot be spent in transit. It is six digits in the body of the
 * message, inert until a human types them into a page a scanner never visits.
 *
 * WHAT THIS PAGE MAY SAY. Nothing about the account. "That code was not
 * accepted" is the whole vocabulary, whether the code is wrong, expired,
 * already used, or belongs to a different address — and whether or not the
 * address has an account at all. Distinguishing any of those would turn this
 * form into the account-enumeration oracle that the request page is careful
 * not to be.
 */

/** Six digits. Anything else never reaches the provider. */
const CODE_PATTERN = /^\d{6}$/

const GENERIC_REFUSAL =
  'That code was not accepted. It may have expired or already been used. Request a new one and try again.'

export function RecoveryCodeStep() {
  const { port } = useAuth()

  const emailId = useId()
  const codeId = useId()
  const errorId = useId()
  const noticeId = useId()
  const emailRef = useRef<HTMLInputElement>(null)

  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [resent, setResent] = useState(false)

  useEffect(() => {
    emailRef.current?.focus()
  }, [])

  /*
    THE CODE DOES NOT OUTLIVE THIS COMPONENT.

    On unmount — navigating away, signing out, closing the flow — the field is
    cleared. React would drop the state anyway; doing it explicitly means the
    value is not sitting in a retained closure if anything ever holds one, and
    it states the intent for whoever edits this next.
  */
  useEffect(() => {
    return () => {
      setCode('')
      setEmail('')
    }
  }, [])

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setError(null)

    const address = email.trim()
    const digits = code.trim()

    // Checked here so an obviously malformed code is not sent anywhere, and so
    // the message is about the shape rather than about the account.
    if (!address || !CODE_PATTERN.test(digits)) {
      setError('Enter the email address you requested the code for, and the six-digit code.')
      return
    }

    setBusy(true)
    const result = await port.verifyRecoveryCode(address, digits)
    setBusy(false)

    // Cleared on BOTH outcomes. On success the session carries the proof and
    // the digits are spent; on failure they are worthless and there is no
    // reason to leave them in a field for the next person at the desk.
    setCode('')

    if (!result.ok) {
      setError(GENERIC_REFUSAL)
      return
    }
    // No navigation. The provider announces the recovery session, the parent
    // re-renders as authenticated, and the password fields replace this form.
  }

  async function onResend() {
    if (busy) return
    const address = email.trim()
    if (!address) {
      setError('Enter your email address first.')
      return
    }
    setBusy(true)
    try {
      await port.sendRecoveryEmail(address, `${window.location.origin}/auth/reset-password`)
    } catch {
      // Swallowed deliberately: a provider failure must look exactly like a
      // success, or this control reports which addresses exist.
    }
    setBusy(false)
    setCode('')
    setResent(true)
  }

  return (
    <AuthLayout
      title="Enter your recovery code"
      lede="We sent a six-digit code to your email address. Enter it below with the address you used, then choose a new password."
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
          <label className="auth-form__label" htmlFor={codeId}>
            Six-digit code
          </label>
          <input
            className="auth-form__input"
            id={codeId}
            name="code"
            type="text"
            /*
              `one-time-code` is what lets a phone offer the code from the
              message instead of making someone memorise six digits and switch
              apps. `inputMode="numeric"` brings up the number pad.
            */
            autoComplete="one-time-code"
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            required
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
            aria-describedby={error ? errorId : undefined}
            aria-invalid={error ? true : undefined}
          />
        </div>

        {error ? <FormError id={errorId}>{error}</FormError> : null}

        {resent ? (
          <p className="auth-form__notice" id={noticeId} role="status" aria-live="polite">
            If that address has an account, another code is on its way. Codes expire, and only the
            newest one works.
          </p>
        ) : null}

        <button className="btn btn--primary auth-form__submit" type="submit" disabled={busy}>
          {busy ? 'Checking…' : 'Continue'}
        </button>

        <button className="btn btn--quiet auth-form__submit" type="button" onClick={onResend} disabled={busy}>
          Send me a new code
        </button>
      </form>

      <p className="auth-shell__footnote">
        <Link className="auth-shell__link" to="/login">
          Back to sign in
        </Link>
      </p>
    </AuthLayout>
  )
}
