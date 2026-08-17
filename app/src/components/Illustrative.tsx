import { Icon } from '@/components/Icon'
import { useDataSource } from '@/data/DataSourceContext'

/**
 * The "Illustrative Data" markers.
 *
 * Two levels, both driven by `dataSource.meta.illustrative` rather than a
 * hard-coded flag:
 *
 *   <IllustrativeBanner/> — persistent, sticky, on EVERY fixture-backed view.
 *   <IllustrativeBlock/>  — the louder treatment, used on Opportunities, where
 *                           mistaking a fixture for a finding would be worst.
 *
 * When PR 9 swaps in the API DataSource, `illustrative` becomes false and both
 * disappear at once. Nothing else needs editing, and nothing can be left behind.
 */

export function IllustrativeBanner() {
  const { meta } = useDataSource()
  if (!meta.illustrative) return null

  return (
    <div className="illustrative-banner" role="note" title={meta.description}>
      <span className="illustrative-banner__label">Illustrative data</span>
      <span className="illustrative-banner__text">
        Sample content for interface review. No real company, project, evidence, or
        account activity is shown.
      </span>
    </div>
  )
}

export function IllustrativeBlock() {
  const { meta } = useDataSource()
  if (!meta.illustrative) return null

  return (
    <section className="illustrative-block" aria-labelledby="illustrative-block-title">
      <Icon name="flask" className="illustrative-block__icon" />
      <div>
        <h2 id="illustrative-block-title">
          These are not real opportunities
        </h2>
        <p>
          Every company, facility, score, and piece of evidence below is
          fabricated to demonstrate the ranking, confidence, and evidence display.
          No live source has been queried and no Haskell target account is
          represented. Do not use anything on this page as market intelligence.
        </p>
      </div>
    </section>
  )
}

/** Inline tag for use next to individual fixture values. */
export function IllustrativeTag() {
  const { meta } = useDataSource()
  if (!meta.illustrative) return null
  return <span className="illustrative-tag">Illustrative</span>
}
