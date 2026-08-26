/**
 * Cryptographic verification of a Supabase access token.
 *
 * WHY THIS EXISTS AT ALL, given that `auth.getUser()` already asks Supabase.
 *
 * `getUser()` answers "is this a validly signed, unexpired token for a user who
 * exists". That is a good answer and the rest of the API still uses it. What it
 * does not answer — and cannot, because the fact is not in the token — is
 * whether the SESSION the token was minted for still exists. A Supabase access
 * token stays cryptographically valid until its own `exp` even after sign-out
 * has deleted the session and revoked the refresh token. For an ordinary
 * dashboard read that window is Supabase's documented behaviour. For
 * confidential evidence it is a credential that outlives its authorisation.
 *
 * To close that window the server needs two claims out of the token — `sub` and
 * `session_id` — and it must not take them from an unverified decode, because
 * an unverified decode is just an attacker's JSON. Hence this module: verify the
 * signature FIRST, then read the claims, then check them against the database.
 *
 * THREE VERIFICATION MODES, in preference order.
 *
 *   asymmetric  The project uses JWT signing keys (ES256/RS256). The public
 *               half is published at `/auth/v1/.well-known/jwks.json`, so the
 *               server verifies locally with no secret to hold or leak. This is
 *               the mode to be in.
 *   hs256       The project still uses the legacy shared JWT secret, and
 *               `SUPABASE_JWT_SECRET` is configured. Verified locally.
 *   delegated   No local key material is obtainable. The signature is verified
 *               by GoTrue itself via `/auth/v1/user`, which refuses a forged or
 *               expired token. Still cryptographic verification — performed by
 *               the issuer rather than by us — and the session check that
 *               follows is identical.
 *
 * The mode in force is reported by `/api/status` so a deployment cannot quietly
 * be in a weaker one than its operator believes.
 */
import { createHmac, createPublicKey, timingSafeEqual, verify as cryptoVerify } from 'node:crypto'

export type JwtVerificationMode = 'asymmetric' | 'hs256' | 'delegated'

export class TokenInvalidError extends Error {
  constructor(readonly reason: string) {
    // The reason is for the SERVER LOG. It is never returned to a caller:
    // "expired" and "bad signature" and "no such session" are one answer to
    // someone who should not have been asking.
    super(`Access token rejected: ${reason}`)
    this.name = 'TokenInvalidError'
  }
}

export interface AccessTokenClaims {
  readonly sub: string
  readonly sessionId: string
  readonly exp: number
  readonly email: string | null
  readonly isAnonymous: boolean
  readonly issuer: string | null
}

interface JwtParts {
  readonly header: Record<string, unknown>
  readonly payload: Record<string, unknown>
  readonly signingInput: string
  readonly signature: Buffer
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function decodeSegment(segment: string): Record<string, unknown> {
  const json = Buffer.from(segment, 'base64url').toString('utf8')
  const parsed: unknown = JSON.parse(json)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TokenInvalidError('segment is not a JSON object')
  }
  return parsed as Record<string, unknown>
}

/** Structure only. Proves nothing about validity — never act on this alone. */
export function decodeJwt(token: string): JwtParts {
  const segments = token.split('.')
  if (segments.length !== 3) throw new TokenInvalidError('not three segments')
  const [h, p, s] = segments as [string, string, string]
  if (!h || !p || !s) throw new TokenInvalidError('empty segment')
  let header: Record<string, unknown>
  let payload: Record<string, unknown>
  try {
    header = decodeSegment(h)
    payload = decodeSegment(p)
  } catch {
    throw new TokenInvalidError('undecodable segment')
  }
  return { header, payload, signingInput: `${h}.${p}`, signature: Buffer.from(s, 'base64url') }
}

// ---------------------------------------------------------------------------
// Signature verification

export interface Jwk {
  readonly kid?: string
  readonly kty?: string
  readonly alg?: string
  readonly use?: string
  readonly [key: string]: unknown
}

