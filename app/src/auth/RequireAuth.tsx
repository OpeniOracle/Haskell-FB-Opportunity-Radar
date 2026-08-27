import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '@/auth/authContext'
import { loginPathFor } from '@/auth/returnPath'

/**
 * The boundary every application surface sits behind.
 *
 * The rule it enforces is narrow and absolute: **nothing renders until the
 * answer is known.** Not the navigation, not a heading, not a skeleton with the
 * right number of rows, not an empty shell that fills in a moment later. A
 * spinner over the real layout still tells a stranger how many accounts are
 * being monitored and what the surfaces are called; a skeleton still leaks the
 * shape of the product.
 *
 * So `loading` renders one neutral, contentless panel and returns. React
 * renders the branch it is given, so there is no frame in which the children
 * exist — this is not a race that is usually won, it is a branch that is never
 * taken.
 *
 * `expired` deliberately does not render its own screen. It redirects to
 * `/login`, which says the session ended — one place that handles being signed
 * out, rather than two that can disagree.
 */
export function RequireAuth() {
  const { status, message } = useAuth()
  const location = useLocation()

  if (status === 'loading') return <AuthPending />

  if (status === 'error') return <AuthUnavailable message={message} />

  if (status !== 'authenticated') {
    // `replace`, so Back does not bounce the visitor through a page they were
    // never allowed to see.
    return <Navigate to={loginPathFor(location)} replace state={{ from: status }} />
  }

  return <Outlet />
}

/**
 * The contentless state.
 *
 * `aria-busy` and a live region rather than a bare spinner: a screen-reader user
 * gets told the page is working instead of hearing nothing at all.
 */
export function AuthPending() {
  return (
    <div className="auth-pending" role="status" aria-busy="true" aria-live="polite">
      <span className="auth-pending__mark" aria-hidden="true" />
      <span className="auth-pending__label">Checking your session…</span>
    </div>
  )
}

/**
 * The provider could not be reached, or this build has no project.
 *
 * Explicitly NOT a redirect to the login page. Sending someone to type a
 * password at a page that cannot check it turns an outage into a support
 * ticket about forgotten credentials.
 */
export function AuthUnavailable({ message }: { message: string | null }) {
  return (
    <div className="auth-shell">
      <main className="auth-card" id="main" tabIndex={-1}>
        <h1 className="auth-card__title">Sign-in is unavailable</h1>
        <p className="auth-card__lede">
          {message ?? 'The Radar could not verify your session.'}
        </p>
        <p className="auth-card__note">
          Nothing is wrong with your account. Try again shortly, or tell your administrator if it
          persists.
        </p>
      </main>
    </div>
  )
}
