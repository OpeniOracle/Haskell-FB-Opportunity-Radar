import { Icon, type IconName } from '@/components/Icon'
import { DECISION_CONFIRMATION, DECISION_LABEL } from '@/hooks/useLocalDecisions'
import type { LocalDecision } from '@/types/domain'

const ORDER: LocalDecision[] = ['pursue', 'watch', 'assign', 'dismiss']

const ICON: Record<LocalDecision, IconName> = {
  pursue: 'check',
  watch: 'target',
  assign: 'building',
  dismiss: 'alert',
}

/**
 * The four pursuit actions, operating as a local preview.
 *
 * They are real buttons with real state rather than disabled placeholders,
 * because a disabled control tells a reviewer nothing about the interaction. What
 * they are NOT is persisted — the row says so in plain words, and choosing the
 * same action twice clears it.
 */
export function LocalActions({
  opportunityId,
  decision,
  onDecide,
  compact = false,
}: {
  opportunityId: string
  decision: LocalDecision | undefined
  onDecide: (opportunityId: string, decision: LocalDecision) => void
  compact?: boolean
}) {
  return (
    <div className={`actions${compact ? ' actions--compact' : ''}`}>
      <div className="actions__row" role="group" aria-label="Pursuit decision (preview only)">
        {ORDER.map((option) => {
          const selected = decision === option
          return (
            <button
              key={option}
              type="button"
              className={`btn btn--action${selected ? ' btn--action-on' : ''}`}
              aria-pressed={selected}
              onClick={() => onDecide(opportunityId, option)}
            >
              <Icon name={ICON[option]} className="btn__icon" />
              {DECISION_LABEL[option]}
            </button>
          )
        })}
      </div>
      {/* The unchosen state is covered once, above the list. Repeating it on
          every card was noise; the confirmation after a choice is not. */}
      {decision ? (
        <p className="actions__note">
          <strong>{DECISION_CONFIRMATION[decision]}</strong> — preview only, not saved.
        </p>
      ) : (
        !compact && (
          <p className="actions__note">
            Preview only — decisions are not saved and reset on reload.
          </p>
        )
      )}
    </div>
  )
}
