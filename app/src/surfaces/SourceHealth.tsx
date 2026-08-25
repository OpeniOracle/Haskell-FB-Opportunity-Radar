import { useCallback } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { CoverageCard } from '@/components/CoverageCard'
import { FutureTimestampWarning, RecordedAt } from '@/components/RecordedAt'
import { Icon } from '@/components/Icon'
import { IllustrativeNote } from '@/components/Illustrative'
import { StatusPill, type PillTone } from '@/components/StatusPill'
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
import { companyPath } from '@/lib/links'
import type { ConnectorRecord, ConnectorState, SourceHealthSnapshot } from '@/types/domain'

const STATE_TONE: Record<ConnectorState, PillTone> = {
  healthy: 'confirmed',
  degraded: 'developing',
  action_required: 'attention',
  disabled: 'neutral',
  unsupported: 'neutral',
}

/**
 * Operational severity, worst first.
 *
 * The fixture order put the one connector needing action last, which on a phone
 * is roughly seven screens below the fold — the single actionable item on the
 * surface, hidden behind six healthy ones. Ordering is by what the operator has
 * to do about it, then by name so the list is stable between renders.
 */
const STATE_SEVERITY: Record<ConnectorState, number> = {
  action_required: 0,
  degraded: 1,
  unsupported: 2,
  disabled: 3,
  healthy: 4,
}

function bySeverityThenName(a: ConnectorRecord, b: ConnectorRecord): number {
  const d = STATE_SEVERITY[a.state] - STATE_SEVERITY[b.state]
  return d !== 0 ? d : a.name.localeCompare(b.name)
}

const STATE_LABEL: Record<ConnectorState, string> = {
  healthy: 'Healthy',
  degraded: 'Degraded',
  action_required: 'Action required',
  disabled: 'Disabled',
  unsupported: 'Unsupported',
}

/**
 * Source Health & Coverage — `/admin/health`.
 *
 * **Two panels that are never merged.** ADR 0010 (Proposed; D17 Open) exists
 * because a 95% connector-success rate can be read as 95% market coverage, and
 * it is not. Connector health answers "are the sources working?"; coverage
 * answers "are we watching the right things?" A healthy fleet can be watching
 * the wrong accounts, and this surface is built so that case is impossible to
 * miss rather than impossible to see.
 *
 * The separation is implemented; **no coverage measurement policy is defined
 * here** — D17 is open and this surface does not pre-empt it.
 *
 * The research-claim staging queue is deliberately absent: plan §11.2 scopes this
 * surface to two panels, and staging is not one of them.
 */
