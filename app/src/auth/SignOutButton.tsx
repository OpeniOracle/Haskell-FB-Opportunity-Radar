import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/auth/authContext'
import { Icon } from '@/components/Icon'

/**
 * The sign-out control, in the authenticated shell.
 *
 * It shows WHO is signed in as well as offering the way out. A shared review
 * laptop with no visible identity is how somebody dismisses an opportunity
 * under a colleague's name, and the address is the cheapest possible answer to
 * "am I me right now".
 *
 * `signOut()` in the provider sets the state directly rather than waiting for
 * the provider's own event, so the protected interface is gone the moment this
 * is pressed — not one network round trip later. What that does NOT do, and
 * must never be described as doing, is invalidate the access token everywhere:
 * the token stays cryptographically valid until it expires. The evidence proxy
 * is the one place that refuses it immediately, because it checks the session
 * table on every request (ADR 0015).
 */
export function SignOutButton({ compact = false }: { compact?: boolean } = {}) {
  const { session, signOut } = useAuth()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)

  if (!session) return null

  async function onClick() {
    if (busy) return
    setBusy(true)
    await signOut()
    navigate('/login', { replace: true })
  }

  const email = session.user.email

  return (
    <div className={`sign-out${compact ? ' sign-out--compact' : ''}`}>
      {!compact && email ? (
        <p className="sign-out__who">
          <span className="sign-out__who-label">Signed in as</span>
          <span className="sign-out__who-email" title={email}>
            {email}
          </span>
        </p>
      ) : null}
      <button
        type="button"
        className="btn btn--quiet sign-out__button"
        onClick={onClick}
        disabled={busy}
        // Compact placement drops the visible word, so the name has to travel
        // with the control for anyone navigating by button.
        aria-label={compact ? 'Sign out' : undefined}
      >
        <Icon name="lock" className="btn__icon" />
        {compact ? null : <span>{busy ? 'Signing out…' : 'Sign out'}</span>}
      </button>
    </div>
  )
}
