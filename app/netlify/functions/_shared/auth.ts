/**
 * Caller authentication for the API functions.
 *
 * Two distinct callers, two distinct mechanisms, deliberately not interchangeable:
 *
 *   A signed-in person    a Supabase Auth JWT in `Authorization: Bearer …`,
 *                         verified by asking Supabase who it belongs to.
 *   An operator           `INGEST_SHARED_SECRET`, compared in constant time.
 *
 * The scheduled ingest function uses NEITHER. It has no HTTP route at all — a
 * schedule invokes it, so there is nothing to authenticate and nothing to
 * expose. The manual administrative trigger is a separate function with the
 * operator mechanism, which is why it exists separately.
 */
import { createClient } from '@supabase/supabase-js'
import { serverEnv } from './env.js'

export interface Caller {
  readonly userId: string
  readonly email: string | null
  /** True only when the address is on `auth_invite_allowlist`. */
  readonly invited: boolean
  readonly isAnonymous: boolean
}

export class UnauthorizedError extends Error {
  constructor(message = 'Authentication required.') {
    super(message)
    this.name = 'UnauthorizedError'
  }
}

function bearer(headers: Record<string, string | undefined>): string | null {
  const raw = headers.authorization ?? headers.Authorization
  if (!raw) return null
  const match = /^Bearer\s+(.+)$/i.exec(raw.trim())
  return match?.[1] ?? null
}

/**
 * Verified against Supabase rather than by decoding the token locally. Decoding
 * proves the SHAPE of a token, not that it is currently valid — a revoked,
 * expired or signed-out session decodes perfectly well, which is precisely the
 * case this must reject.
 */
export async function requireUser(
  headers: Record<string, string | undefined>,
): Promise<Caller> {
  const token = bearer(headers)
  if (!token) throw new UnauthorizedError()

  const env = serverEnv()
  const client = createClient(env.supabaseUrl, env.supabaseSecretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await client.auth.getUser(token)
  if (error || !data.user) throw new UnauthorizedError('Session is not valid.')

  const email = data.user.email ?? null
  const isAnonymous = data.user.is_anonymous === true || email === null

  // Membership is re-checked on EVERY request, not trusted from the token. A
  // token issued before someone was removed from the allowlist is still
  // cryptographically valid; the allowlist is the current answer.
  let invited = false
  if (email) {
    const { data: rows } = await client
      .from('auth_invite_allowlist')
      .select('email_normalized')
      .eq('email_normalized', email.trim().toLowerCase())
      .limit(1)
    invited = Array.isArray(rows) && rows.length > 0
  }

  return { userId: data.user.id, email, invited, isAnonymous }
}

/**
 * A caller who is signed in AND still on the allowlist AND not anonymous.
 *
 * The three are separate questions. Being signed in is not being invited, and an
 * anonymous session is signed in with nobody behind it.
 */
export async function requireInvitedUser(
  headers: Record<string, string | undefined>,
): Promise<Caller> {
  const caller = await requireUser(headers)
  if (caller.isAnonymous) {
    throw new UnauthorizedError('Anonymous sessions are not permitted.')
  }
  if (!caller.invited) {
    throw new UnauthorizedError('This account is not on the invitation allowlist.')
  }
  return caller
}

/** Length-independent comparison, so a wrong secret leaks nothing by timing. */
export function constantTimeEquals(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const ba = enc.encode(a)
  const bb = enc.encode(b)
  let diff = ba.length ^ bb.length
  const n = Math.max(ba.length, bb.length)
  for (let i = 0; i < n; i += 1) {
    diff |= (ba[i] ?? 0) ^ (bb[i] ?? 0)
  }
  return diff === 0
}

export function requireOperator(headers: Record<string, string | undefined>): void {
  const env = serverEnv()
  const supplied = headers['x-radar-operator-secret'] ?? headers['X-Radar-Operator-Secret']
  if (!supplied || !constantTimeEquals(supplied, env.ingestSharedSecret)) {
    throw new UnauthorizedError('Operator credential required.')
  }
}
