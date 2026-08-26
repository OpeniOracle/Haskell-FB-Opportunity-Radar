/**
 * The browser's Supabase client.
 *
 * Holds the PUBLISHABLE (anon) key, which Vite compiles into the bundle and
 * anyone can read. That is expected and safe only because migration 0015 puts
 * row-level security on every table: `anon` can read nothing, and an
 * authenticated session can read the dashboard tables and write none of them.
 *
 * If RLS were ever disabled, this key would become a full read of the database.
 * That is why `db/test.mjs` asserts the posture as a contract test rather than
 * trusting a Supabase dashboard toggle to stay where someone left it.
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
  readonly anonKey: string
  readonly radarEnv: string
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
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
  if (!url || !anonKey) return null
  return {
    url,
    anonKey,
    radarEnv: import.meta.env.VITE_RADAR_ENV ?? 'development',
  }
}

let cached: SupabaseClient | null = null

export function supabaseBrowser(): SupabaseClient | null {
  if (cached) return cached
  const config = browserConfig()
  if (!config) return null
  cached = createClient(config.url, config.anonKey, {
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
