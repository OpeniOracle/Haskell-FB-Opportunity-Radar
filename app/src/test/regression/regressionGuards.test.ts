import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { APP_ROOT } from '@/test/paths'
import {
  REGRESSION_ROOT,
  SOURCED_DIR,
  SYNTHETIC_DIR,
  SYNTHETIC_SENTINEL,
  evaluateCase,
  loadCases,
  loadWorld,
  syntheticFiles,
} from './harness'

/**
 * WHAT THE HARNESS IS NOT ALLOWED TO BECOME.
 *
 * `syntheticRegression.test.ts` checks what the pipeline does. This file checks
 * what the HARNESS is: that it stays fictional, that no sourced or research data
 * leaks into it, that it cannot reach a database, a network, a model or a
 * credential, and that nothing in it can ship in the production bundle.
 *
 * These are structural guarantees rather than conventions: each one fails the
 * build, so a later change that quietly crosses the line has to say so.
 */

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    return statSync(full).isDirectory() ? walk(full) : [full]
  })
}

const read = (file: string) => readFileSync(file, 'utf8')

/* ------------------------------------------------- fictional and synthetic */

/**
 * Real organisations from the pilot cohort and from the research bundle. A
 * synthetic fixture naming any of them has stopped being synthetic.
 */
const REAL_NAMES = [
  'pepsi',
  'tyson',
  'kroger',
  'hershey',
  'coca-cola',
  'coca cola',
  'nestl',
  'niagara',
  'swire',
  'danone',
  'unilever',
  'oatly',
  'kimberly',
  'sherwin',
  'ecolab',
  'keurig',
  'dr pepper',
  'procter',
  'kellanova',
  'purina',
  'frito',
  'jde peet',
  'liquid i.v',
  'house of raeford',
]

describe('every fixture is synthetic', () => {
  const files = syntheticFiles().map((f) => ({ name: f, text: read(join(SYNTHETIC_DIR, f)) }))

  it('declares itself synthetic and carries the sentinel the bundle scan looks for', () => {
    expect(files.length).toBeGreaterThan(0)
    for (const f of files) {
      const json = JSON.parse(f.text) as { sentinel?: string; synthetic?: boolean }
      expect(json.sentinel, f.name).toBe(SYNTHETIC_SENTINEL)
      expect(json.synthetic, f.name).toBe(true)
    }
  })

  it('names no real organisation', () => {
    for (const f of files) {
      const lower = f.text.toLowerCase()
      for (const name of REAL_NAMES) expect(lower.includes(name), `${f.name} contains "${name}"`).toBe(false)
      // `Mars` is a word, not a substring ("Marshall" is fine).
      expect(/\bmars\b/i.test(f.text), `${f.name} contains "Mars"`).toBe(false)
    }
  })

  it('gives every organisation a synthetic entity key and an all-synthetic id', () => {
    for (const org of loadWorld()) {
      expect(org.entityKey.startsWith('synthetic:'), org.slug).toBe(true)
      expect(org.id.startsWith('00000000-0000-4000-8000-'), org.slug).toBe(true)
    }
  })

  it('serves every document from a reserved, non-resolvable .example host', () => {
    for (const c of loadCases()) {
      for (const d of c.documents) {
        const host = new URL(d.url).hostname
        expect(host.endsWith('.example'), `${c.id}/${d.key}: ${host}`).toBe(true)
        expect(new URL(d.url).protocol).toBe('https:')
      }
    }
  })
})

/* ------------------------------------- the research labels stay out (D-R4) */

describe('the provisional research labels are not here', () => {
  it('holds no sourced evidence, and no research record or source identifier, anywhere under regression/', () => {
    expect(readdirSync(SOURCED_DIR).sort()).toEqual(['README.md'])
    const data = walk(REGRESSION_ROOT).filter((f) => /\.(json|md)$/.test(f))
    for (const file of data) {
      const text = read(file)
      const name = relative(REGRESSION_ROOT, file)
      expect(/REAL-\d{3}/.test(text), `${name} carries a research record id`).toBe(false)
      expect(/"source_id"\s*:\s*"S\d{2}"/.test(text), `${name} carries a research source id`).toBe(false)
      expect(/benchmark_label_status|single_analyst_draft/.test(text), `${name} carries a research label field`).toBe(false)
      if (!name.endsWith('README.md')) {
        expect(/gold_reference/i.test(text), `${name} references the research dataset`).toBe(false)
      }
    }
  })
})

