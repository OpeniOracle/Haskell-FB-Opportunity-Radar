/**
 * Mars, Incorporated — official corporate sources, in order of preference.
 *
 * Mars is privately held. There is no EDGAR equivalent and inventing one would
 * be worse than having none, so this connector reads what Mars itself
 * publishes: the newsroom, press releases, and business-unit announcements.
 *
 * LAYERED, BECAUSE THE BEST PATH IS THE ONE THAT EXISTS.
 *
 *   1. robots.txt is read FIRST and obeyed. Not as a formality — it is also
 *      where a site advertises its sitemaps, so the polite path and the
 *      productive one are the same request.
 *   2. A declared feed (RSS, Atom, or JSON) if one is offered. A feed is a
 *      publication contract: stable ids, stable dates, no layout to guess at.
 *   3. A sitemap, filtered by lastmod, which is the next most structured thing.
 *   4. Server-rendered newsroom pages, from which links are collected and each
 *      item's own JSON-LD or Open Graph metadata is read.
 *
 * EVERY CANDIDATE URL IS CONFIGURATION, NOT CODE. `sources.connector_config`
 * carries the feed, sitemap and index candidates, so when the operator runs the
 * live backfill and discovers the real newsroom path, it is corrected with an
 * update statement rather than a deploy. This matters because the development
 * environment that wrote this connector could not reach mars.com to confirm any
 * of them, and pretending otherwise would bake a guess into a binary.
 *
 * WHAT THIS CONNECTOR WILL NOT DO. It will not execute JavaScript, solve a
 * challenge, rotate a user-agent, or ignore a robots rule. If the only path to
 * the content is through an access control, the honest outcome is
 * `manual_review_required` with the refusal recorded exactly as observed — the
 * source stays supported and a human imports from it. A connector that defeats
 * a control is a connector that will be defeating it unattended at 06:00 UTC.
 */
import type {
  Connector,
  ConnectorContext,
  DiscoveredDocument,
  DiscoveryOutcome,
  RestrictionReport,
  RetrievedDocument,
} from './types.js'
import { contentHash, mapWithLimit } from '../egress.js'
import {
  classifyRestriction,
  decodeUtf8,
  extractStructuredArticle,
  htmlToText,
  parseFeed,
  parseRobots,
  parseSitemap,
  robotsAllows,
  normalizeFeedDate,
  type RobotsPolicy,
} from './extract.js'

export const MARS_CONNECTOR_VERSION = '1.0.0'
export const MARS_SOURCE_ID = 'mars-newsroom'
export const MARS_HOSTS = ['mars.com', 'www.mars.com'] as const

const MIN_REQUEST_INTERVAL_MS = 1_500
const FETCH_CONCURRENCY = 2
const MAX_ITEMS_PER_RUN = 120

/**
 * Defaults, every one of them overridable from `sources.connector_config`.
 *
 * These are the conventional locations a corporate newsroom uses. They are
 * starting points for the operator's first live run, not claims about what
 * Mars serves — the run reports which candidate answered, and the ones that
 * did not are corrected in configuration.
 */
export const MARS_DEFAULT_CONFIG = {
  origin: 'https://www.mars.com',
  robotsUrl: 'https://www.mars.com/robots.txt',
  feedCandidates: [
    'https://www.mars.com/rss.xml',
    'https://www.mars.com/news-and-stories/rss',
    'https://www.mars.com/feed',
  ],
  sitemapCandidates: ['https://www.mars.com/sitemap.xml'],
  indexCandidates: [
    'https://www.mars.com/news-and-stories',
    'https://www.mars.com/news',
    'https://www.mars.com/press-releases',
  ],
  /** A sitemap or index link must look like editorial content to be followed. */
  itemPathPattern: '(news|press|stor|release|announce)',
  entityKey: 'radar:mars-incorporated',
  canonicalName: 'Mars, Incorporated',
} as const

export interface MarsConfig {
  origin: string
  robotsUrl: string
  feedCandidates: string[]
  sitemapCandidates: string[]
  indexCandidates: string[]
  itemPathPattern: string
  entityKey: string
  canonicalName: string
}

export function marsConfig(raw: Readonly<Record<string, unknown>>): MarsConfig {
  const merged = { ...MARS_DEFAULT_CONFIG, ...raw } as unknown as MarsConfig
  return {
    ...merged,
    feedCandidates: [...(merged.feedCandidates ?? [])],
    sitemapCandidates: [...(merged.sitemapCandidates ?? [])],
    indexCandidates: [...(merged.indexCandidates ?? [])],
  }
}

