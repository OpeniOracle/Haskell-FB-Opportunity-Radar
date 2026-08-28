/**
 * The daily ingestion schedule.
 *
 * Declared with Netlify's `schedule()` helper, which registers the function as a
 * SCHEDULED function. A scheduled function has no public HTTP route: it is
 * invoked by the platform's scheduler and cannot be triggered by a request. That
 * is why there is no authentication here — there is no caller to authenticate,
 * and adding a route "for testing" would create exactly the public invocation
 * path the design forbids.
 *
 * A human who needs to force a run uses `admin-run`, which is a separate
 * function with its own operator credential. Two mechanisms, deliberately not
 * interchangeable.
 *
 * IDEMPOTENCY. A logical run is keyed on (source_id, collection_window_start),
 * with a unique index behind it. The window is derived from the schedule, not
 * from the wall clock at invocation, so a retried or double-fired invocation
 * computes the SAME window and collides with the run already recorded instead of
 * producing a second one. Retries are attempts against that run, not new runs.
 *
 * THE SCHEDULE IN BOTH CLOCKS. `0 6 * * *` is 06:00 UTC every day, which is
 * 02:00 US Eastern during daylight time and 01:00 during standard time. It is
 * fixed in UTC deliberately: pinning it to Eastern would move the run twice a
 * year and put a shifted window either side of the change.
 */
import { schedule } from '@netlify/functions'
import { MissingEnvError, serverEnv } from './_shared/env.js'
import { supabaseAdmin } from './_shared/supabaseAdmin.js'
import { runIngestion } from './_shared/connectors/runner.js'

/** Midnight UTC on the day the schedule fired. Stable across retries. */
export function collectionWindow(now: Date): { start: string; end: string } {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const start = new Date(end.getTime() - 24 * 60 * 60 * 1000)
  return { start: start.toISOString(), end: end.toISOString() }
}

export async function collect(window: { start: string; end: string }) {
  const env = serverEnv('ingest')
  const client = supabaseAdmin()

  const results = await runIngestion(client, {
    window,
    userAgent: env.secEdgarUserAgent!,
    allowlist: env.egressAllowlist,
    log: (message) => console.log(message),
  })

  if (results.length === 0) {
    return {
      ok: true,
      window,
      sources: [],
      note: 'No source is enabled. Nothing was collected, and this is a coverage gap rather than a success.',
    }
  }

  // Per source, never aggregated into one verdict: one failing connector must
  // not report the cohort as current, and one succeeding connector must not
  // hide a failure next to it.
  return {
    ok: results.every((r) => r.runStatus !== 'failure'),
    window,
    sources: results.map((r) => ({
      sourceId: r.sourceId,
      runStatus: r.runStatus,
      healthStatus: r.healthStatus,
      evidenceCreated: r.counters.evidenceCreated,
      documentsDiscovered: r.counters.documentsDiscovered,
      documentsAccepted: r.counters.documentsAccepted,
      documentsRejected: r.counters.documentsRejected,
      duplicatesPrevented: r.counters.duplicatesPrevented,
      opportunitiesCreated: r.counters.opportunitiesCreated,
      opportunitiesSuppressed: r.counters.opportunitiesSuppressed,
      note: r.note,
    })),
  }
}

// 06:00 UTC daily — after the US business day, before the European one, so a
// failure has a working day in front of it rather than behind it.
export const handler = schedule('0 6 * * *', async () => {
  try {
    // The one entry point that genuinely talks to SEC, so the one that
    // genuinely requires SEC_EDGAR_USER_AGENT.
    serverEnv('ingest')
  } catch (error) {
    if (error instanceof MissingEnvError) {
      console.error(`[scheduled-ingest] not configured: ${error.names.join(', ')}`)
      return { statusCode: 200 }
    }
    throw error
  }

  const window = collectionWindow(new Date())
  try {
    const result = await collect(window)
    console.log(`[scheduled-ingest] ${JSON.stringify(result)}`)
  } catch (error) {
    // Never rethrow into the platform: a thrown scheduled function is retried
    // by Netlify, and a retry that repeats a failing fetch against a
    // fair-access source is the one thing worse than the original failure.
    console.error(
      `[scheduled-ingest] run failed: ${error instanceof Error ? error.message : 'unknown'}`,
    )
  }
  return { statusCode: 200 }
})
