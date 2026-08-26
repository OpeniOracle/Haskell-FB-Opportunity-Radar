/**
 * `GET /api/status` — the authenticated boundary check.
 *
 * The smallest endpoint that proves the whole foundation is wired: the caller is
 * a real invited user, the server can reach Supabase, and row-level security is
 * applied to the caller rather than bypassed.
 *
 * It reads AS THE CALLER, not as the service role. That is the point. A status
 * endpoint that queried with the service role would report success even if every
 * RLS policy were missing, which is precisely the failure it is here to catch.
 *
 * It reports what the deployment is missing, by NAME, without ever reporting a
 * value. "MODEL_API_KEY is not set" is operationally necessary; the key itself
 * is not.
 */
import type { Handler } from '@netlify/functions'
import { failure, json, methodNotAllowed } from './_shared/http.js'
import { UnauthorizedError, requireUser } from './_shared/auth.js'
import { supabaseAsUser } from './_shared/supabaseAdmin.js'
import { modelGateway } from './_shared/modelGateway.js'
import { MissingEnvError, REQUIRED_SERVER_VARS, serverEnv } from './_shared/env.js'

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'GET') return methodNotAllowed('GET')

  let env
  try {
    env = serverEnv()
  } catch (error) {
    if (error instanceof MissingEnvError) {
      return failure(
        503,
        'not_configured',
        `Deployment is incomplete. Missing: ${error.names.join(', ')}.`,
      )
    }
    throw error
  }

  const authorization = event.headers.authorization ?? event.headers.Authorization
  let caller
  try {
    caller = await requireUser({ authorization })
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return failure(401, 'unauthorized', error.message)
    }
    throw error
  }

  const token = /^Bearer\s+(.+)$/i.exec((authorization ?? '').trim())?.[1] ?? ''
  const client = supabaseAsUser(token)

  // `head: true` with an exact count reads no rows: it proves reachability and
  // read permission without pulling data across the wire to prove it.
  const { count, error } = await client
    .from('organizations')
    .select('id', { count: 'exact', head: true })

  const gateway = modelGateway()

  return json(200, {
    ok: !error,
    radarEnv: env.radarEnv,
    caller: { userId: caller.userId },
    database: error
      ? { reachable: false, code: error.code ?? 'unknown' }
      : { reachable: true, organizationsVisible: count ?? 0 },
    model: {
      available: gateway.available,
      describe: gateway.describe,
    },
    // Names only. Never values.
    requiredServerVariables: REQUIRED_SERVER_VARS,
    egressAllowlistSize: env.egressAllowlist.length,
  })
}
