import { useCallback } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { Icon } from '@/components/Icon'
import { IllustrativeNote } from '@/components/Illustrative'
import { RecordLink, RecordMention } from '@/components/RecordLink'
import { FutureTimestampWarning } from '@/components/RecordedAt'
import { StatusPill } from '@/components/StatusPill'
import {
  DegradedNotice,
  EmptyState,
  LoadingState,
  StaleNotice,
  UnavailableState,
} from '@/components/SurfaceStates'
import { useDataSource } from '@/data/DataSourceContext'
import { useSurfaceData } from '@/hooks/useSurfaceData'
import {
  absoluteDateTime,
  accessModeLabel,
  accessModeRecordedValue,
  formatTemporal,
  precisionLabel,
  relativeTime,
  timingBasisLabel,
} from '@/lib/format'
import { companyPath, evidencePath, facilityPath } from '@/lib/links'
import { opportunityDetailPath } from '@/lib/opportunityFilters'
import type { CorrectionRelationship, EvidenceRecord } from '@/types/domain'

const CORRECTION_LABEL: Record<CorrectionRelationship, string> = {
  corrects: 'Corrects',
  retracts: 'Retracts',
  withdraws: 'Withdraws',
  contradicts: 'Contradicts',
  supersedes: 'Superseded by',
  delays: 'Delays',
  cancels: 'Cancels',
}

/**
 * Evidence detail — `/evidence/:evidenceId`, a contextual surface.
 *
 * Three rules govern what this page may show:
 *
 *   **ADR 0004 / D15 (Accepted).** A date is rendered at the precision the source
 *   stated and no finer. Publication time and retrieval time are separate values
 *   and are never conflated — a record published in a month and retrieved on a
 *   day has both, shown as both.
 *
 *   **ADR 0012 / D24 (Accepted).** Corrections supersede; they do not overwrite.
 *   A superseded record stays readable and links to the record that replaced it,
 *   and the replacement links back. Nothing is deleted.
 *
 *   **ADR 0006 / D19 (Proposed / Open).** Access mode is displayed as a recorded
 *   attribute. No promotion rule is implemented from it and none is implied.
 */
export function EvidenceDetail() {
  const source = useDataSource()
  const { evidenceId } = useParams<{ evidenceId: string }>()
  const load = useCallback(
    () => source.getEvidence(evidenceId ?? ''),
    [source, evidenceId],
  )
  const state = useSurfaceData(load, [load])

  const hasData =
    state.kind === 'ready' || state.kind === 'degraded' || state.kind === 'stale'

  return (
    <>
      {state.kind === 'loading' && <LoadingState label="Loading the evidence record" rows={1} />}

      {state.kind === 'empty' && (
        <EmptyState
          title="No retained content"
          body={state.reason}
          next="The reference is preserved even where the body is not."
          checkedAt={state.checkedAt}
        />
      )}

      {state.kind === 'unavailable' && (
        <UnavailableState
          title="This evidence record isn’t available"
          reason={state.reason}
          blockedBy={state.blockedBy}
          checkedAt={state.checkedAt}
          role="status"
        />
      )}

      {state.kind === 'degraded' && (
        <DegradedNotice
          notice={state.notice}
          affected={state.affected}
          checkedAt={state.checkedAt}
        />
      )}

      {state.kind === 'stale' && (
        <StaleNotice notice={state.notice} asOf={state.asOf} checkedAt={state.checkedAt} />
      )}

      {hasData && <EvidenceBody evidence={state.data} />}
    </>
  )
}

