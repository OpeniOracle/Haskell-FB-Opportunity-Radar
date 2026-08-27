/**
 * The run lifecycle: what happened, recorded before, during and after.
 *
 * A run exists in the database BEFORE any request goes out, because a run that
 * only appears once it succeeds cannot explain a failure. It is keyed on
 * (source_id, collection_window_start), so a retried invocation collides with
 * the run already recorded instead of starting a second one, and a partial
 * unique index on `run_status = 'running'` makes a concurrent run impossible
 * rather than unlikely.
 *
 * SOURCE HEALTH IS DERIVED FROM RUNS, NOT ASSERTED. `sources.health_status` and
 * `last_success_at` are written from what the run actually did. Nothing else
 * may set them, which is what makes "as of" on the dashboard a fact rather than
 * a hopeful default.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { CachedValidator, Connector, ConnectorContext, DocumentCachePort } from './types.js'
import {
  RequestPacer,
  egressGetWithRetry,
  type EgressResult,
  type RetryingGetOptions,
} from '../egress.js'
import { runConnectorPass, type CompanyRow, type SourcePassResult } from './pipeline.js'
import { MARS_PACING, MARS_SOURCE_ID, marsConnector } from './mars.js'
import { SEC_PACING, SEC_SOURCE_ID, secConnector, type SecCompanyTarget } from './sec.js'

export class RunAlreadyActiveError extends Error {
  constructor(readonly sourceId: string) {
    super(`A run is already active for source "${sourceId}".`)
    this.name = 'RunAlreadyActiveError'
  }
}

/** Postgres unique-violation. The only way to know we lost the race. */
const UNIQUE_VIOLATION = '23505'

export function supabaseCache(client: SupabaseClient): DocumentCachePort {
  return {
    async read(sourceId, url) {
      const { data } = await client
        .from('source_document_cache')
        .select('etag, last_modified, content_hash, status')
        .eq('source_id', sourceId)
        .eq('request_url', url)
        .maybeSingle()
      if (!data) return null
      return {
        etag: (data.etag as string) ?? null,
        lastModified: (data.last_modified as string) ?? null,
        contentHash: (data.content_hash as string) ?? null,
        status: (data.status as number) ?? null,
      }
    },
    async write(sourceId, url, validator: CachedValidator) {
      // No validator, nothing worth storing — and the table's CHECK would
      // reject the row anyway.
      if (!validator.etag && !validator.lastModified && !validator.contentHash) return
      await client.from('source_document_cache').upsert(
        {
          source_id: sourceId,
          request_url: url,
          etag: validator.etag,
          last_modified: validator.lastModified,
          content_hash: validator.contentHash,
          status: validator.status,
          fetched_at: new Date().toISOString(),
        },
        { onConflict: 'source_id,request_url' },
      )
    },
  }
}

export async function openRun(
  client: SupabaseClient,
  sourceId: string,
  window: { start: string; end: string },
): Promise<{ runId: string; resumed: boolean }> {
  const { data: existing } = await client
    .from('source_runs')
    .select('id, run_status')
    .eq('source_id', sourceId)
    .eq('collection_window_start', window.start)
    .maybeSingle()

  if (existing) {
    if (existing.run_status === 'running') throw new RunAlreadyActiveError(sourceId)
    // Re-running a completed window is legitimate — that is what a retry after
    // a failure IS — and it reuses the same logical run rather than forking one.
    const { error } = await client
      .from('source_runs')
      .update({ run_status: 'running', status: 'running', started_at: new Date().toISOString() })
      .eq('id', existing.id)
    if (error) {
      if (error.code === UNIQUE_VIOLATION) throw new RunAlreadyActiveError(sourceId)
      throw new Error(`could not reopen run: ${error.code ?? error.message}`)
    }
    return { runId: existing.id as string, resumed: true }
  }

  const { data, error } = await client
    .from('source_runs')
    .insert({
      source_id: sourceId,
      status: 'running',
      run_status: 'running',
      started_at: new Date().toISOString(),
      collection_window_start: window.start,
      collection_window_end: window.end,
    })
    .select('id')
    .single()

  if (error) {
    if (error.code === UNIQUE_VIOLATION) throw new RunAlreadyActiveError(sourceId)
    throw new Error(`could not open run: ${error.code ?? error.message}`)
  }
  return { runId: data!.id as string, resumed: false }
}

