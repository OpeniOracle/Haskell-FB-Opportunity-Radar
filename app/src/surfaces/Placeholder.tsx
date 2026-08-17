import { Link } from 'react-router-dom'
import { Icon } from '@/components/Icon'
import type { RouteDescriptor } from '@/routes'

/**
 * Placeholder for a route scheduled for a later milestone.
 *
 * It names the milestone and lists what the surface will do. A blank "coming
 * soon" page tells a reviewer nothing; this one tells them the route exists, is
 * wired, and is deliberately empty — which is a different fact from broken.
 */
export function Placeholder({ route }: { route: RouteDescriptor }) {
  return (
    <>
      <header className="page-head">
        <div>
          <h1 className="page-head__title">{route.label}</h1>
          <p className="page-head__sub">{route.summary}</p>
        </div>
      </header>

      <div className="state state--unavailable placeholder-state">
        <Icon name={route.icon} className="state__icon" />
        <h2 className="state__title">Scheduled for {route.milestone}</h2>
        <p className="state__body">
          The route is wired and reachable. The surface itself is not part of the
          first implementation milestone, which covers Daily Pulse and
          Opportunities only.
        </p>
      </div>

      {route.scheduled.length > 0 && (
        <section className="section placeholder" aria-labelledby="planned-title">
          <div className="section__head">
            <h2 className="section__title" id="planned-title">
              What this surface will do
            </h2>
          </div>
          <ul className="placeholder__list">
            {route.scheduled.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      )}

      <p className="placeholder__back">
        <Link to="/">Back to Daily Pulse</Link>
      </p>
    </>
  )
}

/** 404 — a real state, not a redirect that hides the mistake. */
export function NotFound() {
  return (
    <>
      <header className="page-head">
        <div>
          <h1 className="page-head__title">Page not found</h1>
          <p className="page-head__sub">
            That address does not match any surface in this application.
          </p>
        </div>
      </header>

      <div className="state state--unavailable">
        <Icon name="alert" className="state__icon" />
        <h2 className="state__title">No such route</h2>
        <p className="state__body">
          If you followed a link from elsewhere in the application, that is a bug
          worth reporting rather than a page that has not been built yet.
        </p>
      </div>

      <p className="placeholder__back">
        <Link to="/">Back to Daily Pulse</Link>
      </p>
    </>
  )
}
