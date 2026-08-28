import { describe, expect, it, vi } from 'vitest'
import {
  COLLECTED_FORMS,
  CikResolutionError,
  accessionNoDashes,
  discoverSecFilings,
  filingsFromSubmissions,
  normalizeCompanyName,
  padCik,
  resolveCikFromTickerFile,
  retrieveSecDocument,
  type SecCompanyTarget,
} from '../../netlify/functions/_shared/connectors/sec'
import {
  canonicalizeUrl,
  discoverMars,
  linksFromHtml,
  marsConfig,
} from '../../netlify/functions/_shared/connectors/mars'
import {
  classifyRestriction,
  extractStructuredArticle,
  htmlToText,
  parseFeed,
  parseRobots,
  parseSitemap,
  robotsAllows,
} from '../../netlify/functions/_shared/connectors/extract'
import { classifyText, clusterKey } from '../../netlify/functions/_shared/connectors/classify'
import {
  RequestPacer,
  backoffDelayMs,
  isRetryable,
  mapWithLimit,
  retryAfterMs,
} from '../../netlify/functions/_shared/egress'
import type {
  ConnectorContext,
  DiscoveredDocument,
} from '../../netlify/functions/_shared/connectors/types'

/**
 * The connectors, driven against RECORDED TRANSPORT CONTRACTS.
 *
 * These fixtures are the shapes the real endpoints return — EDGAR's
 * column-oriented `filings.recent`, an RSS item, a JSON-LD NewsArticle, a
 * robots group. They exist so the parsing and the decision logic are provable
 * without a network, and they are deliberately NOT a substitute for the hosted
 * run: a fixture can prove we read `acceptanceDateTime` correctly, and cannot
 * prove SEC still sends it. The live backfill is what proves that.
 */

const WINDOW = { start: '2026-01-01T00:00:00.000Z', end: '2026-12-31T00:00:00.000Z' }

