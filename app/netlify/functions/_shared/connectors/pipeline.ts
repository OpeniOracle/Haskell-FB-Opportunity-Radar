/**
 * source retrieval → raw evidence → normalization → deduplication →
 * classification → opportunity record
 *
 * One pass, written so that running it twice changes nothing.
 *
 * IDEMPOTENCY IS A DATABASE PROPERTY HERE, NOT AN APPLICATION ONE. Every write
 * goes through an upsert onto a real unique index — (source_id,
 * source_document_id) for a document, (organization_id, cluster_key) for a
 * signal, (organization_id, opportunity_key) for an opportunity. An
 * application-level "check then insert" loses to a concurrent run, and a
 * scheduled function that overlaps itself is exactly the case that matters.
 *
 * WHAT A SECOND RUN DOES: bumps `last_seen_at`, and nothing else. Not
 * `published_at`, which belongs to the source. Not `first_seen_at`, which
 * belongs to history. A document whose bytes have changed is not updated in
 * place — it is inserted as a new row and the old one is pointed at it, so the
 * record of what we read last week survives the fact that the page was edited.
 *
 * PARTIAL FAILURE IS PARTIAL. A source that fails does not mark the cohort
 * current, and a document that fails does not fail the run. The run status
 * distinguishes success, partial_success, unchanged and failure, and Source
 * Health reads that rather than inferring it from a row count.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  Connector,
  ConnectorContext,
  DiscoveredDocument,
  RetrievedDocument,
} from './types.js'
import { classifyText, clusterKey, type ClassificationMatch } from './classify.js'
import { mapWithLimit } from '../egress.js'

export const PIPELINE_VERSION = '1.0.0'

export interface CompanyRow {
  readonly id: string
  readonly entity_key: string
  readonly canonical_name: string
}

export interface IngestionCounters {
  documentsDiscovered: number
  documentsRetrieved: number
  /** Produced at least one qualifying signal. */
  documentsAccepted: number
  /**
   * NOT STORED. Retrieval failed, the source answered an error, the write was
   * refused, or the document was about a company outside the cohort.
   *
   * It used to also count every document that WAS stored but carried no
   * qualifying signal, so the first successful SEC run reported
   * `evidenceCreated: 39` and `documentsRejected: 39` at the same time -- which
   * reads as "we stored 39 things and threw all 39 away".
   */
  documentsRejected: number
  /** Stored and evaluated, and the text carried no qualifying signal. */
  documentsStoredWithoutSignal: number
  /** An existing evidence row gained text, a locator or a classification. */
  documentsEnriched: number
  documentsUnchanged: number
  duplicatesPrevented: number
  evidenceCreated: number
  evidenceSuperseded: number
  signalsCreated: number
  signalsUpdated: number
  opportunitiesCreated: number
  opportunitiesUpdated: number
  opportunitiesSuppressed: number
  rejectionReasons: Record<string, number>
}

/**
 * A database refusal, said out loud.
 *
 * THIRTY-NINE DOCUMENTS WERE REJECTED WITH THE WORD "23514" AND NOTHING ELSE.
 *
 * Every write in this file reported `error.code ?? error.message`, and
 * PostgREST always supplies a code -- so the message, which is the half that
 * names the constraint, was never reached. "23514" says "a check constraint
 * failed" and there are more than twenty on `evidence`. Diagnosing it meant
 * reading the connector and the schema side by side.
 *
 * WHAT IS INCLUDED: the code, the message (which names the constraint), the
 * hint, and the constraint name pulled out separately so it is greppable.
 *
 * WHAT IS NOT: `details`. PostgreSQL puts the ENTIRE FAILING ROW in there --
 * `Failing row contains (...)` -- which for evidence means titles, URLs and an
 * excerpt of the document. This string reaches an operator's terminal, a run
 * record and a log, so the row itself stays out of it.
 */
export function describeDbError(error: {
  code?: string | null
  message?: string | null
  hint?: string | null
}): string {
  const parts: string[] = []
  if (error.code) parts.push(error.code)

  const message = error.message ?? ''
  const constraint = /constraint "([^"]+)"/.exec(message)?.[1]
  if (constraint) parts.push(`constraint ${constraint}`)
  if (message) parts.push(message.slice(0, 300))
  if (error.hint) parts.push(`hint: ${String(error.hint).slice(0, 200)}`)

  return parts.length > 0 ? parts.join(' — ') : 'unknown database error'
}

