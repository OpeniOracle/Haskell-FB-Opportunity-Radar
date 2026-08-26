/// <reference types="vite/client" />

/**
 * The client-safe environment contract.
 *
 * Everything here is compiled into the JavaScript bundle and is readable by
 * anyone who opens the page. Nothing secret may be added: the publishable
 * ("anon") key is safe here only because row-level security is what actually
 * protects the data. Server-side names live in
 * `netlify/functions/_shared/env.ts` and never carry the VITE_ prefix.
 */
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
  readonly VITE_RADAR_ENV?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
