/**
 * Server-side Supabase clients.
 *
 * `supabaseAdmin()` holds the **secret** key (`sb_secret_…`), which BYPASSES
 * row-level security. It exists only in the Netlify Functions runtime and must
 * never be imported from `app/src`, placed behind a `VITE_` prefix, logged, or
 * returned in a response body.
 *
 * `persistSession: false` because a function invocation has no session to
 * persist; leaving it on writes tokens to whatever storage shim it finds.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { demand, serverEnv } from './env.js'

let cached: SupabaseClient | null = null

export function supabaseAdmin(): SupabaseClient {
  if (cached) return cached
  const env = serverEnv()
  cached = createClient(env.supabaseUrl, env.supabaseSecretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'X-Radar-Component': 'netlify-function' } },
  })
  return cached
}

/**
 * A client that acts AS THE CALLER, with their access token, so row-level
 * security applies exactly as it would for a direct browser read.
 *
 * Read paths use this rather than the secret key. A read endpoint that used the
 * secret key would silently become an RLS bypass with a login page in front of
 * it, which is the failure mode RLS exists to prevent.
 *
 * Built from the PUBLISHABLE key plus the caller's bearer token — the same pair
 * a browser sends. Passing the secret key as the apikey here would restore the
 * bypass through the back door and the endpoint would report success with every
 * policy missing.
 */
export function supabaseAsUser(accessToken: string): SupabaseClient {
  const env = serverEnv()
  // Demanded at the point of use. Reading as the caller is the only thing that
  // needs the publishable key, so its absence fails reading-as-the-caller and
  // leaves token verification and the session check working.
  const publishable = demand(env.supabasePublishableKey, 'SUPABASE_PUBLISHABLE_KEY')
  return createClient(env.supabaseUrl, publishable, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  })
}
