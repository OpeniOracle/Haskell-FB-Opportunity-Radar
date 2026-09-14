import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { APP_ROOT } from '@/test/paths'

/**
 * The connectivity decision, and the four artifacts that must agree about it.
 *
 * THE DEFECT THIS SUITE EXISTS TO PREVENT.
 *
 * The pre-flight script counted every probe the same way: any non-200 became a
 * failure and the script exited 1. So when Mars answered 200 on robots.txt,
 * 200 on the newsroom index and 200 on the sitemap, but 404 on one GUESSED rss
 * path, the operator was told the check had FAILED -- on a source that is
 * entirely viable, with a working feed strategy and a working index strategy.
 *
 * The connector never had that bug. `discoverMars` walks feed -> sitemap ->
 * index, records each miss in `attempts`, and continues; it reports
 * `unavailable` or `manual_review_required` only when NOTHING was discovered.
 * The pre-flight was stricter than the thing it exists to predict, which is the
 * worst direction for a check to be wrong in: it argues for disabling a source
 * that works.
 *
 * So the rules live in one module and four things have to agree with it: the
 * module, the seed, the bash script and the PowerShell script.
 */

const ROOT = join(APP_ROOT, '..')
const read = (relative: string) => readFileSync(join(ROOT, relative), 'utf8')

const seed = read('db/seed/0006_live_cohort_sources.sql')
const sh = read('scripts/test-source-connectivity.sh')
const ps = read('scripts/Test-SourceConnectivity.ps1')
const connector = read('app/netlify/functions/_shared/connectors/mars.ts')
const runbook = read('docs/HOSTED_VALIDATION_RUNBOOK.md')

/*
   The rules module is plain ESM in `scripts/`, outside Vite's root.

   A bare `await import(url)` does not work here: Vite rewrites every visible
   dynamic import and then cannot resolve a path outside `app/`. Building the
   importer with `new Function` puts the call beyond static analysis, so Node's
   own loader handles it and the real module is evaluated -- the same file the
   operator scripts are checked against, not a copy of it.
*/
type Rules = {
  RETIRED_CANDIDATES: { url: string; observed: string; on: string; by: string }[]
  PROBES: Record<string, { label: string; url: string; role: string; kind?: string; expect: string }[]>
  CHALLENGE_MARKERS: RegExp
  classifyProbe: (p: { status: number; body?: string; transportError?: string }) => string
  applyExpectation: (o: string, p: { body?: string; expect?: string }) => string
  sourceVerdict: (results: { label: string; role: string; outcome: string }[]) => {
    viable: boolean
    blockers: { label: string; outcome: string }[]
    warnings: { label: string; outcome: string }[]
    challenges: { label: string; outcome: string }[]
    usableDiscovery: { label: string }[]
    attribution: string | null
    conclusive: boolean
  }
  exitCode: (verdicts: Record<string, { viable: boolean; conclusive: boolean }>) => number
}

let rules: Rules

beforeAll(async () => {
  const url = pathToFileURL(join(ROOT, 'scripts/lib/connectivity-rules.mjs')).href
  rules = (await import(/* @vite-ignore */ url)) as unknown as Rules
})

type Result = { label: string; role: 'required' | 'discovery'; outcome: string }
const r = (role: 'required' | 'discovery', outcome: string, label = outcome): Result => ({
  label,
  role,
  outcome,
})

// ---------------------------------------------------------------------------
// 1. One probe at a time.
// ---------------------------------------------------------------------------

