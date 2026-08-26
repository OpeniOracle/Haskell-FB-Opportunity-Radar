/**
 * The server-side environment contract.
 *
 * Every secret the Radar holds is read here and nowhere else, so "what does this
 * application need, and which of it is confidential" has one answer you can read
 * in one file.
 *
 * NOTHING in this module may be imported from `app/src`. These values live only
 * in the Netlify Functions runtime. A `VITE_`-prefixed variable is compiled into
 * the browser bundle by Vite and is therefore public by construction.
 *
 * ---------------------------------------------------------------------------
 * KEY SYSTEM
 *
 * This project uses Supabase's CURRENT API keys, not the legacy JWT pair:
 *
 *   sb_publishable_…   browser. Not confidential. Identifies the project and
 *                      nothing else; RLS is what protects the data.
 *   sb_secret_…        server only. Confidential. BYPASSES RLS entirely, and is
 *                      independently rotatable without invalidating sessions.
 *
 * The legacy `anon` / `service_role` JWTs are deliberately NOT configured. They
 * are a single rotation unit — rotating the service key invalidates the anon key
 * and signs every user out — and they are indistinguishable from each other by
 * shape, so a paste error puts a full-database key in the browser bundle and
 * nothing complains. `assertKeyShapes` below rejects both mistakes by name.
 * ---------------------------------------------------------------------------
 */

export type ModelProvider = 'anthropic' | 'bedrock' | 'vertex'

export interface ServerEnv {
  readonly supabaseUrl: string
  /**
   * The publishable key, server-side.
   *
   * Not a secret, and not a duplicate by accident: under the current key system
   * a user-scoped request needs the publishable key as `apikey` AND the user's
   * token as `Authorization`. Without it there is no way to read as the caller,
   * and every read would have to go through the secret key — which is exactly
   * the RLS bypass this contract exists to prevent.
   */
  readonly supabasePublishableKey: string
  readonly supabaseSecretKey: string
  readonly evidenceBucket: string
  readonly egressAllowlist: readonly string[]
  readonly secEdgarUserAgent: string
  readonly secContactConfirmed: boolean
  readonly ingestSharedSecret: string
  readonly radarEnv: 'development' | 'preview' | 'production'
}

export interface ModelEnv {
  readonly provider: ModelProvider
  readonly apiKey: string
  readonly modelId: string
  readonly promptVersion: string
}

export class MissingEnvError extends Error {
  constructor(readonly names: readonly string[]) {
    super(
      `Missing required environment variable(s): ${names.join(', ')}. ` +
        'See docs/ENVIRONMENT.md.',
    )
    this.name = 'MissingEnvError'
  }
}

export class KeyShapeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'KeyShapeError'
  }
}

function read(name: string): string | undefined {
  const value = process.env[name]
  return value && value.trim() !== '' ? value.trim() : undefined
}

function require_(names: string[]): Record<string, string> {
  const found: Record<string, string> = {}
  const missing: string[] = []
  for (const name of names) {
    const value = read(name)
    if (value === undefined) missing.push(name)
    else found[name] = value
  }
  if (missing.length) throw new MissingEnvError(missing)
  return found
}

/** A JWT-shaped value: three base64url segments. The legacy key format. */
export function looksLikeLegacyJwtKey(value: string): boolean {
  return /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)
}

export function looksLikeSecretKey(value: string): boolean {
  return value.startsWith('sb_secret_')
}

export function looksLikePublishableKey(value: string): boolean {
  return value.startsWith('sb_publishable_')
}

/**
 * Reject the two mistakes that are otherwise silent.
 *
 * A secret key in the browser bundle is a full read AND write of every table,
 * published to every visitor. A publishable key on the server produces a
 * function that mysteriously reads nothing, because RLS applies to it. Both are
 * one paste away, and neither raises an error on its own.
 */
