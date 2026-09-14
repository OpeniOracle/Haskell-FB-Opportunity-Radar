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

/**
 * NULL MEANS NOT SCORED YET. IT DOES NOT MEAN ZERO.
 *
 * An opportunity derived from collected evidence exists before anyone has
 * scored it: the scoring configuration is versioned, and one axis is gated on
 * the D14-L licence review. Modelling these as plain numbers forced whatever
 * created the record to supply a value, and the only values available to a
 * collector are invented ones — in the same column an analyst's real score
 * lives in, indistinguishable from it forever after.
 *
 * So the absence is in the type, and every consumer has to decide what to show
 * for it. That is the point: "not scored yet" is a fact worth rendering, and a
 * zero would be a lie that sorts to the bottom and looks deliberate.
 */
export interface ScoreComponents {
  haskellFit: number | null
  projectMaturity: number | null
  potentialScope: number | null
  timingMomentum: number | null
  accountStrategy: number | null
  rawScore: number | null
  confidenceMultiplier: number | null
  finalScore: number | null
}

/**
 * Priority band.
 *
 * A raw score of 78 means nothing to someone opening this for the first time.
 * The band is the part that is actually decision-critical, so it is rendered as
 * a word next to the number and is what the priority filter operates on.
 */
export type PriorityBand = 'critical' | 'high' | 'moderate' | 'low'

/*
 * THERE IS NO `LocalDecision` TYPE ANY MORE, AND THAT IS DELIBERATE.
 *
 * Pursue, Watch, Assign and Dismiss existed as buttons that held a choice in
 * component state and threw it away on reload, labelled "preview only". In a
 * preview build that was an honest demonstration of an interaction. In front of
 * a client it is a control that appears to do something and does not, and the
 * small print underneath is not a remedy — the first thing a user does with a
 * list of opportunities is mark one.
 *
 * There is no persistence layer: `user_read_state` is granted SELECT and
 * nothing else, and no policy admits a write. So the controls are gone rather
 * than disabled, and Saved Pursuits & Watches is gone from the navigation
 * rather than rendering an empty page. They come back when there is a table to
 * write to.
 */

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

/**
 * The document an opportunity rests on, in the terms a client reads it in.
 *
 * An opportunity derived from a filing is only as good as the filing, and the
 * first question anyone asks in a demonstration is "where does that come from?"
 * This is the answer, and it is carried on the record rather than assembled in a
 * component, so the list, the drawer and the full page cannot cite it three
 * different ways.
 *
 * `officialUrl` is the publisher's own address for the document — not our copy,
 * not a search result. `documentType` is the form as the publisher filed it
 * ("8-K"), taken from the recorded locator metadata rather than parsed out of a
 * title.
 */
export interface OpportunitySource {
  evidenceId: string
  title: string
  publisher: string
  /** The form as filed — "8-K", "10-K". Null when the source did not state one. */
  documentType: string | null
  /** The date the document was published or filed. Null if the source gave none. */
  filingDate: string | null
  officialUrl: string | null
  /** The matched passage, verbatim from the document. */
  excerpt: string | null
  accessMode: EvidenceAccessMode
}

/**
 * Why the platform believes this is a project, written for a reader.
 *
 * The classifier records its own derivation — the term it matched, the asset it
 * matched near, the corroborating facts, the width of the window it searched and
 * the grade it assigned. That text is a correct and useful engineering artefact
 * and it is the wrong thing to put in front of a business-development user: it
 * describes the mechanism, not the finding, and phrases like "within 420
 * characters" and "read by a machine" tell a client about our regular
 * expressions instead of about their account.
 *
 * So the STRUCTURED parts of that derivation are carried here and the sentence
 * is composed from them at the boundary. Nothing is invented: every value in
 * `corroboration` is a string the source document actually contained.
 */
export interface OpportunityRationale {
  /** One sentence, composed from the fields below. Never the raw derivation. */
  summary: string
  /** The activity term the document used — "will build", "expansion". */
  matchedActivity: string | null
  /** The asset the activity was about — "production facility". */
  matchedAsset: string | null
  /** Corroborating facts found in the same passage, with readable labels. */
  corroboration: { label: string; value: string }[]
}

/**
 * The date this opportunity is anchored to, and what that date actually IS.
 *
 * `basis` is not decoration. A filing date is when a document was published; an
 * event date is when the thing is said to happen. Rendering the first as though
 * it were the second is the specific lie this type exists to prevent — and
 * showing neither, which is what "No date given" did while the filing date sat
 * in the record, is the failure it was written to fix.
 */