const SUPPORTED_ASYMMETRIC = new Set(['RS256', 'ES256'])

function verifyAsymmetric(parts: JwtParts, jwk: Jwk): boolean {
  const alg = String(parts.header.alg ?? '')
  if (!SUPPORTED_ASYMMETRIC.has(alg)) return false
  let key
  try {
    key = createPublicKey({ key: jwk as never, format: 'jwk' })
  } catch {
    return false
  }
  const data = Buffer.from(parts.signingInput, 'utf8')
  // ES256 signatures in a JWT are raw R‖S, not DER. Without `ieee-p1363` a
  // perfectly good signature verifies as false and every login breaks.
  const options = alg === 'ES256' ? { key, dsaEncoding: 'ieee-p1363' as const } : { key }
  try {
    return cryptoVerify('sha256', data, options, parts.signature)
  } catch {
    return false
  }
}

function verifyHs256(parts: JwtParts, secret: string): boolean {
  if (String(parts.header.alg ?? '') !== 'HS256') return false
  const expected = createHmac('sha256', secret).update(parts.signingInput).digest()
  if (expected.length !== parts.signature.length) return false
  return timingSafeEqual(expected, parts.signature)
}

// ---------------------------------------------------------------------------
// JWKS

interface JwksCacheEntry {
  keys: Jwk[]
  fetchedAt: number
}

const JWKS_TTL_MS = 5 * 60 * 1000
/** A miss on an unknown `kid` may refetch, but not more often than this. */
const JWKS_MIN_REFETCH_MS = 30 * 1000
const jwksCache = new Map<string, JwksCacheEntry>()

/** Test seam. Production passes nothing and the module fetches for itself. */
export type JwksFetcher = (url: string) => Promise<{ keys?: Jwk[] } | null>

const defaultJwksFetcher: JwksFetcher = async (url) => {
  const response = await fetch(url, { headers: { accept: 'application/json' } })
  if (!response.ok) return null
  return (await response.json()) as { keys?: Jwk[] }
}

export function resetJwksCache(): void {
  jwksCache.clear()
}

async function loadJwks(
  url: string,
  fetcher: JwksFetcher,
  now: number,
  force: boolean,
): Promise<Jwk[]> {
  const cached = jwksCache.get(url)
  const age = cached ? now - cached.fetchedAt : Infinity
  if (cached && !force && age < JWKS_TTL_MS) return cached.keys
  if (cached && force && age < JWKS_MIN_REFETCH_MS) return cached.keys
  let document: { keys?: Jwk[] } | null = null
  try {
    document = await fetcher(url)
  } catch {
    document = null
  }
  if (!document || !Array.isArray(document.keys)) {
    // A JWKS endpoint that answers with nothing is how a legacy HS256 project
    // presents. Cache the empty answer so we do not refetch on every request.
    jwksCache.set(url, { keys: [], fetchedAt: now })
    return []
  }
  jwksCache.set(url, { keys: document.keys, fetchedAt: now })
  return document.keys
}

// ---------------------------------------------------------------------------

export interface VerifyDeps {
  readonly supabaseUrl: string
  readonly hmacSecret?: string | undefined
  readonly jwksFetcher?: JwksFetcher | undefined
  /**
   * Used only in `delegated` mode: GoTrue verifies the signature for us.
   * Must resolve to the user id the ISSUER says the token belongs to, or null.
   */
  readonly delegatedVerify?: ((token: string) => Promise<string | null>) | undefined
  readonly now?: (() => number) | undefined
}

export interface VerifiedToken {
  readonly claims: AccessTokenClaims
  readonly mode: JwtVerificationMode
}

