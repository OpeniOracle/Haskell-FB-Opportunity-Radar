import { useCallback } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Icon, type IconName } from '@/components/Icon'
import {
  DegradedNotice,
  EmptyState,
  LoadingState,
  StaleNotice,
  UnavailableState,
} from '@/components/SurfaceStates'
import { IllustrativeNote } from '@/components/Illustrative'
import { useDataSource } from '@/data/DataSourceContext'
import { useSurfaceData } from '@/hooks/useSurfaceData'
import { absoluteDateTime, relativeTime } from '@/lib/format'
import type { ChangeEvent, PulseSnapshot } from '@/types/domain'

const CHANGE_ICON: Record<string, IconName> = {
  stage_promoted: 'check',
  evidence_added: 'document',
  facility_resolved: 'pin',
  negative_signal: 'alert',
  coverage_degraded: 'alert',
  source_recovered: 'refresh',
}

/**
 * Daily Pulse — "what changed, what matters, what do I do next", in that order.
 *
 * The page is structured for a business-development user with ten minutes, so
 * commercial intelligence is primary and platform operations are secondary:
 *
 *   1. Needs attention today   the two or three things worth acting on
 *   2. Three summary figures   short, with the long lists behind a disclosure
 *   3. Other market changes    everything else that moved at an account
 *   4. Coverage and system     connectors and coverage, quiet, collapsed unless
 *      notices                 something actually needs a person
 *
 * The market/system split comes from `ChangeEvent.channel` in the data, not from
 * matching on `kind` here. Coverage and connector health stay separate figures —
 * ADR 0010 forbids merging them, and they answer different questions anyway.
 */
export function Pulse() {
  const source = useDataSource()
  const { search } = useLocation()
  const load = useCallback(() => source.getPulse(), [source])
  const state = useSurfaceData(load, [load, search])

  const hasData =
    state.kind === 'ready' || state.kind === 'degraded' || state.kind === 'stale'

  return (
    <>
      <header className="page-head page-head--tight">
        <div>
          <h1 className="page-head__title">Daily Pulse</h1>
          <p className="page-head__sub">What changed across your accounts since 14 August.</p>
        </div>
        {hasData && (
          <div className="page-head__meta">
            <IllustrativeNote />
            <span title={absoluteDateTime(state.data.generatedAt)}>
              <Icon name="clock" className="stat__icon" /> Updated{' '}
              {relativeTime(state.data.generatedAt)}
            </span>
          </div>
        )}
      </header>

      {state.kind === 'loading' && <LoadingState label="Loading the daily pulse" rows={2} />}

      {state.kind === 'empty' && (
        <EmptyState
          title="You’re caught up"
          body={state.reason}
          next="The next collection cycle runs automatically."
          checkedAt={state.checkedAt}
        />
      )}

      {state.kind === 'unavailable' && (
        <UnavailableState
          title="Today’s changes aren’t ready yet"
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
        <StaleNotice
          notice={state.notice}
          asOf={state.asOf}
          checkedAt={state.checkedAt}
        />
      )}

      {hasData && <PulseBody snapshot={state.data} />}
    </>
  )
}