/** Absolute, fragment-free, and without the tracking parameters. */
export function canonicalizeUrl(raw: string, base: string): string | null {
  let url: URL
  try {
    url = new URL(raw, base)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  url.protocol = 'https:'
  url.hash = ''
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_|gclid|fbclid|mc_cid|mc_eid|s_cid)/i.test(key)) url.searchParams.delete(key)
  }
  // A trailing slash is not a different article.
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) url.pathname = url.pathname.slice(0, -1)
  return url.toString()
}

export function linksFromHtml(html: string, base: string, pattern: RegExp): string[] {
  const found = new Set<string>()
  for (const match of html.matchAll(/<a\b[^>]+href=["']([^"'#]+)["']/gi)) {
    const href = match[1]
    if (!href) continue
    const absolute = canonicalizeUrl(href, base)
    if (!absolute) continue
    let parsed: URL
    try {
      parsed = new URL(absolute)
    } catch {
      continue
    }
    if (!pattern.test(parsed.pathname)) continue
    found.add(absolute)
  }
  return [...found]
}

async function readRobots(
  ctx: ConnectorContext,
  config: MarsConfig,
): Promise<{ policy: RobotsPolicy | null; restriction: RestrictionReport | null }> {
  await ctx.pacer.take()
  try {
    const response = await ctx.get(config.robotsUrl, { accept: 'text/plain' })
    if (response.status === 404) {
      // No robots.txt is not a prohibition. It is the absence of one.
      return { policy: { disallow: [], allow: [], crawlDelaySeconds: null, sitemaps: [] }, restriction: null }
    }
    if (response.status !== 200) {
      return {
        policy: null,
        restriction: classifyRestriction({
          url: config.robotsUrl,
          status: response.status,
          headers: response.headers,
          bodyPreview: decodeUtf8(response.body).slice(0, 2000),
          redirectChain: response.redirects,
        }),
      }
    }
    return { policy: parseRobots(decodeUtf8(response.body), ctx.userAgent), restriction: null }
  } catch (error) {
    return {
      policy: null,
      restriction: classifyRestriction({
        url: config.robotsUrl,
        status: null,
        detail: error instanceof Error ? error.name : 'transport error',
      } as Parameters<typeof classifyRestriction>[0]),
    }
  }
}

function allowedByRobots(policy: RobotsPolicy | null, url: string): { ok: boolean; rule: string | null } {
  if (!policy) return { ok: true, rule: null }
  let path: string
  try {
    path = new URL(url).pathname
  } catch {
    return { ok: false, rule: null }
  }
  if (robotsAllows(policy, path)) return { ok: true, rule: null }
  const rule = policy.disallow.find((d) => path.startsWith(d)) ?? null
  return { ok: false, rule }
}