export function emptyCounters(): IngestionCounters {
  return {
    documentsDiscovered: 0,
    documentsRetrieved: 0,
    documentsAccepted: 0,
    documentsRejected: 0,
    documentsStoredWithoutSignal: 0,
    documentsEnriched: 0,
    documentsUnchanged: 0,
    duplicatesPrevented: 0,
    evidenceCreated: 0,
    evidenceSuperseded: 0,
    signalsCreated: 0,
    signalsUpdated: 0,
    opportunitiesCreated: 0,
    opportunitiesUpdated: 0,
    opportunitiesSuppressed: 0,
    rejectionReasons: {},
  }
}

/**
 * A bound on what is kept in `body_text`.
 *
 * A 10-K runs to hundreds of pages. The text is kept so a document can be
 * RE-CLASSIFIED without re-fetching it from SEC -- which is the whole point of
 * storing it -- and two hundred thousand characters is far past where a
 * facility announcement would be found while staying a sane row size.
 *
 * `body_text` is server-side only: migration 0015 deliberately withholds it
 * from the `authenticated` grant. What a reviewer sees is `evidence_excerpt`,
 * the matched window, which IS granted.
 */
export const MAX_BODY_TEXT_CHARS = 200_000

/** Why a document produced nothing, counted by reason. */
function bumpReason(counters: IngestionCounters, reason: string): void {
  counters.rejectionReasons[reason] = (counters.rejectionReasons[reason] ?? 0) + 1
}

/** Not stored. See `documentsRejected`. */
function reject(counters: IngestionCounters, reason: string): void {
  counters.documentsRejected += 1
  bumpReason(counters, reason)
}

/* ------------------------------------------------------------ normalise */

/**
 * A published timestamp may only come from the source — and is preserved
 * exactly as the source gave it.
 *
 * TWO RULES, AND ONLY TWO.
 *
 *   1. If the source states a publication time, keep it, unmodified.
 *   2. If it does not, the value is NULL. Never the retrieval time, never an
 *      inference from the URL, never "close enough".
 *
 * THERE IS NO THIRD RULE ABOUT EQUALITY. An earlier version of this function
 * discarded a source-stated timestamp that happened to equal the retrieval
 * timestamp, on the theory that equality implied a copy. That was wrong, and it
 * threw away real data: a feed polled moments after publication, a source
 * stating times to the minute, and historical metadata normalised to the same
 * precision all produce legitimate equality. Guarding against a copy by
 * deleting the evidence of a genuine coincidence is a worse bug than the one it
 * was guarding against.
 *
 * `retrievedAt` is deliberately not a parameter any more. It cannot influence
 * the published value, so it has no business being in scope here.
 */
/**
 * The DATABASE's precision vocabulary, which is not the connector's.
 *
 * A connector describes a timestamp as it found it -- SEC states an acceptance
 * instant to the minute, a feed states a pubDate to the minute, a filing index
 * states only a date. The `evidence_published_precision_check` constraint
 * (migration 0004) names a different set, because it describes HOW PRECISELY
 * THE DATE IS KNOWN rather than how many fields the timestamp carried:
 *
 *   exact_day, month, quarter, season, half_year, year, range, relative, unknown
 *
 * There is no sub-day member and there does not need to be one. A timestamp
 * known to the minute is a day known exactly, and the minute itself is not lost
 * -- it is in `published_at`, and the connector's own word for it is recorded
 * in `evidence_locator.publishedPrecisionObserved`.
 *
 * THIS MAPPING DID NOT EXIST, AND THAT WAS THE BUG. The pipeline wrote the
 * connector's vocabulary straight into the column, so every SEC filing carried
 * `published_precision = 'minute'` and was refused by the check constraint.
 */
const PRECISION_FOR_COLUMN: Record<string, string> = {
  minute: 'exact_day',
  hour: 'exact_day',
  day: 'exact_day',
  month: 'month',
  quarter: 'quarter',
  year: 'year',
}

