import { useCallback } from 'react'
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom'
import { AsOfControl } from '@/components/AsOfControl'
import { Icon } from '@/components/Icon'
import { IllustrativeNote } from '@/components/Illustrative'
import { RecordLink } from '@/components/RecordLink'
import { StatusPill } from '@/components/StatusPill'
import {
  DegradedNotice,
  EmptyState,
  LoadingState,
  StaleNotice,
  UnavailableState,
} from '@/components/SurfaceStates'
import { useDataSource } from '@/data/DataSourceContext'
import { useSurfaceData } from '@/hooks/useSurfaceData'
import { FIXTURE_NOW, formatTemporal, precisionLabel } from '@/lib/format'
import { AS_OF_PARAM, companyPath, evidencePath, parseAsOf } from '@/lib/links'
import { opportunityDetailPath } from '@/lib/opportunityFilters'
import type { FacilityOperatingStatus, FacilityRecord } from '@/types/domain'

const TODAY = FIXTURE_NOW.toISOString().slice(0, 10)

const STATUS_LABEL: Record<FacilityOperatingStatus, string> = {
  operating: 'Operating',
  under_construction: 'Under construction',
  announced: 'Announced',
  idle: 'Idle',
  closed: 'Closed',
  unknown: 'Status unknown',
}

/**
 * Facility detail — `/facilities/:facilityId`, a contextual surface.
 *
 * `10_DESIGN_RESPONSE.md` §5.2: facilities "intentionally have no top-level
 * entry — they are reached from Accounts, Opportunities, and Map." So this page
 * always shows where it was reached from.
 *
 * Two distinctions the surface exists to keep honest:
 *
 *   **Candidate vs confirmed.** An uncorroborated address is held as a candidate
 *   rather than merged into a confirmed site. ADR 0005: "unresolved is a valid
 *   terminal state," recorded as a successful outcome rather than an error.
 *
 *   **Company-level vs site-level events.** A company-level milestone may be
 *   displayed here for context, but the platform must not assert it as a
 *   facility event. The schema delta is explicit that writing one per facility
 *   "would manufacture that claim once per plant."
 */
export function FacilityDetail() {
  const source = useDataSource()
  const { facilityId } = useParams<{ facilityId: string }>()
  const load = useCallback(
    () => source.getFacility(facilityId ?? ''),
    [source, facilityId],
  )
  const state = useSurfaceData(load, [load])

  const hasData =
    state.kind === 'ready' || state.kind === 'degraded' || state.kind === 'stale'

  return (
    <>
      {state.kind === 'loading' && <LoadingState label="Loading the facility" rows={1} />}

      {state.kind === 'empty' && (
        <EmptyState
          title="Nothing recorded at this site"
          body={state.reason}
          next="Records appear here as evidence is collected."
          checkedAt={state.checkedAt}
        />
      )}

      {state.kind === 'unavailable' && (
        <UnavailableState
          title="This facility isn’t available"
          reason={state.reason}
          blockedBy={state.blockedBy}
          checkedAt={state.checkedAt}
          role="status"
        />
      )}

      {state.kind === 'degraded' && (
        <DegradedNotice
          notice={state.notice}
          affected={state.affected}
          checkedAt={state.checkedAt}
        />
      )}

      {state.kind === 'stale' && (
        <StaleNotice notice={state.notice} asOf={state.asOf} checkedAt={state.checkedAt} />
      )}

      {hasData && <FacilityBody facility={state.data} />}
    </>
  )
}