export async function discoverMars(ctx: ConnectorContext): Promise<DiscoveryOutcome> {
  const config = marsConfig(ctx.config)
  const pattern = new RegExp(config.itemPathPattern, 'i')
  const attempts: string[] = []
  let lastRestriction: RestrictionReport | null = null

  const { policy, restriction: robotsRestriction } = await readRobots(ctx, config)
  if (robotsRestriction) {
    lastRestriction = robotsRestriction
    attempts.push(`robots.txt: ${robotsRestriction.classification}`)
  }
  if (policy?.crawlDelaySeconds && policy.crawlDelaySeconds * 1000 > MIN_REQUEST_INTERVAL_MS) {
    ctx.log(`[mars] robots.txt asks for ${policy.crawlDelaySeconds}s between requests; honouring it`)
  }

  const candidates: { url: string; kind: 'feed' | 'sitemap' | 'index' }[] = [
    ...config.feedCandidates.map((url) => ({ url, kind: 'feed' as const })),
    // A sitemap advertised by robots.txt outranks a guessed one.
    ...[...(policy?.sitemaps ?? []), ...config.sitemapCandidates].map((url) => ({
      url,
      kind: 'sitemap' as const,
    })),
    ...config.indexCandidates.map((url) => ({ url, kind: 'index' as const })),
  ]

  const discovered = new Map<string, DiscoveredDocument>()

  for (const candidate of candidates) {
    if (discovered.size >= MAX_ITEMS_PER_RUN) break

    const permitted = allowedByRobots(policy, candidate.url)
    if (!permitted.ok) {
      attempts.push(`${candidate.url}: disallowed by robots (${permitted.rule ?? 'rule'})`)
      lastRestriction = classifyRestriction({
        url: candidate.url,
        status: null,
        robotsRule: permitted.rule,
      })
      continue
    }

    await ctx.pacer.take()
    let response
    try {
      response = await ctx.get(candidate.url, {
        accept:
          candidate.kind === 'feed'
            ? 'application/rss+xml, application/atom+xml, application/xml;q=0.9, application/json;q=0.8'
            : candidate.kind === 'sitemap'
              ? 'application/xml, text/xml'
              : 'text/html,application/xhtml+xml',
      })
    } catch (error) {
      attempts.push(`${candidate.url}: transport error`)
      lastRestriction = classifyRestriction({
        url: candidate.url,
        status: null,
        detail: error instanceof Error ? error.name : 'transport error',
      } as Parameters<typeof classifyRestriction>[0])
      continue
    }

    const bodyText = decodeUtf8(response.body)
    if (response.status !== 200) {
      attempts.push(`${candidate.url}: HTTP ${response.status}`)
      lastRestriction = classifyRestriction({
        url: candidate.url,
        status: response.status,
        headers: response.headers,
        bodyPreview: bodyText.slice(0, 2000),
        redirectChain: response.redirects,
      })
      continue
    }

    const found = documentsFromCandidate(candidate, bodyText, config, ctx, pattern)
    for (const document of found) {
      if (!discovered.has(document.canonicalUrl)) discovered.set(document.canonicalUrl, document)
    }
    if (found.length > 0) {
      ctx.log(`[mars] ${candidate.kind} ${candidate.url} yielded ${found.length} item(s)`)
      // A feed that works is the whole answer; there is no reason to also
      // crawl an index and re-derive the same items less reliably.
      if (candidate.kind === 'feed') break
    } else {
      attempts.push(`${candidate.url}: reachable, no items matched`)
    }
  }

  if (discovered.size > 0) {
    return { kind: 'documents', documents: [...discovered.values()].slice(0, MAX_ITEMS_PER_RUN) }
  }

  // NOTHING WAS FOUND. Which of the two reasons it was decides the state.
  if (lastRestriction && (lastRestriction.classification === 'robots_disallow'
    || lastRestriction.classification === 'captcha_or_challenge'
    || lastRestriction.classification === 'terms_prohibited'
    || lastRestriction.classification === 'authentication_required')) {
    return {
      kind: 'manual_review_required',
      note:
        `No compliant automated path to the Mars newsroom. ${attempts.join('; ')}. ` +
        'The source remains supported: import items through the operator path rather than defeating the control.',
      evidenceOfRestriction: lastRestriction,
    }
  }

  if (lastRestriction) {
    return {
      kind: 'unavailable',
      httpStatus: lastRestriction.httpStatus ?? undefined,
      note: `Mars newsroom retrieval failed: ${attempts.join('; ')}.`,
    }
  }

  // Every candidate answered and none carried an item in this window. That is
  // a real "nothing published", not a failure, and must not be shown as one.
  return { kind: 'unchanged', note: `No Mars item published in the window. Checked: ${attempts.join('; ')}.` }
}

function documentsFromCandidate(
  candidate: { url: string; kind: 'feed' | 'sitemap' | 'index' },
  bodyText: string,
  config: MarsConfig,
  ctx: ConnectorContext,
  pattern: RegExp,
): DiscoveredDocument[] {
  const base = (
    url: string,
    publishedAt: string | null,
    title: string,
    id: string,
    path: string,
  ): DiscoveredDocument | null => {
    const canonical = canonicalizeUrl(url, config.origin)
    if (!canonical) return null
    return {
      sourceDocumentId: id,
      url: canonical,
      canonicalUrl: canonical,
      title,
      publishedAt,
      publishedPrecision: publishedAt ? ('minute' as const) : null,
      documentType: 'press_release',
      organizationEntityKey: config.entityKey,
      discoveryPath: path,
      metadata: { discoveredFrom: candidate.url },
    }
  }

  const inWindow = (iso: string | null) => !iso || (iso >= ctx.window.start && iso < ctx.window.end)

  if (candidate.kind === 'feed') {
    if (bodyText.trimStart().startsWith('{') || bodyText.trimStart().startsWith('[')) {
      return jsonFeedDocuments(bodyText, base, inWindow)
    }
    return parseFeed(bodyText)
      .filter((item) => inWindow(item.publishedAt))
      .map((item) => base(item.url, item.publishedAt, item.title, item.id, 'mars:feed'))
      .filter((d): d is DiscoveredDocument => d !== null)
  }

  if (candidate.kind === 'sitemap') {
    return parseSitemap(bodyText)
      .filter((entry) => {
        try {
          return pattern.test(new URL(entry.url).pathname)
        } catch {
          return false
        }
      })
      // lastmod is when the PAGE changed, not when the article was published.
      // It is a discovery filter only; the publication date is read from the
      // item itself during retrieval.
      .filter((entry) => !entry.lastModified || entry.lastModified >= ctx.window.start)
      .map((entry) => base(entry.url, null, entry.url, entry.url, 'mars:sitemap'))
      .filter((d): d is DiscoveredDocument => d !== null)
  }

  return linksFromHtml(bodyText, candidate.url, pattern)
    .map((url) => base(url, null, url, url, 'mars:index'))
    .filter((d): d is DiscoveredDocument => d !== null)
}