export function assertKeyShapes(): void {
  const leaked = Object.keys(process.env).filter((k) => {
    if (!k.startsWith('VITE_')) return false
    const value = process.env[k] ?? ''
    return looksLikeSecretKey(value) || /SECRET|SERVICE_ROLE|PASSWORD|DB_URL/i.test(k)
  })
  if (leaked.length) {
    throw new KeyShapeError(
      `Secret-shaped values are exposed to the browser bundle: ${leaked.join(', ')}. ` +
        'Only the publishable key belongs behind a VITE_ prefix.',
    )
  }

  const secret = read('SUPABASE_SECRET_KEY')
  if (secret !== undefined) {
    if (looksLikePublishableKey(secret)) {
      throw new KeyShapeError(
        'SUPABASE_SECRET_KEY holds a publishable key. Server writes would silently ' +
          'read nothing, because row-level security applies to a publishable key.',
      )
    }
    if (looksLikeLegacyJwtKey(secret)) {
      throw new KeyShapeError(
        'SUPABASE_SECRET_KEY holds a legacy JWT service_role key. This project uses ' +
          'the current sb_secret_… keys, which rotate independently of the ' +
          'publishable key and of user sessions. See docs/ENVIRONMENT.md.',
      )
    }
    if (!looksLikeSecretKey(secret)) {
      throw new KeyShapeError('SUPABASE_SECRET_KEY must be an sb_secret_… key.')
    }
  }

  const publishable = read('SUPABASE_PUBLISHABLE_KEY')
  if (publishable !== undefined) {
    if (looksLikeSecretKey(publishable)) {
      throw new KeyShapeError(
        'SUPABASE_PUBLISHABLE_KEY holds a SECRET key. User-scoped reads would run ' +
          'with row-level security bypassed — the exact failure this split prevents.',
      )
    }
    if (looksLikeLegacyJwtKey(publishable)) {
      throw new KeyShapeError(
        'SUPABASE_PUBLISHABLE_KEY holds a legacy JWT key. This project uses the ' +
          'current sb_publishable_… keys. See docs/ENVIRONMENT.md.',
      )
    }
    if (!looksLikePublishableKey(publishable)) {
      throw new KeyShapeError('SUPABASE_PUBLISHABLE_KEY must be an sb_publishable_… key.')
    }
  }

  // The legacy names must not be configured at all. Their presence means someone
  // reintroduced the old pair, and the old pair is what this contract replaced.
  for (const legacy of [
    'SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_ANON_KEY',
    'VITE_SUPABASE_ANON_KEY',
  ]) {
    if (read(legacy) !== undefined) {
      throw new KeyShapeError(
        `${legacy} is set. This project uses sb_publishable_… and sb_secret_… keys; ` +
          'the legacy pair is deliberately not configured. See docs/ENVIRONMENT.md.',
      )
    }
  }
}

export function serverEnv(): ServerEnv {
  assertKeyShapes()
  const v = require_([
    'SUPABASE_URL',
    'SUPABASE_PUBLISHABLE_KEY',
    'SUPABASE_SECRET_KEY',
    'SEC_EDGAR_USER_AGENT',
    'INGEST_SHARED_SECRET',
  ])
  const radarEnv = read('RADAR_ENV') ?? 'development'
  if (radarEnv !== 'development' && radarEnv !== 'preview' && radarEnv !== 'production') {
    throw new Error(`RADAR_ENV must be development, preview or production; got "${radarEnv}".`)
  }
  return {
    supabaseUrl: v.SUPABASE_URL!,
    supabasePublishableKey: v.SUPABASE_PUBLISHABLE_KEY!,
    supabaseSecretKey: v.SUPABASE_SECRET_KEY!,
    evidenceBucket: read('SUPABASE_EVIDENCE_BUCKET') ?? 'evidence-raw',
    egressAllowlist: (read('EGRESS_ALLOWLIST') ?? '')
      .split(',')
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
    secEdgarUserAgent: v.SEC_EDGAR_USER_AGENT!,
    secContactConfirmed: read('SEC_CONTACT_CONFIRMED') === 'confirmed',
    ingestSharedSecret: v.INGEST_SHARED_SECRET!,
    radarEnv,
  }
}

