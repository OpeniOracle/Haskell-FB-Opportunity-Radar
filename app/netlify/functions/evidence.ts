/**
 * `GET /api/evidence/:evidenceId` — the authenticated evidence proxy.
 *
 * WHY THIS EXISTS INSTEAD OF A SIGNED URL.
 *
 * A Storage signed URL carries its own authorisation in the query string, so
 * once minted it is a bearer credential that anybody holding it can replay. Two
 * consequences make it the wrong control for confidential evidence:
 *
 *   - Expiry is not revocation. Between minting and expiry the URL works for
 *     whoever has it, including someone who has since been removed from the
 *     allowlist or signed out.
 *   - A CDN, a corporate proxy, or a browser cache can retain the RESPONSE. The
 *     token expiring does not evict a copy that was already stored, so the
 *     object outlives the credential that fetched it.
 *
 * This endpoint replaces the URL-as-credential with a per-request authorisation
 * decision. Every fetch verifies the token's signature, refuses it at `exp` with
 * no grace, and then asks the database whether the SESSION named in the token
 * still exists and still belongs to that user — see `_shared/sessionGuard.ts`.
 * Signing out deletes that session row, so a signed-out access token stops
 * working here on the caller's very next request even though it remains
 * cryptographically valid. Allowlist membership is re-checked in the same call,
 * so removing someone takes effect immediately rather than at token expiry.
 *
 * THAT IMMEDIACY IS THIS ENDPOINT'S PROPERTY, not the platform's. Ordinary
 * dashboard reads keep Supabase's documented behaviour, in which an already
 * issued access token stays usable until it expires. Nothing here changes that,
 * and nothing elsewhere should be described as if it did.
 *
 * The response is marked `private, no-store` so no shared cache may retain it,
 * and the storage path never leaves the server — the client only ever knows an
 * evidence id.
 *
 * WHAT IS NOT LOGGED. No token, no key, no storage path, no object bytes, no
 * signed URL. The log line carries an evidence id and an outcome, which is what
 * you need to answer "who fetched what" without the log itself becoming the
 * leak.
 */
import type { Handler, HandlerEvent } from '@netlify/functions'
import { MissingEnvError, serverEnv } from './_shared/env.js'
import {
  SessionRevokedError,
  productionGuardDeps,
  requireLiveSession,
} from './_shared/sessionGuard.js'
import { supabaseAdmin, supabaseAsUser } from './_shared/supabaseAdmin.js'
import { failure, methodNotAllowed } from './_shared/http.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** Headers every evidence response carries, success or failure. */
const NO_STORE: Record<string, string> = {
  'cache-control': 'private, no-store',
  pragma: 'no-cache',
  expires: '0',
  'x-content-type-options': 'nosniff',
  // The response is a document the browser must never render in place.
  'content-disposition': 'attachment',
  'referrer-policy': 'no-referrer',
}

export function evidenceIdFromPath(event: HandlerEvent): string | null {
  const raw = event.path ?? ''
  const tail = raw.split('/').filter(Boolean).pop() ?? ''
  const decoded = (() => {
    try {
      return decodeURIComponent(tail)
    } catch {
      return tail
    }
  })()
  return UUID.test(decoded) ? decoded : null
}

function deny(status: number, code: string, message: string) {
  const body = failure(status, code, message)
  return { ...body, headers: { ...body.headers, ...NO_STORE } }
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'GET') return methodNotAllowed('GET')

  let env
  try {
    // Token verification, the session check and a byte stream. Nothing else.
    env = serverEnv('evidence')
  } catch (error) {
    if (error instanceof MissingEnvError) {
      return deny(503, 'not_configured', 'Evidence storage is not configured.')
    }
    throw error
  }

  const authorization = event.headers.authorization ?? event.headers.Authorization
  const token = /^Bearer\s+(.+)$/i.exec((authorization ?? '').trim())?.[1] ?? ''

  // Verified signature, unexpired, LIVE session, still allowlisted, not
  // anonymous. All of it, on every request.
  let caller
  try {
    caller = await requireLiveSession(token, productionGuardDeps())
  } catch (error) {
    if (error instanceof SessionRevokedError) {
      // One message for every authentication failure. Distinguishing "no
      // session" from "not invited" from "revoked" tells an unauthenticated
      // caller which half of the guess was right. The reason is logged, and
      // the reasons are deliberately coarse — they never name a user or a
      // session id.
      console.log(`[evidence] deny reason=${error.reason}`)
      return deny(401, 'unauthorized', 'Authentication required.')
    }
    throw error
  }

  const evidenceId = evidenceIdFromPath(event)
  if (!evidenceId) {
    return deny(404, 'not_found', 'No such evidence record.')
  }

  // Visibility is decided by RLS, as the caller — not by the secret key. If the
  // caller cannot see the row, the object behind it is not theirs to fetch.
  const asUser = supabaseAsUser(token)
  const { data: visible, error: visibleError } = await asUser
    .from('evidence')
    .select('id, access_mode, mime_type, title')
    .eq('id', evidenceId)
    .maybeSingle()

  if (visibleError || !visible) {
    // Deliberately identical to the unknown-id response. "Exists but not yours"
    // and "does not exist" are the same answer to someone who may not have it.
    console.log(`[evidence] deny user=${caller.userId} evidence=${evidenceId} reason=not_visible`)
    return deny(404, 'not_found', 'No such evidence record.')
  }

  // ADR 0014: reference-only evidence has no retained body by design. This is a
  // correct, explainable state rather than a missing file.
  if (visible.access_mode === 'reference_only' || visible.access_mode === 'metadata_only') {
    return deny(
      409,
      'no_retained_content',
      'This source is retained by reference. Follow the source link; no copy is held.',
    )
  }

  // The storage path is read with the SECRET key because it is excluded from
  // what any browser session may read — and it stays on the server.
  const { data: record, error: recordError } = await supabaseAdmin()
    .from('evidence')
    .select('raw_storage_uri')
    .eq('id', evidenceId)
    .maybeSingle()

  const objectPath = record?.raw_storage_uri ?? null
  if (recordError || !objectPath) {
    console.log(`[evidence] deny user=${caller.userId} evidence=${evidenceId} reason=no_object`)
    return deny(404, 'not_found', 'No such evidence record.')
  }

  const { data: blob, error: downloadError } = await supabaseAdmin()
    .storage.from(env.evidenceBucket)
    .download(objectPath)

  if (downloadError || !blob) {
    // The storage error may quote the path. It does not reach the client.
    console.log(`[evidence] error user=${caller.userId} evidence=${evidenceId} reason=download_failed`)
    return deny(502, 'retrieval_failed', 'The preserved copy could not be retrieved.')
  }

  const bytes = Buffer.from(await blob.arrayBuffer())
  console.log(
    `[evidence] serve user=${caller.userId} evidence=${evidenceId} bytes=${bytes.byteLength}`,
  )

  return {
    statusCode: 200,
    headers: {
      ...NO_STORE,
      'content-type': visible.mime_type ?? 'application/octet-stream',
      'content-length': String(bytes.byteLength),
      // The id, never the path.
      'x-evidence-id': evidenceId,
    },
    body: bytes.toString('base64'),
    isBase64Encoded: true,
  }
}
