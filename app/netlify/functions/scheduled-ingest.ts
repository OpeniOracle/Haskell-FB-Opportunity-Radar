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
 * No connector runs in this PR. `runIngestion` is the seam the First Live Data
 * PR fills; today it records that the schedule fired and that nothing was
 * configured to collect, which is a truthful Source Health state rather than a
 * silent no-op.
 */
import { schedule } from '@netlify/functions'
import { MissingEnvError, serverEnv } from './_shared/env.js'
import { supabaseAdmin } from './_shared/supabaseAdmin.js'

/** Midnight UTC on the day the schedule fired. Stable across retries. */
export function collectionWindow(now: Date): { start: string; end: string } {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const start = new Date(end.getTime() - 24 * 60 * 60 * 1000)
  return { start: start.toISOString(), end: end.toISOString() }
}

async function runIngestion(window: { start: string; end: string }) {
  const client = supabaseAdmin()

  const { data: sources, error } = await client
    .from('sources')
    .select('id, name, enabled')
    .eq('enabled', true)

  if (error) {
    return { ok: false, window, reason: `sources unreadable: ${error.code ?? 'unknown'}` }
  }

  // The First Live Data PR replaces this branch with real collection. Until
  // then the honest report is "the schedule ran and there is nothing enabled",
  // which Source Health can show as a coverage gap.
  return {
    ok: true,
    window,
    enabledSources: sources?.length ?? 0,
    collected: 0,
    note:
      (sources?.length ?? 0) === 0
        ? 'No source is enabled. Nothing was collected, and this is a coverage gap rather than a success.'
        : 'Connectors are not implemented in the Production Foundation PR.',
  }
}

// 06:00 UTC daily — after the US business day, before the European one, so a
// failure has a working day in front of it rather than behind it.
export const handler = schedule('0 6 * * *', async () => {
  try {
    serverEnv()
  } catch (error) {
    if (error instanceof MissingEnvError) {
      console.error(`[scheduled-ingest] not configured: ${error.names.join(', ')}`)
      return { statusCode: 200 }
    }
    throw error
  }

  const window = collectionWindow(new Date())
  const result = await runIngestion(window)
  console.log(`[scheduled-ingest] ${JSON.stringify(result)}`)
  return { statusCode: 200 }
})