/** The allowed members, so a caller can assert against them. */
export const PUBLISHED_PRECISION_VALUES = [
  'exact_day',
  'month',
  'quarter',
  'season',
  'half_year',
  'year',
  'range',
  'relative',
  'unknown',
] as const

/** `evidence_published_basis_check`. Three members, and none of them is prose. */
export const PUBLISHED_BASIS_VALUES = ['stated', 'inferred', 'unknown'] as const

export function publishedPrecisionForColumn(precision: string | null | undefined): string | null {
  if (!precision) return null
  // An unrecognised precision becomes `unknown` rather than being written
  // through. A connector adding a new word must not be able to fail every
  // insert in the run -- which is exactly what happened here.
  return PRECISION_FOR_COLUMN[precision] ?? 'unknown'
}

export function normalizePublished(document: DiscoveredDocument): {
  publishedAt: string | null
  precision: string | null
  basis: string
  observedPrecision: string | null
} {
  if (!document.publishedAt) {
    // The source stated no date. The basis of the absent date is `unknown`;
    // `source_stated_none` was prose, and prose is not in the vocabulary.
    return { publishedAt: null, precision: null, basis: 'unknown', observedPrecision: null }
  }
  return {
    publishedAt: document.publishedAt,
    // A date with no stated precision is a day known exactly -- that is what
    // having a date means. Never invented upward to an instant.
    precision: publishedPrecisionForColumn(document.publishedPrecision ?? 'day'),
    // The source declared it, which the schema calls `stated`.
    basis: 'stated',
    observedPrecision: document.publishedPrecision ?? null,
  }
}

/* ---------------------------------------------------------------- write */

/**
 * The columns a re-observation needs in order to decide what is missing.
 *
 * Named explicitly because PostgREST infers nothing useful from a select list
 * assembled as a string, and an `any` here would hide a typo in a column name
 * until it reached a database.
 */
interface ExistingEvidenceRow {
  id: string
  content_hash: string | null
  first_seen_at: string | null
  evidence_family_id: string | null
  body_text: string | null
  locator: string | null
  evidence_excerpt: string | null
  classification_status: string | null
  extraction_status: string | null
  evidence_locator: Record<string, unknown> | null
}

export interface EvidenceWriteResult {
  readonly evidenceId: string
  readonly created: boolean
  readonly superseded: boolean
  readonly unchanged: boolean
  /** An existing row gained text, a locator, an excerpt or a classification. */
  readonly enriched?: boolean
}

/**
 * Upsert one document as evidence, superseding a changed prior version.
 *
 * Three outcomes, and they are genuinely different:
 *   - no prior row            → insert, created
 *   - prior row, same hash    → touch last_seen_at only, unchanged
 *   - prior row, other hash   → insert new, point old at it, superseded
 */