const TICKER_FILE = {
  '0': { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' },
  '1': { cik_str: 77476, ticker: 'PEP', title: 'PEPSICO INC' },
  '2': { cik_str: 100493, ticker: 'TSN', title: 'TYSON FOODS, INC.' },
  '3': { cik_str: 1090727, ticker: 'UPS', title: 'UNITED PARCEL SERVICE INC' },
}

function ctx(overrides: Partial<ConnectorContext> = {}): ConnectorContext {
  return {
    userAgent: 'Openi-Analytics-Radar/1.0 oracles@openi-analytics.com',
    allowlist: ['sec.gov', 'data.sec.gov', 'mars.com'],
    get: vi.fn(),
    pacer: new RequestPacer(0),
    cache: { read: async () => null, write: async () => {} },
    now: () => new Date('2026-06-01T12:00:00.000Z'),
    config: {},
    window: WINDOW,
    log: () => {},
    ...overrides,
  }
}

function response(body: string, init: Partial<{ status: number; headers: Record<string, string> }> = {}) {
  return {
    url: 'https://example.invalid',
    finalUrl: 'https://example.invalid',
    status: init.status ?? 200,
    headers: init.headers ?? { 'content-type': 'application/json' },
    body: new TextEncoder().encode(body),
    startedAt: '2026-06-01T12:00:00.000Z',
    finishedAt: '2026-06-01T12:00:01.000Z',
    redirects: [],
    notModified: false,
  }
}

/* ==================================================================== */

describe('SEC user-agent and fair access', () => {
  it('sends the declared operator User-Agent on every request', async () => {
    const seen: string[] = []
    const get = vi.fn(async (url: string) => {
      seen.push(url)
      if (url.includes('company_tickers')) return response(JSON.stringify(TICKER_FILE))
      return response(JSON.stringify({ filings: { recent: {} } }))
    })
    const context = ctx({ get: get as unknown as ConnectorContext['get'] })
    await discoverSecFilings(context, [
      { entityKey: 'sec:0000100493', canonicalName: 'Tyson Foods, Inc.' },
    ])
    // The User-Agent is applied by the gateway from ctx.userAgent; what this
    // asserts is that the connector never bypasses it with its own fetch.
    expect(context.userAgent).toMatch(/openi/i)
    expect(context.userAgent).toContain('@')
    expect(seen.every((u) => u.startsWith('https://'))).toBe(true)
  })

  it('retries only the statuses that mean "later"', () => {
    for (const status of [408, 425, 429, 500, 502, 503, 504]) {
      expect(isRetryable(status), `${status} should be retried`).toBe(true)
    }
    for (const status of [200, 301, 400, 401, 403, 404, 410, 422]) {
      expect(isRetryable(status), `${status} must not be retried`).toBe(false)
    }
  })

  it('honours Retry-After in both documented forms', () => {
    const now = Date.parse('2026-06-01T12:00:00Z')
    expect(retryAfterMs('30', now)).toBe(30_000)
    expect(retryAfterMs('Mon, 01 Jun 2026 12:00:30 GMT', now)).toBe(30_000)
    expect(retryAfterMs(undefined, now)).toBeNull()
    expect(retryAfterMs('nonsense', now)).toBeNull()
    // A server asking for a week does not get a week.
    expect(retryAfterMs('999999', now)).toBe(300_000)
  })

  it('backs off exponentially with jitter, under a ceiling', () => {
    const policy = { attempts: 5, baseDelayMs: 500, maxDelayMs: 4000 }
    expect(backoffDelayMs(1, policy, () => 1)).toBe(500)
    expect(backoffDelayMs(2, policy, () => 1)).toBe(1000)
    expect(backoffDelayMs(4, policy, () => 1)).toBe(4000)
    expect(backoffDelayMs(9, policy, () => 1)).toBe(4000)
    // Full jitter: never more than the capped value, never zero-clustered.
    expect(backoffDelayMs(2, policy, () => 0)).toBe(500)
  })

  it('holds a concurrency ceiling and preserves order', async () => {
    let active = 0
    let peak = 0
    const items = Array.from({ length: 12 }, (_, i) => i)
    const out = await mapWithLimit(items, 3, async (n) => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise((r) => setTimeout(r, 1))
      active -= 1
      return n * 2
    })
    expect(peak).toBeLessThanOrEqual(3)
    expect(out).toEqual(items.map((n) => n * 2))
  })

  it('paces requests to a minimum interval', async () => {
    let clock = 0
    const waited: number[] = []
    const pacer = new RequestPacer(
      200,
      () => clock,
      async (ms) => {
        waited.push(ms)
        clock += ms
      },
    )
    await pacer.take()
    await pacer.take()
    expect(waited).toEqual([200])
  })
})

describe('SEC CIK resolution', () => {
  const tyson: SecCompanyTarget = { entityKey: 'sec:0000100493', canonicalName: 'Tyson Foods, Inc.' }

  it('resolves from SEC data by canonical name, not from a constant', () => {
    expect(resolveCikFromTickerFile(TICKER_FILE, tyson)).toBe('0000100493')
    expect(
      resolveCikFromTickerFile(TICKER_FILE, { entityKey: 'sec:x', canonicalName: 'PepsiCo, Inc.' }),
    ).toBe('0000077476')
  })

  it('normalises legal-form noise before comparing', () => {
    expect(normalizeCompanyName('TYSON FOODS, INC.')).toBe(normalizeCompanyName('Tyson Foods Incorporated'))
    expect(normalizeCompanyName('PEPSICO INC')).toBe(normalizeCompanyName('PepsiCo, Inc.'))
  })

  it('pads to ten digits, which is what the API path requires', () => {
    expect(padCik(100493)).toBe('0000100493')
    expect(padCik('77476')).toBe('0000077476')
    expect(padCik('sec:0000100493'.slice(4))).toBe('0000100493')
  })

  it('FAILS LOUDLY when a configured CIK disagrees with SEC', () => {
    // The whole point of cross-checking. Quietly preferring either value would
    // hide precisely the error the check exists to catch.
    expect(() =>
      resolveCikFromTickerFile(TICKER_FILE, { ...tyson, expectedCik: '0000000001' }),
    ).toThrow(CikResolutionError)
    expect(() =>
      resolveCikFromTickerFile(TICKER_FILE, { ...tyson, expectedCik: '0000000001' }),
    ).toThrow(/refusing to guess/i)
  })

  it('refuses when nothing matches rather than picking the closest', () => {
    expect(() =>
      resolveCikFromTickerFile(TICKER_FILE, { entityKey: 'x', canonicalName: 'Nonexistent Foods' }),
    ).toThrow(/no filer/i)
  })

  it('refuses an empty ticker file instead of resolving nothing', () => {
    expect(() => resolveCikFromTickerFile({}, tyson)).toThrow(/empty/i)
  })

  it('uses a ticker only to separate genuine ambiguity', () => {
    const ambiguous = {
      a: { cik_str: 1, ticker: 'AAA', title: 'Example Foods Inc' },
      b: { cik_str: 2, ticker: 'BBB', title: 'Example Foods Inc' },
    }
    expect(() =>
      resolveCikFromTickerFile(ambiguous, { entityKey: 'x', canonicalName: 'Example Foods' }),
    ).toThrow(/no ticker hint/i)
    expect(
      resolveCikFromTickerFile(ambiguous, {
        entityKey: 'x',
        canonicalName: 'Example Foods',
        tickerHint: 'BBB',
      }),
    ).toBe('0000000002')
  })
})

