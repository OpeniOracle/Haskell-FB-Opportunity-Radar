import { beforeEach, describe, expect, it } from 'vitest'
import { generateKeyPairSync, randomUUID, sign as cryptoSign } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { APP_ROOT } from '@/test/paths'
import { TokenInvalidError, resetJwksCache, verifyAccessToken } from '../../netlify/functions/_shared/jwt'
import {
  SessionRevokedError,
  requireLiveSession,
  type SessionGuardDeps,
} from '../../netlify/functions/_shared/sessionGuard'

/**
 * Immediate revocation at the evidence proxy — behaviour, not source-reading.
 *
 * The premise these tests encode: a Supabase access token stays
 * CRYPTOGRAPHICALLY VALID until its own `exp`, even after sign-out has revoked
 * the session's refresh token. Verifying the signature therefore cannot tell you
 * whether the caller is still signed in. The evidence proxy closes that window
 * by checking the session table on every request; everything else on the project
 * keeps Supabase's documented behaviour, and the last test in this file exists
 * to stop anyone claiming otherwise.
 *
 * The JWTs here are REAL ES256 tokens signed with a generated P-256 key and
 * verified through the production code path. An expired token is rejected
 * because it is expired, and a tampered one because the signature does not
 * verify — not because a mock said so.
 *
 * The database side is a faithful in-memory model of migration 0018's
 * `authorize_evidence_access`. `db/test.mjs` runs the same cases against real
 * PostgreSQL, so the SQL and this model are held to the same statements.
 */

const SUPABASE_URL = 'https://project.supabase.invalid'
const ISSUER = `${SUPABASE_URL}/auth/v1`
const KID = 'test-signing-key-1'

const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
const otherPair = generateKeyPairSync('ec', { namedCurve: 'P-256' })

const jwk = { ...(publicKey.export({ format: 'jwk' }) as Record<string, unknown>), kid: KID, alg: 'ES256', use: 'sig' }
const jwksFetcher = async () => ({ keys: [jwk] })

const b64 = (value: string) => Buffer.from(value, 'utf8').toString('base64url')

interface TokenOptions {
  readonly sub: string
  readonly sessionId?: string | null
  readonly email?: string
  readonly expiresInSeconds?: number
  readonly issuer?: string
  readonly isAnonymous?: boolean
  readonly kid?: string
  readonly key?: typeof privateKey
}

function mintToken(options: TokenOptions): string {
  const nowSeconds = Math.floor(Date.now() / 1000)
  const payload: Record<string, unknown> = {
    iss: options.issuer ?? ISSUER,
    sub: options.sub,
    aud: 'authenticated',
    role: 'authenticated',
    email: options.email ?? 'analyst@openi-analytics.invalid',
    iat: nowSeconds - 10,
    exp: nowSeconds + (options.expiresInSeconds ?? 3600),
    is_anonymous: options.isAnonymous ?? false,
  }
  if (options.sessionId !== null) payload.session_id = options.sessionId ?? randomUUID()
  const header = b64(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid: options.kid ?? KID }))
  const body = b64(JSON.stringify(payload))
  const signingInput = `${header}.${body}`
  const signature = cryptoSign('sha256', Buffer.from(signingInput, 'utf8'), {
    key: options.key ?? privateKey,
    dsaEncoding: 'ieee-p1363',
  })
  return `${signingInput}.${signature.toString('base64url')}`
}

// ---------------------------------------------------------------------------
// An in-memory GoTrue + migration 0018, statement for statement.

class FakeProject {
  readonly users = new Map<string, { email: string | null }>()
  readonly sessions = new Map<string, { userId: string }>()
  readonly allowlist = new Set<string>()
  authorizeCalls = 0
  rpcShouldThrow = false

  signIn(email: string | null): { userId: string; sessionId: string } {
    const userId = randomUUID()
    const sessionId = randomUUID()
    this.users.set(userId, { email })
    this.sessions.set(sessionId, { userId })
    if (email) this.allowlist.add(email.trim().toLowerCase())
    return { userId, sessionId }
  }

  /** GoTrue deletes the session row on sign-out. That is the whole mechanism. */
  signOut(userId: string): void {
    for (const [id, session] of this.sessions) {
      if (session.userId === userId) this.sessions.delete(id)
    }
  }

  removeFromAllowlist(email: string): void {
    this.allowlist.delete(email.trim().toLowerCase())
  }

