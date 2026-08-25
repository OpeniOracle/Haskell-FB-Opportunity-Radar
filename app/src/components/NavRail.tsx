import { useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { Icon } from '@/components/Icon'
import { ThemeToggle } from '@/components/ThemeToggle'
import { PRIMARY_SURFACES, RESERVED_DESTINATIONS, reservedAccessibleName } from '@/routes'
import { useDataSource } from '@/data/DataSourceContext'

const SCENARIOS = ['ready', 'loading', 'empty', 'degraded', 'stale', 'unavailable'] as const

/*
 * The reserved clause is spelled once, in `routes.ts`, beside the destinations
 * it describes — see `reservedAccessibleName`.
 *
 * Composing the name from visually hidden text was the first attempt and it
 * produced "Market Trends , RESERVED FOR A LATER PHASE": the name algorithm
 * inserts a space between sibling elements, so the comma detached, and Chromium
 * folds `text-transform: uppercase` into the computed name, so the chip's
 * styling shouted. An explicit name avoids both. It still contains the visible
 * words "Market Trends" and "Reserved", so WCAG 2.5.3 Label in Name holds, and
 * nothing is hidden from assistive technology — the chip simply is not the
 * source of the name.
 */

/** The visible chip. Not `aria-hidden`; it is just not the name source. */
function ReservedTag() {
  return <span className="nav__tag">Reserved</span>
}

/**
 * Side navigation, shown from 901px up.
 *
 * Two groups, deliberately separated:
 *
 *   Surfaces      the five Phase 1 primary entries (plan §11.4)
 *   Later phases  Market Trends, Map and Briefings — reserved positions, not
 *                 Phase 1 surfaces, rendered so the eventual shape is visible
 *
 * Keeping them apart in the markup is the point. Collapsing them into one list
 * is what let a non-Phase-1 destination be counted among the seven surfaces.
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

      {/* `role="group"` + `aria-labelledby` associates the heading with the links
          it introduces. The label was a plain span, so the grouping existed
          visually and nowhere else. */}
      <div className="nav__group" role="group" aria-labelledby="nav-group-surfaces">
        <span className="nav__group-label" id="nav-group-surfaces">
          Surfaces
        </span>
        {PRIMARY_SURFACES.map((surface) => (
          <NavLink
            key={surface.id}
            to={{ pathname: surface.routes[0], search }}
            end={surface.routes[0] === '/'}
            className="nav__link"
          >
            <Icon name={surface.icon} className="nav__icon" />
            <span className="nav__link-text">{surface.label}</span>
            {surface.status === 'scheduled' && (
              <span className="nav__tag" aria-hidden="true">
                Scheduled
              </span>
            )}
          </NavLink>
        ))}
      </div>

      <div className="nav__group" role="group" aria-labelledby="nav-group-later">
        <span className="nav__group-label" id="nav-group-later">
          Later phases
        </span>
        {RESERVED_DESTINATIONS.map((destination) => (
          <NavLink
            key={destination.id}
            to={{ pathname: destination.path, search }}
            className="nav__link nav__link--reserved"
            aria-label={reservedAccessibleName(destination.label)}
          >
            <Icon name={destination.icon} className="nav__icon" />
            <span className="nav__link-text">{destination.label}</span>
            <ReservedTag />
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
                  // A plain Link, not a NavLink. Every state preview points at
                  // the SAME pathname and differs only by `?state=`, which
                  // NavLink does not consider when deciding it is active — so
                  // all six announced `aria-current="page"` at once. Which state
                  // is showing is ours to decide, not the router's.
                  <Link
                    key={scenario}
                    to={target}
                    className="nav__state-link"
                    aria-current={current === scenario ? 'true' : undefined}
                  >
                    {scenario}
                  </Link>
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
 * Carries the five Phase 1 primary entries with a text label under each icon.
 * The three reserved positions do not fit here without dropping to five-character
 * labels, so they live in the header's "Later phases" menu instead — still
 * labelled, still reachable, and never mistaken for a Phase 1 surface.
 */
export function BottomNav() {
  const { search } = useLocation()

  return (
    <nav className="bottom-nav" aria-label="Primary">
      {PRIMARY_SURFACES.map((surface) => (
        <NavLink
          key={surface.id}
          to={{ pathname: surface.routes[0], search }}
          end={surface.routes[0] === '/'}
          className="bottom-nav__link"
        >
          <Icon name={surface.icon} className="bottom-nav__icon" />
          <span className="bottom-nav__label">{surface.shortLabel}</span>
          {surface.status === 'scheduled' && (
            <span className="bottom-nav__dot" aria-hidden="true" />
          )}
        </NavLink>
      ))}
    </nav>
  )
}

/**
 * Compact brand bar for narrow screens, carrying the reserved destinations.
 *
 * The menu is labelled text, not an icon on its own, and it names the group it
 * opens.
 */
export function MobileHeader() {
  const { search } = useLocation()
  const [open, setOpen] = useState(false)

  return (
    <header className="mobile-head">
      <span className="nav__mark">
        <Icon name="pulse" className="nav__mark-glyph" />
        Haskell
      </span>
      <span className="mobile-head__product">F&amp;B Opportunity Radar</span>

      <nav className="mobile-more" aria-label="Later phases">
        <button
          type="button"
          className="btn btn--quiet mobile-more__button"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          Later
          <Icon name="chevron" className="btn__icon" />
        </button>
        {open && (
          <ul className="mobile-more__menu">
            {RESERVED_DESTINATIONS.map((destination) => (
              <li key={destination.id}>
                <NavLink
                  to={{ pathname: destination.path, search }}
                  className="mobile-more__link"
                  aria-label={reservedAccessibleName(destination.label)}
                  onClick={() => setOpen(false)}
                >
                  <Icon name={destination.icon} className="nav__icon" />
                  {destination.label}
                  <ReservedTag />
                </NavLink>
              </li>
            ))}
          </ul>
        )}
      </nav>

      <ThemeToggle compact />
    </header>
  )
}
