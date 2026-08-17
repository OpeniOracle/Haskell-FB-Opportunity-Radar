import { useCallback } from 'react'
import { useLocation } from 'react-router-dom'
import { IllustrativeBlock } from '@/components/Illustrative'
import { OpportunityCard } from '@/components/OpportunityCard'
import {
  DegradedNotice,
  EmptyState,
  LoadingState,
  StaleNotice,
  UnavailableState,
} from '@/components/SurfaceStates'
import { useDataSource } from '@/data/DataSourceContext'
import { useSurfaceData } from '@/hooks/useSurfaceData'
import type { Opportunity } from '@/types/domain'

/**
 * Opportunities — the ranked list.
 *
 * One full-width card per opportunity rather than a tile grid: the list is read
 * top-down and the cards should not compete for attention with each other. The
 * ranking is by final score, and the reasoning behind that score is one
 * disclosure away on every card.
 *
 * This surface carries the loudest illustrative-data treatment in the product,
 * because a fabricated opportunity mistaken for a real one is the single most
 * damaging misreading this interface could invite.
 */
export function Opportunities() {
  const source = useDataSource()
  const { search } = useLocation()
  const load = useCallback(() => source.getOpportunities(), [source])
  const state = useSurfaceData(load, [load, search])

  return (
    <>
      <header className="page-head">
        <div>
          <h1 className="page-head__title">Opportunities</h1>
          <p className="page-head__sub">
            Every live opportunity, ranked by priority score. Stage, pursuit status,
            and confidence are separate indicators — a confirmed project can still
            carry low confidence, and the card shows both.
          </p>
        </div>
      </header>

      <IllustrativeBlock />

      {state.kind === 'loading' && (
        <LoadingState label="Loading ranked opportunities" rows={4} />
      )}

      {state.kind === 'empty' && (
        <EmptyState title="No opportunities to show" body={state.reason} />
      )}

      {state.kind === 'unavailable' && (
        <UnavailableState
          title="Opportunities are unavailable"
          reason={state.reason}
          blockedBy={state.blockedBy}
        />
      )}

      {state.kind === 'degraded' && (
        <DegradedNotice notice={state.notice} affected={state.affected} />
      )}

      {state.kind === 'stale' && <StaleNotice notice={state.notice} asOf={state.asOf} />}

      {(state.kind === 'ready' || state.kind === 'degraded' || state.kind === 'stale') && (
        <OpportunityList opportunities={state.data} />
      )}
    </>
  )
}

function OpportunityList({ opportunities }: { opportunities: Opportunity[] }) {
  const ranked = [...opportunities].sort(
    (a, b) => b.scores.finalScore - a.scores.finalScore,
  )

  return (
    <section className="section" aria-labelledby="opp-list-title">
      <div className="section__head">
        <h2 className="section__title" id="opp-list-title">
          Ranked opportunities
        </h2>
        <span className="section__count">{ranked.length} shown</span>
        <span className="section__note">Highest priority score first</span>
      </div>

      <div className="opp-list">
        {ranked.map((opportunity) => (
          <OpportunityCard key={opportunity.id} opportunity={opportunity} />
        ))}
      </div>
    </section>
  )
}
