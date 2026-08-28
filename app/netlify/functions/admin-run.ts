/**
 * `POST /api/admin-run` — the manual administrative trigger.
 *
 * Separate from the schedule on purpose. The scheduled function has no HTTP
 * route at all; this one does, so it carries its own credential — an operator
 * secret in `X-Radar-Operator-Secret`, compared in constant time, distinct from
 * a user session. A signed-in pilot user cannot force a collection run, and an
 * operator secret cannot read the dashboard.
 *
 * IDEMPOTENCY. A manual run computes the same
 * (source_id, collection_window_start) key as the schedule would, so forcing a
 * run for a window that already ran collides with the existing logical run
 * rather than duplicating it. Overlap is refused by a partial unique index, not
 * by a check in this handler — a check would lose the race it exists to win.
 *
 * THE BACKFILL WINDOW IS A PARAMETER, NOT A CONSTANT. The first live run has to
 * reach back further than one day. `windowDays` is bounded so a mistyped value
 * cannot ask SEC for a decade in one invocation.
 */
import type { Handler } from '@netlify/functions'
import { failure, json, methodNotAllowed } from './_shared/http.js'
import { UnauthorizedError, requireOperator } from './_shared/auth.js'
import { MissingEnvError, serverEnv } from './_shared/env.js'
import { collect, collectionWindow } from './scheduled-ingest.js'

/** Twelve months. The documented backfill depth for the first cohort. */
export const MAX_WINDOW_DAYS = 400

export function backfillWindow(now: Date, days: number): { start: string; end: string } {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000)
  return { start: start.toISOString(), end: end.toISOString() }
}

interface RunRequest {
  windowDays?: number
  sources?: string[]
  dryRun?: boolean
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') return methodNotAllowed('POST')

  try {
    serverEnv('admin-run')
    requireOperator(event.headers as Record<string, string | undefined>)
  } catch (error) {
    if (error instanceof MissingEnvError) {
      return failure(503, 'not_configured', `Missing: ${error.names.join(', ')}.`)
    }
    if (error instanceof UnauthorizedError) {
      // Deliberately identical to the wrong-secret response: distinguishing
      // "no secret" from "wrong secret" is a free hint for whoever is guessing.
      return failure(401, 'unauthorized', 'Operator credential required.')
    }
    throw error
  }

  // The ingest scope is what the collection itself needs. Checked here so the
  // operator gets "SEC_EDGAR_USER_AGENT is missing" instead of a run that
  // starts, opens a run row and then dies.
  try {
    serverEnv('ingest')
  } catch (error) {
    if (error instanceof MissingEnvError) {
      return failure(503, 'not_configured', `Missing: ${error.names.join(', ')}.`)
    }
    throw error
  }

  let body: RunRequest = {}
  if (event.body) {
    try {
      body = JSON.parse(event.body) as RunRequest
    } catch {
      return failure(400, 'bad_request', 'Body must be JSON.')
    }
  }

  const days = Number.isFinite(body.windowDays) ? Number(body.windowDays) : 1
  if (days < 1 || days > MAX_WINDOW_DAYS) {
    return failure(400, 'bad_request', `windowDays must be between 1 and ${MAX_WINDOW_DAYS}.`)
  }

  const window = days === 1 ? collectionWindow(new Date()) : backfillWindow(new Date(), days)

  if (body.dryRun) {
    // A connectivity and configuration check that writes nothing. What an
    // operator wants before committing to a twelve-month backfill.
    return json(200, {
      dryRun: true,
      window,
      note: 'Configuration and credentials accepted. No collection was performed.',
    })
  }

  try {
    const result = await collect(window)
    return json(200, result)
  } catch (error) {
    // The message may name a source or a status; it never carries a body, a
    // header or a key, because this response goes to an operator terminal.
    return failure(
      502,
      'collection_failed',
      error instanceof Error ? error.message.slice(0, 500) : 'Collection failed.',
    )
  }
}
