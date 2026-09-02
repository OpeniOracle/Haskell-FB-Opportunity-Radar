/**
 * The browser's Supabase client.
 *
 * Holds the PUBLISHABLE key (`sb_publishable_…`), which Vite compiles into the
 * bundle and anyone can read. That is expected: it identifies the project and
 * grants nothing on its own. Row-level security is what protects the data —
 * migration 0015 puts RLS on every table, `anon` can read nothing, and an
 * authenticated session can read the dashboard tables and write none of them.
 *
 * The SECRET key (`sb_secret_…`) must never appear here. It bypasses RLS
 * entirely and lives only in the Netlify Functions runtime. The two are
 * distinguishable by prefix precisely so that a paste error is catchable, and
 * `boundaries.test.ts` catches it.
 *
 * If RLS were ever disabled, the publishable key would become a full read of the
 * database. That is why `db/test.mjs` asserts the posture as a contract test
 * rather than trusting a Supabase dashboard toggle to stay where someone left
 * it.
 *
 * Invite-only. There is no `signUp` call anywhere in this application, and
 * self-registration is disabled on the project itself, so an uninvited visitor
 * has no path to an account even if a form appeared.
 *
 * This module and `apiClient.ts` are the only two in `app/src` permitted to
 * touch the network. `boundaries.test.ts` enforces that.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export interface BrowserConfig {
  readonly url: string
  readonly publishableKey: string
  readonly radarEnv: string
  /** Whether this deployment offers "Continue with Microsoft". */
  readonly microsoftSignIn: boolean
}

/**
 * Returns null when the build was not pointed at a project.
 *
 * The application must render a truthful "not configured" state rather than
 * crash on import: a blank page tells a reviewer nothing, and a thrown error at
 * module scope takes the whole bundle down.
 */
export function browserConfig(): BrowserConfig | null {
  const url = import.meta.env.VITE_SUPABASE_URL
  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
  if (!url || !publishableKey) return null
  return {
    url,
    publishableKey,
    radarEnv: import.meta.env.VITE_RADAR_ENV ?? 'development',
    // Exactly `true`, nothing else. See the note in `vite-env.d.ts`: a flag that
    // can be switched on by a typo is not a gate.
    microsoftSignIn: import.meta.env.VITE_AUTH_MICROSOFT_ENABLED === 'true',
  }
}

/**
 * Whether to offer "Continue with Microsoft" on the sign-in page.
 *
 * Two conditions, both required. The flag says this deployment was configured
 * for it; `browserConfig()` returning at all says there is a Supabase project
 * to sign in to. A build with the flag on and no project would render a button
 * that cannot do anything.
 *
 * Read through here rather than from `import.meta.env` directly, because
 * `boundaries.test.ts` holds this module as the only place in `src/` allowed to
 * read build-time configuration — and that rule is worth more than the
 * convenience of reading it where it is used.
 */
export function microsoftSignInEnabled(): boolean {
  return browserConfig()?.microsoftSignIn === true
}

let cached: SupabaseClient | null = null

export function supabaseBrowser(): SupabaseClient | null {
  if (cached) return cached
  const config = browserConfig()
  if (!config) return null
  cached = createClient(config.url, config.publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // The session never appears in the URL. A token in a query string ends up
      // in browser history, in referrer headers, and in shared links.
      detectSessionInUrl: false,
      flowType: 'pkce',
    },
  })
  return cached
}

/** The access token for the current session, or null when signed out. */
export async function currentAccessToken(): Promise<string | null> {
  const client = supabaseBrowser()
  if (!client) return null
  const { data } = await client.auth.getSession()
  return data.session?.access_token ?? null
}
