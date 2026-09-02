/**
 * Turning "who does Microsoft say this is" into "may this person be here".
 *
 * Those are two different questions and this file exists to keep them apart.
 * An identity provider answers the first. The second is answered by one row in
 * `auth_invite_allowlist`, and nothing about a tenant, a domain, a directory or
 * a corporate email suffix is allowed to substitute for it.
 *
 * Everything here is a pure function over values the server already holds, so
 * every rule below is testable without a provider, a browser or a network.
 */

/**
 * The one tenant that is not an organization.
 *
 * Microsoft routes personal accounts — outlook.com, hotmail.com, live.com, and
 * any address someone attached to a consumer Microsoft account — through a
 * fixed pseudo-tenant. The PRIMARY control against personal accounts is the
 * application registration's supported-account-types setting, which is
 * configured in Entra and cannot be asserted from here. This is the second
 * line: if a token from that tenant ever reaches us, it is refused regardless
 * of what the registration says.
 *
 * Not a secret. It is the same fixed value in every Entra tenant on earth and
 * appears throughout Microsoft's own documentation.
 */
export const MICROSOFT_CONSUMER_TENANT = '9188040d-6c67-4c5b-b112-36a304b66dad'

/** Providers that mean "Microsoft Entra ID", across Supabase and GoTrue versions. */
const MICROSOFT_PROVIDERS = new Set(['azure', 'microsoft', 'azure-ad', 'entra'])

/**
 * Normalize an address for EXACT comparison against the allowlist.
 *
 * Returns null when the address cannot be compared safely — and null means
 * DENY at every call site, never "compare it some other way".
 *
 * WHY THIS IS NOT `email.trim().toLowerCase()`.
 *
 * That was the previous rule, and it is a rule that two systems can disagree
 * about. The allowlist row is normalized by Postgres `lower()`; the incoming
 * address is normalized by JavaScript `toLowerCase()`. For ASCII the two are
 * identical. For everything else they are not necessarily:
 *
 *   * `İ` (U+0130) lowercases to two code points in JavaScript and to one in
 *     several Postgres collations.
 *   * `ﬀ` (U+FB00) is compatibility-equivalent to `ff`, so an address that
 *     LOOKS like an allowlisted one can be a different string — or the same
 *     one, depending on who normalizes and when.
 *
 * A disagreement between two normalizers is not a cosmetic bug. It is a way to
 * present an address that matches an allowlist row in one system and not the
 * other, and the direction of that mismatch decides whether it is a bypass or
 * a lockout.
 *
 * So the rule is: normalize conservatively, then REFUSE anything whose
 * normalization is not obviously stable. The addresses this rejects are
 * addresses that must not be silently matched anyway.
 */
export function normalizeEmailForAllowlist(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null

  const trimmed = raw.trim()
  if (trimmed === '' || trimmed.length > 320) return null

  // Any character a parser might strip, fold, or disagree about.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f-\u009f]/.test(trimmed)) return null

  const lowered = trimmed.toLowerCase()

  /*
     PRINTABLE ASCII ONLY, AND THIS IS THE RULE THAT DOES THE WORK.

     The two checks below it — NFKC stability and idempotent lowercasing — are
     worth keeping as belt and braces, but neither is sufficient on its own, and
     believing otherwise is a mistake this file made on its first draft.

     `İ` (U+0130) is the counter-example. JavaScript lowercases it to `i` plus a
     combining dot above (U+0069 U+0307). That two-code-point result is ALREADY
     NFKC-normalized and is ALREADY its own lowercase, so it sails through both
     of the checks below. Several Postgres collations fold the same character to
     a bare `i`. Two systems, two answers, same input — which is exactly the
     disagreement that lets an address match an allowlist row in one place and
     not the other.

     There is no clever normalization that closes that reliably across a
     JavaScript runtime and a Postgres collation whose locale is not ours to
     choose. What closes it is refusing to compare anything where the two can
     differ, and outside printable ASCII they can.

     THE COST, STATED PLAINLY: an address containing a non-ASCII character
     cannot be authorized, even if it is on the allowlist. That is a real
     restriction and it fails CLOSED — such a person is refused, never wrongly
     admitted. Corporate Entra addresses in both tenants are ASCII, so nobody in
     the current cohort is affected; if that ever stops being true, the fix is a
     deliberate decision about a shared normalization, not a quiet loosening of
     this line.
  */
  if (!/^[\u0020-\u007e]+$/.test(lowered)) return null

  /*
     Stable under compatibility normalization. Redundant given the ASCII rule
     above — ASCII is a fixed point of NFKC — and kept because it states the
     property that matters, so a future edit that widens the character set does
     not silently lose it.
  */
  if (lowered.normalize('NFKC') !== lowered) return null

  // Lowercasing must itself be settled. Redundant for the same reason, kept for
  // the same reason.
  if (lowered.toLowerCase() !== lowered) return null

  // One `@`, something either side, a dot in the domain, and no whitespace.
  // Deliberately stricter than RFC 5321 — this is not a validator for the
  // world's addresses, it is a gate for the addresses this project admits.
  if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(lowered)) return null

  return lowered
}

