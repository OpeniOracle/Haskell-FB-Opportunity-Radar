import type {
  AuthChangeEvent,
  AuthPort,
  AuthSession,
  InvitationStanding,
  RedeemResult,
  SignInFailure,
} from '@/auth/authPort'
import type { UrlCredential } from '@/auth/urlCredentials'

/**
 * A controllable authentication provider, for tests.
 *
 * Every state this application has to handle — an expired invitation, a spent
 * one, a session that dies mid-visit, an account removed from the allowlist —
 * is a thing that happens to a real project on a real day and cannot be
 * produced on demand. Here they are one method call.
 *
 * It implements the same `AuthPort` the production adapter does, so a page
 * cannot pass against this fake by doing something the real port would refuse:
 * the port is the contract, and both sides are held to it.
 */

export const TEST_USER_EMAIL = 'analyst@openi-analytics.invalid'

export function makeSession(overrides: Partial<AuthSession['user']> = {}): AuthSession {
  return {
    accessToken: 'test-access-token',
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    user: {
      id: '11111111-1111-4111-8111-111111111111',
      email: TEST_USER_EMAIL,
      isAnonymous: false,
      ...overrides,
    },
  }
}

export interface FakeAuthOptions {
  /** The session `getSession()` resolves with on first load. */
  readonly initialSession?: AuthSession | null
  /** What `confirmStanding()` answers. Default `invited`. */
  readonly standing?: InvitationStanding
  /** What `redeem()` returns. Default: a session, as a successful invitation. */
  readonly redeemResult?: RedeemResult
  /** What `signInWithPassword()` does. Default: succeeds. */
  readonly signInFailure?: SignInFailure
  /** Simulate a build with no Supabase project. */
  readonly configured?: boolean
  /** Make `getSession()` reject, as an unreachable provider would. */
  readonly getSessionThrows?: boolean
}

export class FakeAuth implements AuthPort {
  readonly configured: boolean

  /** Everything the port was asked to do, in order. Assertable. */
  readonly calls: string[] = []
  readonly recoveryEmails: { email: string; redirectTo: string }[] = []
  readonly passwordUpdates: string[] = []
  /** The credentials handed to `redeem`, so a test can assert what was parsed. */
  readonly redeemed: UrlCredential[] = []

  standing: InvitationStanding
  redeemResult: RedeemResult
  signInFailure: SignInFailure | null
  updatePasswordFailure: string | null = null

  private session: AuthSession | null
  private readonly getSessionThrows: boolean
  private handlers: ((event: AuthChangeEvent, session: AuthSession | null) => void)[] = []

  constructor(options: FakeAuthOptions = {}) {
    this.configured = options.configured ?? true
    this.session = options.initialSession ?? null
    this.standing = options.standing ?? 'invited'
    this.redeemResult = options.redeemResult ?? { ok: true, session: makeSession() }
    this.signInFailure = options.signInFailure ?? null
    this.getSessionThrows = options.getSessionThrows ?? false
  }

  /**
   * The synchronous pre-fill described in `AuthPort.peekSession`.
   *
   * Present ONLY here. The Supabase port has no such path, so production always
   * passes through the pending state; `authGate.test.tsx` uses a port with
   * these removed, so the no-flash guarantee is proven without them.
   */
  peekSession(): AuthSession | null {
    return this.session
  }

  peekStanding(): InvitationStanding | null {
    return this.standing
  }

  async getSession(): Promise<AuthSession | null> {
    this.calls.push('getSession')
    if (this.getSessionThrows) throw new Error('provider unreachable')
    return this.session
  }