function EvidenceBody({ evidence }: { evidence: EvidenceRecord }) {
  const { search } = useLocation()
  const superseded = evidence.supersededByEvidenceId !== null
  const bodyWithheld = evidence.excerpt === null

  return (
    <article className={`detail detail--wide${superseded ? ' detail--superseded' : ''}`}>
      <header className="page-head page-head--tight">
        <div>
          <p className="detail__eyebrow">
            {evidence.publisher}
            <span className="detail__band">{' · '}{evidence.sourceName}</span>
          </p>
          <h1 className="page-head__title detail__title">{evidence.title}</h1>
        </div>
        <div className="page-head__meta">
          <IllustrativeNote />
        </div>
      </header>

      <div className="opp__pills detail__pills">
        <StatusPill
          tone="neutral"
          icon="document"
          label={accessModeLabel[evidence.accessMode] ?? evidence.accessMode}
          title="Recorded access mode. ADR 0006 is Proposed and D19 is open — no promotion rule is applied from this."
        />
        {superseded && (
          <StatusPill
            tone="developing"
            icon="clock"
            label="Superseded"
            title="A later record replaced this one in the presented view. This record is not deleted."
          />
        )}
      </div>

      {superseded && evidence.supersededByEvidenceId && (
        <p className="notice notice--stale">
          <Icon name="alert" className="notice__icon" />
          <span>
            <strong>Superseded, not replaced. </strong>
            A later record was selected for the presented view. This one remains readable
            and is still part of the record.{' '}
            <Link to={evidencePath(evidence.supersededByEvidenceId, search)}>
              Open the record that supersedes it
            </Link>
            .
          </span>
        </p>
      )}

      <section className="detail__section" aria-labelledby="ev-provenance">
        <h2 className="detail__h2" id="ev-provenance">
          Provenance
        </h2>
        <dl className="drawer__facts">
          <div className="fact">
            <dt>Source</dt>
            <dd>{evidence.sourceName}</dd>
          </div>
          <div className="fact">
            <dt>Publisher</dt>
            <dd>{evidence.publisher}</dd>
          </div>
          <div className="fact">
            <dt>Published</dt>
            <dd>
              {formatTemporal(evidence.publishedAt)}
              <span className="fact__qualifier">
                {' '}
                ({precisionLabel(evidence.publishedAt)})
              </span>
            </dd>
          </div>
          <div className="fact">
            <dt>Retrieved</dt>
            <dd title={absoluteDateTime(evidence.retrievedAt)}>
              {absoluteDateTime(evidence.retrievedAt)}
              <span className="fact__qualifier">
                {' '}
                ({relativeTime(evidence.retrievedAt)})
              </span>
              <FutureTimestampWarning iso={evidence.retrievedAt} />
            </dd>
          </div>
          <div className="fact">
            <dt>How this source was obtained</dt>
            <dd>
              {accessModeLabel[evidence.accessMode] ?? evidence.accessMode}
              <span className="fact__qualifier">
                {' '}
                (recorded as{' '}
                <code>{accessModeRecordedValue[evidence.accessMode] ?? evidence.accessMode}</code>)
              </span>
            </dd>
          </div>
          <div className="fact fact--wide">
            <dt>Source reference</dt>
            <dd>
              {evidence.locator ? (
                <code className="locator">{evidence.locator}</code>
              ) : (
                <span className="fact__qualifier">No source reference retained</span>
              )}
            </dd>
          </div>
        </dl>
        <p className="drawer__prose drawer__prose--small">
          Published and retrieved are separate values and are never conflated. A record
          dated to a month is shown as that month — rendering it as the first of the month
          would assert a precision the publisher did not give.
        </p>
      </section>

      <section className="detail__section" aria-labelledby="ev-content">
        <h2 className="detail__h2" id="ev-content">
          Content
        </h2>
        {bodyWithheld ? (
          <div className="state state--unavailable" role="status">
            <Icon name="lock" className="state__icon" />
            <div className="state__text">
              <h3 className="state__title">
                {evidence.accessMode === 'metadata_only'
                  ? 'Metadata only — no body retained'
                  : 'Reference only — no body retained'}
              </h3>
              <p className="state__body">
                {evidence.accessMode === 'metadata_only'
                  ? 'Neither the body nor a locator was retained for this record. What is known about it is on this page and nothing more is being withheld from you.'
                  : 'The body was not retained for this record. The reference is preserved so the claim can be traced, and the absence is shown rather than filled with a summary.'}
              </p>
            </div>
          </div>
        ) : (
          <blockquote className="excerpt">
            <p>{evidence.excerpt}</p>
          </blockquote>
        )}
      </section>

      {evidence.subjectTiming && (
        <section className="detail__section" aria-labelledby="ev-timing">
          <h2 className="detail__h2" id="ev-timing">
            What it says about timing
          </h2>
          <dl className="drawer__facts">
            <div className="fact">
              <dt>What the source said about timing</dt>
              <dd>
                {formatTemporal(evidence.subjectTiming)}
                <span className="fact__qualifier">
                  {' '}
                  ({precisionLabel(evidence.subjectTiming)})
                </span>
              </dd>
            </div>
            <div className="fact">
              <dt>Earliest and latest it could mean</dt>
              <dd>
                {evidence.subjectTiming.start ?? '—'} to{' '}
                {evidence.subjectTiming.end ?? '—'}
              </dd>
            </div>
            <div className="fact">
              <dt>How the timing was determined</dt>
              <dd className="fact--emphasis">
                {timingBasisLabel[evidence.subjectTiming.basis] ??
                  evidence.subjectTiming.basis}
                <span className="fact__qualifier">
                  {' '}
                  (recorded as <code>{evidence.subjectTiming.basis}</code>)
                </span>
              </dd>
            </div>
          </dl>
          {evidence.subjectTiming.inferenceNote && (
            <p className="notice notice--stale">
              <Icon name="alert" className="notice__icon" />
              <span>
                <strong>Inferred, not stated. </strong>
                {evidence.subjectTiming.inferenceNote}
              </span>
            </p>
          )}
        </section>
      )}

      <section className="detail__section" aria-labelledby="ev-assertions">
        <h2 className="detail__h2" id="ev-assertions">
          What this record establishes
        </h2>
        <ul className="assertions">
          {evidence.assertions.map((assertion) => (
            <li
              className={`assertion assertion--${assertion.basis}`}
              key={assertion.id}
            >
              <span className="assertion__badge">
                <Icon
                  name={assertion.basis === 'source_fact' ? 'document' : 'spark'}
                  className="assertion__icon"
                />
                {assertion.basis === 'source_fact' ? 'Source fact' : 'System inference'}
              </span>
              <span className="assertion__body">
                <span className="assertion__statement">{assertion.statement}</span>
                {assertion.inferenceNote && (
                  <span className="assertion__note">{assertion.inferenceNote}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
        <p className="drawer__prose drawer__prose--small">
          A source fact is what the publisher wrote. A system inference is what the
          platform concluded from it. Keeping them apart is what lets a reader disagree
          with the conclusion without doubting the document.
        </p>
      </section>

      <section className="detail__section" aria-labelledby="ev-corrections">
        <h2 className="detail__h2" id="ev-corrections">
          Corrections and supersession
        </h2>
        {evidence.corrections.length === 0 ? (
          <p className="drawer__prose drawer__prose--small">
            No corrections reference this record.
          </p>
        ) : (
          <ul className="corrections">
            {evidence.corrections.map((link) => (
              <li className="correction" key={`${link.relationship}-${link.evidenceId}`}>
                <span className="correction__relationship">
                  {CORRECTION_LABEL[link.relationship]}
                </span>
                <span className="correction__body">
                  <Link to={evidencePath(link.evidenceId, search)}>
                    {link.evidenceTitle}
                  </Link>
                  <span className="correction__note">{link.note}</span>
                  <span className="correction__when">
                    {absoluteDateTime(link.occurredAt)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="drawer__prose drawer__prose--small">
          Corrections are relationships between immutable records, never edits.{' '}
          <code>superseded_by</code> survives as a link; nothing is deleted, and what
          changes is only which record the presented view selects.
        </p>
      </section>

      <section className="detail__section" aria-labelledby="ev-related">
        <h2 className="detail__h2" id="ev-related">
          Related records
        </h2>
        <ul className="record-list">
          {evidence.relatedCompany && (
            <li>
              <RecordLink
                to={companyPath(evidence.relatedCompany.id, search)}
                icon="building"
                record={evidence.relatedCompany}
              />
            </li>
          )}
          {evidence.relatedFacility && (
            <li>
              <RecordLink
                to={facilityPath(evidence.relatedFacility.id, search)}
                icon="pin"
                record={evidence.relatedFacility}
              />
            </li>
          )}
          {evidence.relatedOpportunity && (
            <li>
              <RecordLink
                to={opportunityDetailPath(evidence.relatedOpportunity.id, search)}
                icon="target"
                record={evidence.relatedOpportunity}
              />
            </li>
          )}
          {/* Named, not linked: the research-claim staging queue is not a Phase 1
              surface, so there is nowhere honest to send the reader. */}
          {evidence.relatedClaim && (
            <li>
              <RecordMention
                icon="flask"
                record={evidence.relatedClaim}
                note="staging only, no queue in Phase 1"
              />
            </li>
          )}
        </ul>
      </section>
    </article>
  )
}