export async function upsertEvidence(
  client: SupabaseClient,
  input: {
    sourceId: string
    sourceRunId: string
    connectorId: string
    connectorVersion: string
    document: DiscoveredDocument
    retrieved: RetrievedDocument
    excerpt: string | null
    classificationStatus: string
    accessMode: string
    now: string
  },
): Promise<EvidenceWriteResult> {
  const { document, retrieved } = input
  const published = normalizePublished(document)

  /*
     THE OFFICIAL DOCUMENT, THE TEXT, AND THE METADATA -- computed once and used
     by both the insert and the enrichment path, so a row written today and a
     row enriched tomorrow cannot disagree about what they hold.
  */
  const officialUrl = retrieved.finalUrl || document.url
  const bodyText = retrieved.extractedText
    ? retrieved.extractedText.slice(0, MAX_BODY_TEXT_CHARS)
    : null
  const locatorMetadata = {
    documentType: document.documentType,
    ...(published.observedPrecision
      ? { publishedPrecisionObserved: published.observedPrecision }
      : {}),
    ...document.metadata,
  }

  const { data: existingRow, error: readError } = await client
    .from('evidence')
    .select(
      'id, content_hash, first_seen_at, evidence_family_id, body_text, locator, ' +
        'evidence_excerpt, classification_status, extraction_status, evidence_locator',
    )
    .eq('source_id', input.sourceId)
    .eq('source_document_id', document.sourceDocumentId)
    .is('superseded_at', null)
    .maybeSingle()

  if (readError) throw new Error(`evidence lookup failed: ${describeDbError(readError)}`)
  const existing = (existingRow ?? null) as ExistingEvidenceRow | null

  if (existing && (retrieved.unchanged || existing.content_hash === retrieved.contentHash)) {
    /*
       SAME BYTES IS NOT THE SAME AS NOTHING TO DO.

       This used to move `last_seen_at` and nothing else, which is right when
       the stored row is already complete. It is wrong when it is not -- and the
       first successful SEC run produced exactly that: 39 rows with no text, no
       locator and `classification_status = 'unclassified'`, because the earlier
       FAILED run had already written the content hashes into
       `source_document_cache`. The retry saw "unchanged", skipped everything,
       and the 39 documents were frozen half-finished.

       So a re-observation now ENRICHES: it fills in what is missing and leaves
       alone what is not. It never touches identity -- `source_document_id`,
       `content_hash`, `first_seen_at` and the supersession columns are not in
       this update -- so deduplication and history are unaffected.
    */
    const enrichment: Record<string, unknown> = { last_seen_at: input.now }

    if (!existing.body_text && bodyText) enrichment.body_text = bodyText
    if (!existing.locator && officialUrl) enrichment.locator = officialUrl
    if (!existing.evidence_excerpt && input.excerpt) enrichment.evidence_excerpt = input.excerpt

    // A row that was never evaluated, or that a re-read now has something to
    // say about. `unclassified` means "not yet looked at", so it is always
    // worth replacing with a verdict.
    const wasUnevaluated = (existing.classification_status ?? 'unclassified') === 'unclassified'
    if (wasUnevaluated && input.classificationStatus !== 'unclassified') {
      enrichment.classification_status = input.classificationStatus
    }
    if (existing.extraction_status !== retrieved.extractionStatus && retrieved.extractedText) {
      enrichment.extraction_status = retrieved.extractionStatus
    }
    if (!existing.evidence_locator || Object.keys(existing.evidence_locator).length === 0) {
      enrichment.evidence_locator = locatorMetadata
    }

    const { error } = await client.from('evidence').update(enrichment).eq('id', existing.id)
    if (error) throw new Error(`evidence enrichment failed: ${describeDbError(error)}`)

    // More than `last_seen_at` moved, so the caller can report it and the
    // document can go on to the signal stage rather than being skipped.
    const enriched = Object.keys(enrichment).length > 1
    return {
      evidenceId: existing.id as string,
      created: false,
      superseded: false,
      unchanged: true,
      enriched,
    }
  }

  const row = {
    source_id: input.sourceId,
    source_run_id: input.sourceRunId,
    source_document_id: document.sourceDocumentId,
    connector_id: input.connectorId,
    connector_version: input.connectorVersion,
    original_url: document.url,
    resolved_url: retrieved.finalUrl,
    canonical_url: document.canonicalUrl,
    title: document.title.slice(0, 500),
    published_at: published.publishedAt,
    published_precision: published.precision,
    published_basis: published.basis,
    retrieved_at: retrieved.retrievedAt,
    content_hash: retrieved.contentHash,
    mime_type: retrieved.mimeType,
    byte_size: retrieved.bytes.byteLength,
    extraction_status: retrieved.extractionStatus,
    extraction_method: 'connector_text_extraction',
    extractor_version: PIPELINE_VERSION,
    transformation_version: PIPELINE_VERSION,
    evidence_excerpt: input.excerpt,
    // What the SOURCE stated about precision is kept here, because the
    // column's vocabulary has no sub-day member.
    evidence_locator: locatorMetadata,
    /*
       THE TEXT AND THE OFFICIAL URL.

       `body_text` holds the extracted filing text so a document can be
       re-classified without going back to SEC. Migration 0015 deliberately
       withholds it from the `authenticated` grant -- a reviewer sees
       `evidence_excerpt`, the matched window, which IS granted, alongside
       `locator`, the official document URL.

       `structured_primary` permits both. `evidence_reference_only_has_no_body`
       and `evidence_metadata_only_has_no_locator` bind the other two modes, and
       neither is weakened here.
    */
    body_text: bodyText,
    locator: officialUrl,
    access_mode: input.accessMode,
    data_sensitivity_class: 'public',
    classification_status: input.classificationStatus,
    review_status: 'unreviewed',
    first_seen_at: existing?.first_seen_at ?? input.now,
    last_seen_at: input.now,
    evidence_family_id: existing?.evidence_family_id ?? null,
  }

  // RETIRE FIRST, THEN INSERT, THEN LINK.
  //
  // The current-document index is keyed on `superseded_at`, so the old row has
  // to release the key before the new one can take it — and the pointer is a
  // foreign key, so it cannot be set until the new row exists. Marking the old
  // version retired first is what makes both possible without a window in
  // which two rows are current.
  if (existing) {
    const { error } = await client
      .from('evidence')
      .update({ superseded_at: input.now })
      .eq('id', existing.id)
    if (error) throw new Error(`retiring the prior version failed: ${describeDbError(error)}`)
  }

  const { data: inserted, error: insertError } = await client
    .from('evidence')
    .insert(row)
    .select('id')
    .single()

  if (insertError) {
    // Put the old row back the way it was, or a failed insert would leave the
    // document with NO current version at all.
    if (existing) {
      await client.from('evidence').update({ superseded_at: null }).eq('id', existing.id)
    }
    throw new Error(`evidence insert failed: ${describeDbError(insertError)}`)
  }
  const newId = inserted!.id as string

  if (existing) {
    // ADR 0012: the old row keeps its bytes, its hash and its dates, and gains
    // a pointer. Overwriting would destroy the record of what we acted on.
    const { error } = await client
      .from('evidence')
      .update({ superseded_by_evidence_id: newId })
      .eq('id', existing.id)
    if (error) throw new Error(`supersession link failed: ${describeDbError(error)}`)
    return { evidenceId: newId, created: true, superseded: true, unchanged: false }
  }

  return { evidenceId: newId, created: true, superseded: false, unchanged: false }
}