/**
 * The model gateway's configuration, separately obtainable because the rest of
 * the foundation must work without it.
 *
 * Returns null rather than throwing when the credential is absent. The pilot is
 * explicitly permitted to run every non-model stage without it, and the one
 * thing it must never do is invent a classification to fill the gap.
 */
export function modelEnv(): ModelEnv | null {
  const apiKey = read('MODEL_API_KEY')
  if (!apiKey) return null

  const provider = (read('MODEL_PROVIDER') ?? 'anthropic') as ModelProvider
  if (provider !== 'anthropic' && provider !== 'bedrock' && provider !== 'vertex') {
    throw new Error(`MODEL_PROVIDER must be anthropic, bedrock or vertex; got "${provider}".`)
  }
  const modelId = read('MODEL_ID')
  if (!modelId) throw new MissingEnvError(['MODEL_ID'])

  return {
    provider,
    apiKey,
    modelId,
    promptVersion: read('MODEL_PROMPT_VERSION') ?? 'v0',
  }
}

/**
 * SEC requires a declared User-Agent carrying an address a human actually
 * monitors, and rate-limits to 10 requests per second.
 *
 * A syntactically valid address is NOT the requirement. The requirement is that
 * someone reads what arrives there, and that is a fact about a mailbox rather
 * than about a string — no amount of parsing can establish it. So the address
 * counts as unresolved until an operator explicitly sets
 * `SEC_CONTACT_CONFIRMED=confirmed`, and the connector refuses to run until then.
 *
 * The failure mode without this is silent: SEC serves the request either way,
 * and nobody discovers the mailbox is unread until they needed to be reachable.
 */
export function assertSecUserAgentUsable(env: ServerEnv): void {
  const userAgent = env.secEdgarUserAgent
  if (/<[^>]+>/.test(userAgent)) {
    throw new Error(
      `SEC_EDGAR_USER_AGENT still contains an unresolved placeholder: "${userAgent}". ` +
        'Sending it would be a false contact declaration to a federal regulator.',
    )
  }
  if (!/[^\s@]+@[^\s@]+\.[^\s@]+/.test(userAgent)) {
    throw new Error(
      'SEC_EDGAR_USER_AGENT must contain a contact email address. See docs/ENVIRONMENT.md.',
    )
  }
  if (!env.secContactConfirmed) {
    throw new Error(
      'The SEC contact address is not confirmed as an actively monitored mailbox. ' +
        'Set SEC_CONTACT_CONFIRMED=confirmed only once an operator has verified that ' +
        'someone reads it. No SEC request may be sent before then.',
    )
  }
}

/** The names a deployment must set, for documentation and for the health check. */
export const REQUIRED_SERVER_VARS = [
  'SUPABASE_URL',
  'SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_SECRET_KEY',
  'SEC_EDGAR_USER_AGENT',
  'INGEST_SHARED_SECRET',
] as const

export const OPTIONAL_SERVER_VARS = [
  'SUPABASE_DB_URL',
  'SUPABASE_EVIDENCE_BUCKET',
  'EGRESS_ALLOWLIST',
  'SEC_CONTACT_CONFIRMED',
  'MODEL_PROVIDER',
  'MODEL_API_KEY',
  'MODEL_ID',
  'MODEL_PROMPT_VERSION',
  'RADAR_ENV',
] as const

/** Names that must never be configured. Asserted by CI and by `assertKeyShapes`. */
export const FORBIDDEN_VARS = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_ANON_KEY',
  'VITE_SUPABASE_ANON_KEY',
  'VITE_SUPABASE_SECRET_KEY',
  'VITE_SUPABASE_SERVICE_ROLE_KEY',
] as const
