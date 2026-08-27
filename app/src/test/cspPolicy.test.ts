import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { APP_ROOT } from '@/test/paths'

/**
 * The generated Content-Security-Policy.
 *
 * Generated per deployment, so it cannot be reviewed once and trusted forever —
 * these assertions are what a reviewer would otherwise have to re-derive on
 * every build.
 */
/**
 * Generated into a scratch directory, from a fixed copy of `index.html`.
 *
 * NOT from `dist/`. `bundleSecrets.test.ts` runs a real `vite build`, which
 * removes and rewrites that directory; reading it from here raced with that and
 * produced a policy with no script hash — a red test with nothing wrong behind
 * it. The seams the generator exposes for this are documented in
 * `scripts/generate-headers.mjs`.
 */
let workDir: string

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), 'csp-'))
  // The real page's inline script: the pre-paint theme applier, verbatim, so
  // the hash assertion is about the thing that actually ships.
  writeFileSync(
    join(workDir, 'index.html'),
    readFileSync(join(APP_ROOT, 'index.html'), 'utf8'),
    'utf8',
  )
})

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true })
})

function generate(env: Record<string, string>): string {
  const output = join(workDir, '_headers')
  execFileSync('node', ['scripts/generate-headers.mjs'], {
    cwd: APP_ROOT,
    env: {
      ...process.env,
      CSP_HTML_SOURCE: join(workDir, 'index.html'),
      CSP_OUTPUT_PATH: output,
      ...env,
    },
    stdio: 'pipe',
  })
  return readFileSync(output, 'utf8')
}

const PROJECT = 'https://dutmdlbangsthclgtkhy.supabase.co'

describe('content security policy', () => {
  it('grants no WebSocket origin, because nothing opens a realtime channel', () => {
    // Reserving wss:// for a feature that might arrive later widens the policy
    // today in exchange for nothing.
    const headers = generate({ VITE_SUPABASE_URL: PROJECT })
    expect(headers).not.toMatch(/wss:/)
  })

  it('permits exactly the project origin and same-origin functions', () => {
    const headers = generate({ VITE_SUPABASE_URL: PROJECT })
    const connectSrc = /connect-src ([^;]+);/.exec(headers)?.[1]?.trim()
    expect(connectSrc).toBe(`'self' ${PROJECT}`)
  })

  it('falls back to same-origin only when no project is configured', () => {
    const headers = generate({ VITE_SUPABASE_URL: '' })
    const connectSrc = /connect-src ([^;]+);/.exec(headers)?.[1]?.trim()
    expect(connectSrc).toBe("'self'")
  })

  it('uses no wildcard and no scheme-only source anywhere', () => {
    const headers = generate({ VITE_SUPABASE_URL: PROJECT })
    const policy = /Content-Security-Policy: (.+)/.exec(headers)?.[1] ?? ''
    expect(policy).not.toMatch(/\*/)
    // `https:` alone would permit every host on the internet.
    expect(policy).not.toMatch(/(^|[\s;])https:(\s|;|$)/)
    expect(policy).toContain("frame-ancestors 'none'")
    expect(policy).toContain("object-src 'none'")
  })

  it('admits the one inline script by hash rather than by unsafe-inline', () => {
    const headers = generate({ VITE_SUPABASE_URL: PROJECT })
    const scriptSrc = /script-src ([^;]+);/.exec(headers)?.[1] ?? ''
    expect(scriptSrc).toMatch(/'sha256-[A-Za-z0-9+/=]+'/)
    expect(scriptSrc).not.toContain('unsafe-inline')
    expect(scriptSrc).not.toContain('unsafe-eval')
  })
})
