import { useCallback } from 'react'
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom'
import { Icon } from '@/components/Icon'
import { IllustrativeNote } from '@/components/Illustrative'
import { StatusPill } from '@/components/StatusPill'
import { UnavailableField } from '@/components/UnavailableField'
import { AsOfControl } from '@/components/AsOfControl'
import { CoverageCard } from '@/components/CoverageCard'
import { OwnershipTimeline } from '@/components/OwnershipTimeline'
import { RecordLink } from '@/components/RecordLink'
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
import { AS_OF_PARAM, evidencePath, facilityPath, parseAsOf } from '@/lib/links'
import {
  controllingParentAsOf,
  operatorAsOf,
  relationshipsAsOf,
  retainedStakesAsOf,
} from '@/lib/ownership'
import { opportunityDetailPath } from '@/lib/opportunityFilters'
import type { Company } from '@/types/domain'

const TODAY = FIXTURE_NOW.toISOString().slice(0, 10)

/**
 * Company detail — `/accounts/:accountId`.
 *
 * The as-at date is the organising idea. ADR 0005's accepted corollary is that
 * ownership is time-bounded, which means "who owns this" and "who operates this
 * site" have no answer until you say *when*. The date lives in the URL, so a
 * shared link reproduces the same attribution rather than silently re-resolving
 * to today.
 */
