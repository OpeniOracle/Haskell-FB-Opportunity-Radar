import { useDataSource } from '@/data/DataSourceContext'

/**
 * The illustrative-data markers.
 *
 * The striped ribbon in the shell is the persistent marker and is present on
 * every view. It is enough on its own — a second full-width purple panel on
 * Opportunities said the same thing twice and pushed the actual content below the
 * fold, which made the page worse without making the warning clearer.
 *
 * What remains alongside it is a compact contextual note, placed next to the
 * results count where a user's eye already is when they start reading the list.
 *
 * Both are driven by `dataSource.meta.illustrative`, not a hard-coded flag: when
 * the API DataSource lands they disappear together and nothing is left behind.
 */

export function IllustrativeBanner() {
  const { meta } = useDataSource()
  if (!meta.illustrative) return null

  return (
    <div className="illustrative-banner" role="note" title={meta.description}>
      <span className="illustrative-banner__label">Illustrative data</span>
      <span className="illustrative-banner__text">
        Sample content for interface review — no real company, project, or evidence
        is shown.
      </span>
    </div>
  )
}

/** Compact contextual note, used next to a results count. */
export function IllustrativeNote({ children }: { children?: React.ReactNode }) {
  const { meta } = useDataSource()
  if (!meta.illustrative) return null

  return (
    <span className="illustrative-note">
      <span className="illustrative-note__dot" aria-hidden="true" />
      {children ?? 'Fictional examples — not market intelligence'}
    </span>
  )
}
