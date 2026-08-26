import type { ReactNode } from 'react'
import { Icon } from '@/components/Icon'
import { ThemeToggle } from '@/components/ThemeToggle'

/**
 * The frame every authentication page shares.
 *
 * It carries the product mark, the theme control and one `main` landmark, and
 * nothing else — no navigation, no counts, no surface names. An unauthenticated
 * visitor should be able to read this page end to end and learn only that the
 * Radar exists and is invite-only.
 *
 * The theme control is here on purpose: someone arriving from an invitation
 * email at night should not be handed a white page because the only toggle is
 * behind the login they have not completed yet.
 */
export function AuthLayout({
  title,
  lede,
  children,
  footer,
}: {
  title: string
  lede?: ReactNode
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <div className="auth-shell">
      <header className="auth-shell__head">
        <span className="auth-brand">
          <span className="auth-brand__mark" aria-hidden="true">
            <Icon name="pulse" />
          </span>
          <span className="auth-brand__text">
            <span className="auth-brand__product">Opportunity Radar</span>
            <span className="auth-brand__org">Openi Analytics</span>
          </span>
        </span>
        <ThemeToggle compact />
      </header>

      <main className="auth-card" id="main" tabIndex={-1}>
        <h1 className="auth-card__title">{title}</h1>
        {lede ? <p className="auth-card__lede">{lede}</p> : null}
        {children}
      </main>

      <footer className="auth-shell__foot">
        {footer}
        <p className="auth-shell__invite-note">
          Access is by invitation. There is no way to create an account here.
        </p>
      </footer>
    </div>
  )
}

/**
 * The one way this application reports a problem in a form.
 *
 * `role="alert"` so it is announced when it appears, and `aria-describedby`
 * wiring is the caller's job — see the pages. A visual-only error is invisible
 * to the person most likely to be struggling with the form.
 */
export function FormError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p className="auth-form__error" id={id} role="alert">
      <Icon name="alert" />
      <span>{children}</span>
    </p>
  )
}

export function FormNotice({ children }: { children: ReactNode }) {
  return (
    <p className="auth-form__notice" role="status">
      <Icon name="check" />
      <span>{children}</span>
    </p>
  )
}
