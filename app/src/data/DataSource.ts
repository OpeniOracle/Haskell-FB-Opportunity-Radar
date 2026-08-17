import type {
  DataSourceMeta,
  Opportunity,
  PulseSnapshot,
  SurfaceState,
} from '@/types/domain'

/**
 * The single seam between surfaces and data.
 *
 * PR 1 ships one implementation (`fixtureDataSource`). PR 9 adds the `api`
 * implementation and swaps it in — the same interface, not a replacement of the
 * mock. Surfaces never import fixtures directly; ESLint enforces that
 * (`no-restricted-imports` in eslint.config.js).
 *
 * Every method returns a `SurfaceState`, so a surface cannot accidentally render
 * a happy path for data that is loading, empty, degraded, stale, or unavailable.
 */
export interface DataSource {
  readonly meta: DataSourceMeta

  getPulse(): Promise<SurfaceState<PulseSnapshot>>

  getOpportunities(): Promise<SurfaceState<Opportunity[]>>
}
