import { NavLink, useLocation } from 'react-router-dom'
import { Icon } from '@/components/Icon'
import { ThemeToggle } from '@/components/ThemeToggle'
import { PRIMARY_ROUTES } from '@/routes'
import { useDataSource } from '@/data/DataSourceContext'

const SCENARIOS = ['ready', 'loading', 'empty', 'degraded', 'stale', 'unavailable'] as const

/**
 * Side navigation, shown from 901px up.
 *
 * On narrow screens this is hidden and `<BottomNav>` takes over. The two are
 * separate components rather than one responsive element because a side rail and
 * a bottom bar want genuinely different markup — trying to make one collapse into
 * the other is what produced the icon-only bar this replaces.
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
        <span className="nav__group-label">Surfaces</span>
        {PRIMARY_ROUTES.map((route) => (
          <NavLink
            key={route.path}
            to={{ pathname: route.path, search }}
            end={route.path === '/'}
            className="nav__link"
          >
            <Icon name={route.icon} className="nav__icon" />
            <span className="nav__link-text">{route.label}</span>
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
          Fixture build — no connectors, no database, no model calls. Design tokens are
          provisional.
        </p>
      </div>
    </nav>
  )
}

/**
 * Bottom navigation for narrow screens.
 *
 * Every destination carries a short text label under its icon. An occasional user
 * should not have to decode a glyph to find Opportunities, and the previous
 * icon-only bar asked exactly that. Labels are short enough that five fit at
 * 320px without truncation.
 */
export function BottomNav() {
  const { search } = useLocation()

  return (
    <nav className="bottom-nav" aria-label="Primary">
      {PRIMARY_ROUTES.map((route) => (
        <NavLink
          key={route.path}
          to={{ pathname: route.path, search }}
          end={route.path === '/'}
          className="bottom-nav__link"
        >
          <Icon name={route.icon} className="bottom-nav__icon" />
          <span className="bottom-nav__label">{route.shortLabel}</span>
          {!route.implemented && <span className="bottom-nav__dot" aria-hidden="true" />}
        </NavLink>
      ))}
    </nav>
  )
}

/** Compact brand bar for narrow screens, since the rail is hidden there. */
export function MobileHeader() {
  return (
    <header className="mobile-head">
      <span className="nav__mark">
        <Icon name="pulse" className="nav__mark-glyph" />
        Haskell
      </span>
      <span className="mobile-head__product">F&amp;B Opportunity Radar</span>
      <ThemeToggle compact />
    </header>
  )
}
