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
  documentsAccepted: number
  documentsRejected: number
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

export function emptyCounters(): IngestionCounters {
  return {
    documentsDiscovered: 0,
    documentsRetrieved: 0,
    documentsAccepted: 0,
    documentsRejected: 0,
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

function reject(counters: IngestionCounters, reason: string): void {
  counters.documentsRejected += 1
  counters.rejectionReasons[reason] = (counters.rejectionReasons[reason] ?? 0) + 1
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
export function normalizePublished(
  document: DiscoveredDocument,
): { publishedAt: string | null; precision: string | null; basis: string } {
  if (!document.publishedAt) {
    return { publishedAt: null, precision: null, basis: 'source_stated_none' }
  }
  return {
    publishedAt: document.publishedAt,
    precision: document.publishedPrecision ?? 'day',
    basis: 'source_declared',
  }
}

/* ---------------------------------------------------------------- write */

export interface EvidenceWriteResult {
  readonly evidenceId: string
  readonly created: boolean
  readonly superseded: boolean
  readonly unchanged: boolean
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

  const { data: existing, error: readError } = await client
    .from('evidence')
    .select('id, content_hash, first_seen_at, evidence_family_id')
    .eq('source_id', input.sourceId)
    .eq('source_document_id', document.sourceDocumentId)
    .is('superseded_at', null)
    .maybeSingle()

  if (readError) throw new Error(`evidence lookup failed: ${readError.code ?? readError.message}`)

  if (existing && (retrieved.unchanged || existing.content_hash === retrieved.contentHash)) {
    // The ONLY column a re-observation moves.
    const { error } = await client
      .from('evidence')
      .update({ last_seen_at: input.now })
      .eq('id', existing.id)
    if (error) throw new Error(`evidence touch failed: ${error.code ?? error.message}`)
    return { evidenceId: existing.id as string, created: false, superseded: false, unchanged: true }
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
    evidence_locator: { documentType: document.documentType, ...document.metadata },
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
    if (error) throw new Error(`retiring the prior version failed: ${error.code ?? error.message}`)
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
    throw new Error(`evidence insert failed: ${insertError.code ?? insertError.message}`)
  }
  const newId = inserted!.id as string

  if (existing) {
    // ADR 0012: the old row keeps its bytes, its hash and its dates, and gains
    // a pointer. Overwriting would destroy the record of what we acted on.
    const { error } = await client
      .from('evidence')
      .update({ superseded_by_evidence_id: newId })
      .eq('id', existing.id)
    if (error) throw new Error(`supersession link failed: ${error.code ?? error.message}`)
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

    const classification = retrieved.unchanged
      ? { matches: [], rejectionReason: null }
      : classifyText(retrieved.extractedText ?? '')

    const status =
      classification.matches.length > 0 ? 'candidate_signal' : retrieved.unchanged ? 'unclassified' : 'not_relevant'

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
      return
    }
    counters.evidenceCreated += 1
    if (write.superseded) counters.evidenceSuperseded += 1

    if (classification.matches.length === 0) {
      reject(counters, classification.rejectionReason ?? 'no qualifying signal in the document')
      return
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
