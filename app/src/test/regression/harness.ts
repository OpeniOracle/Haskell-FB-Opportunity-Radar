/**
 * THE SYNTHETIC REGRESSION HARNESS (roadmap R1.5).
 *
 * WHAT THIS IS. A way to state, as data, what a CORRECT derivation pipeline
 * would do with a given piece of text, and to compare that with what the real
 * pipeline does today -- dimension by dimension, so that "was a signal
 * recorded", "was an opportunity opened", "which date was written", "how many
 * independent sources were counted" and "which organisation was credited" are
 * separate questions with separate answers.
 *
 * WHAT THIS IS NOT.
 *
 *   - It is not a measure of production precision, recall or accuracy. The
 *     cases are few, hand-written and chosen to expose failure modes; they are
 *     not a sample of incoming documents. No ratio is computed anywhere, on
 *     purpose.
 *   - It does not change behaviour. It imports the real classifier, the real
 *     pipeline and the real location extractor, unmodified, and observes them.
 *     Repairing what it exposes is a separate, separately authorised change.
 *   - It does not touch production. There is no Supabase client, no network, no
 *     model call and no environment read in this file or in the cases: the
 *     database is an in-memory fake and the transport throws if it is used.
 *
 * KNOWN DEFECTS ARE PINNED, NOT HIDDEN. A case states the INTENDED outcome. If
 * the current code does not produce it, the case names the defect and the
 * dimension that fails. The test then asserts the code STILL fails in exactly
 * that way (a strict expected failure). Two consequences, both deliberate:
 *
 *   1. CI stays green while a defect is open, and the defect is visible in the
 *      committed report rather than in a skipped or commented-out test.
 *   2. The change that repairs a defect turns its case RED until the marker is
 *      retired. A fix cannot slip past the harness unrecorded, and a marker
 *      cannot outlive its defect.
 */
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { APP_ROOT } from '@/test/paths'
import { runConnectorPass } from '../../../netlify/functions/_shared/connectors/pipeline'
import { extractLocations } from '../../../netlify/functions/_shared/locations/extract'
import type {
  Connector,
  ConnectorContext,
  DiscoveredDocument,
  RetrievedDocument,
} from '../../../netlify/functions/_shared/connectors/types'

/* ------------------------------------------------------------------ paths */

export const REGRESSION_ROOT = join(APP_ROOT, 'src/test/regression')
export const SYNTHETIC_DIR = join(REGRESSION_ROOT, 'synthetic')
export const SOURCED_DIR = join(REGRESSION_ROOT, 'sourced')
export const MANIFEST_PATH = join(REGRESSION_ROOT, 'MANIFEST.json')
export const REPORT_PATH = join(REGRESSION_ROOT, 'synthetic-regression.report.json')

/** Present in every synthetic fixture file, so a scan of any build output can find a leak. */
export const SYNTHETIC_SENTINEL = 'SYNTHETIC-REGRESSION-FIXTURE'

/* ------------------------------------------------------------------ types */

export type Dimension =
  | 'signal'
  | 'promotion'
  | 'eventDate'
  | 'independence'
  | 'cardinality'
  | 'attribution'
  | 'location'

export const DIMENSIONS: readonly Dimension[] = [
  'signal',
  'promotion',
  'eventDate',
  'independence',
  'cardinality',
  'attribution',
  'location',
]

export interface WorldOrganization {
  slug: string
  id: string
  entityKey: string
  canonicalName: string
  role: string
}

export interface DefectCatalogEntry {
  id: string
  summary: string
  /** The roadmap PR that is expected to retire it. */
  remediation: string
  /** Where the behaviour lives today, on `main`. */
  codePaths: string[]
}

export interface CaseDocument {
  key: string
  /** `slug` of the organisation whose feed or filing this is. */
  publisher: string
  sourceId: string
  sourceDocumentId: string
  title: string
  documentType: string
  /** What the SOURCE states as the publication time. Null when it states none. */
  publishedAt: string | null
  url: string
  text: string
  /**
   * Which original statement this copy derives from. Declared by the fixture,
   * as ground truth about the synthetic world. The pipeline cannot see it --
   * that is the point of the cases that use it.
   */
  originGroup?: string
}

export interface ExpectedSignal {
  /** A classifier family code, or any of several. */
  family: string | string[]
  negative: boolean
}

