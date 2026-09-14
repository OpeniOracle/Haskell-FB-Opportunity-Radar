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
  RETIRED_CANDIDATES: { url: string; array: string; observed: string; on: string; by: string }[]
  CANDIDATE_ARRAYS: string[]
  PROBES: Record<
    string,
    { label: string; url: string; role: string; kind?: string; array?: string; expect: string }[]
  >
  CHALLENGE_MARKERS: RegExp
  remediationFor: (
    results: { label?: string; role: string; outcome: string; url: string; array?: string }[],
  ) => { array: string; urls: string[] }[]
  removalSql: (array: string, urls: string[]) => string
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

  /*
     EXACT URLS, NOT SUBSTRINGS.

     `https://www.mars.com/news` is a PREFIX of
     `https://www.mars.com/news-and-stories`, so a `contains` check reports the
     live newsroom index as a retired candidate. Quoting both ends is what makes
     the two distinguishable -- the same trap that already caught a redirect
     assertion in liveConnectors.test.ts.
  */
  const namesUrl = (text: string, url: string) =>
    new RegExp(`['"\`]${url.replace(/[.*+?^$|()[\]{}\\]/g, '\\$&')}['"\`]`).test(text)

  it('is not a live candidate in the connector defaults', () => {
    const block = connector.slice(
      connector.indexOf('export const MARS_DEFAULT_CONFIG'),
      connector.indexOf('itemPathPattern'),
    )
    expect(block.length).toBeGreaterThan(100)
    const code = block
      .split('\n')
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l.trim()))
      .join('\n')
    for (const url of retiredUrls()) {
      expect(namesUrl(code, url), `${url} is still a connector default`).toBe(false)
    }
  })

  it('is not a live candidate in the seeded connector_config', () => {
    const block = seed.slice(
      seed.indexOf("'feedCandidates'"),
      seed.indexOf("'itemPathPattern'"),
    )
    expect(block.length).toBeGreaterThan(100)
    const code = block
      .split('\n')
      .filter((l) => !l.trim().startsWith('--'))
      .join('\n')
    for (const url of retiredUrls()) {
      expect(namesUrl(code, url), `${url} is still seeded as a candidate`).toBe(false)
    }
  })

  it('is listed in the seed retirement table, with the array it lives in', () => {
    const table = seed.slice(seed.indexOf('with retired(url, arr)'), seed.indexOf('arrays(arr)'))
    for (const entry of rules.RETIRED_CANDIDATES) {
      expect(table, `${entry.url} is not in the seed's retired list`).toContain(entry.url)
      expect(table, `${entry.url} has no array in the seed`).toContain(entry.array)
    }
    expect(seed).toContain('with retired(url, arr)')
  })

  it('every retired candidate declares which array it lived in', () => {
    for (const entry of rules.RETIRED_CANDIDATES) {
      expect(rules.CANDIDATE_ARRAYS).toContain(entry.array)
    }
  })

  for (const [name, text, probeToken] of [
    ['bash', sh, 'probe '],
    ['PowerShell', ps, 'Test-Endpoint '],
  ] as const) {
    it(`the ${name} script never probes a retired URL`, () => {
      const probeLines = text.split('\n').filter((line) => line.trim().startsWith(probeToken))
      expect(probeLines.length).toBeGreaterThan(2)
      for (const url of retiredUrls()) {
        for (const line of probeLines) {
          expect(namesUrl(line, url), `${name} still probes ${url}`).toBe(false)
        }
      }
    })

    it(`the ${name} script explains why the feed candidates are gone`, () => {
      // Requiring every retired URL verbatim would just be noise once the list
      // grows. What a reader needs is the finding and where the list lives.
      expect(text).toMatch(/retire/i)
      expect(text).toContain('RETIRED_CANDIDATES')
      expect(text).toContain('scripts/lib/connectivity-rules.mjs')
      expect(text).toMatch(/NO FEED CANDIDATE|feedCandidates is now legitimately empty/)
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
    // No feed candidate survives, so the walk starts at the sitemap.
    expect(order).toEqual(['sitemap', 'index'])
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
  const reconcile = () => seed.slice(seed.indexOf('with retired(url, arr)'))

  it('the upsert never replaces connector_config wholesale', () => {
    // connector_config is OPERATOR state, corrected during a live run from a
    // machine that can reach the source. A seed that overwrote it would throw
    // away the one thing this repository cannot know.
    const doUpdate = seed.slice(
      seed.indexOf('on conflict (id) do update set'),
      seed.indexOf('with retired(url, arr)'),
    )
    expect(doUpdate).not.toMatch(/connector_config\s*=\s*excluded\.connector_config/)
  })

  it('covers every array a retired candidate can live in', () => {
    const stmt = reconcile()
    for (const array of rules.CANDIDATE_ARRAYS) {
      expect(stmt, `${array} is not named in the reconciliation`).toContain(array)
    }
  })

  it('removes a URL only from the array it belongs to', () => {
    // `where arr = k`. Without it, a URL retired from feedCandidates would be
    // stripped from indexCandidates too if it happened to appear there.
    expect(reconcile()).toContain('where arr = k')
  })

  it('edits arrays and passes every other value through untouched', () => {
    const stmt = reconcile()
    expect(stmt).toContain("jsonb_typeof(v) = 'array'")
    expect(stmt).toContain('else v')
    // Not the `||` merge form, which replaces a whole key.
    expect(stmt).not.toMatch(/connector_config\s*\|\|\s*'\{"/)
  })

  it('preserves array order explicitly', () => {
    // The connector tries candidates in order, so a reshuffle would silently
    // change which discovery path is attempted first.
    expect(reconcile()).toContain('order by c.ordinality')
  })

  it('is idempotent: the guard makes a second run match nothing', () => {
    const stmt = reconcile()
    expect(stmt).toMatch(/where\s+s\.id\s*=\s*'mars-newsroom'/)
    expect(stmt).toContain('and exists (')
    expect(stmt).toContain('in (select url from retired where arr = k)')
  })

  it('touches only the mars-newsroom row', () => {
    expect(reconcile()).toContain("s.id = 'mars-newsroom'")
  })
})

// ---------------------------------------------------------------------------
// 5b. Remediation output is derived from the run, never printed from a template.
// ---------------------------------------------------------------------------

describe('what the script tells the operator to fix', () => {
  const d = (outcome: string, array: string, url: string) => ({
    label: url,
    role: 'discovery' as const,
    outcome,
    array,
    url,
  })

  /*
     THE DEFECT. Both scripts used to print the same example SQL on every run,
     naming https://www.mars.com/rss.xml -- a URL the operator had already
     removed from the hosted row. Advice that is irrelevant on every run after
     the first teaches an operator to skip the section, which is exactly when a
     real one appears.
  */
  it('prints nothing when nothing is wrong', () => {
    expect(
      rules.remediationFor([
        d('ok', 'sitemapCandidates', 'https://www.mars.com/sitemap.xml'),
        d('ok', 'indexCandidates', 'https://www.mars.com/news-and-stories'),
      ]),
    ).toEqual([])
  })

  it('names exactly the candidates that 404ed, in their own arrays', () => {
    const out = rules.remediationFor([
      d('absent', 'feedCandidates', 'https://www.mars.com/feed'),
      d('absent', 'indexCandidates', 'https://www.mars.com/news'),
      d('absent', 'indexCandidates', 'https://www.mars.com/press-releases'),
      d('ok', 'sitemapCandidates', 'https://www.mars.com/sitemap.xml'),
    ])
    expect(out).toEqual([
      { array: 'feedCandidates', urls: ['https://www.mars.com/feed'] },
      {
        array: 'indexCandidates',
        urls: ['https://www.mars.com/news', 'https://www.mars.com/press-releases'],
      },
    ])
  })

  /*
     ONLY A 404. The remediation DELETES a URL from configuration, so the bar is
     evidence that the path is not there -- not evidence that it did not answer
     this time. A 403 may be a WAF in front of a real page, a 429 is a rate
     limit, a redirect is the page moving, and a transport error is usually the
     operator's own network. Retiring on any of those deletes a working
     candidate because of a bad afternoon.
  */
  for (const outcome of ['refused', 'challenge', 'rate_limited', 'redirect', 'local_network', 'unreachable', 'unexpected']) {
    it(`never recommends removing a candidate that was "${outcome}"`, () => {
      expect(
        rules.remediationFor([d(outcome, 'indexCandidates', 'https://www.mars.com/news')]),
      ).toEqual([])
    })
  }

  it('never recommends removing a required endpoint', () => {
    // robots.txt and the SEC APIs are not configuration and cannot be retired.
    expect(
      rules.remediationFor([
        { label: 'robots', role: 'required', outcome: 'absent', url: 'https://www.mars.com/robots.txt' },
      ]),
    ).toEqual([])
  })

  it('emits one statement per array, with every dead URL in it', () => {
    const sql = rules.removalSql('indexCandidates', [
      'https://www.mars.com/news',
      'https://www.mars.com/press-releases',
    ])
    expect(sql).toContain("jsonb_set(")
    expect(sql).toContain("'{indexCandidates}'")
    expect(sql).toContain("'https://www.mars.com/news', 'https://www.mars.com/press-releases'")
    expect(sql).toContain('order by ordinality')
    expect(sql).toContain("where id = 'mars-newsroom';")
    // One array, so the other two are untouched.
    expect(sql).not.toContain('feedCandidates')
    expect(sql).not.toContain('sitemapCandidates')
  })

  for (const [name, text] of [
    ['bash', sh],
    ['PowerShell', ps],
  ] as const) {
    it(`the ${name} script builds its remediation from the run`, () => {
      // It must not carry a hard-coded URL in the advice it prints.
      const advice = text.slice(text.indexOf('proved do not exist'))
      expect(advice.length).toBeGreaterThan(100)
      for (const url of rules.RETIRED_CANDIDATES.map((c: { url: string }) => c.url)) {
        expect(advice, `${name} hard-codes ${url} in its advice`).not.toContain(url)
      }
    })

    it(`the ${name} script prints nothing when nothing 404ed`, () => {
      expect(text).toMatch(/Dead|DEAD/)
      expect(text).toMatch(/if \[ -n "\$DEAD" \]|if \(\$script:Dead\.Count -gt 0\)/)
    })

    it(`the ${name} script only records a 404 for removal`, () => {
      expect(text).toContain('absent')
      expect(text).toMatch(/ONLY A 404/)
    })

    it(`the ${name} script still warns against the whole-key merge form`, () => {
      // The two scripts wrap the sentence differently, so match on the words
      // rather than on one script's line breaks and quoting.
      expect(text).toContain('COMPLETE')
      expect(text).toMatch(/remaining array/)
      expect(text).toMatch(/replaces the whole key/)
    })
  }
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
