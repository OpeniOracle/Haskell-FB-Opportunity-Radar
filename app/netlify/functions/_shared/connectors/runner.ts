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
 *
 * A RUN IS HELD UNDER A LEASE, AND THE LEASE IS RENEWED BY A HEARTBEAT.
 *
 * The partial unique index makes overlap impossible, and on its own it also
 * made recovery impossible. On 2026-09-14 an operator run collected SEC and then
 * Mars inside one synchronous invocation. Netlify ends a synchronous function at
 * 60 seconds (a scheduled one at 30), and the invocation was ended about 59
 * seconds in, after Mars had written 53 rows and before it could close its run.
 * The row stayed `running` for a month. Every later run collided with it, was
 * reported as "skipped" with health `healthy`, and wrote nothing down. A source
 * that never once completed read as healthy on the dashboard.
 *
 * So the holder of a run now writes a heartbeat into `source_runs.checkpoint`
 * as it works, and every write that closes or renews the run is a COMPARE AND
 * SET against the exact checkpoint the holder last wrote:
 *
 *   - A run whose last heartbeat (or, with none, whose start) is older than the
 *     lease is ABANDONED: the invocation holding it has ended, because no
 *     Netlify function runs anywhere near that long. It is closed as a failure
 *     with `error_code = 'abandoned'`, a health event is written, and the
 *     source's health stops claiming anything good about it.
 *   - A run with a recent heartbeat is ACTIVE. It is never abandoned on age
 *     alone, because the heartbeat is direct evidence that its holder is alive.
 *     The new invocation stands down, and says so in `source_health_events`.
 *   - The abandonment is conditional on the checkpoint not having moved since it
 *     was read. A holder that renews its heartbeat in the gap wins, and the
 *     abandonment matches no row.
 *   - A holder that finds its run taken away (its renewal or its close matches
 *     no row) stops, and does NOT overwrite the outcome the recovery recorded.
 *
 * No migration is needed. `checkpoint` has existed since the baseline schema and
 * nothing else writes it; `failed`/`failure`, `degraded` and `action_required`
 * are already in their constraints' vocabularies; `source_health_events.event_type`
 * is free text.
 */
import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { CachedValidator, Connector, ConnectorContext, DocumentCachePort } from './types.js'
import {
  RequestPacer,
  egressGetWithRetry,
  type EgressResult,
  type RetryingGetOptions,
} from '../egress.js'
import {
  describeDbError,
  emptyCounters,
  runConnectorPass,
  type CompanyRow,
  type SourceAccessInput,
  type SourcePassResult,
} from './pipeline.js'
import { MARS_PACING, MARS_SOURCE_ID, marsConnector } from './mars.js'
import { SEC_PACING, SEC_SOURCE_ID, secConnector, type SecCompanyTarget } from './sec.js'

export class RunAlreadyActiveError extends Error {
  constructor(readonly sourceId: string) {
    super(`A run is already active for source "${sourceId}".`)
    this.name = 'RunAlreadyActiveError'
  }
}

/**
 * The run this invocation was working under is no longer its own: a recovery
 * judged it abandoned and closed it. The holder must stop writing.
 */
export class RunLeaseLostError extends Error {
  constructor(
    readonly sourceId: string,
    readonly runId: string,
  ) {
    super(
      `The run ${runId} for source "${sourceId}" is no longer held by this invocation; ` +
        'it was closed by a recovery. Nothing further was written for it.',
    )
    this.name = 'RunLeaseLostError'
  }
}

/** Postgres unique-violation. The only way to know we lost the race. */
const UNIQUE_VIOLATION = '23505'

/* ------------------------------------------------------------------ lease */

/**
 * How long a run may go without a heartbeat before it is presumed abandoned.
 *
 * The longest any Netlify function can run is fifteen minutes (a background
 * function); the functions that collect today are limited to 30 seconds
 * (scheduled) and 60 seconds (synchronous). A run silent for fifteen minutes
 * therefore has no living holder under any function type this application
 * could adopt. The bounds stop a mistyped override from either abandoning live
 * runs (too short) or recreating the month-long stall (too long).
 */