export interface Expected {
  /**
   * `signal`      -- exactly these signals should be recorded.
   * `no_signal`   -- nothing should be recorded.
   * `abstain`     -- the right behaviour is to hold for a human: no opportunity
   *                  and nothing graded above `possible`.
   * `unspecified` -- not asserted (recording policy is a later decision).
   */
  outcome: 'signal' | 'no_signal' | 'abstain' | 'unspecified'
  signals?: ExpectedSignal[]
  promotion: 'none' | 'emerging' | 'unspecified'
  /** Every recorded signal's `event_date`. `null` means it must stay null. */
  eventDate?: string | null
  /** Every recorded signal's `independent_source_count`. */
  independentSourceCount?: number
  counts?: { signals?: number; opportunities?: number }
  /** The exact set of organisations (by slug) that hold an opportunity. */
  attribution?: { opportunityOrganizations: string[] }
  /** Evaluated on the first document's text, by the real location extractor. */
  location?: { projectSites: string[]; notProjectSites: string[] }
}

export interface KnownDefectRef {
  defect: string
  /** The dimensions on which the CURRENT code fails this case. Exactly these. */
  dimensions: Dimension[]
}

export interface RegressionCase {
  id: string
  /** The bundle's failure-mode tag, e.g. `FP02_AMOUNT_ROLE`. */
  failureMode: string
  /** The requirement family this case belongs to. */
  family: string
  title: string
  rationale: string
  clock?: string
  documents: CaseDocument[]
  expected: Expected
  knownDefects: KnownDefectRef[]
}

export interface ObservedSignal {
  classifierFamily: string
  negative: boolean
  confidence: string
  eventDate: string | null
  eventDatePrecision: string | null
  eventDateBasis: string | null
  independentSourceCount: number
  organization: string
  clusterKey: string
}

export interface ObservedOpportunity {
  organization: string
  stage: string
  status: string
  confidence: string
}

export interface Observed {
  signals: ObservedSignal[]
  opportunities: ObservedOpportunity[]
  locations: { place: string; precision: string }[] | null
}

export interface DimensionResult {
  dimension: Dimension
  verdict: 'pass' | 'fail'
  /** Machine-readable outcome classes, e.g. `false_match`, `missed_signal`. */
  classes: string[]
  expected: unknown
  observed: unknown
  /** The defects the case pins to this dimension. Empty means the code is expected to pass. */
  pinnedDefects: string[]
}

export interface CaseResult {
  id: string
  failureMode: string
  family: string
  /** `control` when the code does what is intended; `defect_probe` when it does not. */
  kind: 'control' | 'defect_probe'
  dimensions: DimensionResult[]
}

/* --------------------------------------------------------------- loading */

export function sha256(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export function syntheticFiles(): string[] {
  return readdirSync(SYNTHETIC_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
}

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(join(SYNTHETIC_DIR, file), 'utf8')) as T
}

export function loadWorld(): WorldOrganization[] {
  return readJson<{ organizations: WorldOrganization[] }>('world.json').organizations
}

export function loadDefects(): DefectCatalogEntry[] {
  return readJson<{ defects: DefectCatalogEntry[] }>('defects.json').defects
}

export function loadCases(): RegressionCase[] {
  return syntheticFiles()
    .filter((f) => f.startsWith('cases.'))
    .flatMap((f) => readJson<{ cases: RegressionCase[] }>(f).cases)
}

/* ------------------------------------------------- an in-memory database */

interface Row {
  [key: string]: unknown
}

/**
 * The same shape of fake the existing SEC-path tests use (`secOpportunityPath`),
 * kept separate so that nothing in that file has to change. It implements the
 * handful of query-builder calls the pipeline makes and nothing more: a call
 * the pipeline starts making that this does not implement fails loudly rather
 * than quietly returning nothing.
 */