/**
 * A signal, keyed so the same announcement seen twice is one row.
 *
 * `independent_source_count` is incremented only when the corroborating
 * evidence comes from a DIFFERENT source. A filing and its own exhibit are one
 * source saying one thing twice, and counting them as two is how a system
 * talks itself into confidence it has not earned.
 */
export async function upsertSignal(
  client: SupabaseClient,
  input: {
    organizationId: string
    organizationEntityKey: string
    match: ClassificationMatch
    evidenceId: string
    sourceId: string
    eventDate: string | null
    title: string
    now: string
  },
): Promise<{ signalId: string; created: boolean }> {
  const key = clusterKey({
    organizationEntityKey: input.organizationEntityKey,
    family: input.match.family,
    eventDate: input.eventDate,
    matchedAsset: input.match.matchedAsset,
  })

  const { data: existing, error: readError } = await client
    .from('signals')
    .select('id, independent_source_count')
    .eq('organization_id', input.organizationId)
    .eq('cluster_key', key)
    .maybeSingle()
  if (readError) throw new Error(`signal lookup failed: ${readError.code ?? readError.message}`)

  let signalId: string
  let created = false

  if (existing) {
    signalId = existing.id as string
    const { data: linkedSources } = await client
      .from('signal_evidence')
      .select('source_family_key')
      .eq('signal_id', signalId)
    const distinct = new Set((linkedSources ?? []).map((r) => r.source_family_key as string))
    const isNewSource = !distinct.has(input.sourceId)
    const { error } = await client
      .from('signals')
      .update({
        last_observed_at: input.now,
        updated_at: input.now,
        independent_source_count: isNewSource
          ? ((existing.independent_source_count as number) ?? 1) + 1
          : ((existing.independent_source_count as number) ?? 1),
      })
      .eq('id', signalId)
    if (error) throw new Error(`signal update failed: ${error.code ?? error.message}`)
  } else {
    const { data: inserted, error } = await client
      .from('signals')
      .insert({
        organization_id: input.organizationId,
        title: input.title.slice(0, 300),
        summary: input.match.excerpt.slice(0, 2000),
        signal_family: input.match.family,
        event_type: input.match.eventType,
        event_date: input.eventDate ? input.eventDate.slice(0, 10) : null,
        event_date_precision: input.eventDate ? 'day' : null,
        event_date_basis: input.eventDate ? 'source_declared' : null,
        first_observed_at: input.now,
        last_observed_at: input.now,
        confidence: input.match.confidence,
        independent_source_count: 1,
        negative_signal: input.match.negative,
        cluster_key: key,
        // The reasoning travels with the record. A confidence with no
        // derivation is a number somebody will later mistake for a measurement.
        model_metadata: {
          derivedBy: `pipeline@${PIPELINE_VERSION}`,
          reasoning: input.match.reasoning,
          matchedAction: input.match.matchedAction,
          matchedAsset: input.match.matchedAsset,
          corroboration: input.match.corroboration,
          modelGenerated: false,
        },
      })
      .select('id')
      .single()
    if (error) throw new Error(`signal insert failed: ${error.code ?? error.message}`)
    signalId = inserted!.id as string
    created = true
  }

  // The evidence link is what makes the signal defensible. Upserted, so a
  // repeated run cannot fan one signal out across duplicate links.
  const { error: linkError } = await client.from('signal_evidence').upsert(
    {
      signal_id: signalId,
      evidence_id: input.evidenceId,
      evidence_role: 'primary',
      source_family_key: input.sourceId,
    },
    { onConflict: 'signal_id,evidence_id' },
  )
  if (linkError) throw new Error(`signal_evidence link failed: ${linkError.code ?? linkError.message}`)

  return { signalId, created }
}