/* ------------------------- no database, network, model or credential at all */

/**
 * The only modules the harness may import. A new entry is a decision, not a
 * convenience: it widens what a test can reach.
 */
const ALLOWED_IMPORTS = new Set([
  'vitest',
  'node:crypto',
  'node:fs',
  'node:path',
  '@/test/paths',
  './harness',
  '../../../netlify/functions/_shared/connectors/pipeline',
  '../../../netlify/functions/_shared/locations/extract',
  '../../../netlify/functions/_shared/connectors/types',
])

const FORBIDDEN = [
  /@supabase\//,
  /supabaseAdmin/,
  /modelGateway/,
  /_shared\/env/,
  /_shared\/egress/,
  /\bfetch\s*\(/,
  /XMLHttpRequest/,
  /\bWebSocket\b/,
  /anthropic|openai|api\.anthropic/i,
  /SERVICE_ROLE|sb_secret_|sb_publishable_|SUPABASE_/,
  /\bAuthorization\b|\bBearer\b/,
]

describe('the harness reaches nothing outside itself', () => {
  // The guard file is excluded from the token scan because it lists the tokens;
  // its own imports are still checked below.
  const sources = walk(REGRESSION_ROOT).filter((f) => f.endsWith('.ts'))
  const scanned = sources.filter((f) => !f.endsWith('regressionGuards.test.ts'))

  it('imports only an explicit allowlist of modules', () => {
    for (const file of sources) {
      const text = read(file)
      const specifiers = [...text.matchAll(/(?:from|import\()\s*['"]([^'"]+)['"]/g)].map((m) => m[1]!)
      for (const s of specifiers) {
        expect(ALLOWED_IMPORTS.has(s), `${relative(APP_ROOT, file)} imports "${s}"`).toBe(true)
      }
    }
  })

  it('contains no database client, model client, credential, or network primitive', () => {
    for (const file of scanned) {
      const text = read(file)
      for (const pattern of FORBIDDEN) {
        expect(pattern.test(text), `${relative(APP_ROOT, file)} matches ${pattern}`).toBe(false)
      }
    }
  })

  it('reads no environment variable at all', () => {
    for (const file of scanned) {
      expect(/process\.env|import\.meta\.env/.test(read(file)), relative(APP_ROOT, file)).toBe(false)
    }
  })

  describe('at run time', () => {
    afterEach(() => vi.restoreAllMocks())

    it('performs no network request while evaluating every case', async () => {
      const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
        throw new Error('the synthetic regression harness must not touch the network')
      })
      const world = loadWorld()
      for (const c of loadCases()) await evaluateCase(c, world)
      expect(spy).not.toHaveBeenCalled()
    })
  })
})

/* -------------------------------------- nothing in it can reach production */

describe('nothing in the harness can ship', () => {
  it('is imported by no production source file', () => {
    const production = [
      ...walk(join(APP_ROOT, 'src')).filter((f) => !relative(join(APP_ROOT, 'src'), f).startsWith('test')),
      ...walk(join(APP_ROOT, 'netlify')),
    ].filter((f) => /\.(ts|tsx|mjs|js)$/.test(f))
    expect(production.length).toBeGreaterThan(0)
    for (const file of production) {
      const specifiers = [...read(file).matchAll(/(?:from|import\()\s*['"]([^'"]+)['"]/g)].map((m) => m[1]!)
      for (const s of specifiers) {
        expect(/(^|\/)test\/(regression|fixtures)|\/regression\//.test(s), `${relative(APP_ROOT, file)} imports ${s}`).toBe(false)
      }
    }
  })

  it('leaves no sentinel, case id or fictional organisation in a build output, when one exists', (ctx) => {
    // CI runs this scan again AFTER `npm run build` (see ci.yml), because the
    // unit-test job runs before the build and this test would otherwise have
    // nothing to look at. Skipped, visibly, rather than passed, when absent.
    const dist = join(APP_ROOT, 'dist')
    if (!existsSync(dist)) return ctx.skip()
    const markers = [SYNTHETIC_SENTINEL, ...loadWorld().map((o) => o.canonicalName), 'SYN-ORIGIN-', 'SYN-BOILER-']
    for (const file of walk(dist)) {
      if (!/\.(js|css|html|json|map|txt)$/.test(file)) continue
      const text = readFileSync(file, 'latin1')
      for (const m of markers) expect(text.includes(m), `${relative(APP_ROOT, file)} contains "${m}"`).toBe(false)
    }
  })
})