export const RUN_LEASE_DEFAULT_MS = 15 * 60_000
export const RUN_LEASE_MIN_MS = 2 * 60_000
export const RUN_LEASE_MAX_MS = 6 * 60 * 60_000

/** The longest a holder lets pass between two heartbeat writes. */
export const HEARTBEAT_INTERVAL_MS = 5_000

export function boundedLeaseMs(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested)) return RUN_LEASE_DEFAULT_MS
  return Math.min(RUN_LEASE_MAX_MS, Math.max(RUN_LEASE_MIN_MS, Math.trunc(requested)))
}

/** What a holder has most recently written, and is therefore the CAS value. */
export interface RunLease {
  readonly runId: string
  readonly sourceId: string
  readonly holder: string
  checkpoint: string
  lastBeatMs: number
}

/**
 * The checkpoint text a holder writes: `lease|<holder>|<heartbeat instant>`.
 *
 * Deliberately not JSON. Every renewal and every close compares this exact
 * string in a PostgREST `eq` filter, and a value free of quotes, braces and
 * commas is one that no layer between here and PostgreSQL has any reason to
 * reinterpret.
 */
const LEASE_PREFIX = 'lease|'

export function leaseCheckpoint(holder: string, at: Date): string {
  return `${LEASE_PREFIX}${holder}|${at.toISOString()}`
}

/**
 * When a run last showed signs of life: its last heartbeat, or its start when
 * it never wrote one (every run opened before this change, including the one
 * stalled since 2026-09-14). Null only when neither can be read, which is
 * treated as abandoned rather than as alive -- a run with no evidence of
 * activity has none.
 */
export function lastActivityOf(row: {
  started_at: string | null
  checkpoint: string | null
}): Date | null {
  if (row.checkpoint?.startsWith(LEASE_PREFIX)) {
    const beat = row.checkpoint.split('|')[2]
    if (beat) {
      const at = new Date(beat)
      if (!Number.isNaN(at.getTime())) return at
    }
    // Not a readable lease. Fall back to the start time.
  }
  if (row.started_at) {
    const at = new Date(row.started_at)
    if (!Number.isNaN(at.getTime())) return at
  }
  return null
}

/**
 * Renew the lease. Throttled to one write per interval, and conditional on the
 * checkpoint being exactly what this holder last wrote: if a recovery has
 * closed the run meanwhile, nothing matches and the holder learns it has lost
 * the run instead of carrying on writing under it.
 */
export async function heartbeat(
  client: SupabaseClient,
  lease: RunLease,
  now: Date,
  intervalMs: number = HEARTBEAT_INTERVAL_MS,
): Promise<void> {
  if (now.getTime() - lease.lastBeatMs < intervalMs) return
  const next = leaseCheckpoint(lease.holder, now)
  const { data, error } = await client
    .from('source_runs')
    .update({ checkpoint: next })
    .eq('id', lease.runId)
    .eq('run_status', 'running')
    .eq('checkpoint', lease.checkpoint)
    .select('id')
  if (error) throw new Error(`run heartbeat failed: ${describeDbError(error)}`)
  if (!data || data.length === 0) throw new RunLeaseLostError(lease.sourceId, lease.runId)
  lease.checkpoint = next
  lease.lastBeatMs = now.getTime()
}

/* ------------------------------------------------------------------ cache */

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
      // reject the row anyway. The validator type carries no document text,
      // so the cache can never hold content whatever the source's access mode.
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

/* ------------------------------------------------------------ source health */

/**
 * One checked write path for source health and its event history.
 *
 * `closeRun` used to issue these writes and ignore every error, so a refused
 * health update left the dashboard showing the previous state with nothing to
 * say the write had failed -- the SEC recovery on 2026-09-14 has no health
 * event for exactly that kind of reason. Every write here returns its error,
 * and the caller reports it.
 *
 *   outcome 'complete'  advances last_success_at, resets consecutive_failures
 *   outcome 'partial'   changes neither: the source was reached, but not all
 *                       of what was discovered was checked
 *   outcome 'failure'   increments consecutive_failures, never moves last_success_at
 *   outcome 'none'      changes neither -- a skip is not a collection
 *
 * WHAT `sources.last_success_at` MEANS, exactly: the completion time of the
 * most recent run that finished EVERY document it discovered in its window
 * (`success` or `unchanged`). A run that stopped early -- because a document
 * failed, or because the invocation's time budget ran out and the rest was
 * deferred -- did not check the whole source, and so cannot be the moment the
 * source was last known to be current. It used to be: `partial_success`
 * advanced this timestamp, so a run that checked 13 of 53 pages would have
 * read on the dashboard as a fresh, complete collection.
 */