export function SourceHealth() {
  const source = useDataSource()
  const load = useCallback(() => source.getSourceHealth(), [source])
  const state = useSurfaceData(load, [load])

  const hasData =
    state.kind === 'ready' || state.kind === 'degraded' || state.kind === 'stale'

  return (
    <>
      <header className="page-head page-head--tight">
        <div>
          <h1 className="page-head__title">Source Health &amp; Coverage</h1>
          <p className="page-head__sub">
            Whether the sources are working, and whether the right things are being
            watched. Two questions, two panels, never one number.
          </p>
        </div>
        <div className="page-head__meta">
          <IllustrativeNote />
        </div>
      </header>

      {state.kind === 'loading' && <LoadingState label="Loading source health" rows={2} />}

      {state.kind === 'empty' && (
        <EmptyState
          title="No sources configured"
          body={state.reason}
          next="Health and coverage appear here once a source is enabled."
          checkedAt={state.checkedAt}
        />
      )}

      {state.kind === 'unavailable' && (
        <UnavailableState
          title="Health and coverage aren’t ready yet"
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

      {hasData && <HealthBody snapshot={state.data} />}
    </>
  )
}

function HealthBody({ snapshot }: { snapshot: SourceHealthSnapshot }) {
  const { search } = useLocation()
  const connectors = [...snapshot.connectors].sort(bySeverityThenName)
  const healthy = snapshot.connectors.filter((c) => c.state === 'healthy').length
  const needsAction = connectors.filter((c) => c.state !== 'healthy').length
  const underCovered = snapshot.coverage.filter(
    (row) => row.coverage.missingSources.length > 0,
  )

  return (
    <>
      {/* The case the ADR exists for, stated before either panel. */}
      {underCovered.length > 0 && (
        <p className="notice notice--degraded">
          <Icon name="alert" className="notice__icon" />
          <span>
            <strong>
              {healthy} of {snapshot.connectors.length} connectors are healthy, and{' '}
              {underCovered.length}{' '}
              {underCovered.length === 1 ? 'company is' : 'companies are'} still below
              expected coverage.{' '}
            </strong>
            A healthy connector fleet does not mean complete monitoring. These two figures
            are tracked separately and neither substitutes for the other.
          </span>
        </p>
      )}

      <section className="section" aria-labelledby="connector-panel">
        <div className="section__head">
          <h2 className="section__title" id="connector-panel">
            Panel 1 — Connector health
          </h2>
          <span className="section__count">{snapshot.connectors.length}</span>
          <RecordedAt
            className="section__note"
            iso={snapshot.lastCycleCompletedAt}
            prefix="Cycle completed"
          />
        </div>
        <p className="panel-scope">
          Are the sources working? This panel says nothing about whether the right
          accounts are covered. Ordered by what needs doing:{' '}
          {needsAction === 0
            ? 'nothing is currently degraded.'
            : `${needsAction} of ${connectors.length} need attention and are listed first.`}
        </p>
        <div className="connector-list">
          {connectors.map((connector) => (
            <ConnectorCard key={connector.id} connector={connector} />
          ))}
        </div>
      </section>

      <section className="section" aria-labelledby="coverage-panel">
        <div className="section__head">
          <h2 className="section__title" id="coverage-panel">
            Panel 2 — Expected coverage by company
          </h2>
          <span className="section__count">{snapshot.coverage.length}</span>
          <span className="section__note">
            {underCovered.length} below expected
          </span>
        </div>
        <p className="panel-scope">
          Are the right things being watched? A company with every connector green can
          still be under-covered, and is reported as under-covered rather than quiet.
        </p>
        <div className="coverage-list">
          {snapshot.coverage.map((row) => (
            <article className="coverage-row" key={row.companyId}>
              <h3 className="coverage-row__title">
                <Link to={companyPath(row.companyId, search)}>{row.companyName}</Link>
              </h3>
              <CoverageCard coverage={row.coverage} />
            </article>
          ))}
        </div>
        <p className="drawer__prose drawer__prose--small">
          ADR 0010 is <strong>Proposed</strong> and D17 (coverage measurement model) is{' '}
          <strong>open</strong>. The separation above follows the ADR&rsquo;s recommended
          default; no measurement policy or threshold is defined here.
        </p>
      </section>
    </>
  )
}

function ConnectorCard({ connector }: { connector: ConnectorRecord }) {
  const stale = connector.freshnessHours > connector.expectedCadenceHours

  return (
    <article className="connector" aria-labelledby={`conn-${connector.id}`}>
      <div className="connector__head">
        <h3 className="connector__name" id={`conn-${connector.id}`}>
          {connector.name}
        </h3>
        <StatusPill
          tone={STATE_TONE[connector.state]}
          icon={
            connector.state === 'healthy'
              ? 'check'
              : connector.state === 'action_required'
                ? 'alert'
                : 'clock'
          }
          label={STATE_LABEL[connector.state]}
        />
      </div>

      <dl className="connector__facts">
        <div className="fact">
          <dt>Last run</dt>
          <dd title={absoluteDateTime(connector.lastRunAt)}>
            {relativeTime(connector.lastRunAt)} · {connector.lastOutcome.replace('_', ' ')}
            <FutureTimestampWarning iso={connector.lastRunAt} />
          </dd>
        </div>
        <div className="fact">
          <dt>Consecutive failures</dt>
          <dd className={connector.consecutiveFailures > 0 ? 'connector__bad' : undefined}>
            {connector.consecutiveFailures}
          </dd>
        </div>
        <div className="fact">
          <dt>Last successful collection</dt>
          <dd>
            {connector.lastSuccessfulCollectionAt
              ? relativeTime(connector.lastSuccessfulCollectionAt)
              : 'Never'}
            {connector.lastSuccessfulCollectionAt && (
              <FutureTimestampWarning iso={connector.lastSuccessfulCollectionAt} />
            )}
          </dd>
        </div>
        <div className="fact">
          <dt>Freshness</dt>
          <dd className={stale ? 'connector__bad' : undefined}>
            {connector.freshnessHours}h against a {connector.expectedCadenceHours}h cadence
          </dd>
        </div>
      </dl>

      {connector.maintenance && (
        <p className="notice notice--degraded connector__maintenance">
          <Icon name="settings" className="notice__icon" />
          <span>
            <strong>Maintenance task open. </strong>
            {connector.maintenance.task} Opened{' '}
            {relativeTime(connector.maintenance.openedAt)}. This is a bounded engineering
            action, never routine data entry.
          </span>
        </p>
      )}

      <details className="connector__history">
        <summary>Run history ({connector.runHistory.length})</summary>
        <ul>
          {connector.runHistory.map((run) => (
            <li className={`run run--${run.outcome}`} key={run.id}>
              <span className="run__outcome">{run.outcome.replace('_', ' ')}</span>
              <span className="run__when">
                {absoluteDateTime(run.startedAt)}
                <FutureTimestampWarning iso={run.startedAt} />
              </span>
              <span className="run__note">{run.note}</span>
            </li>
          ))}
        </ul>
        <p className="drawer__prose drawer__prose--small">
          Failures stay on the record after a recovery. A health trend that silently
          rewrote itself could not be trusted.
        </p>
      </details>
    </article>
  )
}
