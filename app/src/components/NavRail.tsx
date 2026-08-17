import { NavLink, useLocation } from 'react-router-dom'
import { Icon } from '@/components/Icon'
import { ThemeToggle } from '@/components/ThemeToggle'
import { PRIMARY_ROUTES } from '@/routes'
import { useDataSource } from '@/data/DataSourceContext'

const SCENARIOS = ['ready', 'loading', 'empty', 'degraded', 'stale', 'unavailable'] as const

/**
 * Navigation rail.
 *
 * Collapses to a horizontal icon bar under 900px (see base.css). Labels are kept
 * in the DOM and hidden visually rather than removed, so the accessible name
 * survives the collapse.
 *
 * The footer carries a state previewer. It exists because the five non-happy
 * states are a deliverable of this milestone and a reviewer should be able to
 * look at them, not take my word for it. It is fixture-only scaffolding and goes
 * away with the fixture DataSource.
 */
export function NavRail() {
  const { pathname, search } = useLocation()
  const { meta } = useDataSource()
  const current = new URLSearchParams(search).get('state') ?? 'ready'

  return (
    <nav className="nav" aria-label="Primary">
      <div className="nav__brand">
        <span className="nav__mark">
          <Icon name="pulse" className="nav__mark-glyph" />
          Haskell
        </span>
        <span className="nav__product">F&amp;B Opportunity Radar</span>
      </div>

      <div className="nav__group">
        <span className="nav__group-label" id="nav-group-surfaces">
          Surfaces
        </span>
        {PRIMARY_ROUTES.map((route) => (
          <NavLink
            key={route.path}
            to={{ pathname: route.path, search }}
            end={route.path === '/'}
            className="nav__link"
            // The label is hidden visually on narrow screens, so the accessible
            // name is supplied explicitly and survives the collapse.
            aria-label={route.label}
            title={route.label}
          >
            <Icon name={route.icon} className="nav__icon" />
            <span className="nav__link-text" aria-hidden="true">
              {route.label}
            </span>
            {!route.implemented && (
              <span className="nav__tag" aria-hidden="true">
                Later
              </span>
            )}
          </NavLink>
        ))}
      </div>

      <div className="nav__footer">
        {meta.illustrative && (
          <details className="nav__states">
            <summary className="nav__states-summary">
              <Icon name="flask" className="nav__icon" />
              Preview surface states
            </summary>
            <div className="nav__states-list">
              {SCENARIOS.map((scenario) => {
                const target =
                  scenario === 'ready' ? pathname : `${pathname}?state=${scenario}`
                return (
                  <NavLink
                    key={scenario}
                    to={target}
                    className="nav__state-link"
                    aria-current={current === scenario ? 'true' : undefined}
                  >
                    {scenario}
                  </NavLink>
                )
              })}
            </div>
          </details>
        )}

        <ThemeToggle />

        <p className="env-note">
          Fixture build — no connectors, no database, no model calls. Design tokens
          are provisional pending the design-system decision.
        </p>
      </div>
    </nav>
  )
}