export async function recordSourceOutcome(
  client: SupabaseClient,
  input: {
    sourceId: string
    runId: string | null
    /** Null leaves `health_status` as it is. */
    healthStatus: string | null
    /**
     * Derive the health from the failure streak AFTER this outcome is counted.
     * Used for abandonment, where one occurrence is a degradation and a repeat
     * needs a person.
     */
    escalate?: (consecutiveFailures: number) => string
    outcome: 'complete' | 'partial' | 'failure' | 'none'
    now: string
    event: {
      type: string
      summary: string
      coverageImpact: Record<string, unknown> | null
      actionRequired: Record<string, unknown> | null
      /** Write the event even when the status does not change. */
      always: boolean
    }
  },
): Promise<{ healthStatus: string | null; errors: string[] }> {
  const errors: string[] = []

  const { data: source, error: readError } = await client
    .from('sources')
    .select('health_status, consecutive_failures')
    .eq('id', input.sourceId)
    .maybeSingle()
  if (readError) {
    errors.push(`source health read failed: ${describeDbError(readError)}`)
    return { healthStatus: null, errors }
  }
  if (!source) {
    errors.push(`source "${input.sourceId}" is not registered; its health could not be recorded`)
    return { healthStatus: null, errors }
  }
  const prior = (source.health_status as string) ?? null
  const priorFailures = (source.consecutive_failures as number) ?? 0
  const failures =
    input.outcome === 'failure' ? priorFailures + 1 : input.outcome === 'complete' ? 0 : priorFailures

  const next = input.escalate ? input.escalate(failures) : (input.healthStatus ?? prior)

  const update: Record<string, unknown> = { updated_at: input.now }
  if (next !== prior) update.health_status = next
  if (input.outcome === 'complete') {
    update.last_success_at = input.now
    update.consecutive_failures = 0
  } else if (input.outcome === 'failure') {
    update.consecutive_failures = failures
  }

  let stored = prior
  if (Object.keys(update).length > 1) {
    const { data: written, error } = await client
      .from('sources')
      .update(update)
      .eq('id', input.sourceId)
      .select('id')
    if (error) errors.push(`source health update failed: ${describeDbError(error)}`)
    else if (!written || written.length === 0) {
      errors.push(`source health update matched no row for "${input.sourceId}"`)
    } else {
      stored = next
    }
  }

  if (input.event.always || next !== prior) {
    const { error } = await client.from('source_health_events').insert({
      source_id: input.sourceId,
      source_run_id: input.runId,
      prior_status: prior,
      new_status: next,
      event_type: input.event.type,
      summary: input.event.summary.slice(0, 1000),
      coverage_impact: input.event.coverageImpact,
      action_required: input.event.actionRequired,
    })
    if (error) errors.push(`source health event insert failed: ${describeDbError(error)}`)
  }

  // What the database holds, not what was intended: a refused update leaves
  // the prior value in place, and reporting `next` would repeat the original
  // defect of asserting a health nobody recorded.
  return { healthStatus: stored, errors }
}

/* -------------------------------------------------------------- recovery */

export type StaleRunCheck =
  | { readonly kind: 'none' }
  | { readonly kind: 'active'; readonly runId: string; readonly lastActivity: string | null }
  | { readonly kind: 'contended'; readonly runId: string }
  | {
      readonly kind: 'recovered'
      readonly runId: string
      readonly lastActivity: string | null
      readonly healthStatus: string | null
      readonly errors: readonly string[]
    }

