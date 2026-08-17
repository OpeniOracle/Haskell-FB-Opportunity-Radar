import { Icon, type IconName } from '@/components/Icon'
import { StatusPill, type PillTone } from '@/components/StatusPill'
import {
  SCORE_CAPS,
  type Opportunity,
  type OpportunityStage,
} from '@/types/domain'
import {
  absoluteDateTime,
  accessModeLabel,
  assessmentTypeLabel,
  confidenceSentence,
  evidenceStrengthLabel,
  formatTemporal,
  precisionLabel,
  relativeTime,
  stageLabel,
  statusLabel,
} from '@/lib/format'

/**
 * The opportunity card.
 *
 * Design intent, since this is the component the whole product is judged on:
 *
 *  - ONE card per opportunity, full width, stacked. Not a grid of competing
 *    tiles — a ranked list is a reading task, not a dashboard.
 *  - The title is the PROJECT, not the company. Analysts scan for what is being
 *    built.
 *  - "Why it matters" is prose and sits above the fold, because a number without
 *    a reason is not intelligence.
 *  - Stage, status, and the three confidence axes are separate indicators. They
 *    answer different questions and the spec forbids collapsing them.
 *  - The score is shown as a single figure; the five-component breakdown is
 *    behind progressive disclosure, so the card stays scannable but the number is
 *    never unexplained.
 */

const STAGE_TONE: Record<OpportunityStage, PillTone> = {
  confirmed: 'confirmed',
  developing: 'developing',
  emerging: 'emerging',
}

const STAGE_ICON: Record<OpportunityStage, IconName> = {
  confirmed: 'check',
  developing: 'clock',
  emerging: 'spark',
}

const CONFIDENCE_TONE = {
  high: 'confirmed',
  moderate: 'developing',
  low: 'emerging',
} as const

const SCORE_ROWS: { key: keyof typeof SCORE_CAPS; label: string }[] = [
  { key: 'haskellFit', label: 'Haskell capability fit' },
  { key: 'projectMaturity', label: 'Project maturity' },
  { key: 'potentialScope', label: 'Potential scope' },
  { key: 'timingMomentum', label: 'Timing and momentum' },
  { key: 'accountStrategy', label: 'Account strategy' },
]

export function OpportunityCard({ opportunity }: { opportunity: Opportunity }) {
  const { organization, facility, confidence, horizon, scores, evidence } = opportunity
  const headingId = `opp-${opportunity.id}-title`
  const isOnHold = opportunity.status === 'on_hold'

  const location = facility
    ? [facility.name, [facility.locality, facility.region].filter(Boolean).join(', ')]
        .filter(Boolean)
        .join(' — ')
    : 'No facility resolved yet'

  return (
    <article className="opp" aria-labelledby={headingId}>
      <div className="opp__body">
        <div className="opp__eyebrow">
          <span className="opp__company">{organization.canonicalName}</span>
          {organization.operatorName && (
            <>
              <span className="opp__sep" aria-hidden="true">
                /
              </span>
              <span>Operated by {organization.operatorName}</span>
            </>
          )}
          <span className="opp__sep" aria-hidden="true">
            •
          </span>
          <span>
            <Icon name="pin" className="opp__evidence-icon" /> {location}
          </span>
        </div>

        <h3 className="opp__title" id={headingId}>
          {opportunity.title}
        </h3>

        <div className="opp__pills">
          <StatusPill
            tone={STAGE_TONE[opportunity.stage]}
            icon={STAGE_ICON[opportunity.stage]}
            label={stageLabel[opportunity.stage]}
            title={`Lifecycle stage: ${stageLabel[opportunity.stage]}`}
          />
          <StatusPill
            tone={isOnHold ? 'attention' : 'neutral'}
            icon={isOnHold ? 'alert' : 'dot'}
            label={statusLabel[opportunity.status]}
            title={`Pursuit status: ${statusLabel[opportunity.status]}`}
          />
          <StatusPill
            tone={CONFIDENCE_TONE[confidence.confidenceLevel]}
            icon="target"
            label={`${confidence.confidenceLevel} confidence`}
            title={confidenceSentence(confidence)}
          />
          {organization.scopeClassStatus === 'provisional' && (
            <StatusPill
              tone="developing"
              icon="clock"
              label="Provisional classification"
              title="This account's scope classification has not been confirmed and is excluded from relevance metrics."
            />
          )}
        </div>

        <p className="opp__why">{opportunity.whyItMatters}</p>

        <dl className="opp__facts">
          <div className="fact">
            <dt>Expected timing</dt>
            <dd>
              {formatTemporal(horizon)}
              <span className="fact__qualifier"> ({precisionLabel(horizon)})</span>
            </dd>
          </div>
          <div className="fact">
            <dt>Assessment</dt>
            <dd>
              {evidenceStrengthLabel[confidence.evidenceStrength]} evidence,{' '}
              {assessmentTypeLabel[confidence.assessmentType].toLowerCase()}
            </dd>
          </div>
          <div className="fact">
            <dt>Capability match</dt>
            <dd>{opportunity.capabilities.join(' · ')}</dd>
          </div>
        </dl>

        {horizon.inferenceNote && (
          <p className="opp__inference">
            <Icon name="alert" className="opp__evidence-icon" />
            <span>
              <strong>Timing is inferred, not stated. </strong>
              {horizon.inferenceNote}
            </span>
          </p>
        )}

        <details className="disclosure">
          <summary className="disclosure__summary">
            <Icon name="chevron" className="disclosure__chevron" />
            How this score was reached
          </summary>
          <div className="disclosure__panel">
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
            <p className="disclosure__note">
              Raw score {scores.rawScore} of 100, multiplied by a confidence factor
              of {scores.confidenceMultiplier.toFixed(2)} to give{' '}
              {scores.finalScore}. The multiplier is what stops a thinly evidenced
              opportunity from out-ranking a well-evidenced one on enthusiasm alone.
            </p>
          </div>
        </details>

        <div className="opp__foot">
          <span className="opp__evidence">
            <Icon name="document" className="opp__evidence-icon" />
            {evidence.count} evidence {evidence.count === 1 ? 'item' : 'items'} from{' '}
            {evidence.independentPublishers} independent{' '}
            {evidence.independentPublishers === 1 ? 'publisher' : 'publishers'}
          </span>
          <span title={accessModeLabel[evidence.strongestAccessMode]}>
            Best access: {accessModeLabel[evidence.strongestAccessMode]}
          </span>
          <span title={absoluteDateTime(evidence.newestRetrievedAt)}>
            Newest evidence {relativeTime(evidence.newestRetrievedAt)}
          </span>
        </div>
      </div>

      <div className="opp__aside">
        <div className="score">
          <span className="score__value">{scores.finalScore}</span>
          <span className="score__label">Priority</span>
        </div>
        <div className="opp__actions">
          <button type="button" className="btn" disabled title="Available in a later milestone">
            Open account
          </button>
        </div>
        <span className="opp__changed" title={absoluteDateTime(opportunity.lastMaterialChangeAt)}>
          Changed {relativeTime(opportunity.lastMaterialChangeAt)}
        </span>
      </div>
    </article>
  )
}
