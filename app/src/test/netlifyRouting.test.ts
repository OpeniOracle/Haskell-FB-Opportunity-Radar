import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { APP_ROOT } from '@/test/paths'

/**
 * Every `/api/*` path must reach a Netlify function, never `index.html`.
 *
 * WHAT THIS EXISTS TO CATCH, STATED AS THE FAILURE IT ACTUALLY WAS.
 *
 * `netlify.toml` declared the API rewrites before the SPA catch-all, in the
 * right order, with a comment explaining the ordering. It was correct. But
 * `app/public/_redirects` carried a COPY of the catch-all — added "so the
 * behaviour survives if netlify.toml is replaced" — and **Netlify processes a
 * `_redirects` file before the rules in `netlify.toml`**. A copy of the last
 * rule, in the file that is read first, is the first rule.
 *
 * So `/*  /index.html  200` matched `/api/session` and Netlify answered 200
 * with the SPA. The client asked for JSON, got HTML, and reported a service
 * failure. Every API route was dead in every deployment for as long as both
 * files existed, and reading either one on its own found nothing wrong.
 *
 * The bug lived in the RELATIONSHIP between two files, so this test models that
 * relationship rather than either file: it reads whatever routing configuration
 * is actually committed, resolves paths through Netlify's real precedence, and
 * asserts where each one lands.
 */

const ROOT = join(APP_ROOT, '..')
const PUBLIC_DIR = join(APP_ROOT, 'public')

interface Rule {
  readonly from: string
  readonly to: string
  readonly status: number
  readonly source: string
}

/** `_redirects` line format: `from  to  [status]`, `#` comments, blanks ignored. */
function parseRedirectsFile(text: string, source: string): Rule[] {
  const rules: Rule[] = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const parts = trimmed.split(/\s+/)
    const from = parts[0]
    const to = parts[1]
    const status = parts[2]
    if (!from || !to) continue
    rules.push({ from, to, status: status ? Number(status.replace('!', '')) : 301, source })
  }
  return rules
}

/** The `[[redirects]]` blocks of netlify.toml, in file order. */
function parseTomlRedirects(text: string): Rule[] {
  const rules: Rule[] = []
  for (const block of text.split('[[redirects]]').slice(1)) {
    const upTo = block.split(/\n\[\[?[a-z]/i)[0] ?? ''
    const from = /from\s*=\s*"([^"]+)"/.exec(upTo)?.[1]
    const to = /to\s*=\s*"([^"]+)"/.exec(upTo)?.[1]
    const status = /status\s*=\s*(\d+)/.exec(upTo)?.[1]
    if (from && to) {
      rules.push({ from, to, status: status ? Number(status) : 301, source: 'netlify.toml' })
    }
  }
  return rules
}

/**
 * The rule list in the order Netlify evaluates it.
 *
 * THE ORDER IS THE WHOLE POINT. `_redirects` first, then `netlify.toml`, each
 * internally in file order, first match wins. Getting this backwards is what
 * made the outage invisible to review.
 */
function effectiveRules(): Rule[] {
  const rules: Rule[] = []
  // The COMMITTED source only. `dist/` is a build artifact and may be stale;
  // asserting against it would make this test's verdict depend on whether
  // somebody happened to run a build. What ships is decided by what is
  // committed, and the built output gets its own check below.
  const file = join(PUBLIC_DIR, '_redirects')
  if (existsSync(file)) {
    rules.push(...parseRedirectsFile(readFileSync(file, 'utf8'), 'app/public/_redirects'))
  }
  rules.push(...parseTomlRedirects(readFileSync(join(ROOT, 'netlify.toml'), 'utf8')))
  return rules
}

/** Netlify's matching: exact, or a trailing `/*` splat. First match wins. */
function resolve(path: string): Rule | null {
  for (const rule of effectiveRules()) {
    if (rule.from.endsWith('/*')) {
      if (path.startsWith(rule.from.slice(0, -1)) || path === rule.from.slice(0, -2)) return rule
    } else if (rule.from === path) {
      return rule
    }
  }
  return null
}