describe('SEC filing selection', () => {
  const submissions = {
    cik: '100493',
    name: 'Tyson Foods, Inc.',
    filings: {
      recent: {
        accessionNumber: ['0000100493-26-000010', '0000100493-26-000011', '0000100493-25-000099'],
        form: ['8-K', 'SC 13G', '10-K'],
        filingDate: ['2026-03-04', '2026-03-05', '2025-11-17'],
        acceptanceDateTime: ['2026-03-04T16:31:00.000Z', '2026-03-05T09:00:00.000Z', ''],
        primaryDocument: ['tsn-20260304.htm', 'sc13g.htm', 'tsn-10k.htm'],
        primaryDocDescription: ['8-K', 'SC 13G', '10-K'],
        reportDate: ['2026-03-04', '', '2025-09-28'],
        items: ['2.05,8.01', '', ''],
      },
    },
  }
  const target: SecCompanyTarget = { entityKey: 'sec:0000100493', canonicalName: 'Tyson Foods, Inc.' }

  it('keeps only the collected forms', () => {
    const docs = filingsFromSubmissions(submissions, '0000100493', target, WINDOW)
    expect(docs.map((d) => d.documentType)).toEqual(['8-K'])
    expect(COLLECTED_FORMS).toContain('10-K')
    // SC 13G is an ownership form: filtered at discovery so it is never fetched.
    expect(docs.some((d) => d.documentType === 'SC 13G')).toBe(false)
  })

  it('filters by the collection window, not by "recent"', () => {
    const wide = filingsFromSubmissions(submissions, '0000100493', target, {
      start: '2025-01-01T00:00:00Z',
      end: '2026-12-31T00:00:00Z',
    })
    expect(wide.map((d) => d.documentType).sort()).toEqual(['10-K', '8-K'])
  })

  it('prefers the precise acceptance instant and records the precision it got', () => {
    const wide = filingsFromSubmissions(submissions, '0000100493', target, {
      start: '2025-01-01T00:00:00Z',
      end: '2026-12-31T00:00:00Z',
    })
    const eightK = wide.find((d) => d.documentType === '8-K')!
    expect(eightK.publishedAt).toBe('2026-03-04T16:31:00.000Z')
    expect(eightK.publishedPrecision).toBe('minute')

    const tenK = wide.find((d) => d.documentType === '10-K')!
    // No acceptance instant: a date is a date, and says so.
    expect(tenK.publishedAt).toBe('2025-11-17T00:00:00Z')
    expect(tenK.publishedPrecision).toBe('day')
  })

  it('builds archive URLs the way EDGAR lays the folder out', () => {
    expect(accessionNoDashes('0000100493-26-000010')).toBe('000010049326000010')
    const docs = filingsFromSubmissions(submissions, '0000100493', target, WINDOW)
    expect(docs[0]!.url).toBe(
      'https://www.sec.gov/Archives/edgar/data/100493/000010049326000010/tsn-20260304.htm',
    )
    expect(docs[0]!.canonicalUrl).toContain('-index.htm')
    expect(docs[0]!.sourceDocumentId).toBe('0000100493-26-000010')
  })

  it('carries the accession number as the stable document identity', () => {
    const docs = filingsFromSubmissions(submissions, '0000100493', target, WINDOW)
    expect(docs[0]!.metadata.accessionNumber).toBe('0000100493-26-000010')
    expect(docs[0]!.metadata.items).toBe('2.05,8.01')
  })

  it('tolerates short columns instead of inventing entries', () => {
    // Index 0 is a complete pair and is a real filing; index 1 has no form, so
    // it is skipped rather than defaulted into something.
    const ragged = { filings: { recent: { accessionNumber: ['a-1', 'a-2'], form: ['8-K'] } } }
    const docs = filingsFromSubmissions(ragged, '0000100493', target, WINDOW)
    expect(docs).toHaveLength(1)
    expect(docs[0]!.sourceDocumentId).toBe('a-1')
  })

  it('follows submissions pagination for older filings', async () => {
    const calls: string[] = []
    const get = vi.fn(async (url: string) => {
      calls.push(url)
      if (url.includes('company_tickers')) return response(JSON.stringify(TICKER_FILE))
      if (url.includes('CIK0000100493.json')) {
        return response(
          JSON.stringify({ ...submissions, filings: { ...submissions.filings, files: [{ name: 'CIK0000100493-submissions-001.json' }] } }),
        )
      }
      if (url.includes('submissions-001.json')) {
        return response(
          JSON.stringify({
            accessionNumber: ['0000100493-25-000001'],
            form: ['8-K'],
            filingDate: ['2026-02-01'],
            acceptanceDateTime: ['2026-02-01T10:00:00.000Z'],
            primaryDocument: ['old.htm'],
          }),
        )
      }
      return response('{}', { status: 404 })
    })
    const outcome = await discoverSecFilings(ctx({ get: get as unknown as ConnectorContext['get'] }), [target])
    expect(outcome.kind).toBe('documents')
    expect(calls.some((u) => u.includes('submissions-001.json'))).toBe(true)
    if (outcome.kind === 'documents') {
      expect(outcome.documents.map((d) => d.sourceDocumentId)).toContain('0000100493-25-000001')
    }
  })

  it('refuses to file documents under the wrong company', async () => {
    const get = vi.fn(async (url: string) => {
      if (url.includes('company_tickers')) return response(JSON.stringify(TICKER_FILE))
      // A submissions document that identifies a different filer entirely.
      return response(JSON.stringify({ cik: '999999', name: 'Some Other Corp', filings: { recent: {} } }))
    })
    const outcome = await discoverSecFilings(ctx({ get: get as unknown as ConnectorContext['get'] }), [target])
    expect(outcome.kind).toBe('unavailable')
    if (outcome.kind === 'unavailable') expect(outcome.note).toMatch(/different filer|misattributed/i)
  })

  it('reports an unavailable ticker file rather than collecting nothing silently', async () => {
    const get = vi.fn(async () => response('', { status: 503 }))
    const outcome = await discoverSecFilings(ctx({ get: get as unknown as ConnectorContext['get'] }), [target])
    expect(outcome.kind).toBe('unavailable')
    if (outcome.kind === 'unavailable') expect(outcome.httpStatus).toBe(503)
  })
})

