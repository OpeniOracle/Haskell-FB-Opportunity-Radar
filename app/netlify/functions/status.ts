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
import { supabaseAdmin, supabaseAsUser } from './_shared/supabaseAdmin.js'
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

  // The schema version, read as the caller. `schema_migrations` is not readable
  // by a browser session, so this deliberately uses the admin client — the
  // version is operational metadata, not data.
  const { data: migration } = await supabaseAdmin()
    .from('schema_migrations')
    .select('version')
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data: bucket } = await supabaseAdmin()
    .storage.getBucket(env.evidenceBucket)

  const gateway = modelGateway()

  return json(200, {
    ok: !error,
    radarEnv: env.radarEnv,
    caller: { userId: caller.userId, invited: caller.invited },
    database: error
      ? { reachable: false, code: error.code ?? 'unknown' }
      : { reachable: true, organizationsVisible: count ?? 0 },
    schema: { version: migration?.version ?? null },
    storage: {
      // The bucket NAME is not sensitive; an object path would be, and none is
      // reported. `public: false` is the property that matters.
      bucket: env.evidenceBucket,
      configured: bucket !== null,
      private: bucket ? bucket.public === false : null,
    },
    // Reported by availability and model id. The key is never read here and
    // could not be printed even by mistake — `describe` is built from MODEL_ID.
    model: {
      configured: gateway.available,
      describe: gateway.describe,
    },
    auth: {
      // Whether the invite guard is in force, not who is on the list.
      inviteOnlyEnforced: true,
    },
    sec: {
      contactConfirmed: env.secContactConfirmed,
    },
    // Names only. Never values.
    requiredServerVariables: REQUIRED_SERVER_VARS,
    egressAllowlistSize: env.egressAllowlist.length,
  })
}
