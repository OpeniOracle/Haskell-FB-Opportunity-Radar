import { useCallback } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { Icon } from '@/components/Icon'
import { IllustrativeNote } from '@/components/Illustrative'
import { OpportunityDetail } from '@/components/OpportunityDetail'
import {
  DegradedNotice,
  EmptyState,
  LoadingState,
  StaleNotice,
  UnavailableState,
} from '@/components/SurfaceStates'
import { useDataSource } from '@/data/DataSourceContext'
import { useLocalDecisions } from '@/hooks/useLocalDecisions'
import { useSurfaceData } from '@/hooks/useSurfaceData'
import { PRIORITY_SHORT, priorityBand } from '@/lib/opportunityFilters'
import type { Opportunity } from '@/types/domain'

/**
 * Full-page opportunity detail — `/opportunities/:opportunityId`.
 *
 * This is the address that gets shared. `10_DESIGN_RESPONSE.md` §5.3: "Deep links
 * always resolve to the full page so a brief or Teams alert lands somewhere
 * shareable." The drawer remains for in-session triage, but it holds no URL
 * state, so a pasted link can only ever arrive here.
 *
 * The body is the same `<OpportunityDetail>` the drawer renders. Nothing is
 * disclosed here that the drawer withholds, and nothing is withheld here that the
 * drawer discloses.
 *
 * All content is fixture data about fictional organizations.
 */
export function OpportunityDetailPage() {
  const source = useDataSource()
  const { search } = useLocation()
  const { opportunityId } = useParams<{ opportunityId: string }>()
  const load = useCallback(() => source.getOpportunities(), [source])
  const state = useSurfaceData(load, [load])
  const { decisions, decide } = useLocalDecisions()

  const hasData =
    state.kind === 'ready' || state.kind === 'degraded' || state.kind === 'stale'

  // Resolved against the full set. An id that matches nothing opens nothing and
  // never falls through to a neighbouring record.
  const opportunity: Opportunity | undefined = hasData
    ? state.data.find((o) => o.id === opportunityId)
    : undefined

  const backToList = { pathname: '/opportunities', search }

  return (
    <>
      <p className="detail-back">
        <Link to={backToList}>
          <Icon name="chevron" className="detail-back__icon" />
          All opportunities
        </Link>
      </p>

      {state.kind === 'loading' && <LoadingState label="Loading the opportunity" rows={1} />}

      {/* Nothing has been ranked at all, so there is no record to resolve the
          address against. Distinct from "no such opportunity", which means the
          set exists and this id is not in it. */}
      {state.kind === 'empty' && (
        <EmptyState
          title="No opportunities to open"
          body={state.reason}
          next="This address will resolve once opportunities have been ranked."
          checkedAt={state.checkedAt}
        />
      )}

      {state.kind === 'unavailable' && (
        <UnavailableState
          title="This opportunity isn’t ranked yet"
          reason={state.reason}
          blockedBy={state.blockedBy}
          checkedAt={state.checkedAt}
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

      {hasData && !opportunity && (
        <UnavailableState
          title="No such opportunity"
          reason="That address does not match any opportunity. Nothing has been opened, and no other record has been shown in its place."
          blockedBy={`Unknown identifier: ${opportunityId ?? '(none)'}`}
          checkedAt={state.checkedAt}
          role="status"
        />
      )}

      {opportunity && (
        <article className="detail">
          <header className="page-head page-head--tight">
            <div>
              <p className="detail__eyebrow">
                {opportunity.organization.canonicalName}
                <span className="detail__band">
                  {' · '}
                  {PRIORITY_SHORT[priorityBand(opportunity.scores.finalScore)]} priority
                </span>
              </p>
              <h1 className="page-head__title detail__title">{opportunity.title}</h1>
            </div>
            <div className="page-head__meta">
              <IllustrativeNote />
            </div>
          </header>

          <div className="detail__body">
            <OpportunityDetail
              opportunity={opportunity}
              decision={decisions[opportunity.id]}
              onDecide={decide}
              headingLevel={2}
            />
          </div>
        </article>
      )}
    </>
  )
}