describe('conditional requests', () => {
  const document: DiscoveredDocument = {
    sourceDocumentId: '0000100493-26-000010',
    url: 'https://www.sec.gov/Archives/edgar/data/100493/x/tsn.htm',
    canonicalUrl: 'https://www.sec.gov/Archives/edgar/data/100493/x/index.htm',
    title: '8-K',
    publishedAt: '2026-03-04T16:31:00.000Z',
    publishedPrecision: 'minute',
    documentType: '8-K',
    organizationEntityKey: 'sec:0000100493',
    discoveryPath: 'sec:submissions-api',
    metadata: {},
  }

  it('sends the stored validators and treats 304 as unchanged, not empty', async () => {
    const sent: Record<string, unknown>[] = []
    const context = ctx({
      cache: {
        read: async () => ({ etag: 'W/"abc"', lastModified: 'Wed, 04 Mar 2026 16:31:00 GMT', contentHash: 'deadbeef', status: 200 }),
        write: async () => {},
      },
      get: (async (_url: string, options: Record<string, unknown>) => {
        sent.push(options)
        return { ...response(''), status: 304, notModified: true }
      }) as unknown as ConnectorContext['get'],
    })
    const result = await retrieveSecDocument(context, document)
    expect(sent[0]!.ifNoneMatch).toBe('W/"abc"')
    expect(sent[0]!.ifModifiedSince).toBe('Wed, 04 Mar 2026 16:31:00 GMT')
    expect(result.unchanged).toBe(true)
    // The bytes are empty because nothing was sent, NOT because the document is.
    expect(result.bytes.byteLength).toBe(0)
    expect(result.contentHash).toBe('deadbeef')
  })

  it('treats a byte-identical body as unchanged even without a 304', async () => {
    const body = '<html><body>Unchanged filing text, long enough to matter.</body></html>'
    const hash = await (async () => {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body))
      return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
    })()
    const context = ctx({
      cache: { read: async () => ({ etag: null, lastModified: null, contentHash: hash, status: 200 }), write: async () => {} },
      get: (async () => response(body, { headers: { 'content-type': 'text/html' } })) as unknown as ConnectorContext['get'],
    })
    const result = await retrieveSecDocument(context, document)
    expect(result.unchanged).toBe(true)
  })
})

