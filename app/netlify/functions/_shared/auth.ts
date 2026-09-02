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
import { demand, serverEnv } from './env.js'
import { screenIdentity, type AdmissionRefusal, type IdentityFacts } from './emailIdentity.js'

export interface Caller {
  readonly userId: string
  readonly email: string | null
  /**
   * Whether this caller may use the Radar.
   *
   * Named `invited` because that is what it has always meant to every caller,
   * but it is now the conjunction of every admission rule, not the allowlist
   * lookup alone: an unverified address, an unusable one, a personal Microsoft
   * account and a missing allowlist row all produce `false`.
   *
   * That conflation is deliberate rather than sloppy. The one thing this may
   * not do is tell the holder of a browser WHICH rule refused them — "your
   * address is not on the list" and "your address is not verified" are
   * different facts about somebody's account, and the endpoint that answers
   * this question answers it to whoever is holding the token.
   */
  readonly invited: boolean
  readonly isAnonymous: boolean
  /**
   * Which rule refused, for SERVER-SIDE behaviour and for tests. Never returned
   * to a client and never rendered.
   */
  readonly refusal: AdmissionRefusal | null
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

  /*
     EVERYTHING THAT CAN BE DECIDED WITHOUT THE DATABASE, FIRST.

     Anonymity, an address that cannot be compared safely, an unverified
     address, a personal Microsoft account. Screening before the query means a
     caller who was never going to be admitted does not cost a round trip, and
     — more usefully — it means the allowlist is only ever consulted with an
     address that has already been normalized to the same shape the rows are
     stored in.

     Signing in with Microsoft proves identity. It does not authorize anybody,
     and NOTHING below grants access on the strength of a tenant, a directory
     or an email domain.
  */
  const screened = screenIdentity(data.user as IdentityFacts)
  if (!screened.ok) {
    return { userId: data.user.id, email, invited: false, isAnonymous, refusal: screened.refusal }
  }

  // Membership is re-checked on EVERY request, not trusted from the token. A
  // token issued before someone was removed from the allowlist is still
  // cryptographically valid; the allowlist is the current answer.
  const { data: rows } = await client
    .from('auth_invite_allowlist')
    .select('email_normalized')
    .eq('email_normalized', screened.email)
    .limit(1)
  const invited = Array.isArray(rows) && rows.length > 0

  return {
    userId: data.user.id,
    email,
    invited,
    isAnonymous,
    refusal: invited ? null : 'not_allowlisted',
  }
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
  // Demanded HERE rather than at function entry. A deployment with no operator
  // secret cannot authenticate an operator -- but that is a fact about this one
  // code path, and it must not be able to refuse anybody else's request.
  const expected = demand(env.ingestSharedSecret, 'INGEST_SHARED_SECRET')
  const supplied = headers['x-radar-operator-secret'] ?? headers['X-Radar-Operator-Secret']
  if (!supplied || !constantTimeEquals(supplied, expected)) {
    throw new UnauthorizedError('Operator credential required.')
  }
}