/** Health after an abandonment: one is a degradation, a repeat needs a person. */
export function healthAfterAbandonment(consecutiveFailures: number): string {
  return consecutiveFailures >= 2 ? 'action_required' : 'degraded'
}

/**
 * Find the source's running run, if any, and close it if its holder is gone.
 *
 * At most one row can be `running` per source (the partial unique index). The
 * close is a compare-and-set on the id, the status and the checkpoint exactly
 * as read, so it cannot close a run that was renewed or reopened after the
 * read: every renewal and every reopen writes a new checkpoint, and a run
 * opened before leases existed has a NULL one that only a renewal or a reopen
 * could change. Two invocations recovering at once both issue it; exactly one
 * matches the row, and only that one writes the health event.
 */
export async function recoverStaleRun(
  client: SupabaseClient,
  sourceId: string,
  now: Date,
  leaseMs: number,
): Promise<StaleRunCheck> {
  const { data: running, error: readError } = await client
    .from('source_runs')
    .select('id, started_at, checkpoint')
    .eq('source_id', sourceId)
    .eq('run_status', 'running')
    .maybeSingle()
  if (readError) throw new Error(`active run lookup failed: ${describeDbError(readError)}`)
  if (!running) return { kind: 'none' }

  const runId = running.id as string
  const startedAt = (running.started_at as string | null) ?? null
  const checkpoint = (running.checkpoint as string | null) ?? null
  const lastActivity = lastActivityOf({ started_at: startedAt, checkpoint })

  if (lastActivity && now.getTime() - lastActivity.getTime() < leaseMs) {
    return { kind: 'active', runId, lastActivity: lastActivity.toISOString() }
  }

  const silence = lastActivity
    ? `no heartbeat since ${lastActivity.toISOString()}`
    : 'no readable start time or heartbeat'
  const summary =
    `Run abandoned: ${silence}, longer than the ${Math.round(leaseMs / 60_000)}-minute lease. ` +
    'The invocation holding it ended without closing it. Documents it stored before ending are kept.'

  let close = client
    .from('source_runs')
    .update({
      status: 'failed',
      run_status: 'failure',
      completed_at: now.toISOString(),
      error_code: 'abandoned',
      error_summary: summary,
    })
    .eq('id', runId)
    .eq('run_status', 'running')
  close = checkpoint === null ? close.is('checkpoint', null) : close.eq('checkpoint', checkpoint)
  const { data: closed, error: closeError } = await close.select('id')

  if (closeError) throw new Error(`abandoning the stalled run failed: ${describeDbError(closeError)}`)
  if (!closed || closed.length === 0) {
    // The holder renewed, or another recovery got there first. Either way the
    // row is no longer what was judged abandoned, and this invocation stands
    // down rather than acting on a stale read.
    return { kind: 'contended', runId }
  }

  const health = await recordSourceOutcome(client, {
    sourceId,
    runId,
    healthStatus: null,
    escalate: healthAfterAbandonment,
    outcome: 'failure',
    now: now.toISOString(),
    event: {
      type: 'run_abandoned',
      summary,
      coverageImpact: { runStatus: 'failure', reason: 'abandoned' },
      actionRequired: null,
      always: true,
    },
  })

  return {
    kind: 'recovered',
    runId,
    lastActivity: lastActivity?.toISOString() ?? null,
    healthStatus: health.healthStatus,
    errors: health.errors,
  }
}

/* -------------------------------------------------------------- open/close */

