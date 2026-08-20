import type { ReactNode } from 'react'
import { Icon, type IconName } from '@/components/Icon'
import { absoluteDateTime, relativeTime } from '@/lib/format'

/**
 * The five non-happy surface states.
 *
 * Each one answers four questions in the same order — what happened, do you need
 * to do anything, what happens next, and when this was last checked. The
 * technical cause is available but is never the headline: a business-development
 * user should not have to know what a taxonomy version is to understand that the
 * list is not ready yet.
 *
 * `empty` and `unavailable` replace the content. `degraded` and `stale` sit above
 * content that is still worth reading.
 */

function CheckedAt({ checkedAt }: { checkedAt: string | null }) {
  if (!checkedAt) return null
  return (
    <span className="state__checked" title={absoluteDateTime(checkedAt)}>
      Last checked {relativeTime(checkedAt)}
    </span>
  )
}

export function LoadingState({ label, rows = 3 }: { label: string; rows?: number }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="visually-hidden">{label}</span>
      <div className="opp-list">
        {Array.from({ length: rows }, (_, i) => (
          <div className="skeleton-card" key={i} aria-hidden="true">
            <div className="skeleton" style={{ height: 12, width: '28%' }} />
            <div className="skeleton" style={{ height: 18, width: '62%' }} />
            <div className="skeleton" style={{ height: 12, width: '88%' }} />
          </div>
        ))}
      </div>
    </div>
  )
}

function Panel({
  tone,
  icon,
  title,
  children,
  checkedAt,
  role,
}: {
  tone: 'empty' | 'unavailable'
  icon: IconName
  title: string
  children: ReactNode
  checkedAt: string | null
  role: 'status' | 'alert'
}) {
  return (
    <div className={`state state--${tone}`} role={role}>
      <Icon name={icon} className="state__icon" />
      <div className="state__text">
        <h2 className="state__title">{title}</h2>
        {children}
      </div>
      <CheckedAt checkedAt={checkedAt} />
    </div>
  )
}

export function EmptyState({
  title,
  body,
  next,
  checkedAt,
}: {
  title: string
  body: string
  next?: string
  checkedAt: string | null
}) {
  return (
    <Panel tone="empty" icon="check" title={title} checkedAt={checkedAt} role="status">
      <p className="state__body">{body}</p>
      {next && <p className="state__next">{next}</p>}
    </Panel>
  )
}

export function UnavailableState({
  title,
  reason,
  blockedBy,
  checkedAt,
  icon = 'clock',
  role = 'alert',
}: {
  title: string
  reason: string
  blockedBy: string
  checkedAt: string | null
  icon?: IconName
  /**
   * `alert` for something that has gone wrong now. `status` for a surface that is
   * deliberately not built yet — a scheduled placeholder is not an emergency.
   */
  role?: 'status' | 'alert'
}) {
  return (
    <Panel
      tone="unavailable"
      icon={icon}
      title={title}
      checkedAt={checkedAt}
      role={role}
    >
      <p className="state__body">{reason}</p>
      <details className="state__detail">
        <summary>Technical detail</summary>
        <p>{blockedBy}</p>
      </details>
    </Panel>
  )
}

export function DegradedNotice({
  notice,
  affected,
  checkedAt,
}: {
  notice: string
  affected: string[]
  checkedAt: string | null
}) {
  return (
    <div className="notice notice--degraded" role="status">
      <Icon name="alert" className="notice__icon" />
      <div>
        <strong>Partial coverage — </strong>
        {notice}
        {affected.length > 0 && (
          <details className="notice__detail">
            <summary>What is affected</summary>
            <p>{affected.join(', ')}</p>
          </details>
        )}
      </div>
      <CheckedAt checkedAt={checkedAt} />
    </div>
  )
}

export function StaleNotice({
  notice,
  asOf,
  checkedAt,
}: {
  notice: string
  asOf: string
  checkedAt: string | null
}) {
  return (
    <div className="notice notice--stale" role="status">
      <Icon name="clock" className="notice__icon" />
      <div>
        <strong>Showing data from {absoluteDateTime(asOf)} — </strong>
        {notice}
      </div>
      <CheckedAt checkedAt={checkedAt} />
    </div>
  )
}
