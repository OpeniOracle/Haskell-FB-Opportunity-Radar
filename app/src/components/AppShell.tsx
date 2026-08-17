import { Outlet } from 'react-router-dom'
import { BottomNav, MobileHeader, NavRail } from '@/components/NavRail'
import { IllustrativeBanner } from '@/components/Illustrative'
import { NARROW_QUERY, useMediaQuery } from '@/hooks/useMediaQuery'

/**
 * The application shell.
 *
 * Exactly one navigation is rendered at a time — the side rail on wide screens,
 * a labelled bottom bar plus a compact brand header on narrow ones. Switching in
 * JavaScript rather than with CSS keeps a single `Primary` landmark in the
 * accessibility tree.
 */
export function AppShell() {
  const narrow = useMediaQuery(NARROW_QUERY)

  return (
    <div className={`shell${narrow ? ' shell--narrow' : ''}`}>
      <a className="skip-link" href="#main">
        Skip to main content
      </a>

      {!narrow && <NavRail />}

      <div className="shell__main">
        {narrow && <MobileHeader />}
        <IllustrativeBanner />
        <main className="shell__content" id="main" tabIndex={-1}>
          <Outlet />
        </main>
      </div>

      {narrow && <BottomNav />}
    </div>
  )
}