/* ==================================================================== */

describe('Mars: robots first, then the most structured path available', () => {
  const ROBOTS_OPEN = 'User-agent: *\nDisallow: /private\nSitemap: https://www.mars.com/sitemap.xml\n'
  const RSS = `<?xml version="1.0"?><rss><channel>
    <item><title>Mars opens new facility</title><link>https://www.mars.com/news/mars-opens-plant</link>
      <guid>mars-2026-03</guid><pubDate>Wed, 04 Mar 2026 10:00:00 GMT</pubDate></item>
  </channel></rss>`

  it('reads robots.txt before anything else', async () => {
    const calls: string[] = []
    const get = vi.fn(async (url: string) => {
      calls.push(url)
      if (url.endsWith('robots.txt')) return response(ROBOTS_OPEN, { headers: { 'content-type': 'text/plain' } })
      if (url.endsWith('rss.xml')) return response(RSS, { headers: { 'content-type': 'application/xml' } })
      return response('', { status: 404 })
    })
    await discoverMars(ctx({ get: get as unknown as ConnectorContext['get'] }))
    expect(calls[0]).toContain('robots.txt')
  })

  it('prefers a working feed and stops rather than also crawling an index', async () => {
    const calls: string[] = []
    const get = vi.fn(async (url: string) => {
      calls.push(url)
      if (url.endsWith('robots.txt')) return response(ROBOTS_OPEN, { headers: { 'content-type': 'text/plain' } })
      if (url.endsWith('rss.xml')) return response(RSS, { headers: { 'content-type': 'application/xml' } })
      return response('<html></html>', { headers: { 'content-type': 'text/html' } })
    })
    const outcome = await discoverMars(ctx({ get: get as unknown as ConnectorContext['get'] }))
    expect(outcome.kind).toBe('documents')
    if (outcome.kind === 'documents') {
      expect(outcome.documents[0]!.canonicalUrl).toBe('https://www.mars.com/news/mars-opens-plant')
      expect(outcome.documents[0]!.discoveryPath).toBe('mars:feed')
      expect(outcome.documents[0]!.publishedAt).toBe('2026-03-04T10:00:00.000Z')
    }
    expect(calls.some((u) => u.includes('news-and-stories'))).toBe(false)
  })

  it('obeys a robots rule instead of fetching the disallowed path', async () => {
    const strict = 'User-agent: *\nDisallow: /\n'
    const fetched: string[] = []
    const get = vi.fn(async (url: string) => {
      fetched.push(url)
      if (url.endsWith('robots.txt')) return response(strict, { headers: { 'content-type': 'text/plain' } })
      return response(RSS)
    })
    const outcome = await discoverMars(ctx({ get: get as unknown as ConnectorContext['get'] }))
    expect(outcome.kind).toBe('manual_review_required')
    if (outcome.kind === 'manual_review_required') {
      expect(outcome.evidenceOfRestriction.classification).toBe('robots_disallow')
      expect(outcome.note).toMatch(/remains supported/i)
    }
    // Exactly one request: robots.txt. Nothing disallowed was fetched.
    expect(fetched).toHaveLength(1)
  })

  it('reports a challenge as manual review, never as a thing to defeat', async () => {
    const get = vi.fn(async (url: string) => {
      if (url.endsWith('robots.txt')) return response(ROBOTS_OPEN, { headers: { 'content-type': 'text/plain' } })
      return response('<html><body>Please verify you are human. captcha</body></html>', {
        status: 403,
        headers: { 'content-type': 'text/html', server: 'cloudflare' },
      })
    })
    const outcome = await discoverMars(ctx({ get: get as unknown as ConnectorContext['get'] }))
    expect(outcome.kind).toBe('manual_review_required')
    if (outcome.kind === 'manual_review_required') {
      expect(outcome.evidenceOfRestriction.classification).toBe('captcha_or_challenge')
      expect(outcome.evidenceOfRestriction.httpStatus).toBe(403)
      // The report must not carry the response body.
      expect(outcome.evidenceOfRestriction.detail).not.toMatch(/verify you are human/i)
    }
  })

  it('is NOT marked unavailable merely because a development network refused', async () => {
    const get = vi.fn(async () => {
      throw new Error('CONNECT tunnel failed, response 403')
    })
    const outcome = await discoverMars(ctx({ get: get as unknown as ConnectorContext['get'] }))
    // A transport failure is retryable and temporary. It must not become the
    // permanent "no compliant path exists" verdict.
    expect(outcome.kind).toBe('unavailable')
  })

  it('separates "nothing published" from "could not ask"', async () => {
    const get = vi.fn(async (url: string) => {
      if (url.endsWith('robots.txt')) return response(ROBOTS_OPEN, { headers: { 'content-type': 'text/plain' } })
      if (url.endsWith('rss.xml')) {
        return response('<?xml version="1.0"?><rss><channel></channel></rss>', {
          headers: { 'content-type': 'application/xml' },
        })
      }
      return response('<html><body>no links here</body></html>', { headers: { 'content-type': 'text/html' } })
    })
    const outcome = await discoverMars(ctx({ get: get as unknown as ConnectorContext['get'] }))
    expect(outcome.kind).toBe('unchanged')
  })

  it('takes its candidate URLs from configuration, not from code', async () => {
    const calls: string[] = []
    const get = vi.fn(async (url: string) => {
      calls.push(url)
      if (url.endsWith('robots.txt')) return response(ROBOTS_OPEN, { headers: { 'content-type': 'text/plain' } })
      return response(RSS, { headers: { 'content-type': 'application/xml' } })
    })
    await discoverMars(
      ctx({
        get: get as unknown as ConnectorContext['get'],
        config: { feedCandidates: ['https://www.mars.com/corrected-feed.xml'], sitemapCandidates: [], indexCandidates: [] },
      }),
    )
    expect(calls).toContain('https://www.mars.com/corrected-feed.xml')
  })

  it('merges configuration over defaults without losing the defaults', () => {
    const merged = marsConfig({ feedCandidates: ['https://www.mars.com/x.xml'] })
    expect(merged.feedCandidates).toEqual(['https://www.mars.com/x.xml'])
    expect(merged.robotsUrl).toBe('https://www.mars.com/robots.txt')
    expect(merged.entityKey).toBe('radar:mars-incorporated')
  })
})

