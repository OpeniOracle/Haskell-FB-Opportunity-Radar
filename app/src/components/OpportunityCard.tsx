import { Icon, type IconName } from '@/components/Icon'
import { StatusPill, type PillTone } from '@/components/StatusPill'
import { LocalActions } from '@/components/LocalActions'
import type { LocalDecision, Opportunity, OpportunityStage } from '@/types/domain'
import {
  absoluteDateTime,
  formatTemporal,
  relativeTime,
  stageLabel,
  statusLabel,
} from '@/lib/format'
import {
  PRIORITY_SHORT,
  UNRESOLVED_LOCATION,
  priorityBand,
} from '@/lib/opportunityFilters'

/**
 * The compact opportunity card.
 *
 * This is a scanning and comparison surface, so the card carries only what a
 * business-development user needs to triage: who, what, where, how urgent, how
 * far along, how sure, when, which capability, and how well evidenced. One
 * sentence of reasoning, then a way in.
 *
 * Everything that answers "why do you say that" — the full assessment, the three
 * confidence axes, the score breakdown, publisher counts, operator attribution,
 * timing caveats, and the complete capability list — lives in the detail drawer.
 * Six of these should fit in a comparison, not fill six screens.
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

export function OpportunityCard({
  opportunity,
  decision,
  onDecide,
  onReview,
}: {
  opportunity: Opportunity
  decision: LocalDecision | undefined
  onDecide: (opportunityId: string, decision: LocalDecision) => void
  onReview: (opportunityId: string) => void
}) {
  const { organization, facility, confidence, horizon, scores, evidence } = opportunity
  const headingId = `opp-${opportunity.id}-title`
  const band = priorityBand(scores.finalScore)
  const isOnHold = opportunity.status === 'on_hold'

  const location = facility
    ? [facility.locality, facility.region].filter(Boolean).join(', ') || facility.name
    : UNRESOLVED_LOCATION

  return (
    <article className={`opp opp--${band ?? 'unscored'}`} aria-labelledby={headingId}>
      {/*
        An unscored opportunity shows a dash and says so, rather than a zero.
        A zero is a judgement; this record has not been judged.
      */}
      <div className="opp__score">
        <span className="opp__score-value">{scores.finalScore ?? '\u2014'}</span>
        <span className="opp__score-band">{band ? PRIORITY_SHORT[band] : 'Not scored'}</span>
      </div>

      <div className="opp__body">
        <div className="opp__eyebrow">
          <span className="opp__company">{organization.canonicalName}</span>
          <span className="opp__sep" aria-hidden="true">
            •
          </span>
          <span className={facility ? 'opp__place' : 'opp__place opp__place--unresolved'}>
            <Icon name="pin" className="opp__meta-icon" />
            {location}
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
            title="Open the opportunity to see the three confidence axes behind this."
          />
        </div>

        <p className="opp__why">{opportunity.whyItMatters}</p>

        <div className="opp__meta">
          <span className="opp__meta-item">
            <Icon name="clock" className="opp__meta-icon" />
            {formatTemporal(horizon)}
          </span>
          <span className="opp__meta-item">
            <Icon name="settings" className="opp__meta-icon" />
            {opportunity.capabilities[0]}
            {opportunity.capabilities.length > 1 && (
              <span className="opp__meta-more">
                {' '}
                +{opportunity.capabilities.length - 1}
              </span>
            )}
          </span>
          <span
            className="opp__meta-item"
            title={absoluteDateTime(evidence.newestRetrievedAt)}
          >
            <Icon name="document" className="opp__meta-icon" />
            {evidence.count} evidence · newest {relativeTime(evidence.newestRetrievedAt)}
          </span>
        </div>
      </div>

      <div className="opp__aside">
        <button
          type="button"
          className="btn btn--primary opp__review"
          onClick={() => onReview(opportunity.id)}
          // Starts with the visible label so it satisfies WCAG 2.5.3, then names
          // which of six identical buttons this one is.
          aria-label={`Review opportunity: ${opportunity.title}`}
        >
          Review opportunity
          <Icon name="chevron" className="btn__icon" />
        </button>
        <LocalActions
          opportunityId={opportunity.id}
          decision={decision}
          onDecide={onDecide}
          compact
        />
      </div>
    </article>
  )
}