export async function openRun(
  client: SupabaseClient,
  sourceId: string,
  window: { start: string; end: string },
  now: Date = new Date(),
  holder: string = randomUUID(),
): Promise<{ runId: string; resumed: boolean; lease: RunLease }> {
  const checkpoint = leaseCheckpoint(holder, now)
  const lease = (runId: string): RunLease => ({
    runId,
    sourceId,
    holder,
    checkpoint,
    lastBeatMs: now.getTime(),
  })

  const { data: existing, error: readError } = await client
    .from('source_runs')
    .select('id, run_status')
    .eq('source_id', sourceId)
    .eq('collection_window_start', window.start)
    .maybeSingle()
  if (readError) throw new Error(`run lookup failed: ${describeDbError(readError)}`)

  if (existing) {
    if (existing.run_status === 'running') throw new RunAlreadyActiveError(sourceId)
    // Re-running a completed window is legitimate — that is what a retry after
    // a failure IS — and it reuses the same logical run rather than forking one.
    // Conditional on the row not having been reopened by someone else since
    // the read; the partial unique index backs that up.
    const { data: reopened, error } = await client
      .from('source_runs')
      .update({
        run_status: 'running',
        status: 'running',
        started_at: now.toISOString(),
        checkpoint,
      })
      .eq('id', existing.id)
      .neq('run_status', 'running')
      .select('id')
    if (error) {
      if (error.code === UNIQUE_VIOLATION) throw new RunAlreadyActiveError(sourceId)
      throw new Error(`could not reopen run: ${describeDbError(error)}`)
    }
    if (!reopened || reopened.length === 0) throw new RunAlreadyActiveError(sourceId)
    return { runId: existing.id as string, resumed: true, lease: lease(existing.id as string) }
  }

  const { data, error } = await client
    .from('source_runs')
    .insert({
      source_id: sourceId,
      status: 'running',
      run_status: 'running',
      started_at: now.toISOString(),
      checkpoint,
      collection_window_start: window.start,
      collection_window_end: window.end,
    })
    .select('id')
    .single()

  if (error) {
    if (error.code === UNIQUE_VIOLATION) throw new RunAlreadyActiveError(sourceId)
    throw new Error(`could not open run: ${describeDbError(error)}`)
  }
  return { runId: data!.id as string, resumed: false, lease: lease(data!.id as string) }
}

export interface CloseOutcome {
  /** False when the run was no longer this holder's: nothing was written. */
  readonly closed: boolean
  readonly healthStatus: string | null
  readonly errors: readonly string[]
}