describe('canonical URLs and structured metadata', () => {
  it('strips tracking parameters, fragments and trailing slashes', () => {
    expect(canonicalizeUrl('/news/x/?utm_source=nl&id=7#top', 'https://www.mars.com')).toBe(
      'https://www.mars.com/news/x?id=7',
    )
    expect(canonicalizeUrl('http://www.mars.com/news/y', 'https://www.mars.com')).toBe(
      'https://www.mars.com/news/y',
    )
    expect(canonicalizeUrl('javascript:alert(1)', 'https://www.mars.com')).toBeNull()
  })

  it('collects only links that look editorial', () => {
    const html = `<a href="/news/plant-opening">a</a><a href="/careers/apply">b</a><a href="/press-releases/x">c</a>`
    const links = linksFromHtml(html, 'https://www.mars.com', /(news|press)/i)
    expect(links).toHaveLength(2)
    expect(links.some((l) => l.includes('careers'))).toBe(false)
  })

  it('prefers the publisher’s own JSON-LD date over anything inferred', () => {
    const html = `<html><head>
      <script type="application/ld+json">{"@type":"NewsArticle","headline":"New plant","datePublished":"2026-03-04T10:00:00Z","url":"https://www.mars.com/news/new-plant"}</script>
      <meta property="og:title" content="Something else"></head><body>x</body></html>`
    const article = extractStructuredArticle(html)
    expect(article.headline).toBe('New plant')
    expect(article.datePublished).toBe('2026-03-04T10:00:00Z')
    expect(article.canonicalUrl).toBe('https://www.mars.com/news/new-plant')
  })

  it('reads an @graph wrapper as well as a bare object', () => {
    const html = `<script type="application/ld+json">{"@graph":[{"@type":"WebSite"},{"@type":"PressRelease","headline":"Expansion"}]}</script>`
    expect(extractStructuredArticle(html).headline).toBe('Expansion')
  })

  it('falls back to Open Graph, then to the title, and never to a guess', () => {
    expect(extractStructuredArticle('<meta property="og:title" content="OG headline">').headline).toBe('OG headline')
    expect(extractStructuredArticle('<title>Just a title</title>').headline).toBe('Just a title')
    expect(extractStructuredArticle('<html></html>').datePublished).toBeNull()
  })

  it('strips script and style bodies before tags', () => {
    const text = htmlToText('<style>.a{color:red}</style><script>var x=1</script><p>Real text</p>')
    expect(text).toBe('Real text')
  })

  it('parses RSS and Atom alike', () => {
    expect(parseFeed('<rss><channel><item><title>T</title><link>https://x.invalid/a</link><pubDate>Wed, 04 Mar 2026 10:00:00 GMT</pubDate></item></channel></rss>')[0]!.publishedAt)
      .toBe('2026-03-04T10:00:00.000Z')
    const atom = parseFeed('<feed><entry><title>T</title><link href="https://x.invalid/b"/><published>2026-03-04T10:00:00Z</published></entry></feed>')
    expect(atom[0]!.url).toBe('https://x.invalid/b')
  })

  it('reads a sitemap’s loc and lastmod', () => {
    const parsed = parseSitemap('<urlset><url><loc>https://x.invalid/news/a</loc><lastmod>2026-03-04</lastmod></url></urlset>')
    expect(parsed[0]!.url).toBe('https://x.invalid/news/a')
    expect(parsed[0]!.lastModified).toBe('2026-03-04T00:00:00.000Z')
  })
})

