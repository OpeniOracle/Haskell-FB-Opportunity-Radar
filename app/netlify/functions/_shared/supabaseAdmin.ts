/**
 * The service-role Supabase client.
 *
 * This key BYPASSES row-level security. It exists only in the Netlify Functions
 * runtime and must never be imported from `app/src`, referenced in a `VITE_`
 * variable, or returned in a response body.
 *
 * `persistSession: false` because a function invocation has no session to
 * persist; leaving it on writes tokens to whatever storage shim it finds.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { serverEnv } from './env.js'

let cached: SupabaseClient | null = null

export function supabaseAdmin(): SupabaseClient {
  if (cached) return cached
  const env = serverEnv()
  cached = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'X-Radar-Component': 'netlify-function' } },
  })
  return cached
}

/**
 * A client that acts AS THE CALLER, with their JWT, so row-level security
 * applies exactly as it would for a direct browser read.
 *
 * Read paths use this rather than the service role. A read endpoint that used
 * the service role would silently become an RLS bypass with a login page in
 * front of it, which is the failure mode RLS exists to prevent.
 */
export function supabaseAsUser(accessToken: string): SupabaseClient {
  const env = serverEnv()
  return createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  })
}