function memoryClient() {
  const tables = new Map<string, Row[]>()
  let seq = 0
  const rows = (t: string) => {
    if (!tables.has(t)) tables.set(t, [])
    return tables.get(t)!
  }

  function builder(table: string) {
    const filters: [string, unknown][] = []
    let pending: { op: string; payload?: Row } | null = null
    const matches = (row: Row) => filters.every(([k, v]) => row[k] === v)

    const api: Record<string, unknown> = {
      select: () =>
        pending?.op === 'insert' || pending?.op === 'update' ? api : ((pending = { op: 'select' }), api),
      eq: (c: string, v: unknown) => (filters.push([c, v]), api),
      is: (c: string, v: unknown) => (filters.push([c, v]), api),
      insert: (payload: Row) => ((pending = { op: 'insert', payload }), api),
      update: (payload: Row) => ((pending = { op: 'update', payload }), api),
      upsert: (payload: Row) => ((pending = { op: 'upsert', payload }), api),
      maybeSingle: async () => ({ data: rows(table).find(matches) ?? null, error: null }),
      single: async () => {
        if (pending?.op === 'insert') {
          seq += 1
          // `superseded_at` is NULL in PostgreSQL when an insert omits it, and the
          // current-row lookup filters on it; without this the fake would store
          // `undefined` and a second document would insert a duplicate.
          const row = { id: `${table}-${seq}`, superseded_at: null, ...pending.payload }
          rows(table).push(row)
          return { data: { id: row.id }, error: null }
        }
        return { data: rows(table).find(matches) ?? null, error: null }
      },
      then: (resolve: (r: unknown) => unknown) => {
        if (pending?.op === 'update') {
          for (const row of rows(table).filter(matches)) Object.assign(row, pending.payload)
          return resolve({ data: null, error: null })
        }
        if (pending?.op === 'upsert') {
          rows(table).push({ id: `${table}-${(seq += 1)}`, ...pending.payload })
          return resolve({ data: null, error: null })
        }
        return resolve({ data: rows(table).filter(matches), error: null })
      },
    }
    return api
  }
  return { client: { from: (t: string) => builder(t) } as never, rows }
}

/**
 * What the synthetic sources permit: the fail-closed default. A source whose
 * rights are unknown is `reference_only`, which is also what ADR 0014 says for
 * corporate material and what the D-R2 default says for state and local records.
 * Classification still reads the text in memory; only retention differs, and
 * retention is not what this harness measures.
 */
const SYNTHETIC_SOURCE_ACCESS = { accessMode: 'reference_only', licenseMode: 'unknown' } as const

export const DEFAULT_CLOCK = '2027-02-01T06:00:00.000Z'

function context(clock: string): ConnectorContext {
  return {
    userAgent: 'synthetic-regression-harness (no network)',
    allowlist: [],
    get: async () => {
      throw new Error('the synthetic regression harness performs no egress')
    },
    pacer: { take: async () => {} } as never,
    cache: { read: async () => null, write: async () => {} },
    now: () => new Date(clock),
    config: {},
    window: { start: '2026-01-01T00:00:00.000Z', end: clock },
    log: () => {},
  }
}

function connectorFor(doc: CaseDocument, entityKey: string): Connector {
  const bytes = new TextEncoder().encode(doc.text)
  const discovered: DiscoveredDocument = {
    sourceDocumentId: doc.sourceDocumentId,
    url: doc.url,
    canonicalUrl: doc.url,
    title: doc.title,
    publishedAt: doc.publishedAt,
    publishedPrecision: doc.publishedAt ? 'day' : null,
    documentType: doc.documentType,
    organizationEntityKey: entityKey,
    discoveryPath: 'synthetic:fixture',
    metadata: { synthetic: true },
  }
  return {
    id: doc.sourceId,
    version: '0.0.0-synthetic',
    sourceId: doc.sourceId,
    hosts: [],
    async discover() {
      return { kind: 'documents', documents: [discovered] }
    },
    async retrieve(): Promise<RetrievedDocument> {
      return {
        document: discovered,
        finalUrl: doc.url,
        status: 200,
        bytes,
        contentHash: sha256(doc.text),
        mimeType: 'text/plain',
        retrievedAt: DEFAULT_CLOCK,
        etag: null,
        lastModified: null,
        unchanged: false,
        extractedText: doc.text,
        extractionStatus: 'success',
      }
    },
  }
}

/* -------------------------------------------------------------- observing */

function needsPipeline(expected: Expected): boolean {
  return (
    expected.outcome !== 'unspecified' ||
    expected.promotion !== 'unspecified' ||
    expected.eventDate !== undefined ||
    expected.independentSourceCount !== undefined ||
    expected.counts !== undefined ||
    expected.attribution !== undefined
  )
}