  /** Mirrors `public.authorize_evidence_access(uuid, uuid)`. */
  authorize = async (userId: string, sessionId: string): Promise<boolean> => {
    this.authorizeCalls += 1
    if (this.rpcShouldThrow) throw new Error('authorize_evidence_access failed')
    if (!userId || !sessionId) return false
    const user = this.users.get(userId)
    if (!user || !user.email || user.email.trim() === '') return false
    const session = this.sessions.get(sessionId)
    if (!session || session.userId !== userId) return false
    return this.allowlist.has(user.email.trim().toLowerCase())
  }

  deps(): SessionGuardDeps {
    return {
      verify: (token) => verifyAccessToken(token, { supabaseUrl: SUPABASE_URL, jwksFetcher }),
      authorize: this.authorize,
    }
  }
}

let project: FakeProject

beforeEach(() => {
  resetJwksCache()
  project = new FakeProject()
})

async function refusal(token: string, deps = project.deps()): Promise<SessionRevokedError> {
  try {
    await requireLiveSession(token, deps)
  } catch (error) {
    expect(error).toBeInstanceOf(SessionRevokedError)
    return error as SessionRevokedError
  }
  throw new Error('expected the request to be refused, but it was authorised')
}

// ---------------------------------------------------------------------------

describe('evidence proxy — a live session, not merely a valid token', () => {
  it('authorises a valid, active session', async () => {
    const email = 'analyst@openi-analytics.invalid'
    const { userId, sessionId } = project.signIn(email)
    const token = mintToken({ sub: userId, sessionId, email })

    const caller = await requireLiveSession(token, project.deps())

    expect(caller.userId).toBe(userId)
    expect(caller.sessionId).toBe(sessionId)
    expect(caller.email).toBe(email)
    // Verified locally against the project's published key. No secret held.
    expect(caller.verificationMode).toBe('asymmetric')
  })

  it('signing out removes the session record the proxy checks', async () => {
    const { userId, sessionId } = project.signIn('analyst@openi-analytics.invalid')
    expect(project.sessions.has(sessionId)).toBe(true)

    project.signOut(userId)

    expect(project.sessions.has(sessionId)).toBe(false)
    expect(await project.authorize(userId, sessionId)).toBe(false)
  })

  it('rejects a previously issued, STILL UNEXPIRED token immediately after sign-out', async () => {
    const email = 'analyst@openi-analytics.invalid'
    const { userId, sessionId } = project.signIn(email)
    const token = mintToken({ sub: userId, sessionId, email, expiresInSeconds: 3600 })

    // It works right now.
    await expect(requireLiveSession(token, project.deps())).resolves.toMatchObject({ userId })

    project.signOut(userId)

    const error = await refusal(token)
    expect(error.reason).toBe('session not live or not allowlisted')

    // The decisive assertion: the token itself is still perfectly valid. If it
    // had merely expired, this verification would throw and the test would be
    // proving nothing about revocation.
    const stillValid = await verifyAccessToken(token, {
      supabaseUrl: SUPABASE_URL,
      jwksFetcher,
    })
    expect(stillValid.claims.exp * 1000).toBeGreaterThan(Date.now())
  })

  it('rejects an expired token, before making any database call', async () => {
    const { userId, sessionId } = project.signIn('analyst@openi-analytics.invalid')
    const token = mintToken({ sub: userId, sessionId, expiresInSeconds: -1 })

    const error = await refusal(token)

    expect(error.reason).toBe('expired')
    // Expiry is decided from the token. An expired credential must not be able
    // to make the server do work on its behalf.
    expect(project.authorizeCalls).toBe(0)
  })

  it('rejects a token whose `sub` is not the owner of the session it names', async () => {
    const alice = project.signIn('alice@openi-analytics.invalid')
    const mallory = project.signIn('mallory@openi-analytics.invalid')

    // Mallory is signed in, allowlisted, and holds a validly signed token. The
    // only thing wrong is that she names Alice's session.
    const token = mintToken({
      sub: mallory.userId,
      sessionId: alice.sessionId,
      email: 'mallory@openi-analytics.invalid',
    })

    const error = await refusal(token)
    expect(error.reason).toBe('session not live or not allowlisted')
    // Both halves really do exist; it is the PAIRING that is refused.
    expect(project.sessions.has(alice.sessionId)).toBe(true)
    expect(project.users.has(mallory.userId)).toBe(true)
  })

  it('blocks access immediately when the allowlist entry is removed', async () => {
    const email = 'departing@openi-analytics.invalid'
    const { userId, sessionId } = project.signIn(email)
    const token = mintToken({ sub: userId, sessionId, email })

    await expect(requireLiveSession(token, project.deps())).resolves.toMatchObject({ userId })

    project.removeFromAllowlist(email)

    // Still signed in, still a live session, still an unexpired token.
    expect(project.sessions.has(sessionId)).toBe(true)
    const error = await refusal(token)
    expect(error.reason).toBe('session not live or not allowlisted')
  })

  it('rejects a token for a user who no longer exists', async () => {
    const { userId, sessionId } = project.signIn('deleted@openi-analytics.invalid')
    const token = mintToken({ sub: userId, sessionId })
    project.users.delete(userId)

    expect((await refusal(token)).reason).toBe('session not live or not allowlisted')
  })

  it('refuses when the database cannot answer, rather than assuming yes', async () => {
    const { userId, sessionId } = project.signIn('analyst@openi-analytics.invalid')
    const token = mintToken({ sub: userId, sessionId })
    project.rpcShouldThrow = true

    expect((await refusal(token)).reason).toBe('authorization check failed')
  })

  it('rejects an anonymous session before it reaches the database', async () => {
    const { userId, sessionId } = project.signIn('analyst@openi-analytics.invalid')
    const token = mintToken({ sub: userId, sessionId, isAnonymous: true })

    expect((await refusal(token)).reason).toBe('anonymous session')
    expect(project.authorizeCalls).toBe(0)
  })

  it('rejects a token carrying no session_id claim', async () => {
    const { userId } = project.signIn('analyst@openi-analytics.invalid')
    const token = mintToken({ sub: userId, sessionId: null })

    // A token that names no session cannot be checked against the session
    // table. Deny — never degrade to "signature was fine".
    expect((await refusal(token)).reason).toBe('no session_id claim')
    expect(project.authorizeCalls).toBe(0)
  })

  it('rejects a missing token', async () => {
    expect((await refusal('')).reason).toBe('no token')
  })
})

