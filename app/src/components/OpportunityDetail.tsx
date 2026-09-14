import { Link } from 'react-router-dom'
import { Icon } from '@/components/Icon'
import { SCORE_CAPS, type Opportunity } from '@/types/domain'
import { evidencePath } from '@/lib/links'
import {
  absoluteDate,
  absoluteDateTime,
  accessModeLabel,
  assessmentTypeLabel,
  confidenceLevelLabel,
  evidenceStrengthLabel,
  formatTemporal,
  precisionLabel,
  relativeTime,
  stageLabel,
  statusLabel,
} from '@/lib/format'
import {
  AWAITING_PRIORITISATION,
  PRIORITY_LABEL,
  UNRESOLVED_LOCATION,
  priorityBand,
} from '@/lib/opportunityFilters'

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
  headingLevel = 3,
}: {
  opportunity: Opportunity
  /** 3 inside the drawer (under its h2 title), 2 on the full page. */
  headingLevel?: 2 | 3
}) {
  const { organization, facility, confidence, horizon, scores, evidence } = opportunity
  const band = priorityBand(scores.finalScore)
  const H = headingLevel === 2 ? 'h2' : 'h3'
  const scored = SCORE_ROWS.some((row) => scores[row.key] !== null)

  return (
    <>
      <section className="drawer__section">
        <div className="drawer__score">
          <span className="drawer__score-value">{scores.finalScore ?? '\u2014'}</span>
          <span className="drawer__score-band">
            {band ? PRIORITY_LABEL[band] : AWAITING_PRIORITISATION}
          </span>
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
                : UNRESOLVED_LOCATION}
            </dd>
          </div>
          {/*
            THE DATE, AND WHAT KIND OF DATE IT IS.

            A filing date and a completion window are different facts and this
            row shows whichever one the record actually holds, labelled. It used
            to show the horizon alone, which meant a dated record rendered as
            undated because the only date it had was on the document rather than
            in a forecast.
          */}
          <div className="fact">
            <dt>{opportunity.sourceDate?.basis === 'stated_event_date' ? 'Event date' : 'Filing date'}</dt>
            <dd>
              {opportunity.sourceDate
                ? absoluteDate(opportunity.sourceDate.iso)
                : 'Not stated in the source'}
            </dd>
          </div>
          {horizon.rawExpression && (
            <div className="fact">
              <dt>Expected timing</dt>
              <dd>
                {formatTemporal(horizon)}
                <span className="fact__qualifier"> ({precisionLabel(horizon)})</span>
              </dd>
            </div>
          )}
        </dl>
      </section>

      <section className="drawer__section">
        <H className="drawer__h3">Why this is an opportunity</H>
        <p className="drawer__prose">{opportunity.whyItMatters}</p>
        {opportunity.rationale && opportunity.rationale.corroboration.length > 0 && (
          <dl className="drawer__facts">
            {opportunity.rationale.corroboration.map((fact) => (
              <div className="fact" key={`${fact.label}-${fact.value}`}>
                <dt>{fact.label}</dt>
                <dd>{fact.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      {/*
        THE SOURCE, ABOVE EVERYTHING WE CONCLUDED FROM IT.

        Placed before the confidence axes and the score on purpose: the document
        is the thing a client can verify, and everything below it is our reading
        of that document. An assessment presented above its evidence asks to be
        taken on trust.
      */}
      {opportunity.sources.length > 0 && (
        <section className="drawer__section drawer__section--source">
          <H className="drawer__h3">Source</H>
          {opportunity.sources.map((source) => (
            <article className="source-card" key={source.evidenceId}>
              <p className="source-card__head">
                {source.documentType && (
                  <span className="source-card__form">{source.documentType}</span>
                )}
                <span className="source-card__publisher">{source.publisher}</span>
                {source.filingDate && (
                  <span className="source-card__date">
                    Filed {absoluteDate(source.filingDate)}
                  </span>
                )}
              </p>
              <p className="source-card__title">{source.title}</p>
              {source.excerpt && (
                <blockquote className="source-card__excerpt">{source.excerpt}</blockquote>
              )}
              <p className="source-card__links">
                {source.officialUrl && (
                  <a
                    className="btn btn--primary"
                    href={source.officialUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open the official filing
                    <Icon name="chevron" className="btn__icon" />
                  </a>
                )}
                <Link className="btn btn--quiet" to={evidencePath(source.evidenceId)}>
                  Evidence record
                </Link>
              </p>
            </article>
          ))}
        </section>
      )}

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
            <dd className="fact--emphasis">
              {confidenceLevelLabel[confidence.confidenceLevel] ?? confidence.confidenceLevel}
            </dd>
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

      {/*
        AN UNSCORED RECORD SHOWS NO BARS AT ALL.

        Five empty tracks with an em dash beside each read as a broken widget —
        five measurements that failed to load. Nothing has failed: no analyst has
        prioritised this yet, which is a sentence, not a chart.
      */}
      <section className="drawer__section">
        <H className="drawer__h3">Prioritisation</H>
        {scored ? (
          <>
            <div className="score-breakdown">
              {SCORE_ROWS.map((row) => {
                const value = scores[row.key]
                const cap = SCORE_CAPS[row.key]
                const label = value === null ? 'not scored' : `${value} out of ${cap}`
                return (
                  <div className="score-row" key={row.key}>
                    <span className="score-row__label">{row.label}</span>
                    <span className="score-row__value">
                      {value === null ? '\u2014' : `${value}/${cap}`}
                    </span>
                    <span
                      className="score-row__bar"
                      role="img"
                      aria-label={`${row.label}: ${label}`}
                    >
                      <span
                        className="score-row__fill"
                        style={{
                          width: value === null ? '0%' : `${Math.round((value / cap) * 100)}%`,
                        }}
                      />
                    </span>
                  </div>
                )
              })}
            </div>
            {scores.rawScore !== null &&
              scores.confidenceMultiplier !== null &&
              scores.finalScore !== null && (
                <p className="drawer__prose drawer__prose--small">
                  Raw score {scores.rawScore} of 100, multiplied by a confidence factor of{' '}
                  {scores.confidenceMultiplier.toFixed(2)} to give {scores.finalScore}. The
                  multiplier stops a thinly evidenced opportunity out-ranking a
                  well-evidenced one.
                </p>
              )}
          </>
        ) : (
          <p className="drawer__prose">
            {AWAITING_PRIORITISATION}. This opportunity was derived from the filing above
            and is complete; where it ranks against the rest is a judgement an analyst
            makes, and none has been recorded.
          </p>
        )}
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

      {opportunity.capabilities.length > 0 && (
        <section className="drawer__section">
          <H className="drawer__h3">Capability match</H>
          <ul className="drawer__list">
            {opportunity.capabilities.map((capability) => (
              <li key={capability}>{capability}</li>
            ))}
          </ul>
        </section>
      )}

    </>
  )
}
