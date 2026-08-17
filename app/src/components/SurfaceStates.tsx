import { Icon } from '@/components/Icon'
import { absoluteDateTime } from '@/lib/format'

/**
 * The five non-happy surface states, rendered explicitly.
 *
 * `04_UX_DESIGN_SPEC.md` treats these as first-class: a blank region is never an
 * acceptable answer, and "we don't know" must be distinguishable from "there is
 * nothing". So each state says what happened, what is still trustworthy, and —
 * where relevant — exactly which accounts or sources are affected.
 *
 * Note the split: `empty` and `unavailable` REPLACE the content, while `degraded`
 * and `stale` sit ABOVE content that is still worth reading.
 */

export function LoadingState({ label, rows = 3 }: { label: string; rows?: number }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="visually-hidden">{label}</span>
      <div className="opp-list">
        {Array.from({ length: rows }, (_, i) => (
          <div className="skeleton-card" key={i} aria-hidden="true">
            <div className="skeleton" style={{ height: 12, width: '32%' }} />
            <div className="skeleton" style={{ height: 20, width: '70%' }} />
            <div className="skeleton" style={{ height: 12, width: '90%' }} />
            <div className="skeleton" style={{ height: 12, width: '54%' }} />
          </div>
        ))}
      </div>
    </div>
  )
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="state" role="status">
      <Icon name="inbox" className="state__icon" />
      <h2 className="state__title">{title}</h2>
      <p className="state__body">{body}</p>
    </div>
  )
}

export function UnavailableState({
  title,
  reason,
  blockedBy,
}: {
  title: string
  reason: string
  blockedBy: string
}) {
  return (
    <div className="state state--unavailable" role="alert">
      <Icon name="lock" className="state__icon" />
      <h2 className="state__title">{title}</h2>
      <p className="state__body">{reason}</p>
      <p className="state__body">
        <strong>Blocked by:</strong> {blockedBy}
      </p>
    </div>
  )
}

export function DegradedNotice({
  notice,
  affected,
}: {
  notice: string
  affected: string[]
}) {
  return (
    <div className="notice notice--degraded" role="status">
      <Icon name="alert" className="notice__icon" />
      <div>
        <strong>Partial coverage — </strong>
        {notice}
        {affected.length > 0 && (
          <>
            {' '}
            <strong>Affected:</strong> {affected.join(', ')}.
          </>
        )}
      </div>
    </div>
  )
}

export function StaleNotice({ notice, asOf }: { notice: string; asOf: string }) {
  return (
    <div className="notice notice--stale" role="status">
      <Icon name="clock" className="notice__icon" />
      <div>
        <strong>Showing data as of {absoluteDateTime(asOf)} — </strong>
        {notice}
      </div>
    </div>
  )
}
