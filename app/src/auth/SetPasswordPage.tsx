import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { AuthLayout, FormError } from '@/auth/AuthLayout'
import { useAuth } from '@/auth/authContext'
import { Icon } from '@/components/Icon'
import {
  MIN_PASSWORD_LENGTH,
  PASSWORD_REQUIREMENTS,
  checkPassword,
  type PasswordProblem,
} from '@/auth/passwordPolicy'
import { scrubCredentialFromHistory } from '@/auth/urlCredentials'

/**
 * `/auth/set-password` and `/auth/reset-password` — the same form, two doorways.
 *
 * Both require a live session that was established from an emailed link: the
 * invitation redeemed at `/auth/callback`, or the recovery link redeemed at the
 * same place. Reaching either address without one is not an error state, it is
 * simply not a page — the visitor is sent to sign in.
 *
 * THE REQUIREMENTS ARE SHOWN BEFORE SUBMISSION. A policy discovered by failing
 * it is a policy that produces `Password1!`, because the fastest way past a
 * rule you meet one error at a time is the least imaginative thing that
 * satisfies it.
 */
export function SetPasswordPage({ mode }: { mode: 'invitation' | 'recovery' }) {
  const { status, session, completeOnboarding, signOut } = useAuth()
  const navigate = useNavigate()

  const passwordId = useId()
  const confirmId = useId()
  const errorId = useId()
  const requirementsId = useId()
  const firstFieldRef = useRef<HTMLInputElement>(null)

  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [problems, setProblems] = useState<PasswordProblem[]>([])
  const [serverError, setServerError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const { port } = useAuth()

  useEffect(() => {
    // Belt and braces. The callback already scrubbed, but a recovery link can
    // land here directly if a redirect target is ever configured that way, and
    // a credential must not survive in history on either path.
    scrubCredentialFromHistory(
      mode === 'invitation' ? '/auth/set-password' : '/auth/reset-password',
    )
    firstFieldRef.current?.focus()
  }, [mode])

  if (status === 'loading') return null
  if (status !== 'authenticated' || !session) {
    // No live session means no link was redeemed, or it has since ended.
    return <Navigate to="/login" replace />
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setServerError(null)

    const found = checkPassword(password, confirmation)
    setProblems(found)
    if (found.length > 0) {
      firstFieldRef.current?.focus()
      return
    }

    setBusy(true)
    const result = await port.updatePassword(password)
    setBusy(false)

    if (!result.ok) {
      setServerError(result.message)
      return
    }

    // Only now. A redirect before the update succeeds strands an invited user
    // inside the application with no password and no way back to this form.
    completeOnboarding()
    setPassword('')
    setConfirmation('')

    if (mode === 'invitation') {
      // The invitation session is the one they just proved; carry it inward.
      navigate('/', { replace: true })
      return
    }

    // A RECOVERY session is different. It was established by a link from an
    // inbox, not by anybody typing the new password — so ending it and asking
    // for the new password is both the honest confirmation that it works and
    // the thing that stops a recovery link doubling as a way in.
    await signOut()
    navigate('/login', { replace: true })
  }

  const messages = [...problems.map((problem) => problem.message), serverError].filter(
    (value): value is string => Boolean(value),
  )

  return (
    <AuthLayout
      title={mode === 'invitation' ? 'Choose a password' : 'Set a new password'}
      lede={
        mode === 'invitation'
          ? `Your invitation is accepted${session.user.email ? ` for ${session.user.email}` : ''}. Choose a password to finish setting up your account.`
          : 'Choose a new password. You will be asked to sign in with it.'
      }
    >
      <form className="auth-form" onSubmit={onSubmit} noValidate>
        <ul className="auth-form__requirements" id={requirementsId}>
          {PASSWORD_REQUIREMENTS.map((requirement) => (
            <li className="auth-form__requirement" key={requirement}>
              <Icon name="check" className="auth-form__requirement-glyph" />
              <span>{requirement}</span>
            </li>
          ))}
        </ul>

        <div className="auth-form__field">
          <label className="auth-form__label" htmlFor={passwordId}>
            New password
          </label>
          <input
            className="auth-form__input"
            id={passwordId}
            ref={firstFieldRef}
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-describedby={messages.length ? `${requirementsId} ${errorId}` : requirementsId}
            aria-invalid={messages.length ? true : undefined}
          />
        </div>

        <div className="auth-form__field">
          <label className="auth-form__label" htmlFor={confirmId}>
            Confirm new password
          </label>
          <input
            className="auth-form__input"
            id={confirmId}
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            required
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            aria-describedby={messages.length ? errorId : undefined}
            aria-invalid={messages.length ? true : undefined}
          />
        </div>

        {messages.length > 0 ? (
          <FormError id={errorId}>
            {messages.length === 1 ? (
              messages[0]
            ) : (
              <ul className="auth-form__error-list">
                {messages.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            )}
          </FormError>
        ) : null}

        <button className="btn btn--primary auth-form__submit" type="submit" disabled={busy}>
          {busy ? 'Saving…' : mode === 'invitation' ? 'Set password and continue' : 'Set password'}
        </button>
      </form>
    </AuthLayout>
  )
}
