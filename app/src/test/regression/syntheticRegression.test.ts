import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  MANIFEST_PATH,
  REPORT_PATH,
  SOURCED_DIR,
  SYNTHETIC_DIR,
  buildReport,
  evaluateCase,
  loadCases,
  loadDefects,
  loadWorld,
  sha256,
  syntheticFiles,
  type CaseResult,
} from './harness'

/**
 * SYNTHETIC REGRESSION: WHAT THE DERIVATION PIPELINE SHOULD DO, AGAINST WHAT IT DOES.
 *
 * Read `README.md` in this directory first. In one paragraph: each case is a
 * fictional document and the outcome a correct pipeline would produce. The real
 * classifier and pipeline run, unmodified, against an in-memory database. A case
 * the code already handles correctly must keep passing (a control). A case it
 * handles incorrectly names the defect and the dimensions that fail, and this
 * test asserts the code STILL fails in exactly that way. When a repair makes a
 * pinned case pass, this test goes red until the marker is retired -- which is
 * how a repair is recorded, rather than assumed.
 *
 * NOTHING HERE MEASURES PRODUCTION PRECISION. No ratio is computed.
 */

const world = loadWorld()
const cases = loadCases()
const defects = loadDefects()

/** The manifest, recomputed from the bytes on disk. */
function computeManifest(): Record<string, string> {
  return Object.fromEntries(
    syntheticFiles().map((f) => [`synthetic/${f}`, sha256(readFileSync(join(SYNTHETIC_DIR, f)))]),
  )
}

describe('the fixtures are what the manifest says they are', () => {
  it('has a checksum for exactly the synthetic files on disk, and none for sourced evidence', async () => {
    const serialised =
      JSON.stringify(
        {
          schema: 'regression-fixture-manifest/1',
          algorithm: 'sha256',
          note: 'Regenerate with `npm test -- src/test/regression -u`. `sourced` is empty on purpose; see sourced/README.md.',
          synthetic: computeManifest(),
          sourced: {},
        },
        null,
        2,
      ) + '\n'
    // A fixture edited without regenerating this file fails here, by design.
    await expect(serialised).toMatchFileSnapshot(MANIFEST_PATH)
    const committed = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as { sourced: Record<string, string> }
    expect(committed.sourced).toEqual({})
  })

  it('lists every sourced-evidence file it holds, and holds none yet', () => {
    expect(readdirSync(SOURCED_DIR).sort()).toEqual(['README.md'])
  })
})

describe('the case catalogue is coherent', () => {
  it('has unique case ids', () => {
    const ids = cases.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('names only defects that exist, and every defect is pinned by at least one case', () => {
    const known = new Set(defects.map((d) => d.id))
    const used = new Set(cases.flatMap((c) => c.knownDefects.map((k) => k.defect)))
    expect([...used].filter((id) => !known.has(id))).toEqual([])
    expect([...known].filter((id) => !used.has(id)), 'a catalogued defect that no case exercises').toEqual([])
  })

  it('names only publishers that exist in the synthetic world', () => {
    const slugs = new Set(world.map((o) => o.slug))
    for (const c of cases) for (const d of c.documents) expect(slugs.has(d.publisher), `${c.id}/${d.key}`).toBe(true)
  })

  it('covers every requirement family the plan names', () => {
    const families = new Set(cases.map((c) => c.family))
    expect([...families].sort()).toEqual(
      [
        'Conditional or hypothetical construction',
        'Historical company events',
        'Administrative permit renewal',
        'Negative events and closures',
        'Operator and facility attribution',
        'Product launches without physical capital work',
        'Publication date versus event date',
        'Repeated financial-disclosure boilerplate',
        'Repeated releases mistaken for independent corroboration',
        'Unrelated dollar amounts',
      ].sort(),
    )
  })

  it('keeps expected signals and expected promotion as separate assertions', () => {
    // A case that asserts a signal outcome must be able to disagree with itself
    // about promotion: at least one case expects a signal and no opportunity,
    // and at least one expects no signal and no opportunity.
    expect(cases.some((c) => c.expected.outcome === 'signal' && c.expected.promotion === 'none')).toBe(true)
    expect(cases.some((c) => c.expected.outcome === 'no_signal' && c.expected.promotion === 'none')).toBe(true)
    expect(cases.some((c) => c.expected.outcome === 'signal' && c.expected.promotion === 'emerging')).toBe(true)
  })
})

describe('each case: the intended outcome, against the code as it is', () => {
  for (const c of cases) {
    const pinned = [...new Set(c.knownDefects.flatMap((k) => k.dimensions.map((d) => `${k.defect}:${d}`)))]
    const label = pinned.length ? `  [KNOWN DEFECT ${pinned.join(' ')}]` : '  [control]'
    it(`${c.id} — ${c.title}${label}`, async () => {
      const result = await evaluateCase(c, world)

      const evaluated = new Set(result.dimensions.map((d) => d.dimension))
      for (const k of c.knownDefects) {
        for (const dim of k.dimensions) {
          expect(evaluated.has(dim), `${c.id} pins ${k.defect} to "${dim}", which this case does not evaluate`).toBe(true)
        }
      }

      for (const d of result.dimensions) {
        if (d.pinnedDefects.length) {
          expect(
            d.verdict,
            `${c.id}/${d.dimension} now PASSES. The defect(s) ${d.pinnedDefects.join(', ')} appear repaired: ` +
              `retire the knownDefects marker and regenerate the report.`,
          ).toBe('fail')
        } else {
          expect(
            d.verdict,
            `${c.id}/${d.dimension} fails and no known defect is pinned to it.\n` +
              `  expected: ${JSON.stringify(d.expected)}\n  observed: ${JSON.stringify(d.observed)}`,
          ).toBe('pass')
        }
      }
    })
  }
})

describe('the machine-readable diagnostic report', () => {
  it('matches the committed report, and states what it is not', async () => {
    // Evaluate again rather than depending on test order.
    const fresh: CaseResult[] = []
    for (const c of cases) fresh.push(await evaluateCase(c, world))
    const report = buildReport(cases, fresh, defects, computeManifest())

    expect(report.scope).toMatch(/NOT production precision/)
    expect(report.summary.unpinnedFailures, 'a failing dimension has no pinned defect').toBe(0)
    expect(report.summary.staleMarkers, 'a pinned dimension now passes').toBe(0)
    // The summary holds counts only: no accuracy, precision, recall or ratio.
    expect(JSON.stringify(report.summary)).not.toMatch(/accuracy|precision|recall|f1|ratio|percent|rate/i)

    // Compared with the committed report; `-u` rewrites it. A change in what the
    // code does shows up here as a diff to review, not as a surprise later.
    await expect(JSON.stringify(report, null, 2) + '\n').toMatchFileSnapshot(REPORT_PATH)

    const { signal, promotion, pinnedDefects } = report.summary
    console.info(
      `synthetic regression: ${report.summary.cases} cases (${report.summary.controls} controls, ` +
        `${report.summary.defectProbes} pinned defect probes) | signals ${JSON.stringify(signal)} | ` +
        `promotion ${JSON.stringify(promotion)} | pinned ${JSON.stringify(pinnedDefects)} — synthetic, not production precision`,
    )
  })
})