describe('classifying a single probe', () => {
  const CASES: [string, { status: number; body?: string; transportError?: string }, string][] = [
    ['a plain 200', { status: 200 }, 'ok'],
    ['a 404', { status: 404 }, 'absent'],
    ['a 403 with no challenge markers', { status: 403, body: 'nope' }, 'refused'],
    ['a 503 with no challenge markers', { status: 503, body: 'maintenance' }, 'refused'],
    ['a 403 carrying a captcha', { status: 403, body: 'Please complete the CAPTCHA' }, 'challenge'],
    [
      'a 503 carrying an Incapsula interstitial',
      { status: 503, body: 'Request unsuccessful. Incapsula incident ID' },
      'challenge',
    ],
    ['a 429', { status: 429 }, 'rate_limited'],
    ['a 301', { status: 301 }, 'redirect'],
    ['a 308', { status: 308 }, 'redirect'],
    ['a 500', { status: 500 }, 'unexpected'],
    [
      'a proxy refusing CONNECT',
      { status: 0, transportError: 'CONNECT tunnel failed, response 403' },
      'local_network',
    ],
    ['a 407 from a proxy', { status: 0, transportError: 'HTTP 407 proxy auth required' }, 'local_network'],
    ['a DNS or TLS failure', { status: 0, transportError: 'Could not resolve host' }, 'unreachable'],
    ['a timeout with no detail', { status: 0 }, 'unreachable'],
  ]

  for (const [name, input, expected] of CASES) {
    it(`${name} is "${expected}"`, () => {
      expect(rules.classifyProbe(input)).toBe(expected)
    })
  }

  it('a 200 whose body lacks the expected marker is not an ok', () => {
    // SEC answering 200 with an error page is not the submissions API working.
    expect(
      rules.applyExpectation('ok', { body: '<html>maintenance</html>', expect: 'filings' }),
    ).toBe('unexpected')
    expect(rules.applyExpectation('ok', { body: '{"filings":{}}', expect: 'filings' })).toBe('ok')
  })

  it('an expectation is not applied to something that already failed', () => {
    expect(rules.applyExpectation('absent', { body: '', expect: 'filings' })).toBe('absent')
  })

  /*
     THE DISTINCTION THE WHOLE SCRIPT TURNS ON. A proxy denying CONNECT and a
     source returning 403 are the same "it did not work" from the operator's
     chair and completely different problems. Collapsing them is how somebody
     disables a working source because of a firewall.
  */
  it('separates this machine refusing from the source refusing', () => {
    const local = rules.classifyProbe({ status: 0, transportError: 'proxy denied CONNECT' })
    const source = rules.classifyProbe({ status: 403, body: '' })
    expect(local).toBe('local_network')
    expect(source).toBe('refused')
    expect(local).not.toBe(source)
  })
})

// ---------------------------------------------------------------------------
// 2. The verdict. A failed optional candidate must not disable a source.
// ---------------------------------------------------------------------------

