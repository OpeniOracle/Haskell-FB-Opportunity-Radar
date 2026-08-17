import { Outlet } from 'react-router-dom'
import { NavRail } from '@/components/NavRail'
import { IllustrativeBanner } from '@/components/Illustrative'

/**
 * The application shell: navigation rail, persistent illustrative-data banner,
 * and the routed content region.
 *
 * The banner sits INSIDE the scroll container and above the outlet so it is
 * present on every surface without each surface having to remember it.
 */
export function AppShell() {
  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      <NavRail />
      <div className="shell__main">
        <IllustrativeBanner />
        <main className="shell__content" id="main" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
