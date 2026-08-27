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
            <Icon name="pulse" className="auth-brand__glyph" />
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
 * A COMPACT CALLOUT, NOT A PANEL. The previous version was a flex row holding
 * an unsized `<svg>` and the message; the icon expanded to fill the line and
 * `flex: none` held it there, so the triangle swallowed the card and the text
 * was squeezed into a column a few characters wide. The shape below is the
 * correction and its rules are enforced by measurement in a real browser
 * (`scripts/browser-layout-test.mjs`), not by inspection:
 *
 *   - the icon is a fixed 20px box that can neither grow nor shrink;
 *   - the message takes every remaining pixel, with `min-width: 0` so a long
 *     unbroken string wraps instead of pushing the row wider than the card;
 *   - the height comes from the text, so there is no fixed colour panel.
 *
 * `role="alert"` because a failure that appears after a submit has to be
 * announced; the message is the live region's only content, so nothing else on
 * the page is read out with it.
 */
export function FormError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p className="auth-status auth-status--error" id={id} role="alert" data-testid="auth-status-error">
      <Icon name="alert" className="auth-status__icon" />
      <span className="auth-status__message" data-status-message>
        {children}
      </span>
    </p>
  )
}

/**
 * The confirmation counterpart.
 *
 * `role="status"` with `aria-live="polite"` rather than `alert`: a confirmation
 * is not an interruption, and a screen reader should finish the sentence it is
 * on before reading it. The wording is the caller's -- and on the recovery page
 * it is deliberately the same whether or not an account exists, which is a
 * property the browser test asserts so a future edit cannot quietly turn this
 * into an account-enumeration oracle.
 */
export function FormNotice({ children }: { children: ReactNode }) {
  return (
    <p
      className="auth-status auth-status--notice"
      role="status"
      aria-live="polite"
      data-testid="auth-status-notice"
    >
      <Icon name="check" className="auth-status__icon" />
      <span className="auth-status__message" data-status-message>
        {children}
      </span>
    </p>
  )
}
