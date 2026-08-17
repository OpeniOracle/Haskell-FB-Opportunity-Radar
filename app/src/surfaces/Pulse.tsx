import { useCallback } from 'react'
import { useLocation } from 'react-router-dom'
import { Icon, type IconName } from '@/components/Icon'
import {
  DegradedNotice,
  EmptyState,
  LoadingState,
  StaleNotice,
  UnavailableState,
} from '@/components/SurfaceStates'
import { useDataSource } from '@/data/DataSourceContext'
import { useSurfaceData } from '@/hooks/useSurfaceData'
import { absoluteDateTime, relativeTime } from '@/lib/format'
import type { ChangeTone, PulseSnapshot } from '@/types/domain'

const CHANGE_ICON: Record<string, IconName> = {
  stage_promoted: 'check',
  evidence_added: 'document',
  facility_resolved: 'pin',
  negative_signal: 'alert',
  coverage_degraded: 'alert',
  source_recovered: 'refresh',
}

/**
 * Daily Pulse — the answer to "what changed since I last looked?"
 *
 * The surface is deliberately NOT a KPI dashboard. Three figures at the top,
 * then a chronological list of material changes with the reason attached to each.
 * `04_UX_DESIGN_SPEC.md` is explicit that a change with no explanation is noise.
 *
 * Coverage and connector health are shown as two separate figures because ADR
 * 0010 forbids collapsing them into one "system health" number: a perfectly
 * healthy connector fleet can still be covering the wrong accounts.
 */
export function Pulse() {
  const source = useDataSource()
  const { search } = useLocation()
  const load = useCallback(() => source.getPulse(), [source])
  const state = useSurfaceData(load, [load, search])

  return (
    <>
      <header className="page-head">
        <div>
          <h1 className="page-head__title">Daily Pulse</h1>
          <p className="page-head__sub">
            What changed across the monitored accounts since your last visit, and
            why each change happened.
          </p>
        </div>
        {(state.kind === 'ready' || state.kind === 'degraded' || state.kind === 'stale') && (
          <div className="page-head__meta">
            <span>
              <Icon name="clock" className="stat__icon" /> Collected{' '}
              {relativeTime(state.data.generatedAt)}
            </span>
            {state.data.lastVisitAt && (
              <span>Last visit {absoluteDateTime(state.data.lastVisitAt)}</span>
            )}
          </div>
        )}
      </header>

      {state.kind === 'loading' && <LoadingState label="Loading the daily pulse" rows={3} />}

      {state.kind === 'empty' && (
        <EmptyState title="Nothing has changed since your last visit" body={state.reason} />
      )}

      {state.kind === 'unavailable' && (
        <UnavailableState
          title="The daily pulse is unavailable"
          reason={state.reason}
          blockedBy={state.blockedBy}
        />
      )}

      {state.kind === 'degraded' && (
        <DegradedNotice notice={state.notice} affected={state.affected} />
      )}

      {state.kind === 'stale' && <StaleNotice notice={state.notice} asOf={state.asOf} />}

      {(state.kind === 'ready' || state.kind === 'degraded' || state.kind === 'stale') && (
        <PulseBody snapshot={state.data} />
      )}
    </>
  )
}

function PulseBody({ snapshot }: { snapshot: PulseSnapshot }) {
  const { coverage, connectorHealth, changesSinceLastVisit } = snapshot

  return (
    <>
      <div className="pulse-grid">
        <section className="stat" aria-labelledby="stat-changes">
          <h2 className="stat__label" id="stat-changes">
            <Icon name="pulse" className="stat__icon" /> Material changes
          </h2>
          <p className="stat__value">{changesSinceLastVisit.length}</p>
          <p className="stat__note">
            Since your last visit. Only changes that alter what an analyst would do
            are counted.
          </p>
        </section>

        <section className="stat" aria-labelledby="stat-coverage">
          <h2 className="stat__label" id="stat-coverage">
            <Icon name="building" className="stat__icon" /> Account coverage
          </h2>
          <p className="stat__value">
            {coverage.accountsAtOrAboveExpected}
            <span className="stat__of">/{coverage.accountsMonitored}</span>
          </p>
          <p className="stat__note">
            Accounts meeting their expected source coverage.{' '}
            {coverage.accountsBelowExpected > 0 ? (
              <>
                Below expected: {coverage.accountsUncovered.join(', ')}.
              </>
            ) : (
              <>No account is below its expected coverage.</>
            )}
          </p>
        </section>

        <section className="stat" aria-labelledby="stat-health">
          <h2 className="stat__label" id="stat-health">
            <Icon name="settings" className="stat__icon" /> Connector health
          </h2>
          <p className="stat__value">
            {connectorHealth.healthy}
            <span className="stat__of">/{connectorHealth.sourcesEnabled}</span>
          </p>
          <p className="stat__note">
            Sources healthy on the last cycle ({connectorHealth.degraded} degraded,{' '}
            {connectorHealth.actionRequired} needing action). Tracked separately
            from coverage — a healthy fleet can still be watching the wrong things.
          </p>
        </section>
      </div>

      <section className="section" aria-labelledby="changes-title">
        <div className="section__head">
          <h2 className="section__title" id="changes-title">
            What changed
          </h2>
          <span className="section__count">{changesSinceLastVisit.length} items</span>
          <span className="section__note">Newest first</span>
        </div>

        <div className="change-list">
          {[...changesSinceLastVisit]
            .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
            .map((change) => (
              <article className="change" key={change.id}>
                <span
                  className={`change__icon change__icon--${change.tone satisfies ChangeTone}`}
                  aria-hidden="true"
                >
                  <Icon name={CHANGE_ICON[change.kind] ?? 'dot'} />
                </span>
                <div className="change__body">
                  <h3 className="change__title">
                    {change.title}
                    <span className="change__subject"> — {change.subjectLabel}</span>
                  </h3>
                  <p className="change__detail">{change.detail}</p>
                </div>
                <time className="change__when" dateTime={change.occurredAt}>
                  {relativeTime(change.occurredAt)}
                </time>
              </article>
            ))}
        </div>
      </section>
    </>
  )
}
