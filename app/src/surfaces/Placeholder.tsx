import { Link } from 'react-router-dom'
import { Icon } from '@/components/Icon'
import { UnavailableState } from '@/components/SurfaceStates'
import type { ReservedDestination, SurfaceDescriptor } from '@/routes'

/**
 * Placeholder for a Phase 1 surface whose fixture-backed build is roadmap PR 2.
 *
 * It uses the established `UnavailableState`, not a bespoke panel, so the
 * not-yet-built case reads the same as every other "we cannot show you this"
 * case in the product. `role="status"` rather than `alert`: a scheduled surface
 * is not an emergency.
 */
export function SurfacePlaceholder({ surface }: { surface: SurfaceDescriptor }) {
  return (
    <>
      <header className="page-head page-head--tight">
        <div>
          <h1 className="page-head__title">{surface.label}</h1>
          <p className="page-head__sub">{surface.summary}</p>
        </div>
      </header>

      <UnavailableState
        title="Arrives in roadmap PR 2"
        reason="This is a Phase 1 surface. The route is wired and reachable; the fixture-backed surface itself is built in roadmap PR 2, which covers the remaining five surfaces."
        blockedBy="Scheduled work — roadmap PR 2 (plan §14), epics E-A4 and E-A5"
        checkedAt={null}
        icon={surface.icon}
        role="status"
      />

      {surface.scheduled.length > 0 && (
        <section className="section placeholder" aria-labelledby="planned-title">
          <div className="section__head">
            <h2 className="section__title" id="planned-title">
              What this surface will do
            </h2>
          </div>
          <ul className="placeholder__list">
            {surface.scheduled.map((item) => (
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

/**
 * A navigation position reserved for a later phase.
 *
 * Deliberately worded differently from the PR 2 placeholder. "Not part of
 * Phase 1" and "arrives in roadmap PR 2" are different facts, and a reviewer
 * counting Phase 1 surfaces must be able to tell them apart at a glance.
 */
export function ReservedPlaceholder({
  destination,
}: {
  destination: ReservedDestination
}) {
  return (
    <>
      <header className="page-head page-head--tight">
        <div>
          <h1 className="page-head__title">{destination.label}</h1>
          <p className="page-head__sub">
            Reserved in the navigation so the eventual shape of the product is visible.
          </p>
        </div>
      </header>

      <UnavailableState
        title="Not part of Phase 1"
        reason={`This destination is reserved for a later phase. It depends on ${destination.dependsOn}, none of which exists yet.`}
        blockedBy="Later phase — plan §11.4 reserves this position rather than hiding it"
        checkedAt={null}
        icon={destination.icon}
        role="status"
      />

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
      <header className="page-head page-head--tight">
        <div>
          <h1 className="page-head__title">Page not found</h1>
          <p className="page-head__sub">
            That address does not match any surface in this application.
          </p>
        </div>
      </header>

      <div className="state state--unavailable" role="alert">
        <Icon name="alert" className="state__icon" />
        <div className="state__text">
          <h2 className="state__title">No such route</h2>
          <p className="state__body">
            If you followed a link from elsewhere in the application, that is a bug worth
            reporting rather than a page that has not been built yet.
          </p>
        </div>
      </div>

      <p className="placeholder__back">
        <Link to="/">Back to Daily Pulse</Link>
      </p>
    </>
  )
}
