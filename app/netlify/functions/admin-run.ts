/**
 * `POST /api/admin-run` — the manual administrative trigger.
 *
 * Separate from the schedule on purpose. The scheduled function has no HTTP
 * route at all; this one does, so it carries its own credential — an operator
 * secret in `X-Radar-Operator-Secret`, compared in constant time, distinct from
 * a user session. A signed-in pilot user cannot force a collection run, and an
 * operator secret cannot read the dashboard.
 *
 * Idempotency is preserved because a manual run computes the same
 * (source_id, collection_window_start) key as the schedule would. Forcing a run
 * for a window that already ran collides with the existing logical run rather
 * than duplicating it — which is the desired behaviour for a re-run and the
 * reason the window is a parameter rather than "now".
 */
import type { Handler } from '@netlify/functions'
import { failure, json, methodNotAllowed } from './_shared/http.js'
import { UnauthorizedError, requireOperator } from './_shared/auth.js'
import { MissingEnvError, serverEnv } from './_shared/env.js'
import { collectionWindow } from './scheduled-ingest.js'

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') return methodNotAllowed('POST')

  try {
    serverEnv()
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

  const window = collectionWindow(new Date())

  return json(202, {
    accepted: true,
    window,
    note: 'Connectors are not implemented in the Production Foundation PR. No collection was performed.',
  })
}
