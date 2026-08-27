/**
 * Turning bytes into something quotable, and refusals into something actionable.
 *
 * Deliberately small and dependency-free. A DOM parser in a serverless function
 * is a large amount of machinery to pull a title and a date out of a press
 * release, and the failure mode of a heavyweight extractor — quietly returning
 * plausible text from the wrong element — is worse than the failure mode of a
 * simple one, which is returning nothing.
 */
import type { RestrictionReport } from './types.js'

export function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
}

const BLOCK_TAGS = /<\/?(p|div|br|li|tr|h[1-6]|section|article|header|footer)\b[^>]*>/gi

/**
 * Readable text, with the parts that are not prose removed first.
 *
 * Script and style bodies are stripped BEFORE tags, or their contents survive
 * as text and a page's JavaScript ends up in an evidence excerpt.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(BLOCK_TAGS, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n')
    .trim()
}

/* ------------------------------------------------------------ structured */

export interface StructuredArticle {
  readonly headline: string | null
  readonly datePublished: string | null
  readonly dateModified: string | null
  readonly canonicalUrl: string | null
  readonly articleBody: string | null
  readonly identifier: string | null
}

/**
 * JSON-LD first, then Open Graph, then the document's own tags.
 *
 * A newsroom that publishes `schema.org/NewsArticle` is telling us its own
 * publication date; inferring one from page text is guessing, and a guessed
 * publication date is indistinguishable from a real one once it is stored.
 */
export function extractStructuredArticle(html: string): StructuredArticle {
  const jsonLd = extractJsonLdArticles(html)
  const article = jsonLd[0] ?? null

  const og = (property: string): string | null => {
    const match = new RegExp(
      `<meta[^>]+(?:property|name)=["']${property}["'][^>]*content=["']([^"']*)["']`,
      'i',
    ).exec(html)
      ?? new RegExp(
        `<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${property}["']`,
        'i',
      ).exec(html)
    return match?.[1]?.trim() || null
  }

  const canonical =
    /<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i.exec(html)?.[1]?.trim() ?? null

  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]

  return {
    headline: article?.headline ?? og('og:title') ?? (title ? htmlToText(title) : null),
    datePublished:
      article?.datePublished ?? og('article:published_time') ?? og('datePublished') ?? null,
    dateModified: article?.dateModified ?? og('article:modified_time') ?? null,
    canonicalUrl: article?.url ?? og('og:url') ?? canonical,
    articleBody: article?.articleBody ?? null,
    identifier: article?.identifier ?? null,
  }
}

interface JsonLdArticle {
  headline?: string
  datePublished?: string
  dateModified?: string
  url?: string
  articleBody?: string
  identifier?: string
}

/** `@graph` and bare arrays are both common; both are flattened. */
export function extractJsonLdArticles(html: string): JsonLdArticle[] {
  const out: JsonLdArticle[] = []
  const blocks = html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )
  for (const block of blocks) {
    const raw = block[1]
    if (!raw) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(raw.trim())
    } catch {
      continue
    }
    for (const node of flattenJsonLd(parsed)) {
      const type = String((node as { '@type'?: unknown })['@type'] ?? '')
      if (/article|newsarticle|pressrelease|blogposting|report/i.test(type)) {
        out.push(node as JsonLdArticle)
      }
    }
  }
  return out
}

function flattenJsonLd(node: unknown): Record<string, unknown>[] {
  if (Array.isArray(node)) return node.flatMap(flattenJsonLd)
  if (node && typeof node === 'object') {
    const record = node as Record<string, unknown>
    const nested = Array.isArray(record['@graph']) ? flattenJsonLd(record['@graph']) : []
    return [record, ...nested]
  }
  return []
}

/* ----------------------------------------------------------------- feeds */

export interface FeedItem {
  readonly id: string
  readonly url: string
  readonly title: string
  readonly publishedAt: string | null
}

/** RSS 2.0 and Atom, which is the whole of what a newsroom feed will be. */
export function parseFeed(xml: string): FeedItem[] {
  const out: FeedItem[] = []
  const tag = (block: string, name: string): string | null => {
    const m = new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i').exec(block)
    if (!m?.[1]) return null
    return htmlToText(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')).trim() || null
  }

  for (const match of xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)) {
    const block = match[0]
    const link = tag(block, 'link')
    if (!link) continue
    out.push({
      id: tag(block, 'guid') ?? link,
      url: link,
      title: tag(block, 'title') ?? link,
      publishedAt: normalizeFeedDate(tag(block, 'pubDate') ?? tag(block, 'dc:date')),
    })
  }

  for (const match of xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)) {
    const block = match[0]
    const href = /<link[^>]+href=["']([^"']+)["']/i.exec(block)?.[1] ?? tag(block, 'link')
    if (!href) continue
    out.push({
      id: tag(block, 'id') ?? href,
      url: href,
      title: tag(block, 'title') ?? href,
      publishedAt: normalizeFeedDate(tag(block, 'published') ?? tag(block, 'updated')),
    })
  }
  return out
}

export function normalizeFeedDate(raw: string | null): string | null {
  if (!raw) return null
  const parsed = Date.parse(raw)
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString()
}