export async function observe(c: RegressionCase, world: WorldOrganization[]): Promise<Observed> {
  const bySlug = new Map(world.map((o) => [o.slug, o]))
  const slugById = new Map(world.map((o) => [o.id, o.slug]))
  const clock = c.clock ?? DEFAULT_CLOCK

  let signals: ObservedSignal[] = []
  let opportunities: ObservedOpportunity[] = []

  if (needsPipeline(c.expected)) {
    const { client, rows } = memoryClient()
    let run = 0
    for (const doc of c.documents) {
      const org = bySlug.get(doc.publisher)
      if (!org) throw new Error(`case ${c.id}: unknown publisher "${doc.publisher}"`)
      await runConnectorPass(
        client,
        connectorFor(doc, org.entityKey),
        context(clock),
        [{ id: org.id, entity_key: org.entityKey, canonical_name: org.canonicalName }],
        `synthetic-run-${(run += 1)}`,
        1,
        SYNTHETIC_SOURCE_ACCESS,
      )
    }
    signals = rows('signals').map((r) => {
      const meta = (r.model_metadata ?? {}) as { classifierFamily?: string }
      return {
        classifierFamily: String(meta.classifierFamily ?? r.signal_family),
        negative: Boolean(r.negative_signal),
        confidence: String(r.confidence),
        eventDate: (r.event_date as string | null) ?? null,
        eventDatePrecision: (r.event_date_precision as string | null) ?? null,
        eventDateBasis: (r.event_date_basis as string | null) ?? null,
        independentSourceCount: Number(r.independent_source_count),
        organization: slugById.get(String(r.organization_id)) ?? String(r.organization_id),
        clusterKey: String(r.cluster_key),
      }
    })
    opportunities = rows('opportunities').map((r) => ({
      organization: slugById.get(String(r.organization_id)) ?? String(r.organization_id),
      stage: String(r.stage),
      status: String(r.status),
      confidence: String(r.confidence),
    }))
  }

  let locations: Observed['locations'] = null
  if (c.expected.location) {
    const first = c.documents[0]
    locations = extractLocations(first?.text ?? '').map((l) => ({
      place: [l.locality, l.region].filter(Boolean).join(', ') || String(l.region),
      precision: l.precision,
    }))
  }

  return { signals, opportunities, locations }
}

/* ------------------------------------------------------------ evaluating */

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort()
}

function describeSignals(signals: ObservedSignal[]): string[] {
  return uniqueSorted(
    signals.map((s) => `${s.classifierFamily}${s.negative ? ' (negative)' : ''} / ${s.confidence}`),
  )
}

function evaluateSignal(expected: Expected, observed: Observed): DimensionResult | null {
  if (expected.outcome === 'unspecified') return null
  const classes: string[] = []
  const found = observed.signals
  let expectedView: unknown

  if (expected.outcome === 'no_signal') {
    expectedView = 'no signal'
    if (found.length > 0) classes.push('false_match')
    else classes.push('correct_none')
  } else if (expected.outcome === 'abstain') {
    expectedView = 'abstain: no opportunity, nothing above possible'
    const committed = found.some((s) => s.confidence !== 'possible')
    classes.push(committed ? 'abstention_violated' : 'abstention_honored')
  } else {
    const wanted = expected.signals ?? []
    expectedView = wanted.map((w) => `${[w.family].flat().join('|')}${w.negative ? ' (negative)' : ''}`)
    const matchesWanted = (w: ExpectedSignal) =>
      found.some((s) => [w.family].flat().includes(s.classifierFamily) && s.negative === w.negative)
    const missing = wanted.filter((w) => !matchesWanted(w))
    const extra = found.filter(
      (s) => !wanted.some((w) => [w.family].flat().includes(s.classifierFamily) && s.negative === w.negative),
    )
    if (missing.length) classes.push('missed_signal')
    if (extra.length) classes.push('false_match')
    if (!missing.length && !extra.length) classes.push('correct_signal')
  }

  const failed = classes.some((c) => c !== 'correct_none' && c !== 'correct_signal' && c !== 'abstention_honored')
  return {
    dimension: 'signal',
    verdict: failed ? 'fail' : 'pass',
    classes,
    expected: expectedView,
    observed: describeSignals(found),
    pinnedDefects: [],
  }
}

