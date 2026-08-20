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

/**
 * Priority band.
 *
 * A raw score of 78 means nothing to someone opening this for the first time.
 * The band is the part that is actually decision-critical, so it is rendered as
 * a word next to the number and is what the priority filter operates on.
 */
export type PriorityBand = 'critical' | 'high' | 'moderate' | 'low'

/**
 * A pursuit decision taken in the interface.
 *
 * In this milestone these are LOCAL PREVIEW ONLY — held in component state and
 * discarded on reload. There is no persistence layer to write them to, and
 * pretending otherwise would be worse than the disabled button it replaces.
 */
export type LocalDecision = 'pursue' | 'watch' | 'dismiss' | 'assign'

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

/**
 * Which audience a change is for.
 *
 * `market` is commercial intelligence — something happened at an account.
 * `system` is platform operations — something happened to a connector.
 *
 * These are separated in the data, not by string-matching on `kind` in the view,
 * because Daily Pulse leads with commercial intelligence and files operations
 * underneath. A business-development user should not have to read past a
 * connector recovery to find a confirmed project.
 */
export type ChangeChannel = 'market' | 'system'

export interface ChangeEvent {
  id: string
  kind: ChangeKind
  channel: ChangeChannel
  tone: ChangeTone
  title: string
  detail: string
  occurredAt: string
  subjectLabel: string
  /** Surfaces into "Needs attention today" when true. */
  needsAttention: boolean
  /** What to do about it, in the user's terms. Shown only when it needs attention. */
  actionHint: string | null
  /** Links the change to an opportunity so the user can act on it. */
  opportunityId: string | null
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
export type SurfaceStatus<T> =
  | { kind: 'loading' }
  | { kind: 'empty'; reason: string }
  | { kind: 'unavailable'; reason: string; blockedBy: string }
  | { kind: 'degraded'; data: T; notice: string; affected: string[] }
  | { kind: 'stale'; data: T; notice: string; asOf: string }
  | { kind: 'ready'; data: T }

/**
 * `checkedAt` rides on every state, including the failures.
 *
 * "When was this last checked?" is one of the four questions a status message
 * has to answer, and it is the one a user cannot infer from anything else on
 * screen. A surface that cannot show its data can still show when it tried.
 */
export type SurfaceState<T> = SurfaceStatus<T> & { checkedAt: string | null }

/** Provenance of everything on screen. PR 1 is always `fixture`. */
export interface DataSourceMeta {
  mode: 'fixture' | 'api'
  illustrative: boolean
  description: string
}

/* ==================================================================== */
/* Roadmap PR 2 — the five remaining Phase 1 surfaces                    */
/* ==================================================================== */

/* ------------------------------------------------------ Licence gating */

/**
 * An attribute that exists in the model but cannot be populated yet.
 *
 * D14-L (event-data licence review) is **blocked pending external legal
 * review**. Plan §13 names four things it blocks: the trade-show attendance
 * import, the engagement layer, tier attributes and `account_strategy` scoring.
 * Those fields are modelled as this type rather than as `string | null`, because
 * a nullable string invites a fixture author to fill it in "just for the demo".
 * There is no value member on this type at all — the interface can only render
 * the reason.
 */
export interface UnavailableAttribute {
  readonly available: false
  /** Shown to the user. Never a value, never a placeholder that looks like one. */
  reason: string
  /** What would unblock it. */
  blockedBy: string
}

/* ------------------------------------------------- Organization graph */

/**
 * Relationship vocabulary, taken verbatim from `organization_relationships` in
 * `11_SCHEMA_DELTA_PROPOSAL.sql`.
 */
export type OrganizationRelationshipType =
  | 'parent_subsidiary'
  | 'brand_owner'
  | 'division'
  | 'joint_venture'
  | 'franchise_bottler'
  | 'co_manufacturer'
  | 'former_parent'
  | 'minority_interest'

export type OwnershipPercentBasis = 'stated' | 'approximate' | 'inferred'

/**
 * A time-bounded, evidence-backed relationship between two organizations.
 *
 * ADR 0005 is **Accepted in part** via D18 — this corollary is the accepted
 * half. Intervals are HALF-OPEN: `fromDate` is INCLUSIVE, `toDate` is
 * **EXCLUSIVE**, `null` means open-ended. A relationship that ends on the day
 * another begins therefore has no overlap and no gap.
 */
export interface OrganizationRelationship {
  id: string
  counterpartyId: string
  counterpartyName: string
  relationship: OrganizationRelationshipType
  /** Required by the schema for `minority_interest`, null otherwise. */
  ownershipPercent: number | null
  ownershipPercentBasis: OwnershipPercentBasis | null
  /** Inclusive. */
  fromDate: string | null
  /** EXCLUSIVE. `null` = still in force. */
  toDate: string | null
  /** The evidence record that establishes it. */
  evidenceId: string | null
  note: string | null
}

/**
 * A dated event on a company's own timeline.
 *
 * `scope` matters and is not decoration. The schema delta is explicit that an
 * organization-level milestone "belongs to the organization, never against any
 * individual plant. Facility timelines MAY DISPLAY it for context — but the
 * platform must not assert it as a facility-specific event." `organization`
 * scope is what a facility timeline is allowed to borrow and must label as
 * borrowed.
 */
export interface CompanyTimelineEntry {
  id: string
  scope: 'organization' | 'facility'
  kind: 'ownership' | 'operational' | 'evidence' | 'opportunity'
  title: string
  detail: string
  occurredOn: TemporalValue
  evidenceId: string | null
  facilityId: string | null
}

export interface CoverageDetail {
  expectedSources: string[]
  observedSources: string[]
  missingSources: string[]
  lastCheckedAt: string
  /** Plain-language reason for any gap. Empty when fully covered. */
  gapReason: string | null
}

export interface CompanySummary {
  id: string
  canonicalName: string
  parentName: string | null
  role: string
  sectors: string[]
  scopeClass: ScopeClass
  scopeClassStatus: ScopeClassStatus
  facilityCount: number
  openOpportunityCount: number
  latestActivityAt: string
  coverage: CoverageDetail
  /** D14-L. Never populated. */
  targetTier: UnavailableAttribute
  engagement: UnavailableAttribute
}

/**
 * A pointer to another record, carrying the label the interface must show.
 *
 * An id is an address, not a name. Rendering `fac-fixture-3` where a plant
 * belongs asks a business-development user to memorise the key space, so a
 * reference always travels with the words a person would use for it.
 */
export interface RecordRef {
  id: string
  label: string
  /** One line of context — a location, a status, a stage. */
  detail: string | null
}

export interface Company extends CompanySummary {
  aliases: string[]
  relationships: OrganizationRelationship[]
  facilities: RecordRef[]
  openOpportunities: RecordRef[]
  timeline: CompanyTimelineEntry[]
  /** D14-L. Never populated. */
  accountStrategyScore: UnavailableAttribute
}

/* ------------------------------------------------------------ Facility */

export type FacilityResolution = 'confirmed' | 'candidate'

export type FacilityOperatingStatus =
  | 'operating'
  | 'under_construction'
  | 'announced'
  | 'idle'
  | 'closed'
  | 'unknown'

export interface FacilityIdentifier {
  scheme: string
  value: string
  /** Deterministic identifiers come from a registry; source-provided do not. */
  origin: 'deterministic' | 'source_provided'
}

export interface FacilityRecord {
  id: string
  name: string
  /** Brand owner. The operator as at a date comes from the ownership graph. */
  organizationId: string
  organizationName: string
  addressLine: string | null
  locality: string | null
  region: string | null
  facilityType: string
  operatingStatus: FacilityOperatingStatus
  resolution: FacilityResolution
  /** Why a candidate is only a candidate. Null when confirmed. */
  candidateReason: string | null
  identifiers: FacilityIdentifier[]
  evidence: RecordRef[]
  opportunities: RecordRef[]
  timeline: CompanyTimelineEntry[]
}

/* ------------------------------------------------------------ Evidence */

export type EvidenceAccessMode =
  | 'structured_primary'
  | 'archived_full_text'
  | 'licensed_full_text'
  | 'reference_only'
  | 'metadata_only'

/** ADR 0012 relationship vocabulary, verbatim. */
export type CorrectionRelationship =
  | 'corrects'
  | 'retracts'
  | 'withdraws'
  | 'contradicts'
  | 'supersedes'
  | 'delays'
  | 'cancels'

export interface CorrectionLink {
  relationship: CorrectionRelationship
  /** The evidence on the other end. Always still readable. */
  evidenceId: string
  evidenceTitle: string
  occurredAt: string
  note: string
}

/**
 * One assertion carried by a piece of evidence.
 *
 * `basis` separates what the source said from what the platform concluded. The
 * UX spec requires that distinction to be visible rather than implied.
 */
export interface EvidenceAssertion {
  id: string
  statement: string
  basis: 'source_fact' | 'system_inference'
  /** Present only for an inference: how it was reached. */
  inferenceNote: string | null
}

export interface EvidenceRecord {
  id: string
  title: string
  sourceName: string
  publisher: string
  /** Distinct values, never conflated. */
  publishedAt: TemporalValue
  retrievedAt: string
  /** Absent for reference-only and metadata-only access modes. */
  excerpt: string | null
  locator: string | null
  accessMode: EvidenceAccessMode
  /** What the evidence says about WHEN something happens. */
  subjectTiming: TemporalValue | null
  assertions: EvidenceAssertion[]
  relatedCompany: RecordRef | null
  relatedFacility: RecordRef | null
  relatedOpportunity: RecordRef | null
  /** Named but never linked: the staging queue is not a Phase 1 surface. */
  relatedClaim: RecordRef | null
  /** Corrections in both directions; nothing is ever overwritten. */
  corrections: CorrectionLink[]
  /** True when a later record supersedes this one. It stays readable. */
  supersededByEvidenceId: string | null
}

/* -------------------------------------------- Source health & coverage */

export type ConnectorState =
  | 'healthy'
  | 'degraded'
  | 'action_required'
  | 'disabled'
  | 'unsupported'

export interface ConnectorRun {
  id: string
  startedAt: string
  outcome: 'success' | 'partial_success' | 'failure'
  note: string
}

export interface ConnectorRecord {
  id: string
  name: string
  state: ConnectorState
  lastRunAt: string
  lastOutcome: ConnectorRun['outcome']
  consecutiveFailures: number
  lastSuccessfulCollectionAt: string | null
  /** Hours since the last successful collection, against its cadence. */
  freshnessHours: number
  expectedCadenceHours: number
  /** Failure history is appended, never overwritten. */
  runHistory: ConnectorRun[]
  /** A bounded maintenance task, when one is open. Never routine data entry. */
  maintenance: { task: string; openedAt: string } | null
}

export interface CompanyCoverageRow {
  companyId: string
  companyName: string
  coverage: CoverageDetail
}

/**
 * Two independent metric families.
 *
 * ADR 0010 is **Proposed** and D17 is **Open**. This models the separation the
 * ADR recommends; it does not implement a coverage measurement policy, and the
 * surface says so.
 */
export interface SourceHealthSnapshot {
  connectors: ConnectorRecord[]
  coverage: CompanyCoverageRow[]
  lastCycleCompletedAt: string
}

/* ------------------------------------------ Saved pursuits and watches */

export type WatchKind = 'company' | 'facility' | 'opportunity'

export interface WatchItem {
  id: string
  kind: WatchKind
  targetId: string
  label: string
  context: string
  addedAt: string
}

export interface SavedViewRecord {
  id: string
  name: string
  surface: 'opportunities' | 'accounts'
  /** Human-readable summary of the filters the view carries. */
  filterSummary: string[]
  resultCount: number
  createdAt: string
}

export interface SavedWorkspace {
  views: SavedViewRecord[]
  watches: WatchItem[]
}
