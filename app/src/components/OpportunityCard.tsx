import { Icon, type IconName } from '@/components/Icon'
import { StatusPill, type PillTone } from '@/components/StatusPill'
import type { Opportunity, OpportunityStage } from '@/types/domain'
import { absoluteDate, stageLabel, statusLabel } from '@/lib/format'
import {
  AWAITING_PRIORITISATION,
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
  onReview,
}: {
  opportunity: Opportunity
  onReview: (opportunityId: string) => void
}) {
  const { organization, facility, confidence, scores, evidence } = opportunity
  const source = opportunity.sources[0] ?? null
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
        <span className="opp__score-band">
          {band ? PRIORITY_SHORT[band] : AWAITING_PRIORITISATION}
        </span>
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

        {/* Derived titles repeat — "<family> — <asset>" is the same words for two
            different projects at one company. This line is what tells them
            apart, and every value in it came out of the filing. */}
        {opportunity.distinguisher && (
          <p className="opp__distinguisher">{opportunity.distinguisher}</p>
        )}

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
          {/*
            The FILING date, labelled as one.

            This read "No date given" because the only date it looked at was the
            forecast horizon, which a derived opportunity correctly has none of.
            The date the record does have is the date its document was filed —
            shown, and never described as a schedule.
          */}
          <span className="opp__meta-item">
            <Icon name="clock" className="opp__meta-icon" />
            {opportunity.sourceDate
              ? `${opportunity.sourceDate.basis === 'filing_date' ? 'Filed' : 'Expected'} ${absoluteDate(opportunity.sourceDate.iso)}`
              : 'No date stated in the source'}
          </span>
          {opportunity.capabilities.length > 0 && (
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
          )}
          <span className="opp__meta-item">
            <Icon name="document" className="opp__meta-icon" />
            {evidence.count} {evidence.count === 1 ? 'document' : 'documents'}
            {source?.documentType && ` · ${source.documentType}`}
          </span>
        </div>

        {/* The source, on the card. "Where does that come from?" is the first
            question anyone asks, and it should not require opening anything. */}
        {source?.officialUrl && (
          <p className="opp__source">
            <Icon name="document" className="opp__meta-icon" />
            <a
              className="opp__source-link"
              href={source.officialUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              {source.publisher}
              {source.documentType ? ` ${source.documentType}` : ''} — official filing
            </a>
          </p>
        )}
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
      </div>
    </article>
  )
}
