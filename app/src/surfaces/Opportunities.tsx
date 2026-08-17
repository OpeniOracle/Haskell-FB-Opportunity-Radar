import { useCallback, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { IllustrativeNote } from '@/components/Illustrative'
import { OpportunityCard } from '@/components/OpportunityCard'
import { OpportunityDrawer } from '@/components/OpportunityDrawer'
import { OpportunityFilters } from '@/components/OpportunityFilters'
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
import {
  DEFAULT_QUERY,
  activeFilterCount,
  applyQuery,
  capabilityOptions,
  regionOptions,
  type OpportunityQuery,
} from '@/lib/opportunityFilters'
import type { Opportunity, OpportunityStatus } from '@/types/domain'

/**
 * Opportunities — a comparison surface.
 *
 * The list is meant to be scanned and narrowed, not read top to bottom. Cards are
 * compact and carry only decision-critical attributes; everything that explains
 * the reasoning is one click away in the drawer.
 *
 * Filtering and sorting run entirely in the browser over the array the
 * `DataSource` already returned. No request is made, no endpoint exists, and
 * nothing here creates a backend dependency for a later milestone to inherit.
 */
export function Opportunities() {
  const source = useDataSource()
  const { search } = useLocation()
  const load = useCallback(() => source.getOpportunities(), [source])
  const state = useSurfaceData(load, [load, search])

  const hasData =
    state.kind === 'ready' || state.kind === 'degraded' || state.kind === 'stale'

  return (
    <>
      <header className="page-head page-head--tight">
        <div>
          <h1 className="page-head__title">Opportunities</h1>
          <p className="page-head__sub">
            Ranked by priority. Open one to see the evidence and reasoning behind its
            score.
          </p>
        </div>
      </header>

      {state.kind === 'loading' && (
        <LoadingState label="Loading ranked opportunities" rows={3} />
      )}

      {state.kind === 'empty' && (
        <EmptyState
          title="No opportunities to review"
          body={state.reason}
          next="New opportunities appear here as evidence is collected."
          checkedAt={state.checkedAt}
        />
      )}

      {state.kind === 'unavailable' && (
        <UnavailableState
          title="Opportunities aren’t ranked yet"
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

      {hasData && <OpportunityWorkspace opportunities={state.data} />}
    </>
  )
}

function OpportunityWorkspace({ opportunities }: { opportunities: Opportunity[] }) {
  const [query, setQuery] = useState<OpportunityQuery>(DEFAULT_QUERY)
  const [openId, setOpenId] = useState<string | null>(null)
  const { decisions, decide } = useLocalDecisions()

  const patch = useCallback(
    (next: Partial<OpportunityQuery>) => setQuery((current) => ({ ...current, ...next })),
    [],
  )
  const clear = useCallback(() => setQuery(DEFAULT_QUERY), [])

  const regions = useMemo(() => regionOptions(opportunities), [opportunities])
  const capabilities = useMemo(() => capabilityOptions(opportunities), [opportunities])
  const statuses = useMemo(
    () =>
      [...new Set(opportunities.map((o) => o.status))].sort() as OpportunityStatus[],
    [opportunities],
  )

  const visible = useMemo(() => applyQuery(opportunities, query), [opportunities, query])
  const activeCount = activeFilterCount(query)
  const open = openId ? opportunities.find((o) => o.id === openId) : undefined

  return (
    <>
      <OpportunityFilters
        query={query}
        onChange={patch}
        onClear={clear}
        regions={regions}
        capabilities={capabilities}
        statuses={statuses}
        activeCount={activeCount}
      />

      <div className="results" role="status">
        <p className="results__count">
          <strong>{visible.length}</strong> of {opportunities.length} opportunities
          {activeCount > 0 && <span className="results__filtered"> · filtered</span>}
        </p>
        <p className="results__preview-note">
          Preview only — Pursue, Watch, Assign and Dismiss are not saved and reset on
          reload.
        </p>
        <IllustrativeNote />
      </div>

      {visible.length === 0 ? (
        <EmptyState
          title="No opportunities match these filters"
          body="Nothing has been hidden — the filters currently exclude every opportunity."
          next="Clear a filter or widen the search to see results again."
          checkedAt={null}
        />
      ) : (
        <div className="opp-list">
          {visible.map((opportunity) => (
            <OpportunityCard
              key={opportunity.id}
              opportunity={opportunity}
              decision={decisions[opportunity.id]}
              onDecide={decide}
              onReview={setOpenId}
            />
          ))}
        </div>
      )}

      {open && (
        <OpportunityDrawer
          opportunity={open}
          decision={decisions[open.id]}
          onDecide={decide}
          onClose={() => setOpenId(null)}
        />
      )}
    </>
  )
}
