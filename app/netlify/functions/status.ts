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
import {
  SessionRevokedError,
  productionGuardDeps,
  requireLiveSession,
} from './_shared/sessionGuard.js'
import {
  KeyShapeError,
  MissingEnvError,
  REQUIRED_SERVER_VARS,
  describeServerVariables,
  serverEnv,
} from './_shared/env.js'

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'GET') return methodNotAllowed('GET')

  let env
  try {
    // Also reads AS THE CALLER, which needs the publishable key. SEC is
    // reported as a component below rather than required here.
    env = serverEnv('status')
  } catch (error) {
    if (error instanceof MissingEnvError) {
      return failure(
        503,
        'not_configured',
        `Deployment is incomplete. Missing: ${error.names.join(', ')}.`,
      )
    }
    // Present but the wrong kind of key. Named, never quoted. Without this an
    // unhandled throw would answer HTML from a JSON endpoint.
    if (error instanceof KeyShapeError) {
      return failure(503, 'not_configured', error.message)
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

  // Is the evidence proxy's session guard actually INSTALLED on this project?
  // Asked by calling it with an id pair that cannot exist: an installed function
  // answers `false`, a missing one raises `undefined function`. Reporting
  // "enforced" from a constant would survive a database that never got
  // migration 0018, which is the one case worth catching.
  const ZERO = '00000000-0000-0000-0000-000000000000'
  const { error: guardProbeError } = await supabaseAdmin().rpc('authorize_evidence_access', {
    p_user_id: ZERO,
    p_session_id: ZERO,
  })

  // What the CALLER's own token would get at the evidence proxy. Useful to an
  // operator and safe to report to its owner: it is a fact about their session,
  // and the reason for a refusal is never included.
  let evidenceAccess: { authorized: boolean; jwtVerification: string | null }
  try {
    const live = await requireLiveSession(token, productionGuardDeps())
    evidenceAccess = { authorized: true, jwtVerification: live.verificationMode }
  } catch (error) {
    if (!(error instanceof SessionRevokedError)) throw error
    evidenceAccess = { authorized: false, jwtVerification: null }
  }

  // `ok` reflects the FOUNDATION: can we reach the database as the caller.
  // The model is reported separately and deliberately does not affect it — an
  // absent model key is a supported state in which collection, preservation and
  // resolution all still run, and only classification refuses. SEC is reported
  // the same way and for the same reason: an unconfigured collector is a
  // supported state, not a broken deployment, and it must never be able to
  // report the foundation as unhealthy.
  return json(200, {
    ok: !error,
    modelConfigured: gateway.available,
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
    // The key is never read here and could not be printed even by mistake:
    // `describe` is built from MODEL_ID and the provider name, never the key.
    model: {
      configured: gateway.available,
      describe: gateway.describe,
    },
    auth: {
      // Whether the invite guard is in force, not who is on the list.
      inviteOnlyEnforced: true,
      /**
       * The evidence proxy refuses a signed-out access token on the caller's
       * next request, because it checks `auth.sessions` per request. This is a
       * property of THAT endpoint only — ordinary reads below keep Supabase's
       * documented behaviour, in which an issued access token stays usable
       * until it expires.
       */
      evidenceSessionCheckInstalled: !guardProbeError,
      evidenceAccessAuthorized: evidenceAccess.authorized,
      jwtVerification: evidenceAccess.jwtVerification,
      dashboardTokenLifetime: 'supabase_default_until_exp',
    },
    /*
       SEC IS A COMPONENT, NOT A PRECONDITION.

       This block used to be unreachable without SEC_EDGAR_USER_AGENT, because
       serverEnv() required it globally -- so the diagnostic that exists to tell
       you a collector is unconfigured was the one thing an unconfigured
       collector prevented you from reading. It reports now, and says plainly
       that this affects collection only.
    */
    sec: {
      configured: Boolean(env.secEdgarUserAgent),
      contactConfirmed: env.secContactConfirmed,
      // Named so an operator knows what is switched off, and what is not.
      affects: env.secEdgarUserAgent
        ? 'none'
        : 'sec_collection_only: authentication, evidence and reads are unaffected',
    },
    // Names only. Never values.
    requiredServerVariables: REQUIRED_SERVER_VARS,
    /*
       PRESENCE AND SHAPE, NEVER VALUE.

       "Are the Deploy Preview's function variables actually there?" is a
       question that previously could only be answered by trusting the Netlify
       UI. Each entry reports whether the variable is set and whether what it
       holds looks like the right KIND of thing -- an `sb_secret_` prefix, an
       https URL -- and nothing else. No value, no prefix beyond the family
       name, no length that would narrow a secret.
    */
    environment: describeServerVariables(),
    egressAllowlistSize: env.egressAllowlist.length,
  })
}
