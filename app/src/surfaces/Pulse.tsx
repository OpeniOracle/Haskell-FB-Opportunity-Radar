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
import { absoluteDate, absoluteDateTime, relativeTime } from '@/lib/format'
import { evidencePath, mediaPath } from '@/lib/links'
import { opportunityLink } from '@/lib/opportunityFilters'
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
 *   2. Four live counts        opportunities, signals, evidence, source health
 *   3. Top opportunities       highest confidence first — NOT highest scoring,
 *                              because nothing here has been scored
 *   4. New signals             what the last week turned up, closures marked as
 *                              closures rather than folded in with expansions
 *   5. Latest evidence         the documents themselves, each with its official
 *                              source link
 *   6. Coverage and system     connectors and coverage, quiet, collapsed unless
 *      notices                 something actually needs a person
 *
 * Every figure on this page is a COUNT OF ROWS. The page used to render three
 * figures derived from an empty `change_events` table and nothing else, which is
 * why it looked broken: the data was all there, one join away, and nothing asked
 * for it.
 *
 * The market/system split comes from `ChangeEvent.channel` in the data, not from
 * matching on `kind` here. Coverage and connector health stay separate figures —
 * ADR 0010 forbids merging them, and they answer different questions anyway.
 */
export function Pulse() {
  const source = useDataSource()
  const load = useCallback(() => source.getPulse(), [source])
  // See the note in Opportunities: the scenario reaches this through `source`,
  // so the query string is not a data dependency.
  const state = useSurfaceData(load, [load])

  const hasData =
    state.kind === 'ready' || state.kind === 'degraded' || state.kind === 'stale'

  return (
    <>
      <header className="page-head page-head--tight">
        <div>
          <h1 className="page-head__title">Daily Pulse</h1>
          <p className="page-head__sub">
            Live counts from the collected record, the newest signals and evidence, and
            the current state of every enabled source.
          </p>
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
  const { coverage, connectorHealth, headline, changesSinceLastVisit } = snapshot
  const { search } = useLocation()

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
        <section className="stat" aria-labelledby="stat-opportunities">
          <h2 className="stat__label" id="stat-opportunities">
            <Icon name="target" className="stat__icon" /> Opportunities
          </h2>
          <p className="stat__value">{headline.opportunityCount}</p>
          <p className="stat__note">Derived from collected filings</p>
        </section>

        <section className="stat" aria-labelledby="stat-signals">
          <h2 className="stat__label" id="stat-signals">
            <Icon name="spark" className="stat__icon" /> Signals
          </h2>
          <p className="stat__value">
            {headline.newSignalCount}
            <span className="stat__of">/{headline.signalCount}</span>
          </p>
          {/* The window is stated, because "new" is meaningless without one and
              there is no stored last-visit time to measure against. */}
          <p className="stat__note">
            New in the last {headline.newSignalWindowDays} days, of {headline.signalCount}{' '}
            on record
          </p>
        </section>

        <section className="stat" aria-labelledby="stat-evidence">
          <h2 className="stat__label" id="stat-evidence">
            <Icon name="document" className="stat__icon" /> Evidence
          </h2>
          <p className="stat__value">{headline.evidenceCount}</p>
          <p className="stat__note">
            {headline.latestEvidenceAt
              ? `Newest ${absoluteDate(headline.latestEvidenceAt)}`
              : 'Nothing collected yet'}
          </p>
        </section>

        <section className="stat" aria-labelledby="stat-health">
          <h2 className="stat__label" id="stat-health">
            <Icon name="settings" className="stat__icon" /> Source health
          </h2>
          <p className="stat__value">
            {connectorHealth.healthy}
            <span className="stat__of">/{connectorHealth.sourcesEnabled}</span>
          </p>
          <p className="stat__note">Enabled sources healthy</p>
          <details className="stat__detail">
            <summary>
              {connectorHealth.degraded} degraded, {connectorHealth.actionRequired} needs
              action
            </summary>
            <ul>
              {snapshot.sources.map((source) => (
                <li key={source.id}>
                  {source.name} — {source.state.replace(/_/g, ' ')}
                  {source.lastSuccessAt
                    ? `, last collected ${absoluteDate(source.lastSuccessAt)}`
                    : ', never collected'}
                </li>
              ))}
            </ul>
          </details>
        </section>
      </div>

      {snapshot.topOpportunities.length > 0 && (
        <section className="section" aria-labelledby="top-opps-title">
          <div className="section__head">
            <h2 className="section__title" id="top-opps-title">
              Top opportunities
            </h2>
            <span className="section__count">{snapshot.topOpportunities.length}</span>
            {/* Not "highest scoring". Nothing is scored, and saying so here stops
                the ordering being read as a ranking somebody made. */}
            <span className="section__note">Highest confidence first</span>
          </div>
          <div className="change-list">
            {snapshot.topOpportunities.map((item) => (
              <article className="change" key={item.id}>
                <span className="change__icon change__icon--confirmed" aria-hidden="true">
                  <Icon name="target" />
                </span>
                <div className="change__body">
                  <h3 className="change__title">
                    <Link to={opportunityLink(item.id, search)}>{item.title}</Link>
                    <span className="change__subject"> — {item.organizationName}</span>
                  </h3>
                  <p className="change__detail">
                    {item.distinguisher ?? `${item.confidenceLevel} confidence`} ·{' '}
                    {item.evidenceCount}{' '}
                    {item.evidenceCount === 1 ? 'document' : 'documents'}
                  </p>
                </div>
                <span className="change__when">
                  {item.sourceDate ? absoluteDate(item.sourceDate.iso) : 'No date'}
                </span>
              </article>
            ))}
          </div>
        </section>
      )}

      {snapshot.newSignals.length > 0 && (
        <section className="section" aria-labelledby="new-signals-title">
          <div className="section__head">
            <h2 className="section__title" id="new-signals-title">
              New signals
            </h2>
            <span className="section__count">{snapshot.newSignals.length}</span>
            <span className="section__note">
              Last {headline.newSignalWindowDays} days
            </span>
          </div>
          <div className="change-list">
            {snapshot.newSignals.map((signal) => (
              <article className="change" key={signal.id}>
                <span
                  className={`change__icon change__icon--${signal.negative ? 'attention' : 'emerging'}`}
                  aria-hidden="true"
                >
                  <Icon name={signal.negative ? 'alert' : 'spark'} />
                </span>
                <div className="change__body">
                  <h3 className="change__title">
                    {signal.title}
                    <span className="change__subject"> — {signal.organizationName}</span>
                  </h3>
                  {/* A closure is not a build. The two are never flattened. */}
                  {signal.negative && (
                    <p className="change__detail">
                      Recorded as a closure or consolidation, not an expansion.
                    </p>
                  )}
                </div>
                <time className="change__when" dateTime={signal.observedAt}>
                  {signal.observedAt ? absoluteDate(signal.observedAt) : '—'}
                </time>
              </article>
            ))}
          </div>
        </section>
      )}

      {/*
        A SMALL LINK, NOT AN EMBED.

        Daily Pulse summarises what the Radar itself collected. Media coverage is
        a different source with a different provenance, so it gets a pointer here
        rather than a panel — and the pointer says "live" because a link to the
        Zignal dashboard genuinely is live, unlike the snapshots on the Spyglass
        page.
      */}
      <section className="section section--spyglass" aria-labelledby="spyglass-pulse-title">
        <div className="section__head">
          <h2 className="section__title" id="spyglass-pulse-title">
            Spyglass media intelligence
          </h2>
        </div>
        <p className="panel-scope">
          Media coverage of these accounts is tracked separately in Openi Spyglass, and
          is not part of the counts above — nothing there is ingested as evidence.
        </p>
        <p className="source-card__links">
          <Link className="btn btn--quiet" to={mediaPath(search)}>
            Spyglass media intelligence
            <Icon name="chevron" className="btn__icon" />
          </Link>
        </p>
      </section>

      {snapshot.latestEvidence.length > 0 && (
        <section className="section" aria-labelledby="latest-evidence-title">
          <div className="section__head">
            <h2 className="section__title" id="latest-evidence-title">
              Latest evidence
            </h2>
            <span className="section__count">{snapshot.latestEvidence.length}</span>
            <span className="section__note">Newest first</span>
          </div>
          <div className="change-list">
            {snapshot.latestEvidence.map((item) => (
              <article className="change" key={item.id}>
                <span className="change__icon change__icon--neutral" aria-hidden="true">
                  <Icon name="document" />
                </span>
                <div className="change__body">
                  <h3 className="change__title">
                    <Link to={evidencePath(item.id, search)}>{item.title}</Link>
                  </h3>
                  <p className="change__detail">
                    {item.documentType ? `${item.documentType} · ` : ''}
                    {item.publisher}
                    {item.officialUrl && (
                      <>
                        {' · '}
                        <a href={item.officialUrl} target="_blank" rel="noopener noreferrer">
                          Official source
                        </a>
                      </>
                    )}
                  </p>
                </div>
                <time className="change__when" dateTime={item.recordedAt}>
                  {item.recordedAt ? absoluteDate(item.recordedAt) : '—'}
                  {/* Published and retrieved are different facts. Which one this
                      is says so rather than being inferred from the column. */}
                  <span className="change__basis">
                    {item.recordedAtBasis === 'published' ? 'filed' : 'collected'}
                  </span>
                </time>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="section" aria-labelledby="coverage-title">
        <div className="section__head">
          <h2 className="section__title" id="coverage-title">
            Account coverage
          </h2>
          <span className="section__count">
            {coverage.accountsAtOrAboveExpected}/{coverage.accountsMonitored}
          </span>
        </div>
        <p className="panel-scope">
          Connector health is whether the sources are working. Account coverage is whether
          the right things are being watched. They are tracked separately and neither
          substitutes for the other.
          {coverage.accountsUncovered.length > 0 && (
            <> Below expected: {coverage.accountsUncovered.join(', ')}.</>
          )}
        </p>
      </section>

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
  const { search } = useLocation()

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
          // Deep link, not a jump to the list: the referenced opportunity opens
          // directly in its drawer. Pushing a history entry means Back returns
          // here rather than stranding the user on Opportunities.
          <Link
            className="btn btn--primary attention__link"
            to={opportunityLink(change.opportunityId, search)}
            aria-label={`Review opportunity: ${change.subjectLabel}`}
          >
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
