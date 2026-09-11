/// <reference types="vite/client" />

/**
 * The client-safe environment contract.
 *
 * Everything here is compiled into the JavaScript bundle and is readable by
 * anyone who opens the page. Nothing secret may be added: the `sb_publishable_…`
 * key is safe here because it grants nothing on its own — row-level security is
 * what protects the data. The `sb_secret_…` key bypasses RLS and lives only in
 * `netlify/functions/_shared/env.ts`, behind no VITE_ prefix.
 */
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string
  readonly VITE_RADAR_ENV?: string
  /**
   * Whether this DEPLOYMENT offers "Continue with Microsoft".
   *
   * A deliberate switch, not a consequence of the code being present. Microsoft
   * sign-in only works where an Entra application registration exists, its
   * credentials have been entered into that Supabase project, and the callback
   * URL matches — none of which is true of a local checkout or a preview build.
   * Showing the button where it cannot work offers people a door that opens
   * onto an error.
   *
   * Off unless the string is exactly `true`. Absent, empty, `1`, `yes` and
   * anything else all mean off: a configuration flag whose failure mode is
   * "enabled by accident" is the wrong way round.
   *
   * Not a secret and not a security control. It decides whether a button is
   * rendered. Every authorization rule holds identically whether it is on
   * or off.
   */
  readonly VITE_AUTH_MICROSOFT_ENABLED?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
