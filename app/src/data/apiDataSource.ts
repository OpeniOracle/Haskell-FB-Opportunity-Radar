/**
 * The live provider. Reads Supabase under the signed-in reviewer's session.
 *
 * THERE IS NO FALLBACK. Not on a network error, not on a missing configuration,
 * not on an empty result. Every one of those returns a state that says what
 * happened. A provider that quietly serves illustrative records when the
 * database is unreachable is a provider that shows a business-development team
 * invented projects on the day the connector broke — and shows them with the
 * same confidence as real ones.
 *
 * READS GO DIRECTLY TO POSTGREST, UNDER RLS. The publishable key identifies the
 * project and grants nothing; migration 0015's policies decide what this
 * session may see, and an allowlist removal takes effect on the next request.
 * Evidence BYTES are the exception: they go through `/api/evidence/:id`, which
 * validates the session against the session table rather than trusting the JWT
 * alone.
 *
 * FRESHNESS IS READ, NOT ASSUMED. `sources.last_success_at` is written only by
 * a run that actually retrieved something, so the "as of" this provider reports
 * is the last time the data could have changed — not the last time someone
 * opened the page.
 */
import type { DataSource } from '@/data/DataSource'
import type {
  ActiveRun,
  Company,
  CompanySummary,
  ConnectorRecord,
  ConnectorRun,
  ConnectorState,
  DataSourceMeta,
  EvidenceRecord,
  FacilityRecord,
  LocationPrecision,
  MapMarker,
  MapSnapshot,
  Opportunity,
  OpportunityDate,
  OpportunityRationale,
  OpportunitySource,
  PulseEvidenceItem,
  PulseSnapshot,
  RecordRef,
  SourceHealthSnapshot,
  SpyglassSnapshot,
  SpyglassWidget,
  SurfaceState,
  UnlocatedOpportunity,
} from '@/types/domain'
import { supabaseBrowser } from '@/lib/supabaseClient'
import { isApprovedDashboardUrl, isApprovedEmbedUrl } from '@/lib/spyglass'

/** Beyond this, "current" is a claim the data does not support. */
const STALE_AFTER_HOURS = 36

export const API_META: DataSourceMeta = {
  mode: 'api',
  illustrative: false,
  description: 'Live records collected from primary sources and stored in Supabase.',
}

/* ------------------------------------------------------------- plumbing */

type Fail = { reason: string; blockedBy: string }

/**
 * Reason codes, so a surface can distinguish the four ways a read fails.
 *
 * §7 asks for "authenticated request failed" and "user is no longer
 * authorized" to be separable, and they are not separable from a single
 * `unavailable` with prose in it.
 */
export const FAILURE = {
  notConfigured: {
    reason: 'This deployment is not pointed at a Radar database.',
    blockedBy: 'configuration',
  },
  unauthorized: {
    reason: 'Your access to the Radar has been withdrawn. Contact your administrator.',
    blockedBy: 'authorization',
  },
  /*
     A GRANT GAP IS NOT A WITHDRAWAL OF SOMEBODY'S ACCESS.

     `42501` is insufficient_privilege, and privileges here are granted to the
     `authenticated` ROLE -- identical for every signed-in user. It can never
     mean that one person's standing changed. Removal from the allowlist is
     enforced by `/api/session` and by row-level policies returning nothing; it
     never revokes a grant.

     So when migration 0021 added columns and did not grant them, every user saw
     "your access has been withdrawn" and went looking at their own account. The
     message now points where the fault actually is.
  */
  notPermitted: {
    reason:
      'The Radar is missing a database permission this view needs. Your access is unaffected; this is a deployment fault.',
    blockedBy: 'configuration',
  },
  requestFailed: {
    reason: 'The Radar could not be reached. Nothing below is current.',
    blockedBy: 'service',
  },
  neverCollected: {
    reason:
      'No source has completed a collection yet. There is nothing to show, and that is not an error.',
    blockedBy: 'first_collection_pending',
  },
} as const satisfies Record<string, Fail>

function unavailable<T>(fail: Fail, checkedAt: string): SurfaceState<T> {
  return { kind: 'unavailable', reason: fail.reason, blockedBy: fail.blockedBy, checkedAt }
}

/**
 * PostgREST reports an RLS refusal as an empty result or a 401/403, and the
 * difference matters: "you may not read this" is not "there is nothing here".
 */
function classifyError(error: { code?: string; message?: string } | null): Fail {
  if (!error) return FAILURE.requestFailed
  const code = error.code ?? ''
  const message = error.message ?? ''

  // A rejected or expired token. This IS about the caller.
  if (code === 'PGRST301' || /jwt/i.test(message)) return FAILURE.unauthorized

  /*
     `42501` used to fall into the same branch, and that is how a missing column
     grant was reported to a fully authorized user as "your access has been
     withdrawn". PostgreSQL words a COLUMN-level denial as "permission denied
     for table sources", so it is indistinguishable from a table denial by text
     -- and neither is a statement about this person.
  */
  if (code === '42501' || /permission denied/i.test(message)) return FAILURE.notPermitted

  return FAILURE.requestFailed
}

interface Freshness {
  readonly lastSuccessAt: string | null
  readonly everCollected: boolean
  readonly stale: boolean
  readonly degradedSources: string[]
  readonly unavailableSources: string[]
  readonly manualReviewSources: string[]
}

async function readFreshness(now: Date): Promise<Freshness | Fail> {
  const client = supabaseBrowser()
  if (!client) return FAILURE.notConfigured

  const { data, error } = await client
    .from('sources')
    .select('id, enabled, health_status, last_success_at')
    .eq('enabled', true)

  if (error) return classifyError(error)

  const rows = data ?? []
  const successes = rows
    .map((r) => r.last_success_at as string | null)
    .filter((v): v is string => Boolean(v))
    .sort()
  const lastSuccessAt = successes.length > 0 ? successes[successes.length - 1]! : null

  return {
    lastSuccessAt,
    everCollected: lastSuccessAt !== null,
    stale:
      lastSuccessAt !== null &&
      now.getTime() - Date.parse(lastSuccessAt) > STALE_AFTER_HOURS * 60 * 60 * 1000,
    degradedSources: rows.filter((r) => r.health_status === 'degraded').map((r) => r.id as string),
    unavailableSources: rows
      .filter((r) => r.health_status === 'source_unavailable' || r.health_status === 'action_required')
      .map((r) => r.id as string),
    manualReviewSources: rows
      .filter((r) => r.health_status === 'manual_review_required')
      .map((r) => r.id as string),
  }
}

function isFail(value: unknown): value is Fail {
  return typeof value === 'object' && value !== null && 'blockedBy' in value
}

/**
 * One place that decides which state a successful read should be presented in.
 *
 * Written once because the alternative is eight surfaces each inventing their
 * own idea of "stale", and a dashboard where two panels disagree about whether
 * the data is current.
 */
function present<T>(
  rows: T[],
  freshness: Freshness,
  checkedAt: string,
  emptyReason: string,
): SurfaceState<T[]> {
  if (!freshness.everCollected) return unavailable(FAILURE.neverCollected, checkedAt)
  if (rows.length === 0) return { kind: 'empty', reason: emptyReason, checkedAt }

  if (freshness.unavailableSources.length > 0) {
    return {
      kind: 'degraded',
      data: rows,
      notice: `${freshness.unavailableSources.join(', ')} did not complete its last collection. Records from other sources are current.`,
      affected: freshness.unavailableSources,
      checkedAt,
    }
  }
  if (freshness.stale) {
    return {
      kind: 'stale',
      data: rows,
      notice: `No source has completed a collection since ${freshness.lastSuccessAt}.`,
      asOf: freshness.lastSuccessAt!,
      checkedAt,
    }
  }
  return { kind: 'ready', data: rows, checkedAt }
}

/* --------------------------------------------------------------- mapping */

/**
 * How many records any one read will pull.
 *
 * The pilot corpus is small, and a browser reading a whole table is fine at
 * this size. The cap is here so it stays a bounded read when it is not.
 */
const READ_LIMIT = 1000

/** Signals first observed inside this window are reported as new. */
const NEW_SIGNAL_WINDOW_DAYS = 7