function FacilityBody({ facility }: { facility: FacilityRecord }) {
  const { search } = useLocation()
  const [, setSearchParams] = useSearchParams()
  const asOf = parseAsOf(search, TODAY)
  const isCandidate = facility.resolution === 'candidate'

  const setAsOf = (next: string) => {
    const params = new URLSearchParams(search)
    if (next === TODAY) params.delete(AS_OF_PARAM)
    else params.set(AS_OF_PARAM, next)
    setSearchParams(params, { replace: true })
  }

  const location =
    [facility.locality, facility.region].filter(Boolean).join(', ') || 'Location not resolved'

  const siteEvents = facility.timeline.filter((entry) => entry.scope === 'facility')

  return (
    <article className={`detail detail--wide${isCandidate ? ' detail--candidate' : ''}`}>
      <p className="detail-back">
        <Link to={companyPath(facility.organizationId, search)}>
          <Icon name="chevron" className="detail-back__icon" />
          {facility.organizationName}
        </Link>
      </p>

      <header className="page-head page-head--tight">
        <div>
          <p className="detail__eyebrow">
            {facility.facilityType}
            <span className="detail__band">{' · '}{location}</span>
          </p>
          <h1 className="page-head__title detail__title">{facility.name}</h1>
          {facility.addressLine && (
            <p className="page-head__sub">{facility.addressLine}</p>
          )}
        </div>
        <div className="page-head__meta">
          <IllustrativeNote />
        </div>
      </header>

      <div className="opp__pills detail__pills">
        <StatusPill
          tone={isCandidate ? 'developing' : 'confirmed'}
          icon={isCandidate ? 'clock' : 'check'}
          label={isCandidate ? 'Candidate facility' : 'Confirmed facility'}
          title={
            isCandidate
              ? 'Held as a candidate rather than merged into a confirmed site.'
              : 'Resolved against a registry identifier or corroborating source.'
          }
        />
        <StatusPill
          tone={facility.operatingStatus === 'operating' ? 'confirmed' : 'neutral'}
          icon={facility.operatingStatus === 'operating' ? 'check' : 'dot'}
          label={STATUS_LABEL[facility.operatingStatus]}
        />
      </div>

      {isCandidate && (
        <div className="notice notice--stale">
          <Icon name="alert" className="notice__icon" />
          <div>
            {/* The verdict first, in one line. The reasoning matters, but a
                reader deciding whether to trust this page should not have to
                parse five lines of it to find out the answer. */}
            <p className="notice__verdict">Candidate location, not yet confirmed</p>
            <p className="notice__detail-text">
              {facility.candidateReason} Leaving it unresolved is a successful outcome,
              not an error — a bad merge corrupts an account timeline and every score
              computed from it, while a missed match costs one opportunity.
            </p>
          </div>
        </div>
      )}

      <AsOfControl value={asOf} onChange={setAsOf} today={TODAY} />

      <section className="detail__section" aria-labelledby="fac-identity">
        <h2 className="detail__h2" id="fac-identity">
          Identity and attribution
        </h2>
        <dl className="drawer__facts">
          <div className="fact">
            <dt>Brand owner</dt>
            <dd>
              <Link to={companyPath(facility.organizationId, search)}>
                {facility.organizationName}
              </Link>
            </dd>
          </div>
          <div className="fact">
            <dt>Operator as at {asOf}</dt>
            <dd>
              {facility.organizationName}
              <span className="fact__qualifier">
                {' '}
                (resolved from the company relationship graph)
              </span>
            </dd>
          </div>
          <div className="fact">
            <dt>Location</dt>
            <dd>{location}</dd>
          </div>
          <div className="fact">
            <dt>Resolution</dt>
            <dd>{isCandidate ? 'Candidate' : 'Confirmed'}</dd>
          </div>
        </dl>
      </section>

      <section className="detail__section" aria-labelledby="fac-ids">
        <h2 className="detail__h2" id="fac-ids">
          Identifiers
        </h2>
        {facility.identifiers.length === 0 ? (
          <p className="drawer__prose drawer__prose--small">
            No identifier has been matched. This is why the site is a candidate.
          </p>
        ) : (
          <ul className="identifier-list">
            {facility.identifiers.map((identifier) => (
              <li className="identifier" key={`${identifier.scheme}-${identifier.value}`}>
                <span className="identifier__scheme">{identifier.scheme}</span>
                <span className="identifier__value">{identifier.value}</span>
                <span
                  className={`identifier__origin identifier__origin--${identifier.origin}`}
                >
                  {identifier.origin === 'deterministic'
                    ? 'Deterministic (registry)'
                    : 'Source-provided'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="detail__section" aria-labelledby="fac-timeline">
        <h2 className="detail__h2" id="fac-timeline">
          Evidence timeline
        </h2>
        {siteEvents.length === 0 ? (
          <p className="drawer__prose drawer__prose--small">
            No site-level events have been recorded.
          </p>
        ) : (
          <ol className="timeline">
            {siteEvents.map((entry) => (
              <li className="timeline__item" key={entry.id}>
                <div className="timeline__marker" aria-hidden="true" />
                <div className="timeline__body">
                  <p className="timeline__when">
                    {formatTemporal(entry.occurredOn)}
                    <span className="fact__qualifier">
                      {' '}
                      ({precisionLabel(entry.occurredOn)})
                    </span>
                  </p>
                  <h3 className="timeline__title">{entry.title}</h3>
                  <p className="timeline__detail">{entry.detail}</p>
                  {entry.evidenceId && (
                    <p className="timeline__links">
                      <Link to={evidencePath(entry.evidenceId, search)}>View evidence</Link>
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}

        <p className="notice notice--info">
          <Icon name="document" className="notice__icon" />
          <span>
            Company-level events — an ownership change or an operational separation —
            appear on the{' '}
            <Link to={companyPath(facility.organizationId, search)}>company timeline</Link>,
            not here. No fixture evidence states that this site changed hands on any of
            those dates, and recording one per facility would manufacture that claim once
            per plant.
          </span>
        </p>
      </section>

      <section className="detail__section" aria-labelledby="fac-opps">
        <h2 className="detail__h2" id="fac-opps">
          Related opportunities
        </h2>
        {facility.opportunities.length === 0 ? (
          <p className="drawer__prose drawer__prose--small">
            No opportunities reference this site.
          </p>
        ) : (
          <ul className="record-list">
            {facility.opportunities.map((opportunity) => (
              <li key={opportunity.id}>
                <RecordLink
                  to={opportunityDetailPath(opportunity.id, search)}
                  icon="target"
                  record={opportunity}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="detail__section" aria-labelledby="fac-evidence">
        <h2 className="detail__h2" id="fac-evidence">
          Evidence records
        </h2>
        {facility.evidence.length === 0 ? (
          <p className="drawer__prose drawer__prose--small">
            No evidence has been linked to this site.
          </p>
        ) : (
          <ul className="record-list">
            {facility.evidence.map((record) => (
              <li key={record.id}>
                <RecordLink
                  to={evidencePath(record.id, search)}
                  icon="document"
                  record={record}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </article>
  )
}