export async function closeRun(
  client: SupabaseClient,
  runId: string,
  sourceId: string,
  result: SourcePassResult,
): Promise<void> {
  const now = new Date().toISOString()
  const c = result.counters

  await client
    .from('source_runs')
    .update({
      status: result.runStatus === 'failure' ? 'failed' : result.runStatus,
      run_status: result.runStatus,
      completed_at: now,
      discovered_count: c.documentsDiscovered,
      fetched_count: c.documentsRetrieved,
      extracted_count: c.evidenceCreated,
      rejected_count: c.documentsRejected,
      duplicate_count: c.duplicatesPrevented,
      items_seen: c.documentsDiscovered,
      items_stored: c.evidenceCreated,
      error_summary: result.errors.length > 0 ? result.errors.slice(0, 5).join('; ').slice(0, 1000) : null,
      error_code: result.runStatus === 'failure' ? 'connector_failure' : null,
      metrics: {
        ...c,
        note: result.note,
        errorCount: result.errors.length,
      },
    })
    .eq('id', runId)

  const { data: source } = await client
    .from('sources')
    .select('health_status')
    .eq('id', sourceId)
    .maybeSingle()
  const prior = (source?.health_status as string) ?? null

  const sourceUpdate: Record<string, unknown> = { health_status: result.healthStatus, updated_at: now }
  // ONLY a run that actually retrieved something moves last_success_at. A
  // "nothing new" run is a successful check and keeps the timestamp current;
  // a failure must never advance it, or the dashboard reports fresh data it
  // does not have.
  if (result.runStatus === 'success' || result.runStatus === 'unchanged' || result.runStatus === 'partial_success') {
    sourceUpdate.last_success_at = now
    sourceUpdate.consecutive_failures = 0
  } else {
    const { data: current } = await client
      .from('sources')
      .select('consecutive_failures')
      .eq('id', sourceId)
      .maybeSingle()
    sourceUpdate.consecutive_failures = ((current?.consecutive_failures as number) ?? 0) + 1
  }
  await client.from('sources').update(sourceUpdate).eq('id', sourceId)

  if (prior !== result.healthStatus) {
    await client.from('source_health_events').insert({
      source_id: sourceId,
      source_run_id: runId,
      prior_status: prior,
      new_status: result.healthStatus,
      event_type: result.runStatus === 'failure' ? 'failure' : 'status_change',
      summary: result.note.slice(0, 1000),
      coverage_impact: { runStatus: result.runStatus, documentsAccepted: c.documentsAccepted },
      action_required:
        result.healthStatus === 'manual_review_required'
          ? { action: 'operator_import', detail: result.note.slice(0, 500) }
          : null,
    })
  }
}

export interface RunOptions {
  readonly window: { start: string; end: string }
  readonly userAgent: string
  readonly allowlist: readonly string[]
  readonly log: (message: string) => void
  /** Injected by tests. Production uses the real gateway. */
  readonly transport?: (url: string, options: RetryingGetOptions) => Promise<EgressResult>
  readonly now?: () => Date
  readonly onlySources?: readonly string[]
}

export function buildConnectors(
  companies: readonly CompanyRow[],
  configBySource: Readonly<Record<string, Record<string, unknown>>>,
): Connector[] {
  const secTargets: SecCompanyTarget[] = companies
    .filter((c) => c.entity_key.startsWith('sec:'))
    .map((c) => ({
      entityKey: c.entity_key,
      canonicalName: c.canonical_name,
      // The seeded key is a CROSS-CHECK. resolveCikFromTickerFile throws on a
      // mismatch rather than preferring either value.
      expectedCik: c.entity_key.slice('sec:'.length),
      tickerHint: configBySource[SEC_SOURCE_ID]?.[`ticker:${c.entity_key}`] as string | undefined,
    }))

  const connectors: Connector[] = []
  if (secTargets.length > 0) connectors.push(secConnector(secTargets))
  if (companies.some((c) => c.entity_key === 'radar:mars-incorporated')) connectors.push(marsConnector())
  return connectors
}

export function pacingFor(sourceId: string): { minIntervalMs: number; concurrency: number } {
  return sourceId === MARS_SOURCE_ID ? MARS_PACING : SEC_PACING
}

/**
 * One collection across every enabled source. Returns a per-source report.
 *
 * A source that throws is caught HERE rather than aborting the cohort: Mars
 * being unreachable is not a reason to skip PepsiCo's filings, and a run that
 * marks the whole cohort failed because of one source is a run that teaches
 * operators to ignore it.
 */