/** A run open longer than this has not finished; it has stopped. */
const RUN_CONSIDERED_STALE_AFTER_HOURS = 6

interface OrganizationRow {
  id: string
  canonical_name: string
  legal_name: string | null
  organization_role: string | null
  parent_organization_id: string | null
  sectors: string[] | null
  official_website: string | null
  scope_class: string | null
  scope_class_status: string | null
}

interface OpportunityRow {
  id: string
  organization_id: string | null
  title: string
  executive_summary: string | null
  stage: string | null
  status: string | null
  confidence: string | null
  why_it_matters: string | null
  capability_alignment: string[] | null
  forecast_horizon: string | null
  haskell_fit: number | null
  project_maturity: number | null
  potential_scope: number | null
  timing_momentum: number | null
  raw_score: number | null
  confidence_multiplier: number | null
  final_score: number | null
  last_material_change_at: string | null
}

interface SignalRow {
  id: string
  organization_id: string | null
  title: string | null
  summary: string | null
  signal_family: string | null
  event_type: string | null
  event_date: string | null
  first_observed_at: string | null
  last_observed_at: string | null
  confidence: string | null
  independent_source_count: number | null
  negative_signal: boolean | null
  model_metadata: Record<string, unknown> | null
}

interface EvidenceRow {
  id: string
  source_id: string | null
  title: string | null
  publisher: string | null
  canonical_url: string | null
  locator: string | null
  published_at: string | null
  retrieved_at: string | null
  evidence_excerpt: string | null
  evidence_locator: Record<string, unknown> | null
  access_mode: string | null
}

const ORGANIZATION_COLUMNS =
  'id, canonical_name, legal_name, organization_role, parent_organization_id, sectors, official_website, scope_class, scope_class_status'

const OPPORTUNITY_COLUMNS =
  'id, organization_id, title, executive_summary, stage, status, confidence, why_it_matters, capability_alignment, forecast_horizon, haskell_fit, project_maturity, potential_scope, timing_momentum, raw_score, confidence_multiplier, final_score, last_material_change_at'

const SIGNAL_COLUMNS =
  'id, organization_id, title, summary, signal_family, event_type, event_date, first_observed_at, last_observed_at, confidence, independent_source_count, negative_signal, model_metadata'

/*
   `body_text`, `archive_uri` and `raw_storage_uri` are ABSENT and must stay
   absent. Migration 0015 withholds them from the `authenticated` grant, so
   naming one here would not leak it -- it would fail the whole read with 42501
   and take every surface down with it, which is exactly what happened when 0021
   added columns nobody granted.
*/
const EVIDENCE_COLUMNS =
  'id, source_id, title, publisher, canonical_url, locator, published_at, retrieved_at, evidence_excerpt, evidence_locator, access_mode'

const STAGE_MAP: Record<string, Opportunity['stage']> = {
  emerging: 'emerging',
  developing: 'developing',
  confirmed: 'confirmed',
}

/**
 * The classifier's family key, in words.
 *
 * `facility_construction` is a database value. "Facility construction" is what a
 * person reads. The mapping is explicit rather than a `replace(/_/g, ' ')`
 * because an unrecognised key should read as itself rather than as a prettified
 * guess at a vocabulary this table does not define.
 */
const FAMILY_LABEL: Record<string, string> = {
  facility_construction: 'Facility construction',
  facility_expansion: 'Facility expansion',
  facility_modernization: 'Facility modernization',
  capacity_change: 'Capacity change',
  distribution_logistics: 'Distribution and logistics',
  site_acquisition: 'Site acquisition',
  utility_infrastructure: 'Utility infrastructure',
  closure_consolidation: 'Closure or consolidation',
}

function familyLabel(family: string | null | undefined): string | null {
  if (!family) return null
  return FAMILY_LABEL[family] ?? family.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
}

/**
 * Corroborating facts, labelled for a reader rather than for a developer.
 *
 * The classifier records `investment_amount`; a client reads "Investment".
 * These are the same fact — only the label changes, and the VALUE is always the
 * string the document contained.
 */
const CORROBORATION_LABEL: Record<string, string> = {
  investment_amount: 'Investment',
  floor_area: 'Floor area',
  job_count: 'Jobs',
  capacity: 'Capacity',
  named_place: 'Location named',
  timeline: 'Timeline',
}

interface ClassifierMetadata {
  matchedAction: string | null
  matchedAsset: string | null
  corroboration: { label: string; value: string; kind: string }[]
  classifierFamily: string | null
}

function readClassifierMetadata(raw: Record<string, unknown> | null): ClassifierMetadata {
  const meta = raw ?? {}
  const rawCorroboration = Array.isArray(meta.corroboration) ? meta.corroboration : []
  return {
    matchedAction: typeof meta.matchedAction === 'string' ? meta.matchedAction : null,
    matchedAsset: typeof meta.matchedAsset === 'string' ? meta.matchedAsset : null,
    classifierFamily: typeof meta.classifierFamily === 'string' ? meta.classifierFamily : null,
    corroboration: rawCorroboration
      .filter(
        (entry): entry is { kind: string; value: string } =>
          typeof entry === 'object' &&
          entry !== null &&
          typeof (entry as { kind?: unknown }).kind === 'string' &&
          typeof (entry as { value?: unknown }).value === 'string',
      )
      .map((entry) => ({
        kind: entry.kind,
        label: CORROBORATION_LABEL[entry.kind] ?? entry.kind.replace(/_/g, ' '),
        value: entry.value.trim(),
      })),
  }
}

/**
 * THE SENTENCE A CLIENT READS, BUILT FROM STRUCTURED FACTS.
 *
 * `opportunities.why_it_matters` holds the classifier's own derivation: which
 * regular expression matched, how wide the window was, and the grade it gave
 * itself. Every word of it is true and none of it belongs on a screen in front
 * of a business-development team — "within 420 characters" describes our
 * implementation, and "read by a machine" invites a client to discount the
 * finding before reading it.
 *
 * Requirement 11 of this pass forbids touching ingestion or rewriting stored
 * records, and it should: the derivation is the audit trail. So the raw text
 * stays in the database, unread by this interface, and the sentence is composed
 * HERE from the structured fields the same classifier recorded beside it.
 *
 * Nothing is added. Every term in the output appeared in the source document.
 */
function composeRationale(
  meta: ClassifierMetadata,
  family: string | null,
  organizationName: string,
): OpportunityRationale | null {
  if (!meta.matchedAction && !meta.matchedAsset && meta.corroboration.length === 0) return null

  const activity = familyLabel(family)?.toLowerCase() ?? 'project activity'
  const asset = meta.matchedAsset ? `“${meta.matchedAsset}”` : 'a physical site'

  const parts: string[] = [
    `The filing describes ${activity} at ${organizationName}, referring to ${asset}`,
  ]
  if (meta.corroboration.length > 0) {
    parts.push(
      `and states ${meta.corroboration
        .map((c) => `${c.label.toLowerCase()} (${c.value})`)
        .join(', ')}`,
    )
  }

  return {
    summary: `${parts.join(' ')}.`,
    matchedActivity: meta.matchedAction,
    matchedAsset: meta.matchedAsset,
    corroboration: meta.corroboration.map(({ label, value }) => ({ label, value })),
  }
}

/**
 * What tells two lookalike records apart, using only what the source said.
 *
 * Derived titles are "<family> — <matched asset>", so two projects at one
 * company render as the same line of text twice. The amount, the named place
 * and the filing date are real attributes of the documents and they are what a
 * reader would use to tell them apart, so they are what the card carries.
 */
function composeDistinguisher(
  meta: ClassifierMetadata,
  sourceDate: OpportunityDate | null,
  documentType: string | null,
): string | null {
  const parts: string[] = []
  const amount = meta.corroboration.find((c) => c.kind === 'investment_amount')
  const place = meta.corroboration.find((c) => c.kind === 'named_place')
  const capacity = meta.corroboration.find((c) => c.kind === 'capacity')

  if (amount) parts.push(amount.value)
  if (place) parts.push(place.value.replace(/^in\s+/i, ''))
  else if (capacity) parts.push(capacity.value)
  if (sourceDate) {
    parts.push(
      `${documentType ? `${documentType} ` : ''}filed ${sourceDate.iso.slice(0, 10)}`,
    )
  }

  return parts.length > 0 ? parts.join(' · ') : null
}

