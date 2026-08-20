import type {
  Company,
  CompanySummary,
  DataSourceMeta,
  EvidenceRecord,
  FacilityRecord,
  Opportunity,
  PulseSnapshot,
  SavedWorkspace,
  SourceHealthSnapshot,
  SurfaceState,
} from '@/types/domain'

/**
 * The single seam between surfaces and data.
 *
 * Roadmap PR 2 ships one implementation (`fixtureDataSource`) covering all seven
 * Phase 1 surfaces. Roadmap PR 9 adds the `api` implementation and swaps it in —
 * the same interface, not a replacement of the mock. Surfaces never import
 * fixtures directly; ESLint enforces that (`no-restricted-imports` in
 * eslint.config.js).
 *
 * Every method returns a `SurfaceState`, so a surface cannot accidentally render
 * a happy path for data that is loading, empty, degraded, stale, or unavailable.
 * Single-record lookups return `unavailable` for an unknown id rather than
 * throwing, because "no such record" is a state a user can be shown.
 */
export interface DataSource {
  readonly meta: DataSourceMeta

  getPulse(): Promise<SurfaceState<PulseSnapshot>>

  getOpportunities(): Promise<SurfaceState<Opportunity[]>>

  /* ---- Roadmap PR 2 surfaces ---- */

  getCompanies(): Promise<SurfaceState<CompanySummary[]>>

  getCompany(companyId: string): Promise<SurfaceState<Company>>

  getFacility(facilityId: string): Promise<SurfaceState<FacilityRecord>>

  getEvidence(evidenceId: string): Promise<SurfaceState<EvidenceRecord>>

  getSourceHealth(): Promise<SurfaceState<SourceHealthSnapshot>>

  getSavedWorkspace(): Promise<SurfaceState<SavedWorkspace>>
}