function evaluatePromotion(expected: Expected, observed: Observed): DimensionResult | null {
  // An abstention is by definition a decision NOT to open an opportunity.
  const want = expected.outcome === 'abstain' ? 'none' : expected.promotion
  if (want === 'unspecified') return null
  const opened = observed.opportunities
  const classes: string[] = []
  if (want === 'none') classes.push(opened.length ? 'false_promotion' : 'correct_none')
  else if (!opened.length) classes.push('missed_promotion')
  else if (opened.some((o) => o.stage !== 'emerging')) classes.push('stage_inflation')
  else classes.push('correct_promotion')
  return {
    dimension: 'promotion',
    verdict: classes[0]!.startsWith('correct') ? 'pass' : 'fail',
    classes,
    expected: want === 'none' ? 'no opportunity' : 'an emerging opportunity',
    observed: opened.length ? opened.map((o) => `${o.organization}: ${o.stage}/${o.status}`) : 'no opportunity',
    pinnedDefects: [],
  }
}

function evaluateEventDate(expected: Expected, observed: Observed): DimensionResult | null {
  if (expected.eventDate === undefined) return null
  const dates = observed.signals.map((s) => s.eventDate)
  const ok = dates.length > 0 && dates.every((d) => d === expected.eventDate)
  return {
    dimension: 'eventDate',
    verdict: ok ? 'pass' : 'fail',
    classes: [ok ? 'correct_date' : dates.length === 0 ? 'no_signal_to_date' : 'wrong_event_date'],
    expected: expected.eventDate,
    observed: observed.signals.map((s) => ({
      eventDate: s.eventDate,
      precision: s.eventDatePrecision,
      basis: s.eventDateBasis,
    })),
    pinnedDefects: [],
  }
}

function evaluateIndependence(expected: Expected, observed: Observed): DimensionResult | null {
  if (expected.independentSourceCount === undefined) return null
  const counts = observed.signals.map((s) => s.independentSourceCount)
  const ok = counts.length > 0 && counts.every((n) => n === expected.independentSourceCount)
  return {
    dimension: 'independence',
    verdict: ok ? 'pass' : 'fail',
    classes: [ok ? 'correct_independence' : counts.some((n) => n > expected.independentSourceCount!) ? 'origins_overcounted' : 'independence_undercounted'],
    expected: expected.independentSourceCount,
    observed: counts,
    pinnedDefects: [],
  }
}

function evaluateCardinality(expected: Expected, observed: Observed): DimensionResult | null {
  if (!expected.counts) return null
  const got = { signals: observed.signals.length, opportunities: observed.opportunities.length }
  const want = expected.counts
  const classes: string[] = []
  if (want.signals !== undefined && got.signals > want.signals) classes.push('duplicate_signals')
  if (want.opportunities !== undefined && got.opportunities > want.opportunities) classes.push('duplicate_opportunities')
  if (want.signals !== undefined && got.signals < want.signals) classes.push('too_few_signals')
  if (want.opportunities !== undefined && got.opportunities < want.opportunities) classes.push('too_few_opportunities')
  if (!classes.length) classes.push('correct_cardinality')
  return {
    dimension: 'cardinality',
    verdict: classes[0] === 'correct_cardinality' ? 'pass' : 'fail',
    classes,
    expected: want,
    observed: got,
    pinnedDefects: [],
  }
}

function evaluateAttribution(expected: Expected, observed: Observed): DimensionResult | null {
  if (!expected.attribution) return null
  const want = uniqueSorted(expected.attribution.opportunityOrganizations)
  const got = uniqueSorted(observed.opportunities.map((o) => o.organization))
  const ok = JSON.stringify(want) === JSON.stringify(got)
  return {
    dimension: 'attribution',
    verdict: ok ? 'pass' : 'fail',
    classes: [ok ? 'correct_attribution' : 'misattributed'],
    expected: want,
    observed: got,
    pinnedDefects: [],
  }
}

function evaluateLocation(expected: Expected, observed: Observed): DimensionResult | null {
  if (!expected.location || !observed.locations) return null
  const places = observed.locations.map((l) => l.place)
  const missing = expected.location.projectSites.filter((p) => !places.includes(p))
  const leaked = expected.location.notProjectSites.filter((p) => places.includes(p))
  const classes: string[] = []
  if (missing.length) classes.push('missed_site')
  if (leaked.length) classes.push('non_project_place_returned')
  if (!classes.length) classes.push('correct_location')
  return {
    dimension: 'location',
    verdict: classes[0] === 'correct_location' ? 'pass' : 'fail',
    classes,
    expected: expected.location,
    observed: observed.locations.map((l) => `${l.place} (${l.precision})`),
    pinnedDefects: [],
  }
}