describe('the source verdict', () => {
  /** Exactly what the operator observed on 2026-09-13, from a direct network. */
  const OBSERVED_MARS: Result[] = [
    r('required', 'ok', 'robots.txt'),
    r('discovery', 'absent', 'rss.xml'),
    r('discovery', 'ok', 'sitemap.xml'),
    r('discovery', 'ok', 'news-and-stories'),
  ]

  it('calls Mars VIABLE on the results the operator actually observed', () => {
    const v = rules.sourceVerdict(OBSERVED_MARS)
    expect(v.viable).toBe(true)
    expect(v.blockers).toHaveLength(0)
    expect(v.warnings.map((w) => w.label)).toEqual(['rss.xml'])
    expect(v.usableDiscovery).toHaveLength(2)
    expect(v.conclusive).toBe(true)
  })

  it('exits 0 on those results', () => {
    expect(rules.exitCode({ 'mars-newsroom': rules.sourceVerdict(OBSERVED_MARS) })).toBe(0)
  })

  it('is viable on ONE usable discovery path and nothing else', () => {
    const v = rules.sourceVerdict([
      r('required', 'ok', 'robots.txt'),
      r('discovery', 'absent', 'a'),
      r('discovery', 'absent', 'b'),
      r('discovery', 'refused', 'c'),
      r('discovery', 'ok', 'd'),
    ])
    expect(v.viable).toBe(true)
    expect(v.warnings).toHaveLength(3)
  })

  it('records each failed optional candidate as a warning, never a blocker', () => {
    const v = rules.sourceVerdict([
      r('required', 'ok', 'robots.txt'),
      r('discovery', 'absent', 'a'),
      r('discovery', 'ok', 'b'),
    ])
    expect(v.blockers).toHaveLength(0)
    expect(v.warnings).toHaveLength(1)
    expect(v.warnings[0]?.outcome).toBe('absent')
  })

  it('is NOT viable when no discovery path answers', () => {
    const v = rules.sourceVerdict([
      r('required', 'ok', 'robots.txt'),
      r('discovery', 'absent', 'a'),
      r('discovery', 'absent', 'b'),
    ])
    expect(v.viable).toBe(false)
    expect(v.conclusive).toBe(true)
  })

  it('is NOT viable when a required endpoint fails, however many optionals work', () => {
    const v = rules.sourceVerdict([
      r('required', 'refused', 'robots.txt'),
      r('discovery', 'ok', 'a'),
      r('discovery', 'ok', 'b'),
    ])
    expect(v.viable).toBe(false)
    expect(v.blockers.map((b) => b.label)).toEqual(['robots.txt'])
  })

  it('treats a source with no discovery candidates as viable on its required set', () => {
    // SEC: three required APIs, no optional discovery.
    const v = rules.sourceVerdict([
      r('required', 'ok', 'tickers'),
      r('required', 'ok', 'submissions'),
      r('required', 'ok', 'archive'),
    ])
    expect(v.viable).toBe(true)
    expect(v.warnings).toHaveLength(0)
  })

  /*
     "THIS MACHINE CANNOT TELL" IS NOT "THE SOURCE IS DEAD".

     Run from a network that blocks the host, every probe fails identically.
     Reporting that as a source verdict is how a working source gets disabled
     from behind a corporate proxy.
  */
  it('is INCONCLUSIVE when every failure was this machine', () => {
    const v = rules.sourceVerdict([
      r('required', 'local_network', 'robots.txt'),
      r('discovery', 'local_network', 'a'),
      r('discovery', 'local_network', 'b'),
    ])
    expect(v.conclusive).toBe(false)
    expect(v.attribution).toBe('local_network')
  })

  it('does not let an inconclusive source set a failing exit code', () => {
    const v = rules.sourceVerdict([
      r('required', 'local_network', 'robots.txt'),
      r('discovery', 'local_network', 'a'),
    ])
    expect(rules.exitCode({ 'mars-newsroom': v })).toBe(0)
  })

  it('still blames the source when something DID answer', () => {
    // One real HTTP answer means the host is reachable, so a 404 elsewhere is
    // about the source, not the network.
    const v = rules.sourceVerdict([
      r('required', 'ok', 'robots.txt'),
      r('discovery', 'absent', 'a'),
      r('discovery', 'local_network', 'b'),
    ])
    expect(v.attribution).toBe('source')
    expect(v.conclusive).toBe(true)
  })

  it('surfaces an interstitial challenge separately from an ordinary miss', () => {
    const v = rules.sourceVerdict([
      r('required', 'ok', 'robots.txt'),
      r('discovery', 'challenge', 'a'),
      r('discovery', 'ok', 'b'),
    ])
    // Still viable -- one path works -- but the challenge is called out,
    // because the correct response is to find an official feed, not to ignore it.
    expect(v.viable).toBe(true)
    expect(v.challenges).toHaveLength(1)
  })

  it('a redirect is inconclusive, not dead', () => {
    const v = rules.sourceVerdict([
      r('required', 'ok', 'robots.txt'),
      r('discovery', 'redirect', 'a'),
      r('discovery', 'ok', 'b'),
    ])
    expect(v.viable).toBe(true)
    expect(v.warnings.map((w) => w.outcome)).toEqual(['redirect'])
  })
})

// ---------------------------------------------------------------------------
// 3. A retired candidate is gone from everywhere.
// ---------------------------------------------------------------------------

