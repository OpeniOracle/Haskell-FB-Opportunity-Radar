/**
 * The server-side environment contract.
 *
 * Every secret the Radar holds is read here and nowhere else, so "what does this
 * application need, and which of it is secret" has one answer you can read in
 * one file.
 *
 * NOTHING in this module may be imported from `app/src`. These values live only
 * in the Netlify Functions runtime. A `VITE_`-prefixed variable is compiled into
 * the browser bundle by Vite and is therefore public by construction; none of
 * the names below carry that prefix, and `assertNoViteSecrets` fails the process
 * if someone ever adds one.
 */

export type ModelProvider = 'anthropic' | 'bedrock' | 'vertex'

export interface ServerEnv {
  readonly supabaseUrl: string
  readonly supabaseServiceRoleKey: string
  readonly evidenceBucket: string
  readonly egressAllowlist: readonly string[]
  readonly secEdgarUserAgent: string
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

/**
 * A secret that reaches the browser is not a secret. Vite inlines every
 * `VITE_`-prefixed variable at build time, so this asserts that none of the
 * server-only names ever acquires that prefix.
 */
export function assertNoViteSecrets(): void {
  const leaked = Object.keys(process.env).filter(
    (k) =>
      k.startsWith('VITE_') &&
      /SERVICE_ROLE|SECRET|_KEY$|PASSWORD|TOKEN|DB_URL/i.test(k) &&
      k !== 'VITE_SUPABASE_ANON_KEY',
  )
  if (leaked.length) {
    throw new Error(
      `Secret-shaped variables are exposed to the browser bundle: ${leaked.join(', ')}. ` +
        'Remove the VITE_ prefix; only the publishable anon key belongs there.',
    )
  }
}

export function serverEnv(): ServerEnv {
  assertNoViteSecrets()
  const v = require_([
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'SEC_EDGAR_USER_AGENT',
    'INGEST_SHARED_SECRET',
  ])
  const radarEnv = read('RADAR_ENV') ?? 'development'
  if (radarEnv !== 'development' && radarEnv !== 'preview' && radarEnv !== 'production') {
    throw new Error(`RADAR_ENV must be development, preview or production; got "${radarEnv}".`)
  }
  return {
    supabaseUrl: v.SUPABASE_URL!,
    supabaseServiceRoleKey: v.SUPABASE_SERVICE_ROLE_KEY!,
    evidenceBucket: read('SUPABASE_EVIDENCE_BUCKET') ?? 'evidence-raw',
    egressAllowlist: (read('EGRESS_ALLOWLIST') ?? '')
      .split(',')
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
    secEdgarUserAgent: v.SEC_EDGAR_USER_AGENT!,
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
 * thing it must never do is invent a classification to fill the gap — so the
 * caller gets an unmistakable null and fails that stage closed.
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

/** The names a deployment must set, for documentation and for the health check. */
export const REQUIRED_SERVER_VARS = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SEC_EDGAR_USER_AGENT',
  'INGEST_SHARED_SECRET',
] as const

export const OPTIONAL_SERVER_VARS = [
  'SUPABASE_DB_URL',
  'SUPABASE_EVIDENCE_BUCKET',
  'EGRESS_ALLOWLIST',
  'MODEL_PROVIDER',
  'MODEL_API_KEY',
  'MODEL_ID',
  'MODEL_PROMPT_VERSION',
  'RADAR_ENV',
] as const
