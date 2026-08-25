import { Icon } from '@/components/Icon'
import { RecordedAt } from '@/components/RecordedAt'
import type { CoverageDetail } from '@/types/domain'

/**
 * Expected coverage for one company.
 *
 * Coverage is not connector health. ADR 0010 (Proposed; D17 Open) keeps them as
 * two metric families, and this card only ever answers the coverage question:
 * were the sources we expect for this account actually observed? A gap always
 * carries a plain-language reason, because a gap you cannot explain is not
 * actionable.
 */
export function CoverageCard({ coverage }: { coverage: CoverageDetail }) {
  const complete = coverage.missingSources.length === 0

  return (
    <div className={`coverage-card${complete ? '' : ' coverage-card--gap'}`}>
      <div className="coverage-card__head">
        <Icon name={complete ? 'check' : 'alert'} className="coverage-card__icon" />
        <p className="coverage-card__summary">
          <strong>
            {coverage.observedSources.length} of {coverage.expectedSources.length}
          </strong>{' '}
          expected sources observed this period
        </p>
        <RecordedAt
          className="state__checked"
          iso={coverage.lastCheckedAt}
          prefix="Last checked"
        />
      </div>

      <dl className="coverage-card__lists">
        <div className="fact">
          <dt>Expected</dt>
          <dd>{coverage.expectedSources.join(', ') || 'None configured'}</dd>
        </div>
        <div className="fact">
          <dt>Observed</dt>
          <dd>{coverage.observedSources.join(', ') || 'None'}</dd>
        </div>
        <div className="fact">
          <dt>Missing</dt>
          <dd className={complete ? undefined : 'coverage-card__missing'}>
            {complete ? 'None' : coverage.missingSources.join(', ')}
          </dd>
        </div>
      </dl>

      {coverage.gapReason && (
        <p className="coverage-card__reason">
          <strong>Why: </strong>
          {coverage.gapReason}
        </p>
      )}
    </div>
  )
}