export async function runIngestion(
  client: SupabaseClient,
  options: RunOptions,
): Promise<SourcePassResult[]> {
  const now = options.now ?? (() => new Date())

  const { data: companyRows, error: companyError } = await client
    .from('organizations')
    .select('id, entity_key, canonical_name')
    .in('entity_key', ['sec:0000077476', 'sec:0000100493', 'radar:mars-incorporated'])
  if (companyError) throw new Error(`cohort unreadable: ${companyError.code ?? companyError.message}`)
  const companies = (companyRows ?? []) as CompanyRow[]

  const { data: sourceRows, error: sourceError } = await client
    .from('sources')
    .select('id, enabled, connector_config')
    .eq('enabled', true)
  if (sourceError) throw new Error(`sources unreadable: ${sourceError.code ?? sourceError.message}`)

  const enabled = new Set((sourceRows ?? []).map((r) => r.id as string))
  const configBySource: Record<string, Record<string, unknown>> = {}
  for (const row of sourceRows ?? []) {
    configBySource[row.id as string] = (row.connector_config as Record<string, unknown>) ?? {}
  }

  const cache = supabaseCache(client)
  const results: SourcePassResult[] = []

  for (const connector of buildConnectors(companies, configBySource)) {
    if (!enabled.has(connector.sourceId)) {
      options.log(`[ingest] ${connector.sourceId} is not enabled; skipped`)
      continue
    }
    if (options.onlySources && !options.onlySources.includes(connector.sourceId)) continue

    // THE ALLOWLIST IS A CONTROL, SO A MISSING ENTRY IS A CONFIGURATION FAULT,
    // NOT SOMETHING TO PAPER OVER. Merging the connector's own hosts in here
    // would mean any connector could grant itself egress, which is the exact
    // property ADR 0002 exists to prevent. Instead the source fails with a
    // message naming the host to add.
    const missingHosts = connector.hosts.filter(
      (host) => !options.allowlist.some((entry) => host === entry || host.endsWith(`.${entry}`)),
    )
    if (missingHosts.length > 0) {
      const note =
        `EGRESS_ALLOWLIST does not permit ${missingHosts.join(', ')}. ` +
        'Add the host to the allowlist; the connector will not grant itself egress.'
      options.log(`[ingest] ${connector.sourceId}: ${note}`)
      results.push({
        sourceId: connector.sourceId,
        runStatus: 'failure',
        healthStatus: 'action_required',
        counters: { ...emptyCountersRef() },
        note,
        errors: [note],
      })
      continue
    }

    const pacing = pacingFor(connector.sourceId)
    let runId: string | null = null
    try {
      const opened = await openRun(client, connector.sourceId, options.window)
      runId = opened.runId

      const ctx: ConnectorContext = {
        userAgent: options.userAgent,
        allowlist: options.allowlist,
        get: (url, overrides) =>
          (options.transport ?? egressGetWithRetry)(url, {
            userAgent: options.userAgent,
            allowlist: options.allowlist,
            ...overrides,
          } as RetryingGetOptions),
        pacer: new RequestPacer(pacing.minIntervalMs),
        cache,
        now,
        config: configBySource[connector.sourceId] ?? {},
        window: options.window,
        log: options.log,
      }

      const result = await runConnectorPass(client, connector, ctx, companies, runId, pacing.concurrency)
      await closeRun(client, runId, connector.sourceId, result)
      results.push(result)
    } catch (error) {
      if (error instanceof RunAlreadyActiveError) {
        options.log(`[ingest] ${connector.sourceId}: a run is already active; this invocation stands down`)
        results.push({
          sourceId: connector.sourceId,
          runStatus: 'skipped',
          healthStatus: 'healthy',
          counters: { ...emptyCountersRef() },
          note: 'A run was already active for this source. Overlapping runs are refused by the database.',
          errors: [],
        })
        continue
      }
      const message = error instanceof Error ? error.message : 'unknown failure'
      options.log(`[ingest] ${connector.sourceId} failed: ${message}`)
      const failure: SourcePassResult = {
        sourceId: connector.sourceId,
        runStatus: 'failure',
        healthStatus: 'source_unavailable',
        counters: { ...emptyCountersRef() },
        note: message,
        errors: [message],
      }
      if (runId) await closeRun(client, runId, connector.sourceId, failure)
      results.push(failure)
    }
  }

  return results
}

function emptyCountersRef() {
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
    rejectionReasons: {} as Record<string, number>,
  }
}
