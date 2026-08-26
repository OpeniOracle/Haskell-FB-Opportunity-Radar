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
 * proves the shape of a token, not that it is currently valid — a revoked or
 * expired session decodes perfectly well.
 */
export async function requireUser(
  headers: Record<string, string | undefined>,
): Promise<Caller> {
  const token = bearer(headers)
  if (!token) throw new UnauthorizedError()

  const env = serverEnv()
  const client = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await client.auth.getUser(token)
  if (error || !data.user) throw new UnauthorizedError('Session is not valid.')

  return { userId: data.user.id, email: data.user.email ?? null }
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