describe('retired candidates', () => {
  it('records why each one was retired, with a date and an observation', () => {
    expect(rules.RETIRED_CANDIDATES.length).toBeGreaterThan(0)
    for (const entry of rules.RETIRED_CANDIDATES) {
      expect(entry.url).toMatch(/^https:\/\//)
      expect(entry.observed).toMatch(/HTTP \d{3}/)
      expect(entry.on).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(entry.by.length).toBeGreaterThan(0)
    }
  })

  it('names the Mars rss.xml path, observed 404', () => {
    const marsRss = rules.RETIRED_CANDIDATES.find(
      (c: { url: string }) => c.url === 'https://www.mars.com/rss.xml',
    )
    expect(marsRss).toBeDefined()
    expect(marsRss?.observed).toBe('HTTP 404')
  })

  /*
     The point of the list. A dead guess costs a request and a log line on every
     run and teaches whoever reads the report to ignore misses -- so it has to
     be gone from the seed, the connector defaults and both scripts, not just
     from wherever somebody happened to look.
  */
  /*
     The point of the list. A dead guess costs a request and a log line on every
     run and teaches whoever reads the report to ignore misses -- so it has to
     be gone from the seed, the connector defaults and both scripts.

     "Gone" means gone as a CANDIDATE. Each artifact may still name it in the
     one place that explains the retirement -- a comment, the seed's `retired`
     list, the example SQL the scripts print for removing it. An earlier version
     of this test just grepped the whole file and failed on that example SQL,
     which is a test failing on the documentation of the thing it is checking.
     So each artifact is checked where a candidate actually lives.
  */
  const retiredUrls = () => rules.RETIRED_CANDIDATES.map((c: { url: string }) => c.url)

  it('is not in the connector default feedCandidates', () => {
    const block = connector.slice(
      connector.indexOf('feedCandidates: ['),
      connector.indexOf('sitemapCandidates:'),
    )
    expect(block.length).toBeGreaterThan(20)
    for (const url of retiredUrls()) expect(block).not.toContain(url)
  })

  it('is not in the seed jsonb_build_array of candidates', () => {
    const block = seed.slice(seed.indexOf("'feedCandidates', jsonb_build_array("))
    const arrayOnly = block.slice(0, block.indexOf('),'))
    expect(arrayOnly.length).toBeGreaterThan(20)
    for (const url of retiredUrls()) expect(arrayOnly).not.toContain(url)
  })

  it('is named exactly once in the seed, in the retired list that removes it', () => {
    for (const url of retiredUrls()) {
      const inValues = seed.includes(`values ('${url}')`) || seed.includes(`('${url}')`)
      expect(inValues, `${url} is not in the seed's retired list`).toBe(true)
    }
    expect(seed).toContain('retired(url)')
  })

  for (const [name, text, probeToken] of [
    ['bash', sh, 'probe '],
    ['PowerShell', ps, 'Test-Endpoint '],
  ] as const) {
    it(`the ${name} script never probes a retired URL`, () => {
      const probeLines = text
        .split('\n')
        .filter((line) => line.trim().startsWith(probeToken))
      expect(probeLines.length).toBeGreaterThan(5)
      for (const url of retiredUrls()) {
        for (const line of probeLines) {
          expect(line, `${name} still probes ${url}`).not.toContain(url)
        }
      }
    })

    it(`the ${name} script explains the retirement rather than hiding it`, () => {
      // It may name the URL in a comment or in the example removal SQL. What it
      // must not do is leave a reader guessing why it disappeared.
      for (const url of retiredUrls()) {
        expect(text, `${name} does not mention ${url} at all`).toContain(url)
      }
      expect(text).toMatch(/retire/i)
    })
  }
})

// ---------------------------------------------------------------------------
// 4. The four artifacts agree.
// ---------------------------------------------------------------------------

describe('the rules module, the seed and both scripts agree', () => {
  const marsProbes = () => rules.PROBES['mars-newsroom'] as { url: string; role: string }[]

  it('every Mars discovery candidate in the module appears in the seed', () => {
    for (const probe of marsProbes().filter((p) => p.role === 'discovery')) {
      expect(seed, `${probe.url} missing from the seed`).toContain(probe.url)
    }
  })

  it('every Mars candidate in the seed is probed by the module', () => {
    const seedUrls = [...seed.matchAll(/'(https:\/\/www\.mars\.com\/[^']*)'/g)]
      .map((m) => m[1])
      .filter((u): u is string => typeof u === 'string')
    const configured = seedUrls.filter(
      (u) => u !== 'https://www.mars.com' && !u.endsWith('/robots.txt'),
    )
    const probed = new Set(marsProbes().map((p) => p.url))
    for (const url of configured) {
      if (rules.RETIRED_CANDIDATES.some((c: { url: string }) => c.url === url)) continue
      expect(probed.has(url), `${url} is configured but never probed`).toBe(true)
    }
  })

  for (const [name, text] of [
    ['bash', sh],
    ['PowerShell', ps],
  ] as const) {
    it(`the ${name} script probes exactly the module's endpoints`, () => {
      for (const source of Object.keys(rules.PROBES)) {
        for (const probe of rules.PROBES[source] as { url: string; role: string }[]) {
          expect(text, `${probe.url} missing from the ${name} script`).toContain(probe.url)
        }
      }
    })

    it(`the ${name} script gives each endpoint the module's role`, () => {
      for (const source of Object.keys(rules.PROBES)) {
        for (const probe of rules.PROBES[source] as { url: string; role: string }[]) {
          const line = text.split('\n').find((l) => l.includes(probe.url) && !l.trim().startsWith('#'))
          expect(line, `no probe line for ${probe.url}`).toBeDefined()
          expect(line!.toLowerCase(), `${probe.url} has the wrong role`).toContain(probe.role)
        }
      }
    })

    it(`the ${name} script treats a discovery miss as a warning`, () => {
      expect(text).toMatch(/warn/i)
      expect(text).toMatch(/NOT VIABLE/)
      expect(text).toMatch(/INCONCLUSIVE/)
    })

    it(`the ${name} script classifies the same outcomes as the module`, () => {
      for (const outcome of [
        'local_network',
        'unreachable',
        'absent',
        'refused',
        'challenge',
        'rate_limited',
        'redirect',
        'unexpected',
      ]) {
        expect(text, `${outcome} missing from the ${name} script`).toContain(outcome)
      }
    })
  }

  it('both scripts share one challenge-marker list with the module', () => {
    for (const marker of ['captcha', 'verify you are human', 'checking your browser', 'incapsula']) {
      expect(rules.CHALLENGE_MARKERS.source).toContain(marker)
      expect(sh).toContain(marker)
      expect(ps).toContain(marker)
    }
  })

  it('the connector still walks feed, then sitemap, then index', () => {
    // The discovery order in the module mirrors the connector's own. If the
    // connector's order changes, the pre-flight stops predicting it.
    const order = (rules.PROBES['mars-newsroom'] as { kind?: string }[])
      .filter((p) => p.kind)
      .map((p) => p.kind)
    expect(order).toEqual(['feed', 'feed', 'sitemap', 'index', 'index', 'index'])
    const feedIdx = connector.indexOf('...config.feedCandidates.map')
    const siteIdx = connector.indexOf('...config.sitemapCandidates')
    const indexIdx = connector.indexOf('...config.indexCandidates.map')
    expect(feedIdx).toBeGreaterThan(-1)
    expect(feedIdx).toBeLessThan(siteIdx)
    expect(siteIdx).toBeLessThan(indexIdx)
  })
})

// ---------------------------------------------------------------------------
// 5. Reconciliation must not overwrite unrelated configuration.
// ---------------------------------------------------------------------------

describe('reconciling the seed with hosted connector configuration', () => {
  it('the upsert never replaces connector_config wholesale', () => {
    // connector_config is OPERATOR state, corrected during a live run from a
    // machine that can reach the source. A seed that overwrote it would throw
    // away the one thing this repository cannot know.
    const doUpdate = seed.slice(seed.indexOf('on conflict (id) do update set'))
    expect(doUpdate).not.toMatch(/connector_config\s*=\s*excluded\.connector_config/)
  })

  it('retirement reaches an existing row through a targeted array edit', () => {
    expect(seed).toContain('jsonb_set(')
    expect(seed).toContain("'{feedCandidates}'")
    expect(seed).toContain('jsonb_array_elements_text')
    // Not the `||` merge form, which replaces the whole key.
    expect(seed).not.toMatch(/connector_config\s*\|\|\s*'\{"feedCandidates"/)
  })

  it('the reconciliation is idempotent: a second run matches nothing', () => {
    const stmt = seed.slice(seed.indexOf('with retired(url)'))
    expect(stmt).toMatch(/where\s+s\.id\s*=\s*'mars-newsroom'/)
    // The guard that makes re-running a no-op.
    expect(stmt).toContain('and exists (')
    expect(stmt).toContain('in (select url from retired)')
  })

  it('touches only the mars-newsroom row', () => {
    const stmt = seed.slice(seed.indexOf('with retired(url)'))
    expect(stmt).toContain("s.id = 'mars-newsroom'")
  })

  it('both scripts print the targeted form and warn against the merge form', () => {
    for (const [name, text] of [
      ['bash', sh],
      ['PowerShell', ps],
    ] as const) {
      expect(text, name).toContain('jsonb_set(')
      expect(text, name).toMatch(/COMPLETE remaining array/)
    }
  })
})

// ---------------------------------------------------------------------------
// 6. Both sources stay disabled.
// ---------------------------------------------------------------------------

describe('the live cohort stays disabled in the repository', () => {
  it('seeds both sources with enabled = false', () => {
    // Two source rows, each with an explicit `false` in the enabled column.
    expect(seed).toContain("'sec-edgar'")
    expect(seed).toContain("'mars-newsroom'")
    expect(seed).toContain('SEEDED DISABLED')
    const enabledTrue = seed.match(/enabled\s*=\s*true/gi) ?? []
    expect(enabledTrue).toHaveLength(0)
  })

  it('never resets enabled or health_status on an existing row', () => {
    const doUpdate = seed.slice(seed.indexOf('on conflict (id) do update set'))
    expect(doUpdate).not.toMatch(/\benabled\s*=/)
    expect(doUpdate).not.toMatch(/health_status\s*=/)
    expect(doUpdate).not.toMatch(/last_success_at\s*=/)
  })

  it('the runbook still makes enabling a separate, deliberate step', () => {
    expect(runbook).toMatch(/enabled\s*=\s*false/)
  })
})