describe('cryptographic verification', () => {
  it('rejects a signature made with a different key', async () => {
    const { userId, sessionId } = project.signIn('analyst@openi-analytics.invalid')
    const token = mintToken({ sub: userId, sessionId, key: otherPair.privateKey })

    expect((await refusal(token)).reason).toBe('bad signature')
    expect(project.authorizeCalls).toBe(0)
  })

  it('rejects a token whose payload was edited after signing', async () => {
    const alice = project.signIn('alice@openi-analytics.invalid')
    const token = mintToken({ sub: alice.userId, sessionId: alice.sessionId })

    const [header, payload, signature] = token.split('.') as [string, string, string]
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>
    claims.exp = Math.floor(Date.now() / 1000) + 86_400 * 365
    const forged = `${header}.${b64(JSON.stringify(claims))}.${signature}`

    expect((await refusal(forged)).reason).toBe('bad signature')
  })

  it('rejects a token signed with an unpublished key id', async () => {
    const { userId, sessionId } = project.signIn('analyst@openi-analytics.invalid')
    const token = mintToken({ sub: userId, sessionId, kid: 'not-a-published-key' })

    expect((await refusal(token)).reason).toBe('no signing key for kid')
  })

  it('rejects a token minted by a different issuer', async () => {
    const { userId, sessionId } = project.signIn('analyst@openi-analytics.invalid')
    const token = mintToken({ sub: userId, sessionId, issuer: 'https://elsewhere.invalid/auth/v1' })

    expect((await refusal(token)).reason).toBe('wrong issuer')
  })

  it('rejects a value that is not a token at all', async () => {
    for (const junk of ['not-a-token', 'a.b', 'a.b.c.d', '...']) {
      await expect(
        verifyAccessToken(junk, { supabaseUrl: SUPABASE_URL, jwksFetcher }),
      ).rejects.toBeInstanceOf(TokenInvalidError)
    }
  })

  it('allows no clock-skew grace at the expiry boundary', async () => {
    const { userId, sessionId } = project.signIn('analyst@openi-analytics.invalid')
    // exp exactly now: `exp <= now` is a refusal, not a rounding question.
    const token = mintToken({ sub: userId, sessionId, expiresInSeconds: 0 })
    expect((await refusal(token)).reason).toBe('expired')
  })

  it('verifies against a rotated key, once the refetch throttle allows it', async () => {
    const rotated = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    const rotatedJwk = {
      ...(rotated.publicKey.export({ format: 'jwk' }) as Record<string, unknown>),
      kid: 'rotated-key',
      alg: 'ES256',
      use: 'sig',
    }
    let published = [jwk]
    let fetches = 0
    const fetcher = async () => {
      fetches += 1
      return { keys: published }
    }
    let clock = Date.now()
    const now = () => clock

    const { userId, sessionId } = project.signIn('analyst@openi-analytics.invalid')
    const before = mintToken({ sub: userId, sessionId })
    await expect(
      verifyAccessToken(before, { supabaseUrl: SUPABASE_URL, jwksFetcher: fetcher, now }),
    ).resolves.toBeTruthy()
    expect(fetches).toBe(1)

    published = [jwk, rotatedJwk]
    const fresh = mintToken({ sub: userId, sessionId, kid: 'rotated-key', key: rotated.privateKey })

    // Immediately after a fetch, an unknown kid does NOT trigger another one.
    // That throttle is deliberate: without it, a stream of tokens carrying
    // random key ids would turn every request into a JWKS fetch.
    await expect(
      verifyAccessToken(fresh, { supabaseUrl: SUPABASE_URL, jwksFetcher: fetcher, now }),
    ).rejects.toMatchObject({ reason: 'no signing key for kid' })
    expect(fetches).toBe(1)

    // Past the throttle, the rotation is picked up without a restart.
    clock += 31_000
    const verified = await verifyAccessToken(fresh, {
      supabaseUrl: SUPABASE_URL,
      jwksFetcher: fetcher,
      now,
    })
    expect(verified.claims.sub).toBe(userId)
    expect(fetches).toBe(2)
  })
})

