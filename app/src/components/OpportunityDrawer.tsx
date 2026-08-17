import { useEffect, useRef } from 'react'
import { Icon } from '@/components/Icon'
import { LocalActions } from '@/components/LocalActions'
import { SCORE_CAPS, type LocalDecision, type Opportunity } from '@/types/domain'
import {
  absoluteDateTime,
  accessModeLabel,
  assessmentTypeLabel,
  evidenceStrengthLabel,
  formatTemporal,
  precisionLabel,
  relativeTime,
  stageLabel,
  statusLabel,
} from '@/lib/format'
import { PRIORITY_LABEL, priorityBand } from '@/lib/opportunityFilters'

const SCORE_ROWS: { key: keyof typeof SCORE_CAPS; label: string }[] = [
  { key: 'haskellFit', label: 'Haskell capability fit' },
  { key: 'projectMaturity', label: 'Project maturity' },
  { key: 'potentialScope', label: 'Potential scope' },
  { key: 'timingMomentum', label: 'Timing and momentum' },
  { key: 'accountStrategy', label: 'Account strategy' },
]

/**
 * The detail drawer — everything the compact card deliberately left out.
 *
 * This is where "why do you say that" gets answered: the full assessment, the
 * three confidence axes with what each one means, the score breakdown, the
 * evidence and publisher counts, operator attribution, timing caveats, and the
 * complete capability list.
 *
 * Keyboard contract: focus moves to the close button on open, Escape closes, Tab
 * is held inside the panel, and focus returns to whatever opened it.
 */