const ACCESS_MODES = new Set([
  'structured_primary',
  'archived_full_text',
  'licensed_full_text',
  'reference_only',
  'metadata_only',
])

function accessMode(value: string | null): OpportunitySource['accessMode'] {
  return (ACCESS_MODES.has(value ?? '') ? value : 'metadata_only') as OpportunitySource['accessMode']
}

/** The form as filed, from recorded locator metadata. Never parsed from a title. */
function documentTypeOf(row: EvidenceRow): string | null {
  const locator = row.evidence_locator ?? {}
  const value = locator.documentType
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/** The publisher's own address for the document, preferred over anything of ours. */
function officialUrlOf(row: EvidenceRow): string | null {
  return row.locator ?? row.canonical_url ?? null
}

function toOpportunitySource(row: EvidenceRow): OpportunitySource {
  return {
    evidenceId: row.id,
    title: row.title ?? 'Untitled document',
    publisher: row.publisher ?? 'Unnamed publisher',
    documentType: documentTypeOf(row),
    filingDate: row.published_at ?? null,
    officialUrl: officialUrlOf(row),
    excerpt: row.evidence_excerpt ?? null,
    accessMode: accessMode(row.access_mode),
  }
}

/**
 * THE DATE THE RECORD IS ANCHORED TO, AND WHAT THAT DATE IS.
 *
 * The card showed "No date given" while the filing date sat in the evidence row
 * two joins away. It did so because the only date it looked at was `horizon` —
 * the forecast window — and a derived opportunity has none, correctly: a filing
 * says a project exists, not when it completes.
 *
 * Both halves of the fix matter. The filing date is shown, so the record is
 * dated. And it is labelled a FILING date, so it is never read as a schedule.
 * Promoting one into the other would have been the easier fix and a false one.
 */
function resolveSourceDate(
  signalEventDate: string | null,
  filingDate: string | null,
): OpportunityDate | null {
  if (signalEventDate) return { iso: signalEventDate, basis: 'stated_event_date' }
  if (filingDate) return { iso: filingDate, basis: 'filing_date' }
  return null
}

const CONFIDENCE_LEVEL: Record<string, Opportunity['confidence']['confidenceLevel']> = {
  confirmed: 'high',
  probable: 'moderate',
  possible: 'low',
}

const EVIDENCE_STRENGTH: Record<string, Opportunity['confidence']['evidenceStrength']> = {
  confirmed: 'authoritative',
  probable: 'corroborated',
  possible: 'indicative',
}

/** Strongest access mode present, in the order the vocabulary ranks them. */
const ACCESS_RANK: OpportunitySource['accessMode'][] = [
  'metadata_only',
  'reference_only',
  'licensed_full_text',
  'archived_full_text',
  'structured_primary',
]

function strongestAccessMode(
  sources: OpportunitySource[],
): Opportunity['evidence']['strongestAccessMode'] {
  let best = 0
  for (const source of sources) {
    const rank = ACCESS_RANK.indexOf(source.accessMode)
    if (rank > best) best = rank
  }
  return ACCESS_RANK[best]!
}

/* ------------------------------------------------------------ the graph */

type Client = NonNullable<ReturnType<typeof supabaseBrowser>>

/**
 * Everything the derived record graph holds, read in six queries.
 *
 * The previous version issued one query PER OPPORTUNITY to find its signals and
 * then discarded most of what came back. Six reads of the whole (small) graph
 * is both faster and, more usefully, the same data every surface needs — so
 * Pulse, Opportunities, Company and the Map cannot disagree about how many
 * signals an account has.
 */
interface SourceRow {
  id: string
  name: string | null
  enabled: boolean | null
  health_status: string | null
  last_success_at: string | null
  expected_cadence_hours: number | null
  consecutive_failures: number | null
}

interface ExpectationRow {
  organization_id: string
  source_family: string
  expectation: string
  rationale: string
}

interface Graph {
  organizations: OrganizationRow[]
  sources: SourceRow[]
  expectations: ExpectationRow[]
  opportunities: OpportunityRow[]
  signals: SignalRow[]
  evidence: EvidenceRow[]
  /** opportunity id -> signal ids */
  signalsByOpportunity: Map<string, string[]>
  /** signal id -> evidence ids */
  evidenceBySignal: Map<string, string[]>
  /** signal id -> the source ids it was observed through */
  sourceBySignal: Map<string, Set<string>>
  organizationById: Map<string, OrganizationRow>
  signalById: Map<string, SignalRow>
  evidenceById: Map<string, EvidenceRow>
}

async function readGraph(client: Client): Promise<Graph | Fail> {
  const [orgs, opps, signals, evidence, oppSignals, signalEvidence, sources, expectations] =
    await Promise.all([
    client.from('organizations').select(ORGANIZATION_COLUMNS).order('canonical_name').limit(READ_LIMIT),
    client.from('opportunities').select(OPPORTUNITY_COLUMNS).limit(READ_LIMIT),
    client.from('signals').select(SIGNAL_COLUMNS).limit(READ_LIMIT),
    client.from('evidence').select(EVIDENCE_COLUMNS).limit(READ_LIMIT),
    client.from('opportunity_signals').select('opportunity_id, signal_id').limit(READ_LIMIT),
    client.from('signal_evidence').select('signal_id, evidence_id, source_family_key').limit(READ_LIMIT),
    client
      .from('sources')
      .select('id, name, enabled, health_status, last_success_at, expected_cadence_hours, consecutive_failures')
      .limit(READ_LIMIT),
    client
      .from('account_source_expectations')
      .select('organization_id, source_family, expectation, rationale')
      .limit(READ_LIMIT),
  ])

  for (const result of [orgs, opps, signals, evidence, oppSignals, signalEvidence, sources, expectations]) {
    if (result.error) return classifyError(result.error)
  }

  const organizations = (orgs.data ?? []) as unknown as OrganizationRow[]
  const opportunities = (opps.data ?? []) as unknown as OpportunityRow[]
  const signalRows = (signals.data ?? []) as unknown as SignalRow[]
  const evidenceRows = (evidence.data ?? []) as unknown as EvidenceRow[]

  const signalsByOpportunity = new Map<string, string[]>()
  for (const link of oppSignals.data ?? []) {
    const key = link.opportunity_id as string
    const list = signalsByOpportunity.get(key) ?? []
    list.push(link.signal_id as string)
    signalsByOpportunity.set(key, list)
  }

  const evidenceBySignal = new Map<string, string[]>()
  for (const link of signalEvidence.data ?? []) {
    const key = link.signal_id as string
    const list = evidenceBySignal.get(key) ?? []
    list.push(link.evidence_id as string)
    evidenceBySignal.set(key, list)
  }

  /* Which source each signal was first seen through. `source_family_key` is the
     source id the pipeline wrote, so this is a recorded link rather than an
     inference from a document title. */
  const sourceBySignal = new Map<string, Set<string>>()
  for (const link of signalEvidence.data ?? []) {
    const key = link.signal_id as string
    const set = sourceBySignal.get(key) ?? new Set<string>()
    set.add(link.source_family_key as string)
    sourceBySignal.set(key, set)
  }

  return {
    organizations,
    sources: (sources.data ?? []) as unknown as SourceRow[],
    expectations: (expectations.data ?? []) as unknown as ExpectationRow[],
    sourceBySignal,
    opportunities,
    signals: signalRows,
    evidence: evidenceRows,
    signalsByOpportunity,
    evidenceBySignal,
    organizationById: new Map(organizations.map((o) => [o.id, o])),
    signalById: new Map(signalRows.map((s) => [s.id, s])),
    evidenceById: new Map(evidenceRows.map((e) => [e.id, e])),
  }
}

/** Documents behind one opportunity, newest filing first. */
function sourcesFor(graph: Graph, opportunityId: string): OpportunitySource[] {
  const evidenceIds = new Set<string>()
  for (const signalId of graph.signalsByOpportunity.get(opportunityId) ?? []) {
    for (const id of graph.evidenceBySignal.get(signalId) ?? []) evidenceIds.add(id)
  }
  return [...evidenceIds]
    .map((id) => graph.evidenceById.get(id))
    .filter((row): row is EvidenceRow => Boolean(row))
    .map(toOpportunitySource)
    .sort((a, b) => (b.filingDate ?? '').localeCompare(a.filingDate ?? ''))
}

/** The signal an opportunity was derived from, when there is one. */
function primarySignalFor(graph: Graph, opportunityId: string): SignalRow | null {
  const ids = graph.signalsByOpportunity.get(opportunityId) ?? []
  const rows = ids
    .map((id) => graph.signalById.get(id))
    .filter((row): row is SignalRow => Boolean(row))
  if (rows.length === 0) return null
  return rows.sort((a, b) => (a.first_observed_at ?? '').localeCompare(b.first_observed_at ?? ''))[0]!
}

function mapOpportunity(graph: Graph, row: OpportunityRow): Opportunity {
  const org = row.organization_id ? graph.organizationById.get(row.organization_id) : undefined
  const organizationName = org?.canonical_name ?? 'Unknown organization'
  const signal = primarySignalFor(graph, row.id)
  const meta = readClassifierMetadata(signal?.model_metadata ?? null)
  const sources = sourcesFor(graph, row.id)
  const newest = sources[0] ?? null
  const grade = row.confidence ?? 'possible'

  const sourceDate = resolveSourceDate(signal?.event_date ?? null, newest?.filingDate ?? null)
  const rationale = composeRationale(
    meta,
    meta.classifierFamily ?? signal?.signal_family ?? null,
    organizationName,
  )

  const publishers = new Set(sources.map((s) => s.publisher))

  return {
    id: row.id,
    title: row.title,
    organization: {
      id: org?.id ?? '',
      canonicalName: organizationName,
      operatorName: org?.legal_name ?? null,
      scopeClass: (org?.scope_class ?? 'unknown') as Opportunity['organization']['scopeClass'],
      scopeClassStatus: (org?.scope_class_status ??
        'provisional') as Opportunity['organization']['scopeClassStatus'],
    },
    facility: null,
    stage: STAGE_MAP[row.stage ?? ''] ?? 'emerging',
    status: (row.status ?? 'new') as Opportunity['status'],
    confidence: {
      evidenceStrength: EVIDENCE_STRENGTH[grade] ?? 'indicative',
      assessmentType: 'observed_fact',
      confidenceLevel: CONFIDENCE_LEVEL[grade] ?? 'low',
    },
    /*
       NO HORIZON IS CLAIMED, AND THE FILING DATE IS NOT ONE.

       A collected filing rarely states a completion window. `sourceDate` below
       carries the date the record genuinely has, labelled as what it is; this
       stays empty because a forecast nobody made is not ours to supply.
    */
    horizon: {
      rawExpression: row.forecast_horizon ?? null,
      start: null,
      end: null,
      precision: 'unknown',
      basis: 'unknown',
      inferenceNote: null,
    },
    sourceDate,
    /*
       The composed sentence, NOT `row.why_it_matters`.

       That column holds the classifier's derivation and stays in the database
       as the audit trail. What a client reads is built from the structured
       fields recorded beside it -- see `composeRationale`.
    */
    whyItMatters: rationale?.summary ?? row.executive_summary ?? '',
    rationale,
    distinguisher: composeDistinguisher(meta, sourceDate, newest?.documentType ?? null),
    capabilities: row.capability_alignment ?? [],
    scores: {
      haskellFit: row.haskell_fit,
      projectMaturity: row.project_maturity,
      potentialScope: row.potential_scope,
      timingMomentum: row.timing_momentum,
      /* D14-L. Withheld at the grant, so it is never read and never rendered. */
      accountStrategy: null,
      rawScore: row.raw_score,
      confidenceMultiplier: row.confidence_multiplier,
      finalScore: row.final_score,
    },
    evidence: {
      count: sources.length,
      independentPublishers: publishers.size,
      newestRetrievedAt: newest?.filingDate ?? row.last_material_change_at ?? '',
      strongestAccessMode: strongestAccessMode(sources),
    },
    sources,
    lastMaterialChangeAt: row.last_material_change_at ?? '',
  }
}

/* ------------------------------------------------------- derived summaries */

function isoDaysAgo(now: Date, days: number): string {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString()
}

/** Publication date where the source gave one, retrieval date otherwise. */
function evidenceRecordedAt(row: EvidenceRow): { at: string; basis: 'published' | 'retrieved' } {
  if (row.published_at) return { at: row.published_at, basis: 'published' }
  return { at: row.retrieved_at ?? '', basis: 'retrieved' }
}

function toPulseEvidence(row: EvidenceRow): PulseEvidenceItem {
  const recorded = evidenceRecordedAt(row)
  return {
    id: row.id,
    title: row.title ?? 'Untitled document',
    publisher: row.publisher ?? 'Unnamed publisher',
    documentType: documentTypeOf(row),
    recordedAt: recorded.at,
    recordedAtBasis: recorded.basis,
    officialUrl: officialUrlOf(row),
  }
}

/**
 * Highest confidence first, then most recent.
 *
 * Not by score: nothing here is scored, and sorting unscored records by a null
 * would put them in an arbitrary order while looking deliberate. Confidence is
 * a grade the classifier genuinely assigned, so it is what "top" means until an
 * analyst has ranked anything.
 */
const CONFIDENCE_ORDER: Record<string, number> = { high: 0, moderate: 1, low: 2 }

function byConfidenceThenRecency(a: Opportunity, b: Opportunity): number {
  const d =
    (CONFIDENCE_ORDER[a.confidence.confidenceLevel] ?? 3) -
    (CONFIDENCE_ORDER[b.confidence.confidenceLevel] ?? 3)
  if (d !== 0) return d
  return (b.sourceDate?.iso ?? b.lastMaterialChangeAt).localeCompare(
    a.sourceDate?.iso ?? a.lastMaterialChangeAt,
  )
}

/** Evidence reachable from an account, through the signals recorded against it. */
function evidenceIdsForOrganization(graph: Graph, organizationId: string): Set<string> {
  const ids = new Set<string>()
  for (const signal of graph.signals) {
    if (signal.organization_id !== organizationId) continue
    for (const id of graph.evidenceBySignal.get(signal.id) ?? []) ids.add(id)
  }
  return ids
}

/**
 * One account's figures.
 *
 * `latestEvidenceAt` counts only evidence linked to this account THROUGH A
 * SIGNAL, because that is the only association the database records. A filing
 * whose title happens to contain the company's name is not a recorded link, and
 * matching on it would be an inference dressed as a count.
 */
/**
 * What is expected of an account, and what actually reported.
 *
 * `account_source_expectations` is the denominator and it is seeded as a data
 * operation, so it can legitimately be EMPTY. An empty denominator does not
 * mean full coverage — it means nobody has said what coverage should be — and
 * the surface distinguishes the two rather than rendering "fully covered" over
 * a table with no rows in it. `gapReason` carries that distinction in words.
 */
function coverageFor(graph: Graph, organizationId: string): CompanySummary['coverage'] {
  const sourceName = (id: string) => graph.sources.find((s) => s.id === id)?.name ?? id

  const observedIds = new Set<string>()
  for (const signal of graph.signals) {
    if (signal.organization_id !== organizationId) continue
    for (const id of graph.sourceBySignal.get(signal.id) ?? []) observedIds.add(id)
  }
  const observedSources = [...observedIds].map(sourceName).sort()

  const expected = graph.expectations.filter(
    (e) =>
      e.organization_id === organizationId &&
      (e.expectation === 'required' || e.expectation === 'expected'),
  )
  const expectedSources = expected.map((e) => e.source_family).sort()
  const missingSources = expectedSources.filter((name) => !observedSources.includes(name))

  return {
    expectedSources,
    observedSources,
    missingSources,
    lastCheckedAt:
      graph.sources
        .map((s) => s.last_success_at ?? '')
        .filter(Boolean)
        .sort()
        .pop() ?? '',
    gapReason:
      expectedSources.length === 0
        ? 'No coverage expectation has been recorded for this account, so completeness cannot be measured yet.'
        : missingSources.length > 0
          ? `${missingSources.join(', ')} has not produced a signal for this account.`
          : null,
  }
}

function summariseCompany(graph: Graph, org: OrganizationRow): CompanySummary {
  const opportunities = graph.opportunities.filter((o) => o.organization_id === org.id)
  const signals = graph.signals.filter((s) => s.organization_id === org.id)
  const evidenceIds = evidenceIdsForOrganization(graph, org.id)

  const dates = [...evidenceIds]
    .map((id) => graph.evidenceById.get(id))
    .filter((row): row is EvidenceRow => Boolean(row))
    .map((row) => evidenceRecordedAt(row).at)
    .filter(Boolean)
    .sort()

  const mapped = opportunities.map((row) => mapOpportunity(graph, row))
  const top = [...mapped].sort(byConfidenceThenRecency)[0] ?? null
  const parent = org.parent_organization_id
    ? (graph.organizationById.get(org.parent_organization_id)?.canonical_name ?? null)
    : null

  const latestEvidenceAt = dates.length > 0 ? dates[dates.length - 1]! : null
  const latestOpportunityAt = mapped
    .map((o) => o.lastMaterialChangeAt)
    .filter(Boolean)
    .sort()
    .pop()

  const topOpportunity: RecordRef | null = top
    ? {
        id: top.id,
        label: top.title,
        detail: top.distinguisher ?? `${top.confidence.confidenceLevel} confidence`,
      }
    : null

  return {
    id: org.id,
    canonicalName: org.canonical_name,
    parentName: parent,
    role: org.organization_role ?? 'Monitored account',
    sectors: org.sectors ?? [],
    scopeClass: (org.scope_class ?? 'unknown') as CompanySummary['scopeClass'],
    scopeClassStatus: (org.scope_class_status ??
      'provisional') as CompanySummary['scopeClassStatus'],
    /*
       ZERO, NOT A GUESS. Nothing has resolved a facility for these accounts
       yet, and the account row says so rather than borrowing a number from
       somewhere adjacent.
    */
    facilityCount: 0,
    openOpportunityCount: opportunities.length,
    signalCount: signals.length,
    latestEvidenceAt,
    topOpportunity,
    latestActivityAt: latestOpportunityAt ?? latestEvidenceAt ?? '',
    coverage: coverageFor(graph, org.id),
    targetTier: {
      available: false,
      reason: 'Target tier is not available.',
      blockedBy: 'D14-L event-data licence review',
    },
    engagement: {
      available: false,
      reason: 'Engagement history is not available.',
      blockedBy: 'D14-L event-data licence review',
    },
  }
}

/* ------------------------------------------------------------ map reads */

interface OrganizationLocationRow {
  id: string
  organization_id: string
  location_type: string
  label: string
  normalized_address: string | null
  latitude: number | null
  longitude: number | null
  precision: string | null
  resolved_at: string | null
}

interface OpportunityLocationRow {
  id: string
  opportunity_id: string
  evidence_id: string | null
  location_type: string
  extracted_text: string
  facility_name: string | null
  normalized_address: string | null
  latitude: number | null
  longitude: number | null
  precision: string | null
  uncertainty_radius_m: number | null
  resolved_at: string | null
}

/**
 * How wide a circle each precision honestly covers.
 *
 * A city-level match is not a point. Drawing it as one at the city centroid
 * would place a project on a specific street corner the filing never mentioned,
 * which is the same fabrication as using a head office — just less obvious.
 */
const UNCERTAINTY_METRES: Record<string, number | null> = {
  exact: null,
  address: null,
  locality: 8000,
  county: 25000,
  region: 150000,
  unresolved: null,
}

function locationPrecision(value: string | null): LocationPrecision {
  const allowed: LocationPrecision[] = ['exact', 'address', 'locality', 'county', 'region', 'unresolved']
  return allowed.includes(value as LocationPrecision) ? (value as LocationPrecision) : 'unresolved'
}

function isPlaced(row: { latitude: number | null; longitude: number | null }): boolean {
  return typeof row.latitude === 'number' && typeof row.longitude === 'number'
}

/* ---------------------------------------------------------------- source */

export function createApiDataSource(clock: () => Date = () => new Date()): DataSource {
  const stamp = () => clock().toISOString()

  async function guard<T>(
    run: (client: Client, freshness: Freshness) => Promise<SurfaceState<T>>,
  ): Promise<SurfaceState<T>> {
    const checkedAt = stamp()
    const client = supabaseBrowser()
    if (!client) return unavailable(FAILURE.notConfigured, checkedAt)
    const freshness = await readFreshness(clock())
    if (isFail(freshness)) return unavailable(freshness, checkedAt)
    try {
      return await run(client, freshness)
    } catch {
      // A thrown fetch is a failed request, never an empty dataset.
      return unavailable(FAILURE.requestFailed, checkedAt)
    }
  }

  return {
    meta: API_META,

    getPulse: () =>
      guard<PulseSnapshot>(async (client, freshness) => {
        const checkedAt = stamp()
        const now = clock()
        const graph = await readGraph(client)
        if (isFail(graph)) return unavailable(graph, checkedAt)
        if (!freshness.everCollected) return unavailable(FAILURE.neverCollected, checkedAt)

        const { data: changes } = await client
          .from('change_events')
          .select('id, change_kind, summary, occurred_at')
          .order('occurred_at', { ascending: false })
          .limit(25)

        const enabled = graph.sources.filter((s) => s.enabled)
        const since = isoDaysAgo(now, NEW_SIGNAL_WINDOW_DAYS)
        const opportunities = graph.opportunities.map((row) => mapOpportunity(graph, row))
        const newSignals = graph.signals.filter((s) => (s.first_observed_at ?? '') >= since)

        const evidenceByRecency = [...graph.evidence].sort((a, b) =>
          evidenceRecordedAt(b).at.localeCompare(evidenceRecordedAt(a).at),
        )
        const latestEvidenceAt =
          evidenceByRecency.length > 0 ? evidenceRecordedAt(evidenceByRecency[0]!).at : null

        const covered = graph.organizations.filter((org) => {
          const coverage = coverageFor(graph, org.id)
          return coverage.expectedSources.length > 0 && coverage.missingSources.length === 0
        })
        const below = graph.organizations.filter((org) => {
          const coverage = coverageFor(graph, org.id)
          return coverage.missingSources.length > 0
        })

        const snapshot: PulseSnapshot = {
          coverage: {
            accountsMonitored: graph.organizations.length,
            accountsAtOrAboveExpected: covered.length,
            accountsBelowExpected: below.length,
            accountsUncovered: below.map((o) => o.canonical_name),
          },
          connectorHealth: {
            sourcesEnabled: enabled.length,
            healthy: enabled.filter((s) => s.health_status === 'healthy').length,
            degraded: enabled.filter((s) => s.health_status === 'degraded').length,
            actionRequired: enabled.filter(
              (s) =>
                s.health_status === 'action_required' ||
                s.health_status === 'manual_review_required' ||
                s.health_status === 'source_unavailable',
            ).length,
            lastCycleCompletedAt: freshness.lastSuccessAt ?? '',
          },
          headline: {
            opportunityCount: graph.opportunities.length,
            signalCount: graph.signals.length,
            newSignalCount: newSignals.length,
            newSignalWindowDays: NEW_SIGNAL_WINDOW_DAYS,
            evidenceCount: graph.evidence.length,
            latestEvidenceAt,
          },
          topOpportunities: [...opportunities]
            .sort(byConfidenceThenRecency)
            .slice(0, 5)
            .map((o) => ({
              id: o.id,
              title: o.title,
              organizationName: o.organization.canonicalName,
              stage: o.stage,
              confidenceLevel: o.confidence.confidenceLevel,
              sourceDate: o.sourceDate,
              evidenceCount: o.evidence.count,
              distinguisher: o.distinguisher,
            })),
          newSignals: newSignals
            .sort((a, b) => (b.first_observed_at ?? '').localeCompare(a.first_observed_at ?? ''))
            .slice(0, 8)
            .map((s) => ({
              id: s.id,
              title: s.title ?? 'Untitled signal',
              organizationName:
                (s.organization_id && graph.organizationById.get(s.organization_id)?.canonical_name) ||
                'Unknown organization',
              observedAt: s.first_observed_at ?? '',
              eventDate: s.event_date,
              negative: Boolean(s.negative_signal),
            })),
          latestEvidence: evidenceByRecency.slice(0, 8).map(toPulseEvidence),
          sources: enabled.map((s) => ({
            id: s.id,
            name: s.name ?? s.id,
            enabled: Boolean(s.enabled),
            state: s.health_status ?? 'unknown',
            lastSuccessAt: s.last_success_at,
          })),
          changesSinceLastVisit: (changes ?? []).map((c) => ({
            id: c.id as string,
            kind: 'evidence_added',
            tone: 'neutral',
            channel: 'market',
            title: (c.summary as string) ?? '',
            detail: (c.summary as string) ?? '',
            occurredAt: (c.occurred_at as string) ?? '',
            subjectLabel: (c.change_kind as string) ?? '',
            needsAttention: false,
            actionHint: null,
            opportunityId: null,
          })) as PulseSnapshot['changesSinceLastVisit'],
          lastVisitAt: null,
          generatedAt: checkedAt,
        }

        if (freshness.stale) {
          return {
            kind: 'stale',
            data: snapshot,
            notice: `No source has completed a collection since ${freshness.lastSuccessAt}.`,
            asOf: freshness.lastSuccessAt!,
            checkedAt,
          }
        }
        return { kind: 'ready', data: snapshot, checkedAt }
      }),

    getOpportunities: () =>
      guard<Opportunity[]>(async (client, freshness) => {
        const checkedAt = stamp()
        const graph = await readGraph(client)
        if (isFail(graph)) return unavailable(graph, checkedAt)

        const mapped = graph.opportunities
          .map((row) => mapOpportunity(graph, row))
          .sort(byConfidenceThenRecency)

        return present(
          mapped,
          freshness,
          checkedAt,
          'No qualifying opportunity has been found in the collected sources yet. Every document retrieved so far was evaluated and none carried a supported facility signal.',
        )
      }),

    getCompanies: () =>
      guard<CompanySummary[]>(async (client, freshness) => {
        const checkedAt = stamp()
        const graph = await readGraph(client)
        if (isFail(graph)) return unavailable(graph, checkedAt)

        const rows = graph.organizations.map((org) => summariseCompany(graph, org))
        return present(rows, freshness, checkedAt, 'No company is being monitored yet.')
      }),

    getCompany: (companyId: string) =>
      guard<Company>(async (client) => {
        const checkedAt = stamp()
        const graph = await readGraph(client)
        if (isFail(graph)) return unavailable(graph, checkedAt)

        const org = graph.organizationById.get(companyId)
        if (!org) {
          return {
            kind: 'unavailable',
            reason: 'No such company is being monitored.',
            blockedBy: 'not_found',
            checkedAt,
          }
        }

        const summary = summariseCompany(graph, org)
        const opportunities = graph.opportunities
          .filter((o) => o.organization_id === org.id)
          .map((row) => mapOpportunity(graph, row))
          .sort(byConfidenceThenRecency)

        const timeline = opportunities
          .filter((o) => o.sourceDate)
          .map((o) => ({
            id: `timeline-${o.id}`,
            scope: 'organization' as const,
            kind: 'opportunity' as const,
            title: o.title,
            detail: o.distinguisher ?? o.whyItMatters,
            occurredOn: {
              rawExpression: o.sourceDate!.iso.slice(0, 10),
              start: o.sourceDate!.iso.slice(0, 10),
              end: o.sourceDate!.iso.slice(0, 10),
              precision: 'exact_day' as const,
              basis: 'stated' as const,
              inferenceNote: null,
            },
            evidenceId: o.sources[0]?.evidenceId ?? null,
            facilityId: null,
          }))
          .sort((a, b) => (b.occurredOn.start ?? '').localeCompare(a.occurredOn.start ?? ''))

        return {
          kind: 'ready',
          data: {
            ...summary,
            aliases: [],
            relationships: [],
            facilities: [],
            openOpportunities: opportunities.map((o) => ({
              id: o.id,
              label: o.title,
              detail: o.distinguisher ?? `${o.confidence.confidenceLevel} confidence`,
            })),
            timeline,
            accountStrategyScore: {
              available: false,
              reason: 'The account-strategy score is not available.',
              blockedBy: 'D14-L event-data licence review',
            },
          },
          checkedAt,
        }
      }),

    getFacility: (facilityId: string) =>
      guard<FacilityRecord>(async (client) => {
        const checkedAt = stamp()
        const { data, error } = await client.from('facilities').select('*').eq('id', facilityId).maybeSingle()
        if (error) return unavailable(classifyError(error), checkedAt)
        if (!data) {
          return { kind: 'unavailable', reason: 'No such facility is on record.', blockedBy: 'not_found', checkedAt }
        }
        return {
          kind: 'ready',
          data: {
            id: data.id as string,
            name: (data.name as string) ?? 'Unnamed site',
            organizationId: (data.organization_id as string) ?? '',
            organizationName: '',
            addressLine: (data.address_line as string) ?? null,
            locality: (data.locality as string) ?? null,
            region: (data.region as string) ?? null,
            facilityType: (data.facility_type as string) ?? 'unknown',
            operatingStatus: ((data.operating_status as string) ??
              'unknown') as FacilityRecord['operatingStatus'],
            resolution: ((data.resolution as string) ?? 'candidate') as FacilityRecord['resolution'],
            candidateReason: (data.candidate_reason as string) ?? null,
            identifiers: [],
            evidence: [],
            opportunities: [],
            timeline: [],
          },
          checkedAt,
        }
      }),

    getEvidence: (evidenceId: string) =>
      guard<EvidenceRecord>(async (client) => {
        const checkedAt = stamp()
        /*
           THE PROVENANCE COLUMNS 0021 ADDED, READ HERE AND NOWHERE ELSE.

           `first_seen_at`, `last_seen_at`, `source_document_id`,
           `connector_id`, `connector_version`, `classification_status` and
           `review_status` are the seven columns migration 0022 grants. They are
           requested here because the evidence record is where a reviewer asks
           "when did we first see this, and has anyone looked at it?" — and
           because a grant for a column nothing reads drifts out of alignment
           with the read it was written for, which is how 0021 happened.
        */
        const { data, error } = await client
          .from('evidence')
          .select(
            `${EVIDENCE_COLUMNS}, published_precision, published_basis, event_date, temporal_raw_expression, temporal_start, temporal_end, temporal_precision, temporal_basis, temporal_inference_note, superseded_by_evidence_id, source_document_id, connector_id, connector_version, first_seen_at, last_seen_at, classification_status, review_status`,
          )
          .eq('id', evidenceId)
          .maybeSingle()
        if (error) return unavailable(classifyError(error), checkedAt)
        if (!data) {
          return { kind: 'unavailable', reason: 'No such evidence record.', blockedBy: 'not_found', checkedAt }
        }

        const row = data as unknown as EvidenceRow & Record<string, unknown>
        const published = (row.published_at ?? '').slice(0, 10)

        return {
          kind: 'ready',
          data: {
            id: row.id,
            title: row.title ?? 'Untitled document',
            sourceName: row.publisher ?? 'Unnamed source',
            publisher: row.publisher ?? 'Unnamed publisher',
            publishedAt: {
              rawExpression: published || null,
              start: published || null,
              end: published || null,
              precision: 'exact_day',
              basis: 'stated',
              inferenceNote: null,
            },
            retrievedAt: row.retrieved_at ?? '',
            firstSeenAt: (row.first_seen_at as string) ?? null,
            lastSeenAt: (row.last_seen_at as string) ?? null,
            sourceDocumentId: (row.source_document_id as string) ?? null,
            collectedBy:
              row.connector_id && row.connector_version
                ? `${row.connector_id as string} ${row.connector_version as string}`
                : null,
            reviewStatus: (row.review_status as string) ?? null,
            excerpt: row.evidence_excerpt ?? null,
            locator: officialUrlOf(row),
            accessMode: accessMode(row.access_mode),
            subjectTiming: null,
            assertions: [],
            relatedCompany: null,
            relatedFacility: null,
            relatedOpportunity: null,
            relatedClaim: null,
            corrections: [],
            supersededByEvidenceId: (row.superseded_by_evidence_id as string) ?? null,
          },
          checkedAt,
        }
      }),

    getSourceHealth: () =>
      guard<SourceHealthSnapshot>(async (client, freshness) => {
        const checkedAt = stamp()
        const now = clock()
        const graph = await readGraph(client)
        if (isFail(graph)) return unavailable(graph, checkedAt)

        const { data: runRows, error: runError } = await client
          .from('source_runs')
          .select(
            'id, source_id, run_status, started_at, completed_at, items_seen, items_stored, error_summary',
          )
          .order('started_at', { ascending: false })
          .limit(READ_LIMIT)
        if (runError) return unavailable(classifyError(runError), checkedAt)

        /* Evidence per source is a direct column. Signals and opportunities are
           reached through the recorded links, never inferred from a title. */
        const evidenceCountBySource = new Map<string, number>()
        for (const row of graph.evidence) {
          if (!row.source_id) continue
          evidenceCountBySource.set(row.source_id, (evidenceCountBySource.get(row.source_id) ?? 0) + 1)
        }

        const signalsBySource = new Map<string, Set<string>>()
        for (const signal of graph.signals) {
          for (const sourceId of graph.sourceBySignal.get(signal.id) ?? []) {
            const set = signalsBySource.get(sourceId) ?? new Set<string>()
            set.add(signal.id)
            signalsBySource.set(sourceId, set)
          }
        }

        const opportunitiesBySource = new Map<string, Set<string>>()
        for (const [opportunityId, signalIds] of graph.signalsByOpportunity) {
          for (const signalId of signalIds) {
            for (const sourceId of graph.sourceBySignal.get(signalId) ?? []) {
              const set = opportunitiesBySource.get(sourceId) ?? new Set<string>()
              set.add(opportunityId)
              opportunitiesBySource.set(sourceId, set)
            }
          }
        }

        const connectors: ConnectorRecord[] = graph.sources.map((source) => {
          const runs = (runRows ?? []).filter((r) => r.source_id === source.id)
          const history: ConnectorRun[] = runs.slice(0, 10).map((r) => ({
            id: r.id as string,
            startedAt: (r.started_at as string) ?? '',
            completedAt: (r.completed_at as string) ?? null,
            outcome: runOutcome(r.run_status as string),
            itemsSeen: (r.items_seen as number) ?? 0,
            itemsStored: (r.items_stored as number) ?? 0,
            note: (r.error_summary as string) ?? '',
          }))

          const open = runs.find((r) => !r.completed_at)
          const activeRun: ActiveRun | null = open
            ? {
                id: open.id as string,
                startedAt: (open.started_at as string) ?? '',
                status: (open.run_status as string) ?? 'running',
                stale:
                  now.getTime() - Date.parse((open.started_at as string) ?? '') >
                  RUN_CONSIDERED_STALE_AFTER_HOURS * 60 * 60 * 1000,
              }
            : null

          const lastSuccess = source.last_success_at
          const freshnessHours = lastSuccess
            ? Math.max(0, Math.round((now.getTime() - Date.parse(lastSuccess)) / 3_600_000))
            : Number.POSITIVE_INFINITY

          return {
            id: source.id,
            name: source.name ?? source.id,
            state: connectorState(source.health_status, Boolean(source.enabled)),
            enabled: Boolean(source.enabled),
            activity: {
              documentsDiscovered: runs.reduce((sum, r) => sum + (((r.items_seen as number) ?? 0)), 0),
              evidenceStored: evidenceCountBySource.get(source.id) ?? 0,
              signalsCreated: signalsBySource.get(source.id)?.size ?? 0,
              opportunitiesCreated: opportunitiesBySource.get(source.id)?.size ?? 0,
            },
            activeRun,
            lastRunAt: (runs[0]?.started_at as string) ?? '',
            lastOutcome: history[0]?.outcome ?? 'failure',
            consecutiveFailures: source.consecutive_failures ?? 0,
            lastSuccessfulCollectionAt: lastSuccess,
            freshnessHours: Number.isFinite(freshnessHours) ? freshnessHours : 0,
            expectedCadenceHours: source.expected_cadence_hours ?? 24,
            runHistory: history,
            maintenance: null,
          }
        })

        const snapshot: SourceHealthSnapshot = {
          connectors,
          coverage: graph.organizations.map((org) => ({
            companyId: org.id,
            companyName: org.canonical_name,
            coverage: coverageFor(graph, org.id),
          })),
          lastCycleCompletedAt: freshness.lastSuccessAt ?? '',
        }

        // Source Health is the one surface that must render when everything
        // else is empty: "nothing has run" is precisely what it is for.
        if (connectors.length === 0) {
          return {
            kind: 'empty',
            reason: 'No source is configured yet.',
            checkedAt,
          }
        }
        if (freshness.unavailableSources.length > 0 || freshness.manualReviewSources.length > 0) {
          return {
            kind: 'degraded',
            data: snapshot,
            notice: [...freshness.unavailableSources, ...freshness.manualReviewSources].join(', ') + ' needs attention.',
            affected: [...freshness.unavailableSources, ...freshness.manualReviewSources],
            checkedAt,
          }
        }
        return { kind: 'ready', data: snapshot, checkedAt }
      }),

    getMapLocations: () =>
      guard<MapSnapshot>(async (client) => {
        const checkedAt = stamp()
        const graph = await readGraph(client)
        if (isFail(graph)) return unavailable(graph, checkedAt)

        const [orgLocations, oppLocations] = await Promise.all([
          client
            .from('organization_locations')
            .select(
              'id, organization_id, location_type, label, normalized_address, latitude, longitude, precision, resolved_at',
            )
            .limit(READ_LIMIT),
          client
            .from('opportunity_locations')
            .select(
              'id, opportunity_id, evidence_id, location_type, extracted_text, facility_name, normalized_address, latitude, longitude, precision, uncertainty_radius_m, resolved_at',
            )
            .limit(READ_LIMIT),
        ])
        if (orgLocations.error) return unavailable(classifyError(orgLocations.error), checkedAt)
        if (oppLocations.error) return unavailable(classifyError(oppLocations.error), checkedAt)

        const opportunities = new Map(
          graph.opportunities.map((row) => [row.id, mapOpportunity(graph, row)]),
        )

        const markers: MapMarker[] = []

        /*
           PROJECT LOCATIONS FIRST, AND ONLY WHERE A DOCUMENT NAMED A PLACE.

           Every row here was extracted from the matched passage of a filing.
           `extracted_text` is what the document said, kept beside the
           coordinate so the pin can always be checked against its source.
        */
        for (const raw of (oppLocations.data ?? []) as unknown as OpportunityLocationRow[]) {
          if (!isPlaced(raw)) continue
          const opportunity = opportunities.get(raw.opportunity_id)
          if (!opportunity) continue
          const precision = locationPrecision(raw.precision)
          const source = raw.evidence_id
            ? (opportunity.sources.find((s) => s.evidenceId === raw.evidence_id) ??
              opportunity.sources[0] ??
              null)
            : (opportunity.sources[0] ?? null)

          markers.push({
            id: `opportunity-location-${raw.id}`,
            locationType:
              raw.location_type === 'confirmed_project_site'
                ? 'confirmed_project_site'
                : 'approximate_project_area',
            precision,
            latitude: raw.latitude!,
            longitude: raw.longitude!,
            uncertaintyRadiusMetres: raw.uncertainty_radius_m ?? UNCERTAINTY_METRES[precision] ?? null,
            label: raw.facility_name ?? raw.normalized_address ?? raw.extracted_text,
            extractedText: raw.extracted_text,
            normalizedAddress: raw.normalized_address,
            organizationId: opportunity.organization.id,
            organizationName: opportunity.organization.canonicalName,
            opportunity: {
              id: opportunity.id,
              title: opportunity.title,
              opportunityType:
                familyLabel(
                  readClassifierMetadata(
                    primarySignalFor(graph, opportunity.id)?.model_metadata ?? null,
                  ).classifierFamily,
                ) ?? 'Project activity',
              stage: opportunity.stage,
              confidenceLevel: opportunity.confidence.confidenceLevel,
              filingDate: opportunity.sourceDate?.iso ?? null,
              documentType: source?.documentType ?? null,
              publisher: source?.publisher ?? null,
              excerpt: source?.excerpt ?? null,
              officialUrl: source?.officialUrl ?? null,
            },
            resolvedAt: raw.resolved_at,
          })
        }

        /*
           ACCOUNT CONTEXT, AND NEVER ANYTHING ELSE.

           A headquarters carries NO opportunity — the field is null, not a
           nearby project borrowed to make the pin look useful. This is the one
           rule the whole surface exists to keep: a head office is where a
           company is registered, not where it is building.
        */
        for (const raw of (orgLocations.data ?? []) as unknown as OrganizationLocationRow[]) {
          if (!isPlaced(raw)) continue
          const org = graph.organizationById.get(raw.organization_id)
          if (!org) continue
          const precision = locationPrecision(raw.precision)
          markers.push({
            id: `organization-location-${raw.id}`,
            locationType:
              raw.location_type === 'known_company_facility'
                ? 'known_company_facility'
                : 'corporate_headquarters',
            precision,
            latitude: raw.latitude!,
            longitude: raw.longitude!,
            uncertaintyRadiusMetres: UNCERTAINTY_METRES[precision] ?? null,
            label: raw.label,
            extractedText: null,
            normalizedAddress: raw.normalized_address,
            organizationId: org.id,
            organizationName: org.canonical_name,
            opportunity: null,
            resolvedAt: raw.resolved_at,
          })
        }

        const placedOpportunities = new Set(
          ((oppLocations.data ?? []) as unknown as OpportunityLocationRow[])
            .filter(isPlaced)
            .map((r) => r.opportunity_id),
        )
        const attempted = new Map(
          ((oppLocations.data ?? []) as unknown as OpportunityLocationRow[]).map((r) => [
            r.opportunity_id,
            r,
          ]),
        )

        const unlocated: UnlocatedOpportunity[] = [...opportunities.values()]
          .filter((o) => !placedOpportunities.has(o.id))
          .map((o) => ({
            id: o.id,
            title: o.title,
            organizationName: o.organization.canonicalName,
            reason: attempted.has(o.id)
              ? `The filing named “${attempted.get(o.id)!.extracted_text}”, which could not be resolved to a place.`
              : 'The filing did not name a site, a city or a state for this project.',
          }))
          .sort((a, b) => a.organizationName.localeCompare(b.organizationName))

        if (markers.length === 0 && unlocated.length === 0) {
          return {
            kind: 'empty',
            reason:
              'No opportunity or account has a recorded location yet. Locations are extracted from collected filings; nothing has been placed on a map by hand.',
            checkedAt,
          }
        }

        return { kind: 'ready', data: { markers, unlocated, generatedAt: checkedAt }, checkedAt }
      }),

    getSpyglass: () =>
      guard<SpyglassSnapshot>(async (client) => {
        const checkedAt = stamp()

        const [settings, widgets, admin] = await Promise.all([
          client
            .from('spyglass_settings')
            .select('dashboard_url, dashboard_label, updated_at')
            .eq('id', 'default')
            .maybeSingle(),
          client
            .from('spyglass_widgets')
            .select(
              'id, title, embed_url, enabled, display_order, snapshot_generated_at, theme, fallback_url',
            )
            .eq('enabled', true)
            .order('display_order'),
          /*
             ONE BOOLEAN ABOUT THE CALLER, ANSWERED BY THE DATABASE.

             `app_administrators` has no grant and no policy, so this cannot be
             answered by reading it. `is_app_administrator()` is a
             security-definer function that answers only about the current
             session — it cannot enumerate anybody, and the ANSWER is not what
             enforces anything. The row-level policy does that. This only
             decides whether to render the control.
          */
          client.rpc('is_app_administrator'),
        ])

        if (settings.error) return unavailable(classifyError(settings.error), checkedAt)
        if (widgets.error) return unavailable(classifyError(widgets.error), checkedAt)

        if (!settings.data) {
          return {
            kind: 'empty',
            reason:
              'No Spyglass dashboard has been configured for this deployment yet. An application administrator can set one without a deployment.',
            checkedAt,
          }
        }

        const dashboardUrl = settings.data.dashboard_url as string
        if (!isApprovedDashboardUrl(dashboardUrl)) {
          /* Stored rows are constrained, but a row that predates the constraint
             or arrived by another route is checked again here rather than
             trusted because it came from our own database. */
          return unavailable(
            {
              reason:
                'The configured Spyglass dashboard address is not an approved Zignal destination, so it has not been opened.',
              blockedBy: 'configuration',
            },
            checkedAt,
          )
        }

        const mapped: SpyglassWidget[] = (widgets.data ?? [])
          .filter((row) => isApprovedEmbedUrl(row.embed_url as string))
          .map((row) => ({
            id: row.id as string,
            title: row.title as string,
            embedUrl: row.embed_url as string,
            enabled: Boolean(row.enabled),
            displayOrder: (row.display_order as number) ?? 100,
            snapshotGeneratedAt: row.snapshot_generated_at as string,
            theme: ((row.theme as string) ?? 'auto') as SpyglassWidget['theme'],
            fallbackUrl: row.fallback_url as string,
          }))

        return {
          kind: 'ready',
          data: {
            settings: {
              dashboardUrl,
              dashboardLabel: (settings.data.dashboard_label as string) ?? 'Openi Spyglass',
              updatedAt: (settings.data.updated_at as string) ?? '',
            },
            widgets: mapped,
            viewerIsAdministrator: admin.data === true,
            generatedAt: checkedAt,
          },
          checkedAt,
        }
      }),

    async setSpyglassDashboard(url: string, label: string) {
      const client = supabaseBrowser()
      if (!client) return { ok: false, reason: FAILURE.notConfigured.reason }
      if (!isApprovedDashboardUrl(url)) {
        return {
          ok: false,
          reason: 'That address is not an approved Zignal destination and was not saved.',
        }
      }

      /*
         `select()` AFTER THE UPDATE, AND THE ROW COUNT IS THE ANSWER.

         A non-administrator's update is not an error: the row-level policy
         filters it out, so PostgREST reports success having changed nothing.
         Reporting that as saved is how someone discovers a week later that the
         dashboard never moved. An empty result means refused, and says so.
      */
      const { data, error } = await client
        .from('spyglass_settings')
        .update({
          dashboard_url: url,
          dashboard_label: label,
          updated_at: new Date().toISOString(),
        })
        .eq('id', 'default')
        .select('dashboard_url')

      if (error) return { ok: false, reason: classifyError(error).reason }
      if (!data || data.length === 0) {
        return {
          ok: false,
          reason:
            'Nothing was changed. Editing the Spyglass dashboard requires an application administrator.',
        }
      }
      return { ok: true }
    },
  }
}

/** `source_runs.run_status` in the vocabulary `ConnectorRun` admits. */
function runOutcome(status: string | null): ConnectorRun['outcome'] {
  if (status === 'succeeded' || status === 'success') return 'success'
  if (status === 'partial' || status === 'partial_success') return 'partial_success'
  return 'failure'
}

/**
 * A source's health, in the vocabulary the interface uses.
 *
 * A DISABLED source is reported as disabled, not as healthy. It is not
 * collecting, and a fleet counted as green because nothing is switched on is
 * the failure mode a health surface exists to prevent.
 */
function connectorState(health: string | null, enabled: boolean): ConnectorState {
  if (!enabled) return 'disabled'
  switch (health) {
    case 'healthy':
      return 'healthy'
    case 'degraded':
      return 'degraded'
    case 'action_required':
    case 'manual_review_required':
    case 'source_unavailable':
      return 'action_required'
    case 'unsupported':
      return 'unsupported'
    default:
      return 'degraded'
  }
}