export async function closeRun(
  client: SupabaseClient,
  lease: RunLease,
  result: SourcePassResult,
  now: Date = new Date(),
): Promise<CloseOutcome> {
  const at = now.toISOString()
  const c = result.counters

  const { data: closed, error: closeError } = await client
    .from('source_runs')
    .update({
      status: result.runStatus === 'failure' ? 'failed' : result.runStatus,
      run_status: result.runStatus,
      completed_at: at,
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
    .eq('id', lease.runId)
    .eq('run_status', 'running')
    .eq('checkpoint', lease.checkpoint)
    .select('id')

  if (closeError) {
    // The run row could not be closed. Source health is left alone rather than
    // advanced past a run whose outcome is not recorded.
    return {
      closed: false,
      healthStatus: null,
      errors: [`closing the run failed: ${describeDbError(closeError)}`],
    }
  }
  if (!closed || closed.length === 0) {
    // A recovery took the run while this holder was still working. Its record
    // of the abandonment stands; overwriting it with this invocation's outcome
    // would erase the fact that the run was presumed dead.
    return { closed: false, healthStatus: null, errors: [new RunLeaseLostError(lease.sourceId, lease.runId).message] }
  }

  // ONLY a run that checked everything it discovered moves last_success_at. A
  // "nothing new" run is a complete check and keeps the timestamp current. A
  // partial run -- a document failed, or the rest was deferred -- reached the
  // source but did not cover it, so it moves neither the timestamp nor the
  // failure count. A failure never advances it, or the dashboard reports fresh
  // data it does not have.
  const outcome =
    result.runStatus === 'success' || result.runStatus === 'unchanged'
      ? 'complete'
      : result.runStatus === 'partial_success'
        ? 'partial'
        : 'failure'
  const health = await recordSourceOutcome(client, {
    sourceId: lease.sourceId,
    runId: lease.runId,
    healthStatus: result.healthStatus,
    outcome,
    now: at,
    event: {
      type: result.runStatus === 'failure' ? 'failure' : 'status_change',
      summary: result.note,
      coverageImpact: {
        runStatus: result.runStatus,
        documentsAccepted: c.documentsAccepted,
        documentsDeferred: c.documentsDeferred,
        // Said outright, so nobody reading the event has to infer it.
        coveredWholeWindow: outcome === 'complete',
      },
      actionRequired:
        result.healthStatus === 'manual_review_required'
          ? { action: 'operator_import', detail: result.note.slice(0, 500) }
          : null,
      always: false,
    },
  })
  return { closed: true, healthStatus: health.healthStatus, errors: health.errors }
}

/* ------------------------------------------------------------------ the run */

export interface RunOptions {
  readonly window: { start: string; end: string }
  readonly userAgent: string
  readonly allowlist: readonly string[]
  readonly log: (message: string) => void
  /** Injected by tests. Production uses the real gateway. */
  readonly transport?: (url: string, options: RetryingGetOptions) => Promise<EgressResult>
  readonly now?: () => Date
  readonly onlySources?: readonly string[]
  /** Abandonment threshold; bounded by `boundedLeaseMs`. */
  readonly leaseMs?: number
  /**
   * Absolute time (epoch ms) after which no new source is started and no new
   * document is begun. Set by the entry point from its platform limit, so the
   * invocation closes its runs instead of being ended mid-write.
   */
  readonly deadlineMs?: number
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
 * The deadline for the next source: an equal share of the time left, so
 * whatever an earlier source did not use rolls over to the ones after it.
 *
 * It bounds when a source stops STARTING documents. A single request already in
 * flight, or a connector's discovery walk, is not interrupted -- which is why
 * the invocation-wide deadline also stops a source from starting at all.
 */
export function fairShareDeadline(
  nowMs: number,
  deadlineMs: number | undefined,
  remainingSources: number,
): number | undefined {
  if (deadlineMs === undefined) return undefined
  return nowMs + Math.max(0, deadlineMs - nowMs) / Math.max(1, remainingSources)
}

/** A result for a source that was not collected, with nothing counted. */
function notCollected(
  sourceId: string,
  runStatus: SourcePassResult['runStatus'],
  healthStatus: string,
  note: string,
  errors: readonly string[],
): SourcePassResult {
  return { sourceId, runStatus, healthStatus, counters: emptyCounters(), note, errors }
}

/**
 * A skip, written down. The health is left as it was -- a concurrent
 * invocation is not a collection failure -- and the result reports the health
 * the database actually holds, never an assumed `healthy`.
 */
async function recordSkip(
  client: SupabaseClient,
  sourceId: string,
  runId: string | null,
  eventType: string,
  note: string,
  now: Date,
  log: (message: string) => void,
): Promise<SourcePassResult> {
  const recorded = await recordSourceOutcome(client, {
    sourceId,
    runId,
    healthStatus: null,
    outcome: 'none',
    now: now.toISOString(),
    event: {
      type: eventType,
      summary: note,
      coverageImpact: { runStatus: 'skipped', collected: false },
      actionRequired: null,
      always: true,
    },
  })
  for (const e of recorded.errors) log(`[ingest] ${sourceId}: ${e}`)
  return notCollected(sourceId, 'skipped', recorded.healthStatus ?? 'unknown', note, recorded.errors)
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
  const leaseMs = boundedLeaseMs(options.leaseMs)
  const deadlineReached = () => options.deadlineMs !== undefined && now().getTime() >= options.deadlineMs
  const holder = randomUUID()

  const { data: companyRows, error: companyError } = await client
    .from('organizations')
    .select('id, entity_key, canonical_name')
    .in('entity_key', ['sec:0000077476', 'sec:0000100493', 'radar:mars-incorporated'])
  if (companyError) throw new Error(`cohort unreadable: ${companyError.code ?? companyError.message}`)
  const companies = (companyRows ?? []) as CompanyRow[]

  const { data: sourceRows, error: sourceError } = await client
    .from('sources')
    .select('id, enabled, connector_config, access_mode, license_mode')
    .eq('enabled', true)
  if (sourceError) throw new Error(`sources unreadable: ${sourceError.code ?? sourceError.message}`)

  const enabled = new Set((sourceRows ?? []).map((r) => r.id as string))
  const configBySource: Record<string, Record<string, unknown>> = {}
  const accessBySource: Record<string, SourceAccessInput> = {}
  for (const row of sourceRows ?? []) {
    configBySource[row.id as string] = (row.connector_config as Record<string, unknown>) ?? {}
    // What the SOURCE REGISTRY says may be retained. Never a constant: the
    // pipeline used to write `structured_primary` for every connector, which
    // put full copyrighted pages behind a reference-only source.
    accessBySource[row.id as string] = {
      accessMode: (row.access_mode as string | null) ?? null,
      licenseMode: (row.license_mode as string | null) ?? null,
    }
  }

  const cache = supabaseCache(client)
  const results: SourcePassResult[] = []

  const runnable: Connector[] = []
  for (const connector of buildConnectors(companies, configBySource)) {
    if (!enabled.has(connector.sourceId)) {
      options.log(`[ingest] ${connector.sourceId} is not enabled; skipped`)
      continue
    }
    if (options.onlySources && !options.onlySources.includes(connector.sourceId)) continue
    runnable.push(connector)
  }

  for (const [index, connector] of runnable.entries()) {
    /*
       A FAIR SHARE OF WHAT IS LEFT, SO ONE SOURCE CANNOT STARVE THE NEXT.

       Sources run in order, SEC before Mars. With one shared deadline, a slow
       SEC day -- a backlog of filings, a run of retries -- could spend the whole
       budget and Mars would never start, every day, with nothing in its own
       record to say why. Each source may use at most an equal share of the time
       remaining when it starts; time a source does not use rolls over to the
       ones after it. On an ordinary day SEC takes two seconds and Mars gets the
       rest.
    */
    const sourceDeadlineMs = fairShareDeadline(now().getTime(), options.deadlineMs, runnable.length - index)
    const sourceBudgetSpent = () => sourceDeadlineMs !== undefined && now().getTime() >= sourceDeadlineMs

    // THE ALLOWLIST IS A CONTROL, SO A MISSING ENTRY IS A CONFIGURATION FAULT,
    // NOT SOMETHING TO PAPER OVER. Merging the connector's own hosts in here
    // would mean any connector could grant itself egress, which is the exact
    // property ADR 0002 exists to prevent. Instead the source fails with a
    // message naming the host to add -- and the failure is now written to the
    // source's health, where it used to exist only in this invocation's log.
    const missingHosts = connector.hosts.filter(
      (host) => !options.allowlist.some((entry) => host === entry || host.endsWith(`.${entry}`)),
    )
    if (missingHosts.length > 0) {
      const note =
        `EGRESS_ALLOWLIST does not permit ${missingHosts.join(', ')}. ` +
        'Add the host to the allowlist; the connector will not grant itself egress.'
      options.log(`[ingest] ${connector.sourceId}: ${note}`)
      const recorded = await recordSourceOutcome(client, {
        sourceId: connector.sourceId,
        runId: null,
        healthStatus: 'action_required',
        outcome: 'failure',
        now: now().toISOString(),
        event: {
          type: 'blocked_egress',
          summary: note,
          coverageImpact: { runStatus: 'failure', collected: false },
          actionRequired: { action: 'extend_egress_allowlist', hosts: missingHosts },
          always: true,
        },
      })
      for (const e of recorded.errors) options.log(`[ingest] ${connector.sourceId}: ${e}`)
      results.push(
        notCollected(connector.sourceId, 'failure', recorded.healthStatus ?? 'action_required', note, [
          note,
          ...recorded.errors,
        ]),
      )
      continue
    }

    if (deadlineReached()) {
      // Opening a run now would hand it to an invocation the platform is about
      // to end -- which is how a run stalls. The source waits for the next one.
      results.push(
        await recordSkip(
          client,
          connector.sourceId,
          null,
          'deferred_time_budget',
          'Not started: this invocation had used its time budget. The source runs on the next invocation.',
          now(),
          options.log,
        ),
      )
      continue
    }

    const pacing = pacingFor(connector.sourceId)
    let opened: { runId: string; lease: RunLease } | null = null
    const recoveryErrors: string[] = []
    try {
      const stale = await recoverStaleRun(client, connector.sourceId, now(), leaseMs)
      if (stale.kind === 'active' || stale.kind === 'contended') {
        const note =
          stale.kind === 'active'
            ? `A run (${stale.runId}) is active for this source, last heartbeat ${stale.lastActivity ?? 'unknown'}. ` +
              'This invocation stood down; overlapping runs are refused by the database.'
            : `A run (${stale.runId}) changed while it was being checked for abandonment. ` +
              'This invocation stood down rather than act on a stale read.'
        options.log(`[ingest] ${connector.sourceId}: ${note}`)
        results.push(await recordSkip(client, connector.sourceId, stale.runId, 'skipped_overlap', note, now(), options.log))
        continue
      }
      if (stale.kind === 'recovered') {
        options.log(
          `[ingest] ${connector.sourceId}: closed abandoned run ${stale.runId} (last activity ${stale.lastActivity ?? 'unknown'})`,
        )
        recoveryErrors.push(...stale.errors)
      }

      const run = await openRun(client, connector.sourceId, options.window, now(), holder)
      opened = run
      const lease = run.lease

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

      const passed = await runConnectorPass(
        client,
        connector,
        ctx,
        companies,
        run.runId,
        pacing.concurrency,
        accessBySource[connector.sourceId] ?? { accessMode: null, licenseMode: null },
        {
          heartbeat: () => heartbeat(client, lease, now()),
          budgetExhausted: sourceBudgetSpent,
        },
      )
      const close = await closeRun(client, lease, passed, now())
      const errors = [...passed.errors, ...recoveryErrors, ...close.errors]
      for (const e of [...recoveryErrors, ...close.errors]) options.log(`[ingest] ${connector.sourceId}: ${e}`)
      results.push(
        close.closed
          ? { ...passed, healthStatus: close.healthStatus ?? passed.healthStatus, errors }
          : {
              ...passed,
              runStatus: 'failure',
              healthStatus: close.healthStatus ?? 'unknown',
              note: `${passed.note} The run's outcome could not be recorded: ${close.errors.join('; ')}`,
              errors,
            },
      )
    } catch (error) {
      if (error instanceof RunAlreadyActiveError) {
        const note = 'A run became active for this source while this invocation was opening one. It stood down.'
        options.log(`[ingest] ${connector.sourceId}: ${note}`)
        results.push(await recordSkip(client, connector.sourceId, null, 'skipped_overlap', note, now(), options.log))
        continue
      }
      if (error instanceof RunLeaseLostError) {
        // The run was closed out from under this invocation. Its close was the
        // recovery's to record, and it did; nothing is written here.
        options.log(`[ingest] ${connector.sourceId}: ${error.message}`)
        results.push(notCollected(connector.sourceId, 'failure', 'unknown', error.message, [error.message, ...recoveryErrors]))
        continue
      }
      const message = error instanceof Error ? error.message : 'unknown failure'
      options.log(`[ingest] ${connector.sourceId} failed: ${message}`)
      const failure = notCollected(connector.sourceId, 'failure', 'source_unavailable', message, [
        message,
        ...recoveryErrors,
      ])
      if (opened) {
        const close = await closeRun(client, opened.lease, failure, now())
        for (const e of close.errors) options.log(`[ingest] ${connector.sourceId}: ${e}`)
        results.push({
          ...failure,
          healthStatus: close.healthStatus ?? 'unknown',
          errors: [...failure.errors, ...close.errors],
        })
      } else {
        // No run row to close -- the failure came before one opened -- but the
        // source still failed to collect, and its health must say so rather
        // than keep whatever the last good run left there.
        const recorded = await recordSourceOutcome(client, {
          sourceId: connector.sourceId,
          runId: null,
          healthStatus: 'source_unavailable',
          outcome: 'failure',
          now: now().toISOString(),
          event: {
            type: 'failure',
            summary: message,
            coverageImpact: { runStatus: 'failure', collected: false },
            actionRequired: null,
            always: true,
          },
        })
        for (const e of recorded.errors) options.log(`[ingest] ${connector.sourceId}: ${e}`)
        results.push({
          ...failure,
          healthStatus: recorded.healthStatus ?? 'unknown',
          errors: [...failure.errors, ...recorded.errors],
        })
      }
    }
  }

  return results
}
