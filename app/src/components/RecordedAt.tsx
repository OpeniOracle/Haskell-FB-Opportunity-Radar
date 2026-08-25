import { Icon } from '@/components/Icon'
import { absoluteDateTime, isFutureInstant, relativeTime } from '@/lib/format'

/**
 * An instant that describes something that has ALREADY happened.
 *
 * Retrieval times, collection cycles, connector runs and last-activity stamps
 * are all records of completed work, so a future value is not a date — it is a
 * data-quality fault. A skewed collector clock or a source that publishes a
 * wrong date will produce one eventually, and the interface has to say so
 * rather than render it as an ordinary time.
 *
 * The absolute value is always retained so the fault can be inspected instead of
 * merely reported.
 */
export function RecordedAt({
  iso,
  prefix,
  className,
}: {
  iso: string
  /** e.g. "Last checked", "Retrieved". Rendered before the relative value. */
  prefix?: string
  className?: string
}) {
  const future = isFutureInstant(iso)
  const absolute = absoluteDateTime(iso)

  return (
    <span className={className} title={absolute}>
      {prefix ? `${prefix} ` : ''}
      {relativeTime(iso)}
      {future && (
        <span className="timestamp-fault" role="status">
          <Icon name="alert" className="timestamp-fault__icon" />
          Future timestamp detected — recorded as {absolute}
        </span>
      )}
    </span>
  )
}

/**
 * The same guard where only the warning is wanted, because the caller is
 * already rendering the time itself in its own layout.
 */
export function FutureTimestampWarning({ iso }: { iso: string }) {
  if (!isFutureInstant(iso)) return null
  return (
    <span className="timestamp-fault" role="status">
      <Icon name="alert" className="timestamp-fault__icon" />
      Future timestamp detected — recorded as {absoluteDateTime(iso)}
    </span>
  )
}
