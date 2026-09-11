import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { APP_ROOT } from '@/test/paths'
import {
  MICROSOFT_CONSUMER_TENANT,
  addressesMatch,
  hasMicrosoftIdentity,
  hasVerifiedEmail,
  isPersonalMicrosoftAccount,
  normalizeEmailForAllowlist,
  screenIdentity,
  type IdentityFacts,
} from '../../netlify/functions/_shared/emailIdentity'

/**
 * The server's half of "Microsoft said who you are; may you be here?".
 *
 * These are the rules that actually protect the data. The browser can be
 * bypassed by anybody willing to open a terminal, so every claim the sign-in
 * page makes has to be true here too, and this is where it is asserted.
 *
 * Pure functions, tested as such. The handler around them cannot run in this
 * environment — it needs a live project, a real token and a real allowlist —
 * so the parts that ARE reachable are tested directly and the wiring is held to
 * a contract read from source, the same way the evidence proxy is.
 */

const AZURE = (data: Record<string, unknown>) => ({ provider: 'azure', identity_data: data })

/** A confirmed, organizational, ordinary reviewer. */
const REVIEWER: IdentityFacts = {
  email: 'reviewer@haskell.example',
  email_confirmed_at: '2026-01-01T00:00:00Z',
  is_anonymous: false,
  identities: [AZURE({ email: 'reviewer@haskell.example', tid: 'c0ffee00-0000-4000-8000-000000000001' })],
}

// ---------------------------------------------------------------------------
// Normalization.
// ---------------------------------------------------------------------------