export interface OpportunityDate {
  iso: string
  basis: 'filing_date' | 'stated_event_date'
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
  /**
   * The date on the record. Filing date when the source stated no event date —
   * labelled as a filing date, never promoted into a forecast.
   */
  sourceDate: OpportunityDate | null
  whyItMatters: string
  rationale: OpportunityRationale | null
  /**
   * What makes this record different from the one above it.
   *
   * Derived opportunity titles are "<family> — <matched asset>", so two projects
   * at the same company read identically in a list. This is a short line of
   * TRUE source attributes — amount, place, filing date — that tells them apart.
   * Null when nothing distinguishing was recorded; it is never padded.
   */
  distinguisher: string | null
  capabilities: string[]
  scores: ScoreComponents
  evidence: EvidenceSummary
  /** Every document behind this opportunity, newest first. */
  sources: OpportunitySource[]
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

/**
 * The four counts Daily Pulse leads with.
 *
 * These are COUNTS OF RECORDS, not estimates: each one is the number of rows a
 * query returned. `newSignalCount` is bounded by a stated window rather than by
 * "since your last visit", because there is no stored last-visit time and
 * pretending there is would make the number unreproducible.
 */
export interface PulseHeadline {
  opportunityCount: number
  signalCount: number
  newSignalCount: number
  /** The window `newSignalCount` covers, stated so the figure can be checked. */
  newSignalWindowDays: number
  evidenceCount: number
  latestEvidenceAt: string | null
}

/** One collected document, as Daily Pulse lists it. */
export interface PulseEvidenceItem {
  id: string
  title: string
  publisher: string
  documentType: string | null
  /** Published or filed date where the source gave one, retrieval date otherwise. */
  recordedAt: string
  recordedAtBasis: 'published' | 'retrieved'
  officialUrl: string | null
}

/** One opportunity, as Daily Pulse lists it. */
export interface PulseOpportunityItem {
  id: string
  title: string
  organizationName: string
  stage: OpportunityStage
  confidenceLevel: ConfidenceLevel
  sourceDate: OpportunityDate | null
  evidenceCount: number
  distinguisher: string | null
}

/** One signal, as Daily Pulse lists it. */
export interface PulseSignalItem {
  id: string
  title: string
  organizationName: string
  observedAt: string
  eventDate: string | null
  /** A closure or consolidation is not a build. Never flattened together. */
  negative: boolean
}

/** One source, as Daily Pulse reports its health. */
export interface PulseSourceItem {
  id: string
  name: string
  enabled: boolean
  state: string
  lastSuccessAt: string | null
}

export interface PulseSnapshot {
  /** Distinct from connector health — ADR 0010 forbids merging these. */
  coverage: CoverageSummary
  connectorHealth: ConnectorHealthSummary
  /** The counts the page leads with. */
  headline: PulseHeadline
  /** Highest-confidence, most recent first. Bounded. */
  topOpportunities: PulseOpportunityItem[]
  /** Signals first observed inside `headline.newSignalWindowDays`. */
  newSignals: PulseSignalItem[]
  /** The most recently collected documents. */
  latestEvidence: PulseEvidenceItem[]
  /** Every enabled source and its current state. */
  sources: PulseSourceItem[]
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
  /** Signals recorded against this account, opportunity-bearing or not. */
  signalCount: number
  /** When a document about this account was last published or collected. */
  latestEvidenceAt: string | null
  /**
   * The account's strongest open opportunity, or null.
   *
   * Null is a real answer and the surface says so in words: an account can be
   * monitored, collected from, and correctly carry no qualifying project.
   */
  topOpportunity: RecordRef | null
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
  /**
   * When this document was first observed, and when it was last confirmed still
   * there. Distinct from `retrievedAt`, which is when the stored copy was taken.
   *
   * Null in the preview fixtures, which predate the collector that writes them.
   */
  firstSeenAt: string | null
  lastSeenAt: string | null
  /** The publisher's own identifier for the document — an SEC accession number. */
  sourceDocumentId: string | null
  /** Which connector version stored it. Provenance, not decoration. */
  collectedBy: string | null
  /** Whether a person has looked at it yet. */
  reviewStatus: string | null
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
  completedAt: string | null
  outcome: 'success' | 'partial_success' | 'failure'
  /** Documents the run discovered at the source. */
  itemsSeen: number
  /** Documents the run stored as evidence. */
  itemsStored: number
  note: string
}

/**
 * What a connector has actually produced, end to end.
 *
 * Four counts rather than one, because they answer four different questions and
 * the gaps between them are the interesting part: a connector can discover a
 * hundred documents, store all hundred, and produce no signal at all — which is
 * a working connector reporting that nothing qualified, not a broken one.
 */
export interface ConnectorActivity {
  documentsDiscovered: number
  evidenceStored: number
  signalsCreated: number
  opportunitiesCreated: number
}

/**
 * A run that has started and not recorded a completion.
 *
 * `stale` is true once it has been open longer than any run should take. An
 * ingestion that died mid-cycle leaves exactly this row behind, and a health
 * surface that does not show it reports the fleet as healthy while nothing is
 * collecting.
 */
export interface ActiveRun {
  id: string
  startedAt: string
  status: string
  stale: boolean
}

export interface ConnectorRecord {
  id: string
  name: string
  state: ConnectorState
  /** A disabled source is not a broken one. The two are never merged. */
  enabled: boolean
  activity: ConnectorActivity
  activeRun: ActiveRun | null
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

/* -------------------------------------------- Spyglass media intelligence */

/**
 * AN EMBEDDED ZIGNAL WIDGET IS A SNAPSHOT. IT IS NOT LIVE.
 *
 * Zignal's own documentation is unambiguous: embeddable widgets support neither
 * realtime nor data refresh, and "the data that it will show once embedded will
 * be the data available at the time you generated the embed snippet. As days go
 * by the data remains the same."
 *
 * So `snapshotGeneratedAt` is REQUIRED, not optional — a widget that cannot say
 * when it was frozen cannot be rendered honestly, and a stale sentiment chart
 * presented as current coverage of a client's brand is the exact failure this
 * type is shaped to prevent. The word "live" belongs to `dashboardUrl` and to
 * nothing else on this surface.
 */
export interface SpyglassWidget {
  id: string
  title: string
  /** An allow-listed https Zignal embed URL. Never a stored HTML snippet. */
  embedUrl: string
  enabled: boolean
  displayOrder: number
  snapshotGeneratedAt: string
  theme: 'light' | 'dark' | 'auto'
  /** Where to send a reader when the frame will not load. Always present. */
  fallbackUrl: string
}

export interface SpyglassSettings {
  dashboardUrl: string
  dashboardLabel: string
  updatedAt: string
}

export interface SpyglassSnapshot {
  settings: SpyglassSettings
  widgets: SpyglassWidget[]
  /** True when this session may repoint the dashboard or edit a widget. */
  viewerIsAdministrator: boolean
  generatedAt: string
}

/* --------------------------------------------------------------- Map */

/**
 * WHAT A COORDINATE ON THE MAP ACTUALLY MEANS.
 *
 * This is the most important type in the map, and it exists because a pin is
 * the most confident thing an interface can draw. A dot on a map reads as "the
 * project is HERE" whatever the caption says, so the distinction between a site
 * a filing named and a head office forty miles away cannot live in a footnote.
 *
 *   confirmed_project_site     the source named this site for this project
 *   approximate_project_area   the source named a city, county or state only
 *   known_company_facility     a site we hold for the company, not tied to this
 *                              project
 *   corporate_headquarters     account context. NEVER a project location.
 *
 * A headquarters is never promoted, never inferred into a project site, and is
 * styled so it cannot be mistaken for one.
 */
export type MapLocationType =
  | 'confirmed_project_site'
  | 'approximate_project_area'
  | 'known_company_facility'
  | 'corporate_headquarters'

/** How precisely the underlying text pinned the place. */
export type LocationPrecision =
  | 'exact'
  | 'address'
  | 'locality'
  | 'county'
  | 'region'
  | 'unresolved'

/** The opportunity behind a marker, with its source attribution intact. */
export interface MapOpportunityRef {
  id: string
  title: string
  /** The project type in readable words — "Facility construction". */
  opportunityType: string
  stage: OpportunityStage
  confidenceLevel: ConfidenceLevel
  filingDate: string | null
  documentType: string | null
  publisher: string | null
  excerpt: string | null
  officialUrl: string | null
}

export interface MapMarker {
  id: string
  locationType: MapLocationType
  precision: LocationPrecision
  latitude: number
  longitude: number
  /**
   * Radius of the area the source actually described, in metres.
   *
   * Non-null whenever the precision is coarser than an address: a city-level
   * match is drawn as a circle over the city, not as a point at its centroid
   * pretending to be a street corner.
   */
  uncertaintyRadiusMetres: number | null
  label: string
  /** What the document said, verbatim, before geocoding. */
  extractedText: string | null
  normalizedAddress: string | null
  organizationId: string
  organizationName: string
  opportunity: MapOpportunityRef | null
  resolvedAt: string | null
}

/**
 * An opportunity with no defensible geography.
 *
 * It goes in a list beside the map rather than onto it. The alternative —
 * dropping it on the company's head office — is the single failure this whole
 * surface is built to avoid, and an opportunity that is invisible because it was
 * silently omitted is barely better.
 */
export interface UnlocatedOpportunity {
  id: string
  title: string
  organizationName: string
  /** Why it could not be placed, in words a reader can act on. */
  reason: string
}

export interface MapSnapshot {
  markers: MapMarker[]
  unlocated: UnlocatedOpportunity[]
  generatedAt: string
}

/*
 * SAVED PURSUITS AND WATCHES USED TO BE MODELLED HERE.
 *
 * `WatchItem`, `SavedViewRecord` and `SavedWorkspace` are gone with the surface
 * that rendered them. Nothing wrote them: `user_read_state` carries a SELECT
 * grant and a per-user read policy, and no policy or grant admits an insert. A
 * type for records that can never be created is an invitation to build a page
 * that is empty by construction, which is what `/views` was.
 */
