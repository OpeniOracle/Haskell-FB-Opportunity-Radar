import { useCallback, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
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
  OPPORTUNITY_PARAM,
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
  const load = useCallback(() => source.getOpportunities(), [source])
  // Keyed on the DataSource alone, NOT on the query string. The fixture scenario
  // already produces a new DataSource when it changes, so adding `search` here
  // only meant that opening or closing the drawer tore down and rebuilt the whole
  // list — which destroyed the card that focus was meant to return to.
  const state = useSurfaceData(load, [load])

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

/**
 * Fallback focus target for a drawer that was opened by a URL rather than by a
 * click. Prefers the matching card's review button; falls back to the main
 * region so focus never drops to the document body.
 */
function restoreFocusToCard(opportunityId: string) {
  const card = document.querySelector<HTMLElement>(
    `[data-review-for="${CSS.escape(opportunityId)}"]`,
  )
  if (card) {
    card.focus()
    return
  }
  document.getElementById('main')?.focus()
}

function OpportunityWorkspace({ opportunities }: { opportunities: Opportunity[] }) {
  const [query, setQuery] = useState<OpportunityQuery>(DEFAULT_QUERY)
  const [searchParams, setSearchParams] = useSearchParams()
  const { decisions, decide } = useLocalDecisions()

  /**
   * Drawer state lives in the URL, not in component state.
   *
   * That makes the address shareable and reload-safe, and gives the back button
   * something to return to — Daily Pulse, when the user arrived from a
   * "Needs attention today" link.
   */
  const openId = searchParams.get(OPPORTUNITY_PARAM)

  const openOpportunity = useCallback(
    (opportunityId: string) => {
      const next = new URLSearchParams(searchParams)
      next.set(OPPORTUNITY_PARAM, opportunityId)
      // Pushed, so Back closes the drawer rather than leaving the surface.
      setSearchParams(next)
    },
    [searchParams, setSearchParams],
  )

  const closeDrawer = useCallback(() => {
    const next = new URLSearchParams(searchParams)
    next.delete(OPPORTUNITY_PARAM)
    // Replaced, so closing a directly loaded link drops the parameter without
    // navigating out of the application — there may be nothing to go back to.
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])

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

  // Resolved against the FULL set, never the filtered one: a deep link must open
  // the record it names even when the current filters would hide it. An id that
  // matches nothing simply opens nothing — it never falls through to a
  // neighbouring record.
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
              onReview={openOpportunity}
            />
          ))}
        </div>
      )}

      {open && (
        <OpportunityDrawer
          opportunity={open}
          decision={decisions[open.id]}
          onDecide={decide}
          onClose={closeDrawer}
          // Arriving from a shared link means nothing was focused before the
          // drawer opened, so name where focus should land when it closes.
          restoreFocus={restoreFocusToCard}
        />
      )}
    </>
  )
}