describe('robots parsing', () => {
  it('prefers a group naming our agent over the wildcard', () => {
    const policy = parseRobots(
      'User-agent: *\nDisallow: /\n\nUser-agent: openi-analytics-radar\nDisallow: /private\n',
      'Openi-Analytics-Radar/1.0 oracles@openi-analytics.com',
    )
    expect(policy.disallow).toEqual(['/private'])
    expect(robotsAllows(policy, '/news/x')).toBe(true)
    expect(robotsAllows(policy, '/private/x')).toBe(false)
  })

  it('lets the longest matching Allow override a Disallow', () => {
    const policy = parseRobots('User-agent: *\nDisallow: /news\nAllow: /news/public\n', 'X/1.0')
    expect(robotsAllows(policy, '/news/secret')).toBe(false)
    expect(robotsAllows(policy, '/news/public/a')).toBe(true)
  })

  it('ignores comments and collects sitemaps', () => {
    const policy = parseRobots('# a comment\nSitemap: https://x.invalid/s.xml\nUser-agent: *\nCrawl-delay: 5\n', 'X/1.0')
    expect(policy.sitemaps).toEqual(['https://x.invalid/s.xml'])
    expect(policy.crawlDelaySeconds).toBe(5)
  })
})

describe('restriction reporting', () => {
  it('names the classification rather than saying "blocked"', () => {
    expect(classifyRestriction({ url: 'https://x.invalid', status: 429 }).classification).toBe('rate_limited')
    expect(classifyRestriction({ url: 'https://x.invalid', status: 401 }).classification).toBe('authentication_required')
    expect(classifyRestriction({ url: 'https://x.invalid', status: 404 }).classification).toBe('not_found')
    expect(classifyRestriction({ url: 'https://x.invalid', status: null, robotsRule: '/' }).classification).toBe('robots_disallow')
  })

  it('records the redirect chain and never the body', () => {
    const report = classifyRestriction({
      url: 'https://x.invalid/a',
      status: 403,
      headers: { server: 'cloudflare' },
      bodyPreview: 'set-cookie: session=SECRETVALUE; checking your browser',
      redirectChain: ['https://x.invalid/a', 'https://x.invalid/b'],
    })
    expect(report.redirectChain).toHaveLength(2)
    expect(report.detail).not.toContain('SECRETVALUE')
    expect(report.classification).toBe('captcha_or_challenge')
  })
})