describe('normalizing an address for the allowlist', () => {
  it('lowercases and trims an ordinary address', () => {
    expect(normalizeEmailForAllowlist('  Reviewer@Haskell.Example ')).toBe(
      'reviewer@haskell.example',
    )
  })

  it('matches the shape the allowlist stores', () => {
    // Migration 0016 constrains rows to `lower(trim(email))`. A normalizer that
    // produced anything else would simply never match, and the failure would
    // look like a missing invitation rather than a bug.
    const normalized = normalizeEmailForAllowlist('Reviewer@Haskell.Example')
    expect(normalized).toBe(normalized?.trim().toLowerCase())
  })

  const REFUSED: [string, unknown][] = [
    ['nothing at all', ''],
    ['whitespace only', '   '],
    ['not a string', 42],
    ['null', null],
    ['undefined', undefined],
    ['no at sign', 'reviewer.haskell.example'],
    ['two at signs', 'a@b@haskell.example'],
    ['no domain dot', 'reviewer@haskell'],
    ['an internal space', 'rev iewer@haskell.example'],
    ['a leading dot in the domain', 'reviewer@.haskell.example'],
    ['an empty local part', '@haskell.example'],
    ['absurd length', `${'a'.repeat(400)}@haskell.example`],
  ]

  for (const [name, value] of REFUSED) {
    it(`refuses ${name}`, () => {
      expect(normalizeEmailForAllowlist(value as string)).toBeNull()
    })
  }

  it('refuses an address carrying a control character', () => {
    // A newline or tab that one parser strips and another keeps is the
    // disagreement, and the disagreement is the vulnerability.
    expect(normalizeEmailForAllowlist('reviewer\u0000@haskell.example')).toBeNull()
    expect(normalizeEmailForAllowlist('reviewer\u000a@haskell.example')).toBeNull()
    expect(normalizeEmailForAllowlist('reviewer\u0009@haskell.example')).toBeNull()
    expect(normalizeEmailForAllowlist('reviewer@haskell.example\u007f')).toBeNull()
  })

  it('still trims ordinary surrounding whitespace rather than refusing it', () => {
    // Trailing whitespace is a paste artefact, not an attack. Trimming happens
    // before the control-character check for exactly this reason.
    expect(normalizeEmailForAllowlist('  reviewer@haskell.example\n')).toBe(
      'reviewer@haskell.example',
    )
  })

  /*
     THE NORMALIZATION-DISAGREEMENT CASES.

     Postgres lowercases the allowlist row; JavaScript lowercases the incoming
     address. For ASCII the two agree. For these they need not, and an address
     that matches in one system and not the other is a bypass in one direction
     and a lockout in the other. Both are refused rather than guessed at.
  */
  it('refuses a compatibility-equivalent lookalike', () => {
    // U+FB00 is compatibility-equivalent to "ff".
    expect(normalizeEmailForAllowlist('staﬀ@haskell.example')).toBeNull()
  })

  it('refuses the dotted capital I, whose lowercase is two code points', () => {
    expect(normalizeEmailForAllowlist('İnfo@haskell.example')).toBeNull()
  })

  it('refuses a fullwidth at sign that would fold to an ordinary one', () => {
    expect(normalizeEmailForAllowlist('reviewer＠haskell.example')).toBeNull()
  })

  it('treats two spellings of the same address as the same address', () => {
    expect(addressesMatch(' Reviewer@Haskell.Example ', 'reviewer@haskell.example')).toBe(true)
  })

  it('treats an unusable address as matching nothing, including itself', () => {
    // Null means DENY at every call site. It must never fall through to a
    // looser comparison.
    expect(addressesMatch('staﬀ@haskell.example', 'staﬀ@haskell.example')).toBe(false)
    expect(addressesMatch(null, null)).toBe(false)
  })

  it('does not treat different reviewers as the same person', () => {
    expect(addressesMatch('a@haskell.example', 'b@haskell.example')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Recognising a Microsoft identity.
// ---------------------------------------------------------------------------

describe('recognising a Microsoft identity', () => {
  it('finds one on the identities list', () => {
    expect(hasMicrosoftIdentity(REVIEWER)).toBe(true)
  })

  it('finds one named by any of the slugs Supabase and GoTrue have used', () => {
    for (const provider of ['azure', 'Azure', 'microsoft', 'azure-ad', 'entra']) {
      expect(hasMicrosoftIdentity({ identities: [{ provider, identity_data: {} }] })).toBe(true)
    }
  })

  it('finds one recorded only in app metadata', () => {
    expect(hasMicrosoftIdentity({ app_metadata: { provider: 'azure' } })).toBe(true)
    expect(hasMicrosoftIdentity({ app_metadata: { providers: ['email', 'azure'] } })).toBe(true)
  })

  it('does not see one on a password-only account', () => {
    expect(
      hasMicrosoftIdentity({
        app_metadata: { provider: 'email', providers: ['email'] },
        identities: [{ provider: 'email', identity_data: {} }],
      }),
    ).toBe(false)
  })
})

describe('a personal Microsoft account', () => {
  it('is recognised by the consumer tenant', () => {
    expect(
      isPersonalMicrosoftAccount({
        identities: [AZURE({ email: 'someone@outlook.example', tid: MICROSOFT_CONSUMER_TENANT })],
      }),
    ).toBe(true)
  })

  it('is recognised however the tenant claim is spelled', () => {
    for (const key of ['tid', 'tenant_id', 'tenantId']) {
      expect(
        isPersonalMicrosoftAccount({
          identities: [AZURE({ email: 'a@b.example', [key]: MICROSOFT_CONSUMER_TENANT })],
        }),
      ).toBe(true)
    }
  })

  it('is not confused with an organizational account', () => {
    expect(isPersonalMicrosoftAccount(REVIEWER)).toBe(false)
  })

  /*
     ABSENCE OF THE CLAIM IS NOT EVIDENCE.

     A token that never carried `tid` tells us nothing, and refusing on "we were
     not told" would break every password sign-in. That is precisely why the
     application registration's supported-account-types setting is the PRIMARY
     control and this is the second line — a distinction the setup report has to
     state, because a reader who believes this check is the whole defence would
     configure the registration wrongly.
  */
  it('does not treat a missing tenant claim as personal', () => {
    expect(isPersonalMicrosoftAccount({ identities: [AZURE({ email: 'a@b.example' })] })).toBe(false)
    expect(isPersonalMicrosoftAccount({ email: 'a@b.example' })).toBe(false)
  })

  it('ignores a tenant claim sitting on a non-Microsoft identity', () => {
    expect(
      isPersonalMicrosoftAccount({
        identities: [{ provider: 'email', identity_data: { tid: MICROSOFT_CONSUMER_TENANT } }],
      }),
    ).toBe(false)
  })
})

describe('whether the address was ever confirmed', () => {
  it('accepts a confirmed account', () => {
    expect(hasVerifiedEmail(REVIEWER)).toBe(true)
    expect(hasVerifiedEmail({ confirmed_at: '2026-01-01T00:00:00Z' })).toBe(true)
  })

  it('refuses one that was never confirmed', () => {
    expect(hasVerifiedEmail({ email: 'a@b.example' })).toBe(false)
    expect(hasVerifiedEmail({ email_confirmed_at: null })).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// The screen, which is what actually decides.
// ---------------------------------------------------------------------------

describe('screening a caller before the allowlist is consulted', () => {
  it('admits a confirmed organizational reviewer', () => {
    expect(screenIdentity(REVIEWER)).toEqual({ ok: true, email: 'reviewer@haskell.example' })
  })

  it('normalizes the address it hands on to the allowlist lookup', () => {
    const result = screenIdentity({ ...REVIEWER, email: '  Reviewer@Haskell.Example  ' })
    expect(result).toEqual({ ok: true, email: 'reviewer@haskell.example' })
  })

  it('refuses an anonymous session', () => {
    expect(screenIdentity({ ...REVIEWER, is_anonymous: true })).toEqual({
      ok: false,
      refusal: 'anonymous',
    })
  })

  it('refuses an account with no address', () => {
    expect(screenIdentity({ ...REVIEWER, email: null })).toEqual({
      ok: false,
      refusal: 'unusable_email',
    })
  })

  it('refuses an address that cannot be compared safely', () => {
    expect(screenIdentity({ ...REVIEWER, email: 'staﬀ@haskell.example' })).toEqual({
      ok: false,
      refusal: 'unusable_email',
    })
  })

  /*
     THE UNVERIFIED-EMAIL CASE.

     An email address in a token is a CLAIM. In a tenant that permits it, a
     directory administrator can set a user's mail attribute to any string they
     like — including a reviewer's. If an unverified address were allowed to
     match an allowlist row, that would be access to somebody else's account
     with no password involved.
  */
  it('refuses an unverified address', () => {
    expect(
      screenIdentity({ ...REVIEWER, email_confirmed_at: null, confirmed_at: null }),
    ).toEqual({ ok: false, refusal: 'email_unverified' })
  })

  it('refuses a personal Microsoft account', () => {
    expect(
      screenIdentity({
        ...REVIEWER,
        identities: [AZURE({ email: REVIEWER.email, tid: MICROSOFT_CONSUMER_TENANT })],
      }),
    ).toEqual({ ok: false, refusal: 'personal_microsoft_account' })
  })

  it('leaves a password-only account entirely unaffected', () => {
    // The recovery-code and password journeys must not change because Microsoft
    // sign-in was added beside them.
    expect(
      screenIdentity({
        email: 'reviewer@haskell.example',
        email_confirmed_at: '2026-01-01T00:00:00Z',
        app_metadata: { provider: 'email', providers: ['email'] },
        identities: [{ provider: 'email', identity_data: { email: 'reviewer@haskell.example' } }],
      }),
    ).toEqual({ ok: true, email: 'reviewer@haskell.example' })
  })

  it('grants nothing on the strength of a domain', () => {
    // Screening says "this caller is usable", never "this caller is allowed".
    // The allowlist is the only thing that grants access, and it is a separate
    // lookup that this function deliberately does not perform.
    for (const email of [
      'stranger@haskell.com',
      'stranger@openi-analytics.com',
      'stranger@haskell.example',
    ]) {
      const result = screenIdentity({ ...REVIEWER, email })
      expect(result.ok).toBe(true)
      expect(result).not.toHaveProperty('invited')
      expect(result).not.toHaveProperty('authorized')
    }
  })
})

// ---------------------------------------------------------------------------
// The wiring, held to a contract read from source.
// ---------------------------------------------------------------------------

describe('the caller gate uses these rules', () => {
  const authSource = readFileSync(
    join(APP_ROOT, 'netlify/functions/_shared/auth.ts'),
    'utf8',
  )
  const sessionSource = readFileSync(join(APP_ROOT, 'netlify/functions/session.ts'), 'utf8')

  it('screens the identity before reading the allowlist', () => {
    expect(authSource).toContain('screenIdentity')
    const screenAt = authSource.indexOf('screenIdentity(data.user')
    const queryAt = authSource.indexOf("from('auth_invite_allowlist')")
    expect(screenAt).toBeGreaterThan(-1)
    expect(queryAt).toBeGreaterThan(screenAt)
  })

  it('queries the allowlist with the NORMALIZED address, not the raw one', () => {
    // `.eq` is an exact match. Handing it an unnormalized address would miss
    // every row and look like a missing invitation.
    expect(authSource).toMatch(/\.eq\('email_normalized', screened\.email\)/)
    expect(authSource).not.toMatch(/\.eq\('email_normalized', email\.trim\(\)\.toLowerCase\(\)\)/)
  })

  it('re-reads the allowlist per request rather than trusting the token', () => {
    expect(authSource).toMatch(/from\('auth_invite_allowlist'\)/)
  })

  it('never returns the refusal reason to a client', () => {
    // Which rule refused somebody is a fact about their account. The endpoint
    // answers one boolean and nothing else.
    expect(sessionSource).not.toContain('refusal')
    expect(sessionSource).toMatch(/invited: caller\.invited/)
  })

  it('logs no address, token or provider response', () => {
    for (const source of [authSource, sessionSource]) {
      expect(source).not.toMatch(/console\.(log|info|warn|error|debug)/)
    }
  })

  it('grants nothing from a domain or a tenant anywhere in the gate', () => {
    expect(authSource).not.toMatch(/haskell\.com|openi-analytics\.com/)
    expect(authSource).not.toMatch(/endsWith\(['"]@/)
  })
})