/** `<loc>` and `<lastmod>` from a sitemap or sitemap index. */
export function parseSitemap(xml: string): { url: string; lastModified: string | null }[] {
  const out: { url: string; lastModified: string | null }[] = []
  for (const match of xml.matchAll(/<(?:url|sitemap)\b[\s\S]*?<\/(?:url|sitemap)>/gi)) {
    const block = match[0]
    const loc = /<loc>([\s\S]*?)<\/loc>/i.exec(block)?.[1]?.trim()
    if (!loc) continue
    const lastmod = /<lastmod>([\s\S]*?)<\/lastmod>/i.exec(block)?.[1]?.trim() ?? null
    out.push({ url: loc, lastModified: normalizeFeedDate(lastmod) })
  }
  return out
}

/* ---------------------------------------------------------------- robots */

export interface RobotsPolicy {
  readonly disallow: readonly string[]
  readonly allow: readonly string[]
  readonly crawlDelaySeconds: number | null
  readonly sitemaps: readonly string[]
}

/**
 * The record for OUR user-agent, falling back to `*`.
 *
 * A specific group wins outright when one exists — that is the point of naming
 * a user-agent — and the wildcard group is used only when it does not.
 */
export function parseRobots(text: string, userAgent: string): RobotsPolicy {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/#.*$/, '').trim()).filter(Boolean)
  const groups = new Map<string, string[]>()
  const sitemaps: string[] = []
  let current: string[] = []

  for (const line of lines) {
    const [rawKey, ...rest] = line.split(':')
    const key = (rawKey ?? '').toLowerCase().trim()
    const value = rest.join(':').trim()
    if (key === 'sitemap') {
      sitemaps.push(value)
      continue
    }
    if (key === 'user-agent') {
      const agent = value.toLowerCase()
      current = groups.get(agent) ?? []
      groups.set(agent, current)
      continue
    }
    if (key && current) current.push(`${key}:${value}`)
  }

  const token = userAgent.split('/')[0]!.toLowerCase()
  const chosen =
    [...groups.entries()].find(([agent]) => agent && token.includes(agent) && agent !== '*')?.[1] ??
    groups.get('*') ??
    []

  const disallow: string[] = []
  const allow: string[] = []
  let crawlDelay: number | null = null
  for (const directive of chosen) {
    const [key, ...rest] = directive.split(':')
    const value = rest.join(':').trim()
    if (key === 'disallow' && value) disallow.push(value)
    if (key === 'allow' && value) allow.push(value)
    if (key === 'crawl-delay') {
      const n = Number(value)
      if (Number.isFinite(n)) crawlDelay = n
    }
  }
  return { disallow, allow, crawlDelaySeconds: crawlDelay, sitemaps }
}

/** Longest match wins, and an equal-length Allow beats Disallow. */
export function robotsAllows(policy: RobotsPolicy, path: string): boolean {
  const longest = (rules: readonly string[]) =>
    rules.filter((rule) => path.startsWith(rule)).reduce((best, rule) => Math.max(best, rule.length), -1)
  const disallowed = longest(policy.disallow)
  if (disallowed < 0) return true
  return longest(policy.allow) >= disallowed
}

/* ----------------------------------------------------------- restrictions */

const CHALLENGE_MARKERS = [
  'captcha',
  'are you a human',
  'verify you are human',
  'checking your browser',
  'cf-challenge',
  'px-captcha',
  'incapsula',
  'request unsuccessful. incapsula',
  'access denied',
]

/**
 * What kind of refusal this was — recorded, never worked around.
 *
 * The point of naming the classification is that each one has a DIFFERENT
 * correct response: a 429 means slow down, a robots rule means find the feed,
 * a challenge means stop and ask a human. Collapsing them into "blocked"
 * throws away the only information that would tell an operator what to do.
 */
export function classifyRestriction(input: {
  url: string
  status: number | null
  headers?: Readonly<Record<string, string>>
  bodyPreview?: string
  redirectChain?: readonly string[]
  robotsRule?: string | null
}): RestrictionReport {
  const body = (input.bodyPreview ?? '').toLowerCase().slice(0, 4000)
  const server = (input.headers?.['server'] ?? '').toLowerCase()
  const looksLikeChallenge = CHALLENGE_MARKERS.some((marker) => body.includes(marker))

  let classification: RestrictionReport['classification'] = 'transport_error'
  if (input.robotsRule) classification = 'robots_disallow'
  else if (input.status === 429) classification = 'rate_limited'
  else if (input.status === 401) classification = 'authentication_required'
  else if (input.status === 404 || input.status === 410) classification = 'not_found'
  else if (looksLikeChallenge) classification = 'captcha_or_challenge'
  else if (input.status === 403 || input.status === 503) {
    classification = /cloudflare|akamai|incapsula|awselb/.test(server) ? 'waf_block' : 'waf_block'
  }

  return {
    url: input.url,
    httpStatus: input.status,
    classification,
    redirectChain: input.redirectChain ?? [],
    robotsRule: input.robotsRule ?? null,
    // A marker, never the body: a challenge page can contain a session token.
    detail: looksLikeChallenge
      ? 'response carried an interstitial challenge marker'
      : `status ${input.status ?? 'none'}${server ? `, server ${server}` : ''}`,
  }
}
