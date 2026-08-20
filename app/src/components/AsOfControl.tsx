import { Icon } from '@/components/Icon'

/**
 * The as-at date control.
 *
 * ADR 0005's accepted corollary (D18) is that relationships are time-bounded, so
 * "who owned this" has no answer without a date. Making the date an explicit,
 * URL-carried control rather than an implicit "now" is what stops a 2023 project
 * from being silently reattributed to a 2026 owner.
 */
export function AsOfControl({
  value,
  onChange,
  today,
}: {
  value: string
  onChange: (next: string) => void
  today: string
}) {
  return (
    <div className="as-of">
      <Icon name="clock" className="as-of__icon" />
      <label className="as-of__field">
        <span className="as-of__label">Attribution as at</span>
        <input
          type="date"
          className="as-of__input"
          value={value}
          onChange={(event) => {
            if (event.target.value) onChange(event.target.value)
          }}
        />
      </label>
      {value !== today && (
        <button type="button" className="btn btn--quiet as-of__reset" onClick={() => onChange(today)}>
          Reset to today
        </button>
      )}
      <p className="as-of__note">
        Ownership and operator answers change with this date. Intervals are half-open —
        <code> [from, to)</code> — so the end date is <strong>excluded</strong>.
      </p>
    </div>
  )
}