export function OpportunityDrawer({
  opportunity,
  decision,
  onDecide,
  onClose,
}: {
  opportunity: Opportunity
  decision: LocalDecision | undefined
  onDecide: (opportunityId: string, decision: LocalDecision) => void
  onClose: () => void
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    returnFocusRef.current = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    return () => returnFocusRef.current?.focus()
  }, [])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
        return
      }
      if (event.key !== 'Tab') return

      const panel = panelRef.current
      if (!panel) return
      const focusable = panel.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])',
      )
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!first || !last) return

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [onClose])

  const { organization, facility, confidence, horizon, scores, evidence } = opportunity
  const titleId = `drawer-${opportunity.id}-title`
  const band = priorityBand(scores.finalScore)

  return (
    <div className="drawer-layer">
      <button
        type="button"
        className="drawer__scrim"
        aria-label="Close opportunity detail"
        onClick={onClose}
      />
      <div
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={panelRef}
      >
        <header className="drawer__head">
          <div>
            <p className="drawer__eyebrow">{organization.canonicalName}</p>
            <h2 className="drawer__title" id={titleId}>
              {opportunity.title}
            </h2>
          </div>
          <button
            type="button"
            className="btn btn--quiet drawer__close"
            onClick={onClose}
            ref={closeRef}
          >
            Close
          </button>
        </header>

        <div className="drawer__body">
          <section className="drawer__section">
            <div className="drawer__score">
              <span className="drawer__score-value">{scores.finalScore}</span>
              <span className="drawer__score-band">{PRIORITY_LABEL[band]}</span>
            </div>
            <dl className="drawer__facts">
              <div className="fact">
                <dt>Stage</dt>
                <dd>{stageLabel[opportunity.stage]}</dd>
              </div>
              <div className="fact">
                <dt>Pursuit status</dt>
                <dd>{statusLabel[opportunity.status]}</dd>
              </div>
              <div className="fact">
                <dt>Location</dt>
                <dd>
                  {facility
                    ? [facility.name, [facility.locality, facility.region]
                        .filter(Boolean)
                        .join(', ')]
                        .filter(Boolean)
                        .join(' — ')
                    : 'No facility resolved yet'}
                </dd>
              </div>
              <div className="fact">
                <dt>Expected timing</dt>
                <dd>
                  {formatTemporal(horizon)}
                  <span className="fact__qualifier"> ({precisionLabel(horizon)})</span>
                </dd>
              </div>
            </dl>
          </section>

          <section className="drawer__section">
            <h3 className="drawer__h3">Assessment</h3>
            <p className="drawer__prose">{opportunity.whyItMatters}</p>
          </section>

          {organization.operatorName && (
            <section className="drawer__section">
              <h3 className="drawer__h3">Ownership and operator</h3>
              <p className="drawer__prose">
                The brand owner is <strong>{organization.canonicalName}</strong>. The
                operating entity on this project is{' '}
                <strong>{organization.operatorName}</strong>. The project is attributed
                to the operator as at the filing date, so the account timeline reflects
                who actually ran the site at the time.
              </p>
            </section>
          )}

          {organization.scopeClassStatus === 'provisional' && (
            <section className="drawer__section">
              <h3 className="drawer__h3">Account classification</h3>
              <p className="drawer__prose">
                This account is classified <strong>provisionally</strong>. It is
                excluded from relevance metrics until the classification is confirmed,
                so treat the priority score as indicative for this one.
              </p>
            </section>
          )}

          {horizon.inferenceNote && (
            <section className="drawer__section">
              <h3 className="drawer__h3">Timing caveat</h3>
              <p className="notice notice--stale drawer__caveat">
                <Icon name="alert" className="notice__icon" />
                <span>
                  <strong>Timing is inferred, not stated. </strong>
                  {horizon.inferenceNote}
                </span>
              </p>
            </section>
          )}

          <section className="drawer__section">
            <h3 className="drawer__h3">Confidence</h3>
            <dl className="drawer__facts">
              <div className="fact">
                <dt>Evidence strength</dt>
                <dd>{evidenceStrengthLabel[confidence.evidenceStrength]}</dd>
              </div>
              <div className="fact">
                <dt>Assessment type</dt>
                <dd>{assessmentTypeLabel[confidence.assessmentType]}</dd>
              </div>
              <div className="fact">
                <dt>Confidence level</dt>
                <dd className="fact--emphasis">{confidence.confidenceLevel}</dd>
              </div>
            </dl>
            <p className="drawer__prose drawer__prose--small">
              These are three separate judgements. A document can be beyond question
              while the conclusion drawn from it is still ours — which is why an
              inference is capped below high confidence however good the source is.
            </p>
          </section>

          <section className="drawer__section">
            <h3 className="drawer__h3">How this score was reached</h3>
            <div className="score-breakdown">
              {SCORE_ROWS.map((row) => {
                const value = scores[row.key]
                const cap = SCORE_CAPS[row.key]
                return (
                  <div className="score-row" key={row.key}>
                    <span className="score-row__label">{row.label}</span>
                    <span className="score-row__value">
                      {value}/{cap}
                    </span>
                    <span
                      className="score-row__bar"
                      role="img"
                      aria-label={`${row.label}: ${value} out of ${cap}`}
                    >
                      <span
                        className="score-row__fill"
                        style={{ width: `${Math.round((value / cap) * 100)}%` }}
                      />
                    </span>
                  </div>
                )
              })}
            </div>
            <p className="drawer__prose drawer__prose--small">
              Raw score {scores.rawScore} of 100, multiplied by a confidence factor of{' '}
              {scores.confidenceMultiplier.toFixed(2)} to give {scores.finalScore}. The
              multiplier stops a thinly evidenced opportunity out-ranking a
              well-evidenced one.
            </p>
          </section>

          <section className="drawer__section">
            <h3 className="drawer__h3">Evidence</h3>
            <dl className="drawer__facts">
              <div className="fact">
                <dt>Items</dt>
                <dd>{evidence.count}</dd>
              </div>
              <div className="fact">
                <dt>Independent publishers</dt>
                <dd>{evidence.independentPublishers}</dd>
              </div>
              <div className="fact">
                <dt>Best access mode</dt>
                <dd>{accessModeLabel[evidence.strongestAccessMode]}</dd>
              </div>
              <div className="fact">
                <dt>Newest item</dt>
                <dd>
                  {relativeTime(evidence.newestRetrievedAt)}
                  <span className="fact__qualifier">
                    {' '}
                    ({absoluteDateTime(evidence.newestRetrievedAt)})
                  </span>
                </dd>
              </div>
            </dl>
            {evidence.strongestAccessMode === 'reference_only' && (
              <p className="drawer__prose drawer__prose--small">
                Reference-only evidence caps strength at indicative, which is why the
                confidence level cannot rise above low on this item alone.
              </p>
            )}
          </section>

          <section className="drawer__section">
            <h3 className="drawer__h3">Capability match</h3>
            <ul className="drawer__list">
              {opportunity.capabilities.map((capability) => (
                <li key={capability}>{capability}</li>
              ))}
            </ul>
          </section>

          <section className="drawer__section drawer__section--actions">
            <h3 className="drawer__h3">Decision</h3>
            <LocalActions
              opportunityId={opportunity.id}
              decision={decision}
              onDecide={onDecide}
            />
          </section>
        </div>
      </div>
    </div>
  )
}