export function CompanyDetail() {
  const source = useDataSource()
  const { accountId } = useParams<{ accountId: string }>()
  const load = useCallback(
    () => source.getCompany(accountId ?? ''),
    [source, accountId],
  )
  const state = useSurfaceData(load, [load])

  const hasData =
    state.kind === 'ready' || state.kind === 'degraded' || state.kind === 'stale'

  return (
    <>
      <p className="detail-back">
        <Link to="/accounts">
          <Icon name="chevron" className="detail-back__icon" />
          All companies
        </Link>
      </p>

      {state.kind === 'loading' && <LoadingState label="Loading the company" rows={1} />}

      {state.kind === 'empty' && (
        <EmptyState
          title="Nothing recorded yet"
          body={state.reason}
          next="Activity appears here as evidence is collected."
          checkedAt={state.checkedAt}
        />
      )}

      {state.kind === 'unavailable' && (
        <UnavailableState
          title="This company isn’t available"
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

      {hasData && <CompanyBody company={state.data} />}
    </>
  )
}

function CompanyBody({ company }: { company: Company }) {
  const { search } = useLocation()
  const [, setSearchParams] = useSearchParams()
  const asOf = parseAsOf(search, TODAY)

  const setAsOf = (next: string) => {
    const params = new URLSearchParams(search)
    if (next === TODAY) params.delete(AS_OF_PARAM)
    else params.set(AS_OF_PARAM, next)
    setSearchParams(params, { replace: true })
  }

  const activeRelationships = relationshipsAsOf(company.relationships, asOf)
  const parent = controllingParentAsOf(company.relationships, asOf)
  const operator = operatorAsOf(company, asOf)
  const stakes = retainedStakesAsOf(company.relationships, asOf)

  return (
    <article className="detail detail--wide">
      <header className="page-head page-head--tight">
        <div>
          <p className="detail__eyebrow">{company.role}</p>
          <h1 className="page-head__title detail__title">{company.canonicalName}</h1>
          {company.aliases.length > 0 && (
            <p className="page-head__sub">Also known as {company.aliases.join(', ')}</p>
          )}
        </div>
        <div className="page-head__meta">
          <IllustrativeNote />
        </div>
      </header>

      <div className="opp__pills detail__pills">
        {company.scopeClassStatus === 'provisional' ? (
          <StatusPill
            tone="developing"
            icon="clock"
            label="Provisional classification"
            title="Excluded from relevance metrics until confirmed (D11)."
          />
        ) : (
          <StatusPill tone="neutral" icon="dot" label="Confirmed classification" />
        )}
        {company.sectors.map((s) => (
          <StatusPill key={s} tone="neutral" icon="dot" label={s} />
        ))}
      </div>

      {company.scopeClassStatus === 'provisional' && (
        <p className="notice notice--stale">
          <Icon name="alert" className="notice__icon" />
          <span>
            <strong>Provisional classification. </strong>
            This account is classified provisionally and is{' '}
            <strong>excluded from relevance metrics</strong> until the classification is
            confirmed. D11 is approved provisionally; confirming it is a data change, not
            a code change.
          </span>
        </p>
      )}

      <AsOfControl value={asOf} onChange={setAsOf} today={TODAY} />

      <section className="detail__section" aria-labelledby="ownership-title">
        <h2 className="detail__h2" id="ownership-title">
          Ownership and related organizations
        </h2>

        <dl className="drawer__facts">
          <div className="fact">
            <dt>Controlling parent as at {asOf}</dt>
            <dd>{parent ? parent.counterpartyName : 'None — independent'}</dd>
          </div>
          <div className="fact">
            <dt>Operator as at {asOf}</dt>
            <dd>
              {operator.name}
              {operator.via === 'brand_owner' && (
                <span className="fact__qualifier"> (brand owner operates directly)</span>
              )}
            </dd>
          </div>
          <div className="fact">
            <dt>Retained stakes as at {asOf}</dt>
            <dd>
              {stakes.length === 0
                ? 'None'
                : stakes
                    .map(
                      (s) =>
                        `${s.counterpartyName} — ${s.ownershipPercent?.toFixed(1)}% (${s.ownershipPercentBasis})`,
                    )
                    .join('; ')}
            </dd>
          </div>
        </dl>

        <OwnershipTimeline
          relationships={company.relationships}
          asOf={asOf}
          search={search}
        />

        {activeRelationships.length === 0 && company.relationships.length > 0 && (
          <p className="drawer__prose drawer__prose--small">
            No relationship was in force on {asOf}. Earlier and later relationships are
            listed above with their intervals.
          </p>
        )}
      </section>

      <section className="detail__section" aria-labelledby="licensed-title">
        <h2 className="detail__h2" id="licensed-title">
          Account strategy attributes
        </h2>
        <dl className="drawer__facts">
          <UnavailableField label="Target tier" attribute={company.targetTier} />
          <UnavailableField label="Engagement" attribute={company.engagement} />
          <UnavailableField
            label="Account-strategy score"
            attribute={company.accountStrategyScore}
          />
        </dl>
        <p className="drawer__prose drawer__prose--small">
          These fields exist in the model and are deliberately unpopulated. Plan §13
          lists the trade-show attendance import, the engagement layer, tier attributes
          and account-strategy scoring as blocked by <strong>D14-L</strong>, an external
          licence review that has not concluded. Their tables are created empty so that
          clearing D14-L becomes a data operation rather than a schema change.
        </p>
      </section>

      <section className="detail__section" aria-labelledby="coverage-title">
        <h2 className="detail__h2" id="coverage-title">
          Coverage against expected sources
        </h2>
        <CoverageCard coverage={company.coverage} />
      </section>

      <section className="detail__section" aria-labelledby="facilities-title">
        <h2 className="detail__h2" id="facilities-title">
          Facilities
        </h2>
        {company.facilities.length === 0 ? (
          <div className="state state--unavailable" role="status">
            <Icon name="pin" className="state__icon" />
            <div className="state__text">
              <h3 className="state__title">No facilities resolved yet</h3>
              <p className="state__body">
                Nothing has been matched to a site for this company. That is a resolution
                outcome, not a failure — an unresolved mention is recorded rather than
                merged into the nearest plausible plant.
              </p>
            </div>
          </div>
        ) : (
          <ul className="record-list">
            {company.facilities.map((facility) => (
              <li key={facility.id}>
                <RecordLink
                  to={facilityPath(facility.id, search)}
                  icon="pin"
                  record={facility}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="detail__section" aria-labelledby="opps-title">
        <h2 className="detail__h2" id="opps-title">
          Open opportunities
        </h2>
        {company.openOpportunities.length === 0 ? (
          <p className="drawer__prose drawer__prose--small">
            No open opportunities for this company.
          </p>
        ) : (
          <ul className="record-list">
            {company.openOpportunities.map((opportunity) => (
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

      <section className="detail__section" aria-labelledby="timeline-title">
        <h2 className="detail__h2" id="timeline-title">
          Company timeline
        </h2>
        {company.timeline.length === 0 ? (
          <p className="drawer__prose drawer__prose--small">
            Nothing has been recorded against this company yet.
          </p>
        ) : (
          <ol className="timeline">
            {company.timeline.map((entry) => (
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
                  <p className="timeline__links">
                    <span className="timeline__scope">
                      {entry.scope === 'organization' ? 'Company-level' : 'Site-level'}
                    </span>
                    {entry.evidenceId && (
                      <Link to={evidencePath(entry.evidenceId, search)}>View evidence</Link>
                    )}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </article>
  )
}