describe('the scope of this protection is stated honestly', () => {
  const read = (relative: string) => readFileSync(join(APP_ROOT, relative), 'utf8')
  const authSource = read('netlify/functions/_shared/auth.ts')
  const guardSource = read('netlify/functions/_shared/sessionGuard.ts')
  const proxySource = read('netlify/functions/evidence.ts')
  const migration = readFileSync(
    join(APP_ROOT, '..', 'db/migrations/0018_evidence_session_guard.up.sql'),
    'utf8',
  )

  it('applies the session check to the evidence proxy', () => {
    expect(proxySource).toContain('requireLiveSession')
    expect(guardSource).toContain('authorize_evidence_access')
  })

  it('does NOT apply it to ordinary authenticated reads', () => {
    // `requireUser` / `requireInvitedUser` are unchanged: they validate the
    // token with Supabase and re-check the allowlist. Adding the session check
    // here would be a different, larger decision than the one taken.
    expect(authSource).not.toContain('authorize_evidence_access')
    expect(authSource).not.toContain('auth.sessions')
    expect(authSource).not.toContain('sessionGuard')
  })

  it('never claims that ordinary Supabase tokens are revoked on sign-out', () => {
    for (const [name, text] of [
      ['auth.ts', authSource],
      ['sessionGuard.ts', guardSource],
      ['evidence.ts', proxySource],
      ['docs/ENVIRONMENT.md', read('../docs/ENVIRONMENT.md')],
      ['runbook', read('../docs/HOSTED_VALIDATION_RUNBOOK.md')],
    ] as const) {
      // The claim must always be scoped. A bare "sign-out revokes the token"
      // would be false for every other endpoint on the project.
      const sentences = text.split(/(?<=[.\n])/)
      for (const sentence of sentences) {
        if (!/revok/i.test(sentence)) continue
        if (!/\baccess token\b|\bJWT\b/i.test(sentence)) continue
        const scoped = /evidence|proxy|session table|auth\.sessions|refresh token|NOT\b|not\b/i.test(
          sentence,
        )
        expect(scoped, `${name}: unscoped revocation claim — "${sentence.trim()}"`).toBe(true)
      }
    }
  })

  it('states the distinction in the migration itself', () => {
    expect(migration).toMatch(/does not change it|not acceptable/i)
    expect(migration).toContain('auth.sessions')
  })

  it('exposes the guard as a boolean-only, service-role-only function', () => {
    expect(migration).toMatch(/returns\s+boolean/)
    expect(migration).toMatch(/security\s+definer/)
    expect(migration).toMatch(/set\s+search_path\s*=/)
    expect(migration).toMatch(/revoke all on function[\s\S]*?from public/)
    expect(migration).toMatch(/revoke all on function[\s\S]*?from anon/)
    expect(migration).toMatch(/revoke all on function[\s\S]*?from authenticated/)
    expect(migration).toMatch(/grant execute on function[\s\S]*?to service_role/)
    // It must not hand back anything from the session row.
    expect(migration).not.toMatch(/returns\s+(setof|table|record|uuid|timestamptz)/i)
  })
})