export async function evaluateCase(c: RegressionCase, world: WorldOrganization[]): Promise<CaseResult> {
  const observed = await observe(c, world)
  const dimensions = [
    evaluateSignal(c.expected, observed),
    evaluatePromotion(c.expected, observed),
    evaluateEventDate(c.expected, observed),
    evaluateIndependence(c.expected, observed),
    evaluateCardinality(c.expected, observed),
    evaluateAttribution(c.expected, observed),
    evaluateLocation(c.expected, observed),
  ].filter((d): d is DimensionResult => d !== null)

  for (const d of dimensions) {
    d.pinnedDefects = c.knownDefects.filter((k) => k.dimensions.includes(d.dimension)).map((k) => k.defect)
  }
  const failing = dimensions.some((d) => d.verdict === 'fail')
  return {
    id: c.id,
    failureMode: c.failureMode,
    family: c.family,
    kind: failing ? 'defect_probe' : 'control',
    dimensions,
  }
}

/* -------------------------------------------------------------- reporting */

export const REPORT_SCOPE =
  'SYNTHETIC REGRESSION ONLY. These cases are hand-written, fictional and few. This report is NOT production precision, recall or accuracy, no ratio is computed, and it must not be quoted as one. It records which intended behaviours the current code does and does not produce.'

export interface Report {
  schema: 'synthetic-regression-report/1'
  scope: string
  fixtures: { files: Record<string, string>; cases: number }
  summary: {
    cases: number
    controls: number
    defectProbes: number
    signal: Record<string, number>
    promotion: Record<string, number>
    otherDimensions: Record<string, { pass: number; fail: number }>
    pinnedDefects: Record<string, number>
    pinnedByRemediation: Record<string, number>
    unpinnedFailures: number
    staleMarkers: number
  }
  byFailureMode: Record<string, { cases: number; failingDimensions: number }>
  cases: CaseResult[]
}

function bump(into: Record<string, number>, key: string) {
  into[key] = (into[key] ?? 0) + 1
}

function sortKeys<T>(o: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)))
}

export function buildReport(
  cases: RegressionCase[],
  results: CaseResult[],
  defects: DefectCatalogEntry[],
  manifestFiles: Record<string, string>,
): Report {
  const signal: Record<string, number> = {}
  const promotion: Record<string, number> = {}
  const other: Record<string, { pass: number; fail: number }> = {}
  const pinned: Record<string, number> = {}
  const byRemediation: Record<string, number> = {}
  const byMode: Record<string, { cases: number; failingDimensions: number }> = {}
  let unpinned = 0
  let stale = 0

  for (const r of results) {
    const mode = (byMode[r.failureMode] ??= { cases: 0, failingDimensions: 0 })
    mode.cases += 1
    const source = cases.find((c) => c.id === r.id)!

    for (const d of r.dimensions) {
      if (d.dimension === 'signal') d.classes.forEach((c) => bump(signal, c))
      else if (d.dimension === 'promotion') d.classes.forEach((c) => bump(promotion, c))
      else {
        const slot = (other[d.dimension] ??= { pass: 0, fail: 0 })
        slot[d.verdict] += 1
      }
      if (d.verdict === 'fail') {
        mode.failingDimensions += 1
        if (d.pinnedDefects.length) {
          for (const id of d.pinnedDefects) {
            bump(pinned, id)
            bump(byRemediation, defects.find((x) => x.id === id)?.remediation ?? 'unknown')
          }
        } else unpinned += 1
      }
    }
    // A marker for a dimension that now passes is stale.
    for (const k of source.knownDefects) {
      for (const dim of k.dimensions) {
        const got = r.dimensions.find((d) => d.dimension === dim)
        if (!got || got.verdict === 'pass') stale += 1
      }
    }
  }

  return {
    schema: 'synthetic-regression-report/1',
    scope: REPORT_SCOPE,
    fixtures: { files: sortKeys(manifestFiles), cases: cases.length },
    summary: {
      cases: results.length,
      controls: results.filter((r) => r.kind === 'control').length,
      defectProbes: results.filter((r) => r.kind === 'defect_probe').length,
      signal: sortKeys(signal),
      promotion: sortKeys(promotion),
      otherDimensions: sortKeys(other),
      pinnedDefects: sortKeys(pinned),
      pinnedByRemediation: sortKeys(byRemediation),
      unpinnedFailures: unpinned,
      staleMarkers: stale,
    },
    byFailureMode: sortKeys(byMode),
    cases: results,
  }
}