/** Every API path the client actually calls, and where each must land. */
const API_ROUTES: [string, string][] = [
  ['/api/session', '/.netlify/functions/session'],
  ['/api/status', '/.netlify/functions/status'],
  ['/api/admin-run', '/.netlify/functions/admin-run'],
  ['/api/evidence/11111111-1111-4111-8111-111111111111', '/.netlify/functions/evidence/:splat'],
]

describe('Netlify routing', () => {
  it.each(API_ROUTES)('%s resolves to its function, not the SPA', (path, target) => {
    const rule = resolve(path)
    expect(rule, `${path} matched no rule at all`).not.toBeNull()
    expect(
      rule!.to,
      `${path} resolved to ${rule!.to} via ${rule!.source} — the SPA fallback is winning`,
    ).toBe(target)
    expect(rule!.status).toBe(200)
  })

  it.each(API_ROUTES)('%s never resolves to index.html', (path) => {
    expect(resolve(path)?.to).not.toBe('/index.html')
  })

  /**
   * The specific inversion that caused the outage, asserted as an ordering
   * property rather than as "this file does not exist" — a future maintainer
   * may have a good reason to add `_redirects` back, and this says what it must
   * then contain.
   */
  it('no catch-all is evaluated before the API rules', () => {
    const rules = effectiveRules()
    const catchAll = rules.findIndex((rule) => rule.from === '/*')
    const lastApi = rules.map((rule) => rule.from.startsWith('/api')).lastIndexOf(true)
    expect(catchAll, 'there is no SPA fallback at all').toBeGreaterThanOrEqual(0)
    expect(lastApi, 'there are no /api rules at all').toBeGreaterThanOrEqual(0)
    expect(
      catchAll,
      'a /* catch-all is evaluated before the /api rules — every API route returns index.html',
    ).toBeGreaterThan(lastApi)
  })

  it('an unmatched /api path 404s rather than silently returning the SPA', () => {
    // Without this, a typo in a client call looks like a successful request
    // that happened to return HTML — the hardest kind of bug to see.
    const rule = resolve('/api/not-a-route')
    expect(rule?.to).toBe('/404.html')
    expect(rule?.status).toBe(404)
  })

  it('ordinary application deep links still reach the SPA', () => {
    for (const path of ['/', '/opportunities', '/auth/callback', '/company/anything']) {
      const rule = resolve(path)
      expect(rule?.to, `${path} must serve the SPA`).toBe('/index.html')
      expect(rule?.status).toBe(200)
    }
  })

  it('every function named by a rewrite exists on disk', () => {
    const dir = join(APP_ROOT, 'netlify/functions')
    const present = readdirSync(dir)
      .filter((name) => name.endsWith('.ts'))
      .map((name) => name.replace(/\.ts$/, ''))
    for (const [, target] of API_ROUTES) {
      const name = target.replace('/.netlify/functions/', '').replace('/:splat', '')
      expect(present, `${name} is routed to but does not exist`).toContain(name)
    }
  })

  it('a built dist/ carries no catch-all of its own', () => {
    // Belt and braces on the real artifact: a stale or hand-edited
    // `dist/_redirects` would be deployed verbatim and would win, exactly as
    // the committed copy did. Skipped when nothing has been built.
    const built = join(APP_ROOT, 'dist', '_redirects')
    if (!existsSync(built)) return
    const rules = parseRedirectsFile(readFileSync(built, 'utf8'), 'dist/_redirects')
    const catchAll = rules.findIndex((rule) => rule.from === '/*')
    const lastApi = rules.map((rule) => rule.from.startsWith('/api')).lastIndexOf(true)
    if (catchAll >= 0) expect(catchAll).toBeGreaterThan(lastApi)
  })

  it('routing is declared in exactly one place', () => {
    // Two sources where one silently wins is the defect itself, not a
    // redundancy. If `_redirects` returns it must carry the API rules too,
    // which the ordering test above enforces.
    const publicRedirects = join(PUBLIC_DIR, '_redirects')
    if (!existsSync(publicRedirects)) return
    const text = readFileSync(publicRedirects, 'utf8')
    expect(
      text,
      '_redirects exists and is evaluated FIRST, so it must carry the /api rules',
    ).toMatch(/\/api\//)
  })
})