  onAuthStateChange(handler: (event: AuthChangeEvent, session: AuthSession | null) => void) {
    this.handlers.push(handler)
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler)
    }
  }

  async signInWithPassword(email: string, password: string) {
    this.calls.push(`signInWithPassword:${email}`)
    if (this.signInFailure) return { ok: false as const, failure: this.signInFailure }
    if (!password) return { ok: false as const, failure: { code: 'invalid_credentials' as const } }
    this.session = makeSession({ email })
    return { ok: true as const, session: this.session }
  }

  async signOut() {
    this.calls.push('signOut')
    this.session = null
  }

  async updatePassword(password: string) {
    this.calls.push('updatePassword')
    if (this.updatePasswordFailure) {
      return { ok: false as const, message: this.updatePasswordFailure }
    }
    this.passwordUpdates.push(password)
    return { ok: true as const }
  }

  async sendRecoveryEmail(email: string, redirectTo: string) {
    this.calls.push(`sendRecoveryEmail:${email}`)
    this.recoveryEmails.push({ email, redirectTo })
  }

  async redeem(credential: UrlCredential): Promise<RedeemResult> {
    this.calls.push(`redeem:${credential.kind}`)
    this.redeemed.push(credential)
    // Mirrors the real port: a callback with nothing in it, or one carrying a
    // failure Supabase already reported, is refused before any exchange. A fake
    // that redeemed those would let a broken page pass.
    if (credential.kind === 'none') return { ok: false, reason: 'missing' }
    if (credential.kind === 'error') return { ok: false, reason: credential.reason }
    if (this.redeemResult.ok) this.session = this.redeemResult.session
    return this.redeemResult
  }

  async confirmStanding(accessToken: string): Promise<InvitationStanding> {
    this.calls.push(`confirmStanding:${accessToken.slice(0, 8)}`)
    return this.standing
  }

  // ---- Test controls -----------------------------------------------------

  /** What the provider does when a token cannot be refreshed, or a tab signs out. */
  expireSession() {
    this.session = null
    for (const handler of this.handlers) handler('SIGNED_OUT', null)
  }

  /** A session arriving from elsewhere — another tab, or a redeemed link. */
  emit(event: AuthChangeEvent, session: AuthSession | null) {
    this.session = session
    for (const handler of this.handlers) handler(event, session)
  }

  /** Remove this account from the invitation allowlist, server-side. */
  removeFromAllowlist() {
    this.standing = 'not_invited'
  }

  get currentSession(): AuthSession | null {
    return this.session
  }
}

/** A fake that is already signed in — the default for surface tests. */
export function signedIn(overrides: FakeAuthOptions = {}): FakeAuth {
  return new FakeAuth({ initialSession: makeSession(), ...overrides })
}

/** A fake that is signed out. */
export function signedOut(overrides: FakeAuthOptions = {}): FakeAuth {
  return new FakeAuth({ initialSession: null, ...overrides })
}

/**
 * The same fake with the synchronous pre-fill removed.
 *
 * Production semantics: no provider can answer "is anyone signed in" without a
 * round trip, so the first paint is always `loading`. Gate tests use this so the
 * no-flash guarantee is proven against how the application actually behaves,
 * not against the shortcut that spares six hundred surface tests an await.
 */
export function withoutPrefill(fake: FakeAuth): AuthPort {
  const port = fake as AuthPort & { peekSession?: unknown; peekStanding?: unknown }
  return new Proxy(port, {
    get(target, property, receiver) {
      if (property === 'peekSession' || property === 'peekStanding') return undefined
      const value = Reflect.get(target, property, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    },
  }) as AuthPort
}

/** A provider that never answers — the state a hung network leaves you in. */
export function neverResolves(): AuthPort {
  return {
    configured: true,
    getSession: () => new Promise<AuthSession | null>(() => {}),
    onAuthStateChange: () => () => {},
    signInWithPassword: async () => ({ ok: false, failure: { code: 'unavailable' } }),
    signOut: async () => {},
    updatePassword: async () => ({ ok: false, message: 'unavailable' }),
    sendRecoveryEmail: async () => {},
    redeem: () => new Promise(() => {}),
    confirmStanding: () => new Promise<InvitationStanding>(() => {}),
  }
}
