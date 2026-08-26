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
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
