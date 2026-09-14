/**
 * Emit `dist/_headers` with a Content-Security-Policy naming THIS deployment's
 * Supabase project.
 *
 * The policy has to be generated rather than written into `netlify.toml`,
 * because the one origin the browser is allowed to talk to is the project URL,
 * and that differs between the development project, a preview and production.
 * A static policy could only be permissive enough to cover all three, which is
 * the opposite of what a narrow allowlist is for.
 *
 * With no `VITE_SUPABASE_URL` configured the policy falls back to
 * `connect-src 'self'` — same-origin Netlify Functions only, no Supabase, no
 * anything else. That is the correct posture for a build that has not been
 * pointed at a project: fail closed, not open.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP = dirname(dirname(fileURLToPath(import.meta.url)))
const DIST = join(APP, 'dist')

/**
 * Test seams. A deployment sets neither, and both default to the build output.
 *
 * They exist because `dist/` is shared mutable state: the bundle-secret test
 * runs a real `vite build`, which removes and rewrites the directory, so a
 * concurrent policy test could read `index.html` while it did not exist and see
 * a policy with no script hash in it — a failure with nothing wrong behind it.
 */
const HTML_SOURCE = process.env.CSP_HTML_SOURCE || join(DIST, 'index.html')
const OUTPUT_PATH = process.env.CSP_OUTPUT_PATH || join(DIST, '_headers')

function supabaseOrigins(raw) {
  if (!raw) return []
  let url
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`VITE_SUPABASE_URL is not a valid URL: ${raw}`)
  }
  if (url.protocol !== 'https:') {
    throw new Error(`VITE_SUPABASE_URL must be https, got ${url.protocol}`)
  }
  // HTTPS only. The realtime WebSocket origin is deliberately NOT granted: this
  // application uses Supabase REST, Auth and Storage, and does not open a
  // realtime channel anywhere. Reserving `wss://` for a feature that might
  // arrive later widens the policy today in exchange for nothing, and a CSP that
  // permits more than the app uses stops describing the app.
  //
  // If realtime is ever adopted, add it here in the same change that adds the
  // first `.channel()` call — so the grant and its justification land together.
  return [`https://${url.host}`]
}

/**
 * `index.html` carries one inline script: the pre-paint theme applier, which has
 * to run before first paint or a chosen theme flashes the other one.
 *
 * It is admitted by SHA-256 hash rather than by `'unsafe-inline'`. A hash names
 * exactly that script; `'unsafe-inline'` names every inline script anyone ever
 * adds, including one injected through a rendering bug. Hashing here also means
 * that if the script is edited and the hash is not regenerated, the script stops
 * running loudly instead of the policy silently going slack.
 */
function inlineScriptHashes() {
  let html
  try {
    html = readFileSync(HTML_SOURCE, 'utf8')
  } catch {
    return []
  }
  const hashes = []
  const pattern = /<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g
  let match
  while ((match = pattern.exec(html)) !== null) {
    const body = match[1]
    if (!body) continue
    hashes.push(`'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`)
  }
  return hashes
}

const origins = supabaseOrigins(process.env.VITE_SUPABASE_URL)
const scriptHashes = inlineScriptHashes()

// 'self' covers the same-origin Netlify Functions under /api/*. Everything else
// is enumerated. No wildcards, no scheme-only sources.
const connectSrc = ["'self'", ...origins].join(' ')

/*
   THE MAP AND SPYGLASS ORIGINS, ENUMERATED AND NO WIDER.

   MapLibre needs three things beyond 'self':
     - the Stadia tile host, for style JSON and vector tiles (connect-src)
     - the same host for sprite and glyph images (img-src)
     - `blob:` and `worker-src`, because MapLibre builds its workers and its
       canvas textures from blobs. Without them the map fails silently.
   NO API KEY IS INVOLVED: Stadia authenticates browser tiles by domain, which
   is why Referrer-Policy in netlify.toml must keep sending an origin.

   Spyglass needs exactly ONE directive: frame-src. Zignal's generated snippet is
   an <iframe>, not a script -- verified against their embed documentation, which
   shows `<iframe width=... src="https://embeddable-widgets…" frameborder="0">`.
   So script-src, connect-src and img-src are NOT widened for it, and must not be
   without inspecting a snippet that actually requires it.
*/
const MAP_TILE_ORIGIN = 'https://tiles.stadiamaps.com'
const SPYGLASS_FRAME_ORIGINS = [
  'https://embeddable-widgets.zignallabs.com',
  'https://embeddable-widgets.staging.zignallabs.com',
]

const policy = [
  "default-src 'self'",
  ["script-src 'self'", ...scriptHashes].join(' '),
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${MAP_TILE_ORIGIN}`,
  "font-src 'self'",
  `connect-src ${connectSrc} ${MAP_TILE_ORIGIN}`,
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
  `frame-src ${SPYGLASS_FRAME_ORIGINS.join(' ')}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ')

/*
   A GUARD ON THE GUARD. Every added origin must be an explicit https host: a
   scheme-only source or a wildcard would quietly readmit everything this policy
   exists to exclude.
*/
for (const origin of [MAP_TILE_ORIGIN, ...SPYGLASS_FRAME_ORIGINS]) {
  if (!/^https:\/\/[a-z0-9.-]+$/.test(origin)) {
    throw new Error(`"${origin}" is not an explicit https origin; the CSP will not be written.`)
  }
}
if (/(\s|;)\*|https:(\s|;|$)/.test(policy)) {
  throw new Error('The generated CSP contains a wildcard or a scheme-only source.')
}

const body = `# Generated by scripts/generate-headers.mjs at build time. Do not edit.
/*
  Content-Security-Policy: ${policy}
`

mkdirSync(dirname(OUTPUT_PATH), { recursive: true })
writeFileSync(OUTPUT_PATH, body, 'utf8')

// A guard, not decoration: `wss:` must not reappear without a deliberate edit
// above, and a generator is exactly the place a stray scheme slips back in.
if (policy.includes('wss:')) {
  throw new Error(
    'The generated CSP grants a WebSocket origin, but this application opens no ' +
      'realtime channel. Remove it, or add it together with the code that needs it.',
  )
}

console.log(
  origins.length
    ? `_headers written; connect-src permits ${origins.join(' and ')}`
    : "_headers written; VITE_SUPABASE_URL is unset so connect-src is 'self' only",
)
console.log(
  scriptHashes.length
    ? `script-src admits ${scriptHashes.length} inline script(s) by hash, not by 'unsafe-inline'`
    : "script-src admits no inline script",
)