function claimsFrom(payload: Record<string, unknown>): AccessTokenClaims {
  const sub = typeof payload.sub === 'string' ? payload.sub : ''
  const sessionId = typeof payload.session_id === 'string' ? payload.session_id : ''
  const exp = typeof payload.exp === 'number' ? payload.exp : 0
  const email = typeof payload.email === 'string' && payload.email.trim() !== ''
    ? payload.email.trim()
    : null
  return {
    sub,
    sessionId,
    exp,
    email,
    isAnonymous: payload.is_anonymous === true,
    issuer: typeof payload.iss === 'string' ? payload.iss : null,
  }
}

/**
 * Verify signature and time-validity, then return the claims.
 *
 * Order matters and is not cosmetic. Expiry is checked BEFORE any network call,
 * so an expired token costs nothing and cannot be used to make the server fetch
 * on demand. The signature is checked before the claims are trusted, because an
 * unverified claim is attacker-controlled input.
 */
export async function verifyAccessToken(
  token: string,
  deps: VerifyDeps,
): Promise<VerifiedToken> {
  const now = Math.floor((deps.now?.() ?? Date.now()) / 1000)
  const parts = decodeJwt(token)

  const exp = parts.payload.exp
  if (typeof exp !== 'number' || !Number.isFinite(exp)) {
    throw new TokenInvalidError('no exp claim')
  }
  // No clock-skew grace. A grace period is a window in which a token that has
  // expired still works, which is the exact property this file exists to remove.
  if (exp <= now) throw new TokenInvalidError('expired')

  const nbf = parts.payload.nbf
  if (typeof nbf === 'number' && nbf > now) throw new TokenInvalidError('not yet valid')

  const expectedIssuer = `${deps.supabaseUrl.replace(/\/+$/, '')}/auth/v1`
  const issuer = parts.payload.iss
  if (typeof issuer === 'string' && issuer !== expectedIssuer) {
    throw new TokenInvalidError('wrong issuer')
  }

  const jwksUrl = `${deps.supabaseUrl.replace(/\/+$/, '')}/auth/v1/.well-known/jwks.json`
  const fetcher = deps.jwksFetcher ?? defaultJwksFetcher
  const nowMs = deps.now?.() ?? Date.now()
  const kid = typeof parts.header.kid === 'string' ? parts.header.kid : null
  const alg = String(parts.header.alg ?? '')

  let mode: JwtVerificationMode | null = null

  if (SUPPORTED_ASYMMETRIC.has(alg)) {
    let keys = await loadJwks(jwksUrl, fetcher, nowMs, false)
    let match = keys.find((k) => (kid ? k.kid === kid : true))
    if (!match && kid) {
      // An unknown kid is what a key rotation looks like. Refetch once.
      keys = await loadJwks(jwksUrl, fetcher, nowMs, true)
      match = keys.find((k) => k.kid === kid)
    }
    if (!match) throw new TokenInvalidError('no signing key for kid')
    if (!verifyAsymmetric(parts, match)) throw new TokenInvalidError('bad signature')
    mode = 'asymmetric'
  } else if (alg === 'HS256' && deps.hmacSecret) {
    if (!verifyHs256(parts, deps.hmacSecret)) throw new TokenInvalidError('bad signature')
    mode = 'hs256'
  } else if (deps.delegatedVerify) {
    const userId = await deps.delegatedVerify(token)
    if (!userId) throw new TokenInvalidError('issuer refused the token')
    if (typeof parts.payload.sub === 'string' && parts.payload.sub !== userId) {
      // The issuer says this token belongs to somebody else than its own `sub`
      // claim. Nothing good produces that.
      throw new TokenInvalidError('subject does not match the issuer')
    }
    mode = 'delegated'
  } else {
    throw new TokenInvalidError(`unsupported alg "${alg}" and no verification path`)
  }

  const claims = claimsFrom(parts.payload)
  if (!UUID.test(claims.sub)) throw new TokenInvalidError('sub is not a user id')
  // A token with no `session_id` cannot be checked against the session table,
  // so it cannot be authorised for confidential evidence. Deny, do not degrade.
  if (!UUID.test(claims.sessionId)) throw new TokenInvalidError('no session_id claim')

  return { claims, mode }
}