function PulseBody({ snapshot }: { snapshot: PulseSnapshot }) {
  const { coverage, connectorHealth, changesSinceLastVisit } = snapshot

  const byRecency = [...changesSinceLastVisit].sort((a, b) =>
    b.occurredAt.localeCompare(a.occurredAt),
  )
  const attention = byRecency.filter((c) => c.channel === 'market' && c.needsAttention)
  const market = byRecency.filter((c) => c.channel === 'market' && !c.needsAttention)
  const system = byRecency.filter((c) => c.channel === 'system')

  // Collapsed unless something in the operations column actually needs a person.
  const systemNeedsAction =
    connectorHealth.actionRequired > 0 || coverage.accountsBelowExpected > 0

  return (
    <>
      {attention.length > 0 && (
        <section className="section section--attention" aria-labelledby="attention-title">
          <div className="section__head">
            <h2 className="section__title" id="attention-title">
              Needs attention today
            </h2>
            <span className="section__count">{attention.length}</span>
          </div>
          <div className="attention-list">
            {attention.map((change) => (
              <AttentionRow key={change.id} change={change} />
            ))}
          </div>
        </section>
      )}

      <div className="pulse-grid">
        <section className="stat" aria-labelledby="stat-changes">
          <h2 className="stat__label" id="stat-changes">
            <Icon name="pulse" className="stat__icon" /> Changes
          </h2>
          <p className="stat__value">{attention.length + market.length}</p>
          <p className="stat__note">Market changes since your last visit</p>
        </section>

        <section className="stat" aria-labelledby="stat-coverage">
          <h2 className="stat__label" id="stat-coverage">
            <Icon name="building" className="stat__icon" /> Account coverage
          </h2>
          <p className="stat__value">
            {coverage.accountsAtOrAboveExpected}
            <span className="stat__of">/{coverage.accountsMonitored}</span>
          </p>
          <p className="stat__note">Accounts fully covered</p>
          {coverage.accountsUncovered.length > 0 && (
            <details className="stat__detail">
              <summary>{coverage.accountsBelowExpected} below expected</summary>
              <ul>
                {coverage.accountsUncovered.map((account) => (
                  <li key={account}>{account}</li>
                ))}
              </ul>
            </details>
          )}
        </section>

        <section className="stat" aria-labelledby="stat-health">
          <h2 className="stat__label" id="stat-health">
            <Icon name="settings" className="stat__icon" /> Connector health
          </h2>
          <p className="stat__value">
            {connectorHealth.healthy}
            <span className="stat__of">/{connectorHealth.sourcesEnabled}</span>
          </p>
          <p className="stat__note">Sources healthy</p>
          <details className="stat__detail">
            <summary>
              {connectorHealth.degraded} degraded, {connectorHealth.actionRequired} needs
              action
            </summary>
            <p>
              Connector health is whether the sources are working. Account coverage is
              whether the right things are being watched. They are tracked separately.
            </p>
          </details>
        </section>
      </div>

      {market.length > 0 && (
        <section className="section" aria-labelledby="market-title">
          <div className="section__head">
            <h2 className="section__title" id="market-title">
              Other market changes
            </h2>
            <span className="section__count">{market.length}</span>
            <span className="section__note">Newest first</span>
          </div>
          <div className="change-list">
            {market.map((change) => (
              <ChangeRow key={change.id} change={change} />
            ))}
          </div>
        </section>
      )}

      <section className="section section--system" aria-labelledby="system-title">
        <details className="system-notices" open={systemNeedsAction}>
          <summary className="system-notices__summary">
            <Icon name="settings" className="system-notices__icon" />
            <span id="system-title">Coverage and system notices</span>
            <span className="system-notices__count">{system.length}</span>
            {systemNeedsAction && (
              <span className="system-notices__flag">1 needs action</span>
            )}
          </summary>
          <div className="system-notices__body">
            {system.map((change) => (
              <div className="notice-row" key={change.id}>
                <Icon
                  name={CHANGE_ICON[change.kind] ?? 'dot'}
                  className={`notice-row__icon notice-row__icon--${change.tone}`}
                />
                <div className="notice-row__body">
                  <p className="notice-row__title">
                    {change.title}
                    <span className="notice-row__subject"> — {change.subjectLabel}</span>
                  </p>
                  <p className="notice-row__detail">{change.detail}</p>
                </div>
                <time className="notice-row__when" dateTime={change.occurredAt}>
                  {relativeTime(change.occurredAt)}
                </time>
              </div>
            ))}
          </div>
        </details>
      </section>
    </>
  )
}

function AttentionRow({ change }: { change: ChangeEvent }) {
  return (
    <article className={`attention attention--${change.tone}`}>
      <span className="attention__icon" aria-hidden="true">
        <Icon name={CHANGE_ICON[change.kind] ?? 'dot'} />
      </span>
      <div className="attention__body">
        <h3 className="attention__title">{change.title}</h3>
        <p className="attention__subject">{change.subjectLabel}</p>
        {change.actionHint && <p className="attention__hint">{change.actionHint}</p>}
      </div>
      <div className="attention__aside">
        <time className="attention__when" dateTime={change.occurredAt}>
          {relativeTime(change.occurredAt)}
        </time>
        {change.opportunityId && (
          <Link className="btn btn--primary attention__link" to="/opportunities">
            Review opportunity
          </Link>
        )}
      </div>
    </article>
  )
}

function ChangeRow({ change }: { change: ChangeEvent }) {
  return (
    <article className="change">
      <span className={`change__icon change__icon--${change.tone}`} aria-hidden="true">
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
  )
}