/**
 * An opportunity, only where evidence supports one.
 *
 * A signal graded `possible` from a single source does not become an
 * opportunity. That is the whole difference between a radar and a keyword
 * alert: the bar for putting something in front of a business-development team
 * is that a person could read the evidence and agree.
 */
export async function upsertOpportunity(
  client: SupabaseClient,
  input: {
    organizationId: string
    organizationEntityKey: string
    signalId: string
    match: ClassificationMatch
    independentSourceCount: number
    eventDate: string | null
    now: string
  },
): Promise<{ opportunityId: string | null; created: boolean; suppressed: string | null }> {
  const supportsOpportunity =
    input.match.confidence === 'probable' ||
    input.match.confidence === 'confirmed' ||
    input.independentSourceCount >= 2

  if (!supportsOpportunity) {
    return {
      opportunityId: null,
      created: false,
      suppressed:
        'one source, graded possible — held as a signal until a second source or an analyst confirms it',
    }
  }

  const key = clusterKey({
    organizationEntityKey: input.organizationEntityKey,
    family: input.match.family,
    eventDate: input.eventDate,
    matchedAsset: input.match.matchedAsset,
  })

  const { data: existing, error: readError } = await client
    .from('opportunities')
    .select('id')
    .eq('organization_id', input.organizationId)
    .eq('opportunity_key', key)
    .maybeSingle()
  if (readError) throw new Error(`opportunity lookup failed: ${readError.code ?? readError.message}`)

  const title = `${humanFamily(input.match.family)} — ${input.match.matchedAsset}`

  if (existing) {
    const { error } = await client
      .from('opportunities')
      .update({ updated_at: input.now, last_material_change_at: input.now, derived_at: input.now })
      .eq('id', existing.id)
    if (error) throw new Error(`opportunity update failed: ${error.code ?? error.message}`)
    await linkOpportunitySignal(client, existing.id as string, input.signalId)
    return { opportunityId: existing.id as string, created: false, suppressed: null }
  }

  const { data: inserted, error } = await client
    .from('opportunities')
    .insert({
      organization_id: input.organizationId,
      opportunity_key: key,
      title: title.slice(0, 300),
      executive_summary: input.match.excerpt.slice(0, 1500),
      capability_alignment: [],
      // 'emerging' and 'new' are the vocabulary the schema actually defines.
      // A derived opportunity starts at the earliest stage and the untouched
      // status; nothing about a machine reading one document justifies more.
      stage: 'emerging',
      status: 'new',
      confidence: input.match.confidence,
      why_it_matters: input.match.reasoning,
      derived_by: `pipeline@${PIPELINE_VERSION}`,
      derived_at: input.now,
      last_material_change_at: input.now,
    })
    .select('id')
    .single()
  if (error) throw new Error(`opportunity insert failed: ${error.code ?? error.message}`)

  await linkOpportunitySignal(client, inserted!.id as string, input.signalId)
  return { opportunityId: inserted!.id as string, created: true, suppressed: null }
}

