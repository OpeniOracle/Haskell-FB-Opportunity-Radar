/**
 * The evidence proxy's authorisation gate: a LIVE session, not merely a valid token.
 *
 * WHAT THIS ADDS OVER `requireInvitedUser`.
 *
 * `requireInvitedUser` asks Supabase to validate the token and then re-checks
 * the invitation allowlist. That is the correct gate for the dashboard API, and
 * it is unchanged. What it cannot do is notice that the caller signed out
 * ninety seconds ago: their access token remains cryptographically valid until
 * `exp`, which is Supabase's documented behaviour and is fine for a read that
 * the caller could have made ninety seconds ago anyway.
 *
 * Preserved evidence is different. The proxy exists because a credential that
 * outlives its authorisation is the wrong control for confidential source
 * material — that is the whole argument against signed Storage URLs — and an
 * unexpired-but-signed-out JWT is that same credential in a different wrapper.
 * So this gate adds the one question a JWT cannot answer:
 *
 *   1. Verify the signature cryptographically.        (jwt.ts)
 *   2. Reject anything at or past `exp`.              (jwt.ts, no skew grace)
 *   3. Read `sub` and `session_id` from the VERIFIED claims.
 *   4. Ask the database, in one call:                 (authorize_evidence_access)
 *        - does that user still exist?
 *        - does that session still exist?
 *        - does that session belong to that user?
 *        - is that user still on the invite allowlist?
 *   5. Any "no" is the same "no".
 *
 * Sign-out deletes the `auth.sessions` row, so step 4 turns a signed-out token
 * into a refusal on the caller's very next request. THIS PROPERTY BELONGS TO
 * THE EVIDENCE PROXY ONLY. It does not change the lifetime of Supabase JWTs
 * anywhere else, and nothing here should be described as if it did.
 */
import { createClient } from '@supabase/supabase-js'
import { serverEnv } from './env.js'
import { supabaseAdmin } from './supabaseAdmin.js'
import {
  TokenInvalidError,
  verifyAccessToken,
  type JwtVerificationMode,
  type VerifiedToken,
} from './jwt.js'

export class SessionRevokedError extends Error {
  constructor(readonly reason: string) {
    super(`Session is not authorised: ${reason}`)
    this.name = 'SessionRevokedError'
  }
}

export interface LiveSessionCaller {
  readonly userId: string
  readonly sessionId: string
  readonly email: string | null
  readonly verificationMode: JwtVerificationMode
}

export interface SessionGuardDeps {
  readonly verify: (token: string) => Promise<VerifiedToken>
  /** Must be the `authorize_evidence_access` RPC, or a fake standing in for it. */
  readonly authorize: (userId: string, sessionId: string) => Promise<boolean>
}

/**
 * Throws `SessionRevokedError` for every failure, with a reason that is for the
 * log only. Callers must map all of them to one indistinguishable response.
 */
export async function requireLiveSession(
  token: string | null,
  deps: SessionGuardDeps,
): Promise<LiveSessionCaller> {
  if (!token || token.trim() === '') throw new SessionRevokedError('no token')

  let verified: VerifiedToken
  try {
    verified = await deps.verify(token.trim())
  } catch (error) {
    throw new SessionRevokedError(
      error instanceof TokenInvalidError ? error.reason : 'token verification failed',
    )
  }

  const { claims } = verified
  // An anonymous session is a signed-in caller with nobody behind it. The
  // database refuses it too (migration 0016 forbids an email-less account), but
  // refusing it here means it never reaches a query.
  if (claims.isAnonymous) throw new SessionRevokedError('anonymous session')

  let authorized: boolean
  try {
    authorized = await deps.authorize(claims.sub, claims.sessionId)
  } catch {
    // A database that cannot answer is not a database that said yes.
    throw new SessionRevokedError('authorization check failed')
  }
  if (!authorized) throw new SessionRevokedError('session not live or not allowlisted')

  return {
    userId: claims.sub,
    sessionId: claims.sessionId,
    email: claims.email,
    verificationMode: verified.mode,
  }
}

// ---------------------------------------------------------------------------
// Production wiring

/**
 * Delegated-mode verification: GoTrue checks the signature for us.
 *
 * Reached only when the project publishes no JWKS and no `SUPABASE_JWT_SECRET`
 * is configured. The session check that follows is identical either way, so
 * this is a difference in WHERE the signature is verified, not in whether it is.
 */
async function issuerVerify(token: string): Promise<string | null> {
  const env = serverEnv()
  const client = createClient(env.supabaseUrl, env.supabaseSecretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await client.auth.getUser(token)
  if (error || !data.user) return null
  return data.user.id
}

export function productionGuardDeps(): SessionGuardDeps {
  const env = serverEnv()
  return {
    verify: (token) =>
      verifyAccessToken(token, {
        supabaseUrl: env.supabaseUrl,
        hmacSecret: env.supabaseJwtSecret,
        delegatedVerify: issuerVerify,
      }),
    authorize: async (userId, sessionId) => {
      const { data, error } = await supabaseAdmin().rpc('authorize_evidence_access', {
        p_user_id: userId,
        p_session_id: sessionId,
      })
      if (error) throw new Error('authorize_evidence_access failed')
      return data === true
    },
  }
}
