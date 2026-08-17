/**
 * Typed domain models for the Phase 1 application shell.
 *
 * These mirror `schemas/platform.schema.json` and the proposed delta in
 * `docs/design/11_SCHEMA_DELTA_PROPOSAL.sql`. They are deliberately a SUBSET:
 * PR 1 renders Daily Pulse and Opportunities only, so only the fields those
 * surfaces need are modelled here.
 *
 * Three approved decisions are represented structurally rather than as loose
 * strings, because getting them wrong later is expensive:
 *
 *   D15 / ADR 0004 — temporal values are INTERVALS with precision and basis.
 *                    There is no plain `Date` field anywhere in this file.
 *   D16 / ADR 0009 — confidence is three independent axes, not one enum.
 *   D11            — scope classification carries a provisional/confirmed status.
 */

/* ------------------------------------------------------------------ Temporal */

export type TemporalPrecision =
  | 'exact_day'
  | 'month'
  | 'quarter'
  | 'season'
  | 'half_year'
  | 'year'
  | 'range'
  | 'relative'
  | 'unknown'

export type TemporalBasis = 'stated' | 'inferred' | 'unknown'

/**
 * An interval, never a point. `start`/`end` are ISO `YYYY-MM-DD`.
 * `rawExpression` is what the source actually said and is always preserved.
 */
export interface TemporalValue {
  rawExpression: string | null
  start: string | null
  end: string | null
  precision: TemporalPrecision
  basis: TemporalBasis
  inferenceNote: string | null
}

/* --------------------------------------------------- Confidence: three axes */

/** How good is the underlying record? */
export type EvidenceStrength = 'indicative' | 'corroborated' | 'authoritative'

/** What kind of claim is this? */
export type AssessmentType = 'observed_fact' | 'inference' | 'hypothesis'

/** How sure are we, all things considered? */
export type ConfidenceLevel = 'low' | 'moderate' | 'high'

export interface ConfidenceAxes {
  evidenceStrength: EvidenceStrength
  assessmentType: AssessmentType
  confidenceLevel: ConfidenceLevel
}

/* ---------------------------------------------------------------- Opportunity */

export type OpportunityStage = 'emerging' | 'developing' | 'confirmed'

export type OpportunityStatus =
  | 'new'
  | 'watching'
  | 'pursue'
  | 'assigned'
  | 'on_hold'
  | 'dismissed'
  | 'closed_won'
  | 'closed_lost'
  | 'cancelled'
  | 'expired'

export type ScopeClass = 'fnb_core' | 'fnb_adjacent' | 'non_fnb' | 'unknown'

export type ScopeClassStatus = 'provisional' | 'confirmed'

export interface ScoreComponents {
  haskellFit: number
  projectMaturity: number
  potentialScope: number
  timingMomentum: number
  accountStrategy: number
  rawScore: number
  confidenceMultiplier: number
  finalScore: number
}

/** Caps come from `02_DATA_AND_SIGNAL_MODEL.md` and are used to render bars. */
export const SCORE_CAPS = {
  haskellFit: 30,
  projectMaturity: 25,
  potentialScope: 20,
  timingMomentum: 15,
  accountStrategy: 10,
} as const

export interface OrganizationRef {
  id: string
  canonicalName: string
  /** The operating entity, when it differs from the brand owner (D13). */
  operatorName: string | null
  scopeClass: ScopeClass
  scopeClassStatus: ScopeClassStatus
}

export interface FacilityRef {
  id: string
  name: string
  locality: string | null
  region: string | null
}

export interface EvidenceSummary {
  count: number
  independentPublishers: number
  newestRetrievedAt: string
  /** Highest access mode present across the supporting evidence. */
  strongestAccessMode:
    | 'structured_primary'
    | 'archived_full_text'
    | 'licensed_full_text'
    | 'reference_only'
    | 'metadata_only'
}

export interface Opportunity {
  id: string
  title: string
  organization: OrganizationRef
  facility: FacilityRef | null
  stage: OpportunityStage
  status: OpportunityStatus
  confidence: ConfidenceAxes
  horizon: TemporalValue
  whyItMatters: string
  capabilities: string[]
  scores: ScoreComponents
  evidence: EvidenceSummary
  lastMaterialChangeAt: string
}

/* ---------------------------------------------------------------- Pulse feed */

export type ChangeTone = 'confirmed' | 'developing' | 'emerging' | 'attention' | 'neutral'

export type ChangeKind =
  | 'stage_promoted'
  | 'evidence_added'
  | 'facility_resolved'
  | 'negative_signal'
  | 'coverage_degraded'
  | 'source_recovered'

export interface ChangeEvent {
  id: string
  kind: ChangeKind
  tone: ChangeTone
  title: string
  detail: string
  occurredAt: string
  subjectLabel: string
}

export interface CoverageSummary {
  accountsMonitored: number
  accountsAtOrAboveExpected: number
  accountsBelowExpected: number
  /** Named so the surface can say WHICH accounts are uncovered, per ADR 0010. */
  accountsUncovered: string[]
}

export interface ConnectorHealthSummary {
  sourcesEnabled: number
  healthy: number
  degraded: number
  actionRequired: number
  lastCycleCompletedAt: string
}

export interface PulseSnapshot {
  /** Distinct from connector health — ADR 0010 forbids merging these. */
  coverage: CoverageSummary
  connectorHealth: ConnectorHealthSummary
  changesSinceLastVisit: ChangeEvent[]
  lastVisitAt: string | null
  generatedAt: string
}

/* ----------------------------------------------------------- Surface envelope */

/**
 * Every surface renders one of these. Making the non-happy states part of the
 * type means a surface cannot forget to handle them — `04_UX_DESIGN_SPEC.md`
 * requires empty, loading, stale, degraded, and failed states to be explicit.
 */
export type SurfaceState<T> =
  | { kind: 'loading' }
  | { kind: 'empty'; reason: string }
  | { kind: 'unavailable'; reason: string; blockedBy: string }
  | { kind: 'degraded'; data: T; notice: string; affected: string[] }
  | { kind: 'stale'; data: T; notice: string; asOf: string }
  | { kind: 'ready'; data: T }

/** Provenance of everything on screen. PR 1 is always `fixture`. */
export interface DataSourceMeta {
  mode: 'fixture' | 'api'
  illustrative: boolean
  description: string
}
