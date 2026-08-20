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
 * The full detail content for one opportunity.
 *
 * Rendered identically by the drawer (in-session triage) and by the full page at
 * `/opportunities/:id` (the shareable, reload-safe address). Extracting it is the
 * point: `10_DESIGN_RESPONSE.md` §5.3 requires both a drawer preview and a full
 * page, and two hand-maintained copies of the same disclosures would drift.
 *
 * Everything here is fixture data about fictional organizations.
 *
 * A note on authority, because this component displays several things whose
 * governing decisions are not settled:
 *
 *   ADR 0004 (D15)  — Accepted. Temporal precision and basis.
 *   ADR 0012 (D24)  — Accepted. Corrections supersede.
 *   ADR 0005 (D18)  — Accepted IN PART: the time-bounded ownership corollary only.
 *   ADR 0009 (D16)  — Proposed; D16 is OPEN. The three confidence axes are shown
 *                     as the recommended default on illustrative data. This
 *                     display is not an implementation of a ratified decision.
 *   ADR 0006 (D19)  — Proposed; D19 is OPEN. Access mode is displayed as a
 *                     recorded attribute. No promotion rule is implemented.
 */
export function OpportunityDetail({
  opportunity,
  decision,
  onDecide,
  headingLevel = 3,
}: {
  opportunity: Opportunity
  decision: LocalDecision | undefined
  onDecide: (opportunityId: string, decision: LocalDecision) => void
  /** 3 inside the drawer (under its h2 title), 2 on the full page. */
  headingLevel?: 2 | 3
}) {
  const { organization, facility, confidence, horizon, scores, evidence } = opportunity
  const band = priorityBand(scores.finalScore)
  const H = headingLevel === 2 ? 'h2' : 'h3'

  return (
    <>
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
                ? [
                    facility.name,
                    [facility.locality, facility.region].filter(Boolean).join(', '),
                  ]
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
        <H className="drawer__h3">Assessment</H>
        <p className="drawer__prose">{opportunity.whyItMatters}</p>
      </section>

      {organization.operatorName && (
        <section className="drawer__section">
          <H className="drawer__h3">Ownership and operator</H>
          <p className="drawer__prose">
            The brand owner is <strong>{organization.canonicalName}</strong>. The
            operating entity on this project is{' '}
            <strong>{organization.operatorName}</strong>. The project is attributed to
            the operator as at the filing date, so the account timeline reflects who
            actually ran the site at the time.
          </p>
        </section>
      )}

      {organization.scopeClassStatus === 'provisional' && (
        <section className="drawer__section">
          <H className="drawer__h3">Account classification</H>
          <p className="drawer__prose">
            This account is classified <strong>provisionally</strong>. It is excluded
            from relevance metrics until the classification is confirmed, so treat the
            priority score as indicative for this one.
          </p>
        </section>
      )}

      {horizon.inferenceNote && (
        <section className="drawer__section">
          <H className="drawer__h3">Timing caveat</H>
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
        <H className="drawer__h3">Confidence</H>
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
          These are three separate judgements. A document can be beyond question while
          the conclusion drawn from it is still ours — which is why an inference is
          capped below high confidence however good the source is. The decomposition
          itself (D16) is an open decision and the display follows the proposed default
          rather than a ratified rule.
        </p>
      </section>

      <section className="drawer__section">
        <H className="drawer__h3">How this score was reached</H>
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
          multiplier stops a thinly evidenced opportunity out-ranking a well-evidenced
          one.
        </p>
      </section>

      <section className="drawer__section">
        <H className="drawer__h3">Evidence</H>
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
        <H className="drawer__h3">Capability match</H>
        <ul className="drawer__list">
          {opportunity.capabilities.map((capability) => (
            <li key={capability}>{capability}</li>
          ))}
        </ul>
      </section>

      <section className="drawer__section drawer__section--actions">
        <H className="drawer__h3">Decision</H>
        <LocalActions
          opportunityId={opportunity.id}
          decision={decision}
          onDecide={onDecide}
        />
      </section>
    </>
  )
}