/** Whether two addresses, after normalization, are the same one. */
export function addressesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normalizeEmailForAllowlist(a)
  const right = normalizeEmailForAllowlist(b)
  return left !== null && right !== null && left === right
}

/** The parts of a Supabase user this module reasons about. */
export interface IdentityFacts {
  readonly email?: string | null
  readonly email_confirmed_at?: string | null
  readonly confirmed_at?: string | null
  readonly is_anonymous?: boolean
  readonly app_metadata?: { provider?: string | null; providers?: string[] | null } | null
  readonly user_metadata?: Record<string, unknown> | null
  readonly identities?:
    | readonly {
        provider?: string | null
        identity_data?: Record<string, unknown> | null
      }[]
    | null
}

/** True when any identity on the account came from Microsoft Entra ID. */
export function hasMicrosoftIdentity(user: IdentityFacts): boolean {
  const fromIdentities = (user.identities ?? []).some((identity) =>
    MICROSOFT_PROVIDERS.has(String(identity.provider ?? '').toLowerCase()),
  )
  if (fromIdentities) return true
  const providers = user.app_metadata?.providers ?? []
  return (
    MICROSOFT_PROVIDERS.has(String(user.app_metadata?.provider ?? '').toLowerCase()) ||
    (providers ?? []).some((p) => MICROSOFT_PROVIDERS.has(String(p ?? '').toLowerCase()))
  )
}

/**
 * Whether the account's address has been confirmed.
 *
 * Read from the ACCOUNT, not from the provider's claims. An OAuth sign-in that
 * Supabase declined to treat as verified leaves the account unconfirmed, and an
 * unconfirmed account is one whose address nobody has demonstrated control of.
 * The four pre-provisioned reviewers are confirmed users, so this costs them
 * nothing.
 */
export function hasVerifiedEmail(user: IdentityFacts): boolean {
  return Boolean(user.email_confirmed_at ?? user.confirmed_at)
}

/**
 * Whether this is a personal Microsoft account rather than an organizational one.
 *
 * Absence of the tenant claim is NOT treated as a personal account: a token
 * that never carried `tid` tells us nothing, and refusing on "we were not told"
 * would break every non-Microsoft sign-in. The claim is checked only when it is
 * present, which is why the application registration remains the primary
 * control and this is the second line rather than the first.
 */
export function isPersonalMicrosoftAccount(user: IdentityFacts): boolean {
  const tenants: unknown[] = []
  for (const identity of user.identities ?? []) {
    if (!MICROSOFT_PROVIDERS.has(String(identity.provider ?? '').toLowerCase())) continue
    const data = identity.identity_data ?? {}
    tenants.push(data.tid, data.tenant_id, data.tenantId)
  }
  if (hasMicrosoftIdentity(user)) {
    const meta = user.user_metadata ?? {}
    tenants.push(meta.tid, meta.tenant_id)
  }

  return tenants.some(
    (value) =>
      typeof value === 'string' && value.trim().toLowerCase() === MICROSOFT_CONSUMER_TENANT,
  )
}

/**
 * Why a caller was refused. For BEHAVIOUR and for tests — never rendered.
 *
 * The application shows one generic sentence for every value here. Which rule
 * refused somebody is a fact about their account and about this project's
 * roster, and the person holding the browser is not necessarily entitled to
 * either.
 */
export type AdmissionRefusal =
  | 'anonymous'
  | 'unusable_email'
  | 'email_unverified'
  | 'personal_microsoft_account'
  | 'not_allowlisted'

export type Admission =
  | { readonly ok: true; readonly email: string }
  | { readonly ok: false; readonly refusal: AdmissionRefusal }

/**
 * Everything that can be decided about a caller BEFORE the allowlist is read.
 *
 * Separated from the allowlist lookup so that the database round trip is not
 * made for a caller who was never going to be admitted, and so that the rules
 * are testable as pure functions.
 */
export function screenIdentity(user: IdentityFacts): Admission {
  if (user.is_anonymous === true) return { ok: false, refusal: 'anonymous' }

  const email = normalizeEmailForAllowlist(user.email)
  if (email === null) return { ok: false, refusal: 'unusable_email' }

  if (!hasVerifiedEmail(user)) return { ok: false, refusal: 'email_unverified' }
  if (isPersonalMicrosoftAccount(user)) {
    return { ok: false, refusal: 'personal_microsoft_account' }
  }

  return { ok: true, email }
}
