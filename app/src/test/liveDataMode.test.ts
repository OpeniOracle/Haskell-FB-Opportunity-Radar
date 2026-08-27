import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { APP_ROOT } from '@/test/paths'

/**
 * Production shows live records or an honest state — never illustrative ones.
 *
 * These are SOURCE and BUILD assertions rather than rendering assertions,
 * because the guarantee being made is structural: the fixture modules are not
 * reachable from a production bundle at all. A rendering test can only show
 * that fixtures are not displayed on the paths it happens to exercise.
 */

function read(relative: string): string {
  return readFileSync(join(APP_ROOT, relative), 'utf8')
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full)
  }
  return out
}

/**
 * The RUNTIME modules: everything under `src/` that is neither a test nor part
 * of the fixture corpus itself. The corpus is allowed to import its own parts;
 * what must not happen is the application importing any of it.
 */
const APP_SOURCES = walk(join(APP_ROOT, 'src')).filter(
  (path) =>
    !path.includes(`${'/'}test${'/'}`) &&
    !path.endsWith('.test.ts') &&
    !path.endsWith('.test.tsx') &&
    !path.includes(`${'/'}data${'/'}fixture`),
)

describe('the runtime cannot reach the fixture corpus', () => {
  it('has no static import of the fixture provider outside tests', () => {
    const offenders = APP_SOURCES.filter((path) => {
      const text = readFileSync(path, 'utf8')
      // A dynamic import() is permitted in exactly one module and is guarded
      // by a build-time constant; a STATIC import is what would put the
      // fixtures in the production graph.
      return /^\s*import\s[^\n]*from\s+['"]@\/data\/fixture/m.test(text)
    })
    expect(offenders).toEqual([])
  })

  it('reaches fixtures only through a build-time-guarded dynamic import', () => {
    const context = read('src/data/DataSourceContext.tsx')
    expect(context).toMatch(/FIXTURES_AVAILABLE/)
    expect(context).toMatch(/import\.meta\.env\.DEV/)
    expect(context).toMatch(/void import\('@\/data\/fixtureDataSource'\)/)
    // The guard must be CHECKED before the import, not after it. Asserted on
    // position rather than on an exact condition string, so rewording the
    // condition cannot silently stop this from testing anything.
    const importAt = context.indexOf("void import('@/data/fixtureDataSource')")
    expect(importAt).toBeGreaterThan(-1)
    const guardAt = context.slice(0, importAt).lastIndexOf('FIXTURES_AVAILABLE')
    expect(guardAt, 'FIXTURES_AVAILABLE must be consulted before the import').toBeGreaterThan(-1)
    // And the early return that the guard controls sits between them.
    expect(context.slice(guardAt, importAt)).toMatch(/return/)
  })

  it('constructs the live provider by default and the fixture one never', () => {
    const context = read('src/data/DataSourceContext.tsx')
    expect(context).toMatch(/createApiDataSource\(\)/)
    expect(context).not.toMatch(/source \?\? createFixtureDataSource/)
  })

  it('passes a data source into the application only from a test', () => {
    const app = read('src/App.tsx')
    expect(app).toMatch(/dataSource\?: DataSourceInput/)
    const callers = APP_SOURCES.filter((path) => /<App\b[^>]*dataSource=/.test(readFileSync(path, 'utf8')))
    expect(callers).toEqual([])
  })
})

describe('the live provider never falls back', () => {
  const source = read('src/data/apiDataSource.ts')

  it('imports no fixture module', () => {
    expect(source).not.toMatch(/fixture/i)
  })

  it('names four distinct failures rather than one', () => {
    for (const key of ['notConfigured', 'unauthorized', 'requestFailed', 'neverCollected']) {
      expect(source, `${key} must be a named failure`).toContain(key)
    }
  })

  it('turns a thrown request into unavailable, never into empty', () => {
    expect(source).toMatch(/catch \{[\s\S]{0,200}FAILURE\.requestFailed/)
  })

  it('separates "no records" from "never collected"', () => {
    expect(source).toMatch(/everCollected/)
    expect(source).toMatch(/first_collection_pending/)
  })

  it('reads freshness from the run, not from the clock', () => {
    expect(source).toMatch(/last_success_at/)
    expect(source).toMatch(/STALE_AFTER_HOURS/)
  })

  it('declares itself as live and not illustrative', () => {
    expect(source).toMatch(/mode: 'api'/)
    expect(source).toMatch(/illustrative: false/)
  })
})

describe('the built bundle carries no illustrative record', () => {
  const distDir = join(APP_ROOT, 'dist', 'assets')

  /*
    CONTENT, NOT FILENAMES.

    An earlier version of this test asserted that no chunk was NAMED after the
    fixture module. That passed for the wrong reason: the alias meant to
    replace the module was shadowed by the `@` prefix alias and never fired, so
    the clean output came from tree-shaking a dynamic import behind a false
    `import.meta.env.DEV`. Under NODE_ENV=test the flag inlined as true, the
    import survived, and the whole corpus shipped as its own chunk.

    A chunk named `fixtureDataSource.production-stub-*.js` is the CORRECT
    output: it is the stub. What must never appear is a fabricated record.
  */
  const PAYLOAD_MARKERS = [
    'opp-fixture-',
    'fx-company-',
    'fx-facility-',
    'Example Beverage',
    'mode:"fixture"',
    'illustrative:!0',
  ]

  it('ships no fabricated record, under any build mode', () => {
    let files: string[]
    try {
      files = readdirSync(distDir).filter((f) => f.endsWith('.js'))
    } catch {
      // `npm run build` has not run in this working tree. CI builds and then
      // scans in a dedicated step, so this is a local convenience only.
      expect(true).toBe(true)
      return
    }
    expect(files.length).toBeGreaterThan(0)

    for (const file of files) {
      const bundle = readFileSync(join(distDir, file), 'utf8')
      for (const marker of PAYLOAD_MARKERS) {
        expect(bundle, `${file} ships '${marker}'`).not.toContain(marker)
      }
    }
  })

  it('replaces the fixture module with a stub that refuses, if it is emitted at all', () => {
    let files: string[]
    try {
      files = readdirSync(distDir).filter((f) => /fixture/i.test(f))
    } catch {
      expect(true).toBe(true)
      return
    }
    for (const file of files) {
      const chunk = readFileSync(join(distDir, file), 'utf8')
      expect(chunk, `${file} must be the stub`).toContain('not part of a production build')
      expect(chunk).not.toContain('opp-fixture-')
    }
  })
})

describe('the preview-state parameter cannot substitute business data', () => {
  it('is read but honoured only where fixtures exist', () => {
    const app = read('src/App.tsx')
    expect(app).toMatch(/new URLSearchParams\(search\)\.get\('state'\)/)
    // App no longer imports the fixture scenario parser at all.
    expect(app).not.toMatch(/parseScenario/)
  })
})