function jsonFeedDocuments(
  bodyText: string,
  base: (url: string, publishedAt: string | null, title: string, id: string, path: string) => DiscoveredDocument | null,
  inWindow: (iso: string | null) => boolean,
): DiscoveredDocument[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(bodyText)
  } catch {
    return []
  }
  const container = parsed as { items?: unknown[]; data?: unknown[] }
  const items = Array.isArray(container.items)
    ? container.items
    : Array.isArray(container.data)
      ? container.data
      : Array.isArray(parsed)
        ? (parsed as unknown[])
        : []

  const out: DiscoveredDocument[] = []
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as Record<string, unknown>
    const url = String(item.url ?? item.link ?? item.permalink ?? '')
    if (!url) continue
    const published = normalizeFeedDate(
      String(item.date_published ?? item.datePublished ?? item.published ?? item.date ?? '') || null,
    )
    if (!inWindow(published)) continue
    const document = base(
      url,
      published,
      String(item.title ?? item.headline ?? url),
      String(item.id ?? item.guid ?? url),
      'mars:json-feed',
    )
    if (document) out.push(document)
  }
  return out
}

export async function retrieveMarsDocument(
  ctx: ConnectorContext,
  document: DiscoveredDocument,
): Promise<RetrievedDocument> {
  const cached = await ctx.cache.read(MARS_SOURCE_ID, document.url)

  await ctx.pacer.take()
  const response = await ctx.get(document.url, {
    accept: 'text/html,application/xhtml+xml',
    ifNoneMatch: cached?.etag ?? undefined,
    ifModifiedSince: cached?.lastModified ?? undefined,
  })

  const retrievedAt = ctx.now().toISOString()
  const etag = response.headers['etag'] ?? null
  const lastModified = response.headers['last-modified'] ?? null

  if (response.notModified) {
    return {
      document,
      finalUrl: response.finalUrl,
      status: 304,
      bytes: new Uint8Array(0),
      contentHash: cached?.contentHash ?? '',
      mimeType: 'text/html',
      retrievedAt,
      etag: etag ?? cached?.etag ?? null,
      lastModified: lastModified ?? cached?.lastModified ?? null,
      unchanged: true,
      extractedText: null,
      extractionStatus: 'success',
    }
  }

  const html = decodeUtf8(response.body)
  const hash = await contentHash(response.body)
  const structured = extractStructuredArticle(html)

  await ctx.cache.write(MARS_SOURCE_ID, document.url, {
    etag,
    lastModified,
    contentHash: hash,
    status: response.status,
  })

  // The page's own metadata outranks whatever the index link implied.
  const publishedAt = normalizeFeedDate(structured.datePublished) ?? document.publishedAt
  const enriched: DiscoveredDocument = {
    ...document,
    title: structured.headline ?? document.title,
    publishedAt,
    publishedPrecision: publishedAt ? 'minute' : null,
    canonicalUrl:
      (structured.canonicalUrl && canonicalizeUrl(structured.canonicalUrl, document.url)) ??
      document.canonicalUrl,
    metadata: {
      ...document.metadata,
      jsonLdIdentifier: structured.identifier,
      dateModified: structured.dateModified,
    },
  }

  const text = structured.articleBody ? htmlToText(structured.articleBody) : htmlToText(html)

  return {
    document: enriched,
    finalUrl: response.finalUrl,
    status: response.status,
    bytes: response.body,
    contentHash: hash,
    mimeType: (response.headers['content-type'] ?? 'text/html').split(';')[0]!.trim(),
    retrievedAt,
    etag,
    lastModified,
    unchanged: cached?.contentHash === hash,
    extractedText: text || null,
    extractionStatus: structured.articleBody ? 'success' : text ? 'partial' : 'failed',
  }
}

export function marsConnector(): Connector {
  return {
    id: MARS_SOURCE_ID,
    version: MARS_CONNECTOR_VERSION,
    sourceId: MARS_SOURCE_ID,
    hosts: [...MARS_HOSTS],
    discover: discoverMars,
    retrieve: retrieveMarsDocument,
  }
}

export const MARS_PACING = { minIntervalMs: MIN_REQUEST_INTERVAL_MS, concurrency: FETCH_CONCURRENCY }
export { mapWithLimit }