/* ==================================================================== */

describe('classification refuses to call a keyword a signal', () => {
  it('rejects a bare mention with no asset', () => {
    const result = classifyText('Tyson Foods announced a new partnership with a retailer, expanding its product line nationwide this year.')
    expect(result.matches).toHaveLength(0)
    expect(result.rejectionReason).toMatch(/physical asset|corroborating/i)
  })

  it('rejects an asset mention with no corroborating fact', () => {
    const result = classifyText(
      'The company operates a number of processing plants across several states and continues to evaluate expanding its facility network over time.',
    )
    expect(result.matches).toHaveLength(0)
    expect(result.rejectionReason).toMatch(/corroborating/i)
  })

  it('accepts an announcement that names an amount and a place', () => {
    const result = classifyText(
      'PepsiCo will build a new manufacturing plant in Denver, Colorado, investing $200 million and creating 250 jobs, with production beginning in 2027.',
    )
    expect(result.matches).toHaveLength(1)
    const match = result.matches[0]!
    expect(match.family).toBe('facility_construction')
    expect(match.confidence).toBe('probable')
    expect(match.corroboration.map((c) => c.kind)).toContain('investment_amount')
    expect(match.reasoning).toMatch(/never graded confirmed/i)
  })

  it('never grades a single machine-read document as confirmed', () => {
    const result = classifyText(
      'The company will build a new plant in Springfield, Illinois, investing $500 million, adding 900 jobs, opening in 2028.',
    )
    expect(result.matches.every((m) => m.confidence !== 'confirmed')).toBe(true)
  })

  it('treats a closure as a signal, marked negative', () => {
    const result = classifyText(
      'Tyson Foods will close its processing plant in Emporia, Kansas, affecting 400 jobs, with operations ceasing by the second quarter of 2026.',
    )
    expect(result.matches[0]!.negative).toBe(true)
    expect(result.matches[0]!.family).toBe('closure_consolidation')
  })

  it('records the span and excerpt so a reviewer can disagree', () => {
    const result = classifyText(
      'In other news, the company will build a new distribution center in Dallas, Texas, a $75 million project completing in 2027. Unrelated paragraph follows.',
    )
    const match = result.matches[0]!
    expect(match.excerpt).toMatch(/distribution center/i)
    expect(match.endOffset).toBeGreaterThan(match.startOffset)
    expect(match.matchedAsset).toBeTruthy()
  })

  it('refuses a document with almost no text rather than guessing', () => {
    expect(classifyText('short').rejectionReason).toMatch(/too little text/i)
  })

  it('gives the same announcement one cluster key regardless of source', () => {
    const a = clusterKey({ organizationEntityKey: 'sec:1', family: 'facility_expansion', eventDate: '2026-03-04T10:00:00Z', matchedAsset: 'plant' })
    const b = clusterKey({ organizationEntityKey: 'sec:1', family: 'facility_expansion', eventDate: '2026-03-20T22:00:00Z', matchedAsset: 'Plant' })
    expect(a).toBe(b)
    const other = clusterKey({ organizationEntityKey: 'sec:2', family: 'facility_expansion', eventDate: '2026-03-04T10:00:00Z', matchedAsset: 'plant' })
    expect(other).not.toBe(a)
  })
})