async function linkOpportunitySignal(
  client: SupabaseClient,
  opportunityId: string,
  signalId: string,
): Promise<void> {
  const { error } = await client
    .from('opportunity_signals')
    .upsert(
      { opportunity_id: opportunityId, signal_id: signalId, signal_role: 'primary' },
      { onConflict: 'opportunity_id,signal_id' },
    )
  if (error) throw new Error(`opportunity_signals link failed: ${error.code ?? error.message}`)
}

function humanFamily(family: string): string {
  return family.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

/* ------------------------------------------------------------- the pass */

export interface SourcePassResult {
  readonly sourceId: string
  readonly runStatus: 'success' | 'partial_success' | 'unchanged' | 'failure' | 'skipped'
  readonly healthStatus: string
  readonly counters: IngestionCounters
  readonly note: string
  readonly errors: readonly string[]
}

export async function runConnectorPass(
  client: SupabaseClient,
  connector: Connector,
  ctx: ConnectorContext,
  companies: readonly CompanyRow[],
  sourceRunId: string,
  concurrency: number,
): Promise<SourcePassResult> {
  const counters = emptyCounters()
  const errors: string[] = []
  const byEntityKey = new Map(companies.map((c) => [c.entity_key, c]))
  const now = ctx.now().toISOString()

  const discovery = await connector.discover(ctx)

  if (discovery.kind === 'unavailable') {
    return {
      sourceId: connector.sourceId,
      runStatus: 'failure',
      healthStatus: 'source_unavailable',
      counters,
      note: discovery.note,
      errors: [discovery.note],
    }
  }
  if (discovery.kind === 'manual_review_required') {
    return {
      sourceId: connector.sourceId,
      runStatus: 'skipped',
      healthStatus: 'manual_review_required',
      counters,
      note: discovery.note,
      errors: [],
    }
  }
  if (discovery.kind === 'unchanged') {
    return {
      sourceId: connector.sourceId,
      runStatus: 'unchanged',
      healthStatus: 'healthy',
      counters,
      // "Nothing was published" is a successful check, not a failure, and the
      // interface must be able to say so without implying a broken connector.
      note: discovery.note,
      errors: [],
    }
  }

  counters.documentsDiscovered = discovery.documents.length

  await mapWithLimit(discovery.documents, concurrency, async (document) => {
    const company = byEntityKey.get(document.organizationEntityKey)
    if (!company) {
      reject(counters, 'document is about a company outside the approved cohort')
      return
    }

    let retrieved: RetrievedDocument
    try {
      retrieved = await connector.retrieve(ctx, document)
      counters.documentsRetrieved += 1
    } catch (error) {
      // One document failing is one document failing. The other nineteen are
      // still worth having, and the run says partial rather than pretending.
      errors.push(`${document.sourceDocumentId}: ${error instanceof Error ? error.message : 'retrieval failed'}`)
      reject(counters, 'retrieval failed')
      return
    }

    if (retrieved.status >= 400) {
      reject(counters, `source answered HTTP ${retrieved.status}`)
      return
    }

    /*
       CLASSIFY WHENEVER THERE IS TEXT, EVEN IF THE BYTES ARE UNCHANGED.

       This used to skip classification entirely on `unchanged`, which is how 39
       SEC filings came to be stored as `unclassified` with no excerpt. The
       earlier FAILED run had already written their content hashes into
       `source_document_cache`; the retry fetched each document, saw a matching
       hash, declared it unchanged and never looked at the text it was holding.

       Unchanged bytes only mean the document did not change. It says nothing
       about whether WE have finished with it. The one case where there is
       genuinely nothing to read is a 304, where the body was never sent --
       there `extractedText` is null and the stored classification stands.
    */
    const classification = retrieved.extractedText
      ? classifyText(retrieved.extractedText)
      : { matches: [], rejectionReason: null }

    const status =
      classification.matches.length > 0
        ? 'candidate_signal'
        : retrieved.extractedText
          ? 'not_relevant'
          : 'unclassified'

    let write: EvidenceWriteResult
    try {
      write = await upsertEvidence(client, {
        sourceId: connector.sourceId,
        sourceRunId,
        connectorId: connector.id,
        connectorVersion: connector.version,
        document: retrieved.document,
        retrieved,
        excerpt: classification.matches[0]?.excerpt.slice(0, 2000) ?? null,
        classificationStatus: status,
        accessMode: 'structured_primary',
        now,
      })
    } catch (error) {
      errors.push(`${document.sourceDocumentId}: ${error instanceof Error ? error.message : 'write failed'}`)
      reject(counters, 'evidence write failed')
      return
    }

    if (write.unchanged) {
      counters.documentsUnchanged += 1
      counters.duplicatesPrevented += 1
      if (write.enriched) counters.documentsEnriched += 1

      /*
         AN ENRICHED ROW STILL HAS TO REACH THE SIGNAL STAGE.

         Returning here is right for a document we have already finished with,
         and wrong for one that has only just been classified. Without this, a
         rerun would fill in the text and the verdict and then stop, and the 39
         filings would never produce a signal however many times it ran.
      */
      if (classification.matches.length === 0) {
        if (retrieved.extractedText) {
          counters.documentsStoredWithoutSignal += 1
          bumpReason(counters, classification.rejectionReason ?? 'no qualifying signal in the document')
        }
        return
      }
    } else {
      counters.evidenceCreated += 1
      if (write.superseded) counters.evidenceSuperseded += 1

      if (classification.matches.length === 0) {
        /*
           STORED, EVALUATED, AND CARRYING NOTHING. That is not a rejection.

           This called `reject()`, so the first successful SEC run reported
           `evidenceCreated: 39` and `documentsRejected: 39` together -- which
           reads as "we stored 39 documents and threw all 39 away". Rejected now
           means NOT STORED.
        */
        counters.documentsStoredWithoutSignal += 1
        bumpReason(counters, classification.rejectionReason ?? 'no qualifying signal in the document')
        return
      }
    }
    counters.documentsAccepted += 1

    for (const match of classification.matches) {
      try {
        const eventDate = retrieved.document.publishedAt
        const signal = await upsertSignal(client, {
          organizationId: company.id,
          organizationEntityKey: company.entity_key,
          match,
          evidenceId: write.evidenceId,
          sourceId: connector.sourceId,
          eventDate,
          title: retrieved.document.title,
          now,
        })
        if (signal.created) counters.signalsCreated += 1
        else counters.signalsUpdated += 1

        const { data: signalRow } = await client
          .from('signals')
          .select('independent_source_count')
          .eq('id', signal.signalId)
          .maybeSingle()

        const opportunity = await upsertOpportunity(client, {
          organizationId: company.id,
          organizationEntityKey: company.entity_key,
          signalId: signal.signalId,
          match,
          independentSourceCount: (signalRow?.independent_source_count as number) ?? 1,
          eventDate,
          now,
        })
        if (opportunity.suppressed) counters.opportunitiesSuppressed += 1
        else if (opportunity.created) counters.opportunitiesCreated += 1
        else counters.opportunitiesUpdated += 1

        // The evidence is now doing work, and says so.
        await client
          .from('evidence')
          .update({ classification_status: 'supporting_evidence' })
          .eq('id', write.evidenceId)
      } catch (error) {
        errors.push(`${document.sourceDocumentId}: ${error instanceof Error ? error.message : 'derivation failed'}`)
      }
    }
  })

  const runStatus: SourcePassResult['runStatus'] =
    errors.length === 0
      ? counters.evidenceCreated === 0 && counters.documentsUnchanged > 0
        ? 'unchanged'
        : 'success'
      : counters.evidenceCreated > 0
        ? 'partial_success'
        : 'failure'

  return {
    sourceId: connector.sourceId,
    runStatus,
    healthStatus:
      runStatus === 'failure' ? 'source_unavailable' : runStatus === 'partial_success' ? 'degraded' : 'healthy',
    counters,
    note:
      runStatus === 'unchanged'
        ? 'Every document discovered was already held and unchanged.'
        : `${counters.evidenceCreated} evidence record(s) written from ${counters.documentsDiscovered} discovered.`,
    errors,
  }
}
