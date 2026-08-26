import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { APP_ROOT } from '@/test/paths'

/**
 * Contract assertions on the evidence proxy, read from source.
 *
 * The handler cannot be executed here — it needs a live Supabase project, a real
 * session and a real object, and this environment has none of the three. What it
 * CAN do is assert the properties that a reviewer would otherwise have to check
 * by eye, and that a later edit could quietly remove: that the no-store headers
 * exist, that the secret key is not used for the visibility decision, that the
 * storage path never reaches a response, and that nothing sensitive is logged.
 *
 * The end-to-end behaviour is proven separately by the hosted canary run
 * documented in docs/ENVIRONMENT.md, which needs credentials this environment
 * does not hold.
 */
const source = readFileSync(join(APP_ROOT, 'netlify/functions/evidence.ts'), 'utf8')
const authSource = readFileSync(join(APP_ROOT, 'netlify/functions/_shared/auth.ts'), 'utf8')

describe('evidence proxy contract', () => {
  it('sends the required no-cache headers', () => {
    expect(source).toMatch(/'cache-control':\s*'private, no-store'/)
    expect(source).toMatch(/pragma:\s*'no-cache'/)
  })

  it('applies those headers to failures as well as successes', () => {
    // A 404 that is cacheable leaks the existence question to a shared cache.
    expect(source).toMatch(/function deny\([\s\S]*?\.\.\.NO_STORE/)
  })

  it('requires an invited, non-anonymous session', () => {
    expect(source).toContain('requireInvitedUser')
    expect(authSource).toContain('isAnonymous')
    expect(authSource).toContain('auth_invite_allowlist')
  })

  it('re-checks allowlist membership on every request rather than trusting the token', () => {
    // A token issued before someone was removed is still cryptographically
    // valid. Membership has to be the current answer, not the minted one.
    expect(authSource).toMatch(/from\('auth_invite_allowlist'\)/)
  })

  it('decides visibility as the caller, not with the secret key', () => {
    const visibility = source.slice(source.indexOf('const asUser'), source.indexOf('access_mode ==='))
    expect(visibility).toContain('supabaseAsUser')
    expect(visibility).not.toContain('supabaseAdmin')
  })

  it('never returns a storage path or a reusable storage URL', () => {
    const returnBlocks = source.match(/return\s*\{[\s\S]*?\n\s{2}\}/g) ?? []
    for (const block of returnBlocks) {
      expect(block).not.toContain('raw_storage_uri')
      expect(block).not.toContain('objectPath')
      expect(block).not.toMatch(/createSignedUrl|getPublicUrl|signedUrl/)
    }
    expect(source).not.toMatch(/createSignedUrl|getPublicUrl/)
  })

  it('answers "not yours" and "does not exist" identically', () => {
    const notFound = source.match(/deny\(404, 'not_found', '[^']+'\)/g) ?? []
    expect(notFound.length).toBeGreaterThanOrEqual(3)
    expect(new Set(notFound).size, 'every 404 must be the same response').toBe(1)
  })

  it('logs no token, key, path or content', () => {
    const logs = source.match(/console\.\w+\([\s\S]*?\)\n/g) ?? []
    expect(logs.length).toBeGreaterThan(0)
    for (const line of logs) {
      for (const forbidden of ['objectPath', 'token', 'raw_storage_uri', 'bytes.toString', 'authorization']) {
        expect(line, `log must not contain ${forbidden}`).not.toContain(forbidden)
      }
    }
  })

  it('rejects a non-UUID identifier before touching the database', () => {
    expect(source).toContain('evidenceIdFromPath')
    expect(source).toMatch(/UUID\s*=\s*\/\^/)
  })

  it('refuses reference-only evidence rather than inventing a file', () => {
    // ADR 0014: corporate material is retained by reference and has no body.
    expect(source).toContain("'no_retained_content'")
    expect(source).toContain("reference_only")
  })
})
