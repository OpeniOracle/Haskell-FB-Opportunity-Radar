/**
 * SEC EDGAR — the documented JSON APIs and the filing archive.
 *
 * WHY THIS CONNECTOR IS AN API CLIENT AND NOT A SCRAPER. EDGAR publishes
 * `data.sec.gov/submissions/CIK##########.json` and the archive under
 * `www.sec.gov/Archives/edgar/data/...` precisely so that programs do not have
 * to parse the search UI. Using the documented endpoints is both the compliant
 * path and the stable one.
 *
 * FAIR ACCESS, CONCRETELY. Every request carries the declared
 * `SEC_EDGAR_USER_AGENT`, which names Openi Analytics and a monitored address.
 * Requests are paced by a minimum interval, held under a concurrency ceiling,
 * retried only on the statuses that mean "later" (429, 5xx), and sent
 * conditionally so an unchanged filing is answered 304 instead of re-downloaded.
 *
 * CIK RESOLUTION IS A LOOKUP, NOT A CONSTANT. The company's canonical name
 * comes from our database; the CIK comes from SEC's own
 * `company_tickers.json`. A CIK written into source code is an assumption that
 * silently points at the wrong filer the day it is wrong — and there is no
 * symptom, because some other company's filings are perfectly well-formed.
 * Where a hint is configured it is used only to CROSS-CHECK the resolved
 * value, and a mismatch fails loudly rather than picking a winner.
 */
import type {
  Connector,
  ConnectorContext,
  DiscoveredDocument,
  DiscoveryOutcome,
  RetrievedDocument,
} from './types.js'
import { mapWithLimit } from '../egress.js'
import { contentHash } from '../egress.js'
import { classifyRestriction, decodeUtf8, htmlToText } from './extract.js'

export const SEC_CONNECTOR_VERSION = '1.0.0'

export const SEC_HOSTS = ['sec.gov', 'data.sec.gov', 'www.sec.gov'] as const

/** SEC asks for no more than ten requests a second. We use a fraction of it. */
const MIN_REQUEST_INTERVAL_MS = 220
const FETCH_CONCURRENCY = 3

const COMPANY_TICKERS_URL = 'https://www.sec.gov/files/company_tickers.json'
const SUBMISSIONS_URL = (cik: string) => `https://data.sec.gov/submissions/CIK${cik}.json`
const SUBMISSIONS_PAGE_URL = (name: string) => `https://data.sec.gov/submissions/${name}`

/**
 * Forms worth collecting for a facilities-and-capital-projects radar.
 *
 * 8-K carries the announcements (Item 2.05 exit/disposal, 8.01 other events);
 * 10-K and 10-Q carry the properties and capital-expenditure discussion.
 * Amendments are included because a correction is exactly the thing we must
 * see. Everything else — ownership forms, proxies, prospectuses — is noise for
 * this purpose and is filtered at discovery so it is never fetched at all.
 */
export const COLLECTED_FORMS = ['8-K', '8-K/A', '10-K', '10-K/A', '10-Q', '10-Q/A'] as const

/** EX-99 is where press releases are attached to an 8-K. */
const ANNOUNCEMENT_EXHIBIT = /^ex-?99/i

export interface SecCompanyTarget {
  readonly entityKey: string
  /** From the database. What we match against SEC's own company title. */
  readonly canonicalName: string
  /** Optional cross-check only. Never the source of the CIK. */
  readonly expectedCik?: string
  readonly tickerHint?: string
}

export class CikResolutionError extends Error {
  constructor(readonly canonicalName: string, readonly detail: string) {
    super(`Could not resolve a CIK for "${canonicalName}": ${detail}`)
    this.name = 'CikResolutionError'
  }
}

export function padCik(raw: string | number): string {
  return String(raw).replace(/\D/g, '').padStart(10, '0')
}

/** "Tyson Foods, Inc." and "TYSON FOODS INC" are the same filer. */
export function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.,]/g, ' ')
    .replace(/\b(incorporated|inc|corporation|corp|company|co|plc|llc|lp|ltd|the)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

interface TickerRow {
  readonly cik_str: number | string
  readonly ticker: string
  readonly title: string
}

/**
 * Resolve one company's CIK from SEC's published ticker file.
 *
 * Matching is on the normalised company NAME, with the ticker used only to
 * disambiguate when several filers normalise alike. A configured
 * `expectedCik` is compared afterwards and a mismatch throws: quietly
 * preferring one over the other would hide precisely the error the check
 * exists to catch.
 */
export function resolveCikFromTickerFile(
  file: Readonly<Record<string, TickerRow>> | readonly TickerRow[],
  target: SecCompanyTarget,
): string {
  const rows: TickerRow[] = Array.isArray(file) ? [...file] : Object.values(file)
  if (rows.length === 0) throw new CikResolutionError(target.canonicalName, 'ticker file was empty')

  const wanted = normalizeCompanyName(target.canonicalName)
  let matches = rows.filter((row) => normalizeCompanyName(row.title ?? '') === wanted)

  if (matches.length === 0) {
    // A prefix match catches "PEPSICO INC" against "PepsiCo, Inc." only after
    // the exact comparison has failed, so it can never override a real match.
    matches = rows.filter((row) => {
      const t = normalizeCompanyName(row.title ?? '')
      return t.length > 0 && (t.startsWith(`${wanted} `) || wanted.startsWith(`${t} `) || t === wanted)
    })
  }

  if (matches.length > 1 && target.tickerHint) {
    const byTicker = matches.filter(
      (row) => (row.ticker ?? '').toUpperCase() === target.tickerHint!.toUpperCase(),
    )
    if (byTicker.length === 1) matches = byTicker
  }

  if (matches.length === 0) {
    throw new CikResolutionError(target.canonicalName, 'no filer in company_tickers.json matched the canonical name')
  }
  if (matches.length > 1) {
    throw new CikResolutionError(
      target.canonicalName,
      `${matches.length} filers matched the canonical name and no ticker hint separated them`,
    )
  }

  const resolved = padCik(matches[0]!.cik_str)

  if (target.expectedCik && padCik(target.expectedCik) !== resolved) {
    throw new CikResolutionError(
      target.canonicalName,
      `SEC reports CIK ${resolved}, configuration expected ${padCik(target.expectedCik)}. ` +
        'Refusing to guess which is right.',
    )
  }
  return resolved
}

/* -------------------------------------------------------------- filings */

interface RecentFilings {
  readonly accessionNumber?: readonly string[]
  readonly filingDate?: readonly string[]
  readonly reportDate?: readonly string[]
  readonly acceptanceDateTime?: readonly string[]
  readonly form?: readonly string[]
  readonly primaryDocument?: readonly string[]
  readonly primaryDocDescription?: readonly string[]
  readonly items?: readonly string[]
}

export interface SubmissionsDocument {
  readonly cik?: string | number
  readonly name?: string
  readonly filings?: {
    readonly recent?: RecentFilings
    readonly files?: readonly { readonly name: string; readonly filingCount?: number }[]
  }
}

/** '' and undefined both mean "the API did not give us one". */
function blankToNull(value: string | undefined): string | null {
  const trimmed = (value ?? '').trim()
  return trimmed === '' ? null : trimmed
}

export function accessionNoDashes(accession: string): string {
  return accession.replace(/-/g, '')
}

/**
 * The parallel-array shape EDGAR uses, turned into records.
 *
 * `filings.recent` is column-oriented — nine arrays that line up by index. A
 * missing entry in one array is not a missing filing, it is a shorter column,
 * so every read is bounds-checked rather than assumed.
 */
export function filingsFromSubmissions(
  submissions: SubmissionsDocument,
  cik: string,
  target: SecCompanyTarget,
  window: { start: string; end: string },
  forms: readonly string[] = COLLECTED_FORMS,
): DiscoveredDocument[] {
  const recent = submissions.filings?.recent
  if (!recent?.accessionNumber) return []

  const out: DiscoveredDocument[] = []
  const formSet = new Set(forms.map((f) => f.toUpperCase()))

  for (let i = 0; i < recent.accessionNumber.length; i += 1) {
    const accession = recent.accessionNumber[i]
    const form = recent.form?.[i]
    if (!accession || !form) continue
    if (!formSet.has(form.toUpperCase())) continue

    // EDGAR sends an EMPTY STRING for a value it does not have, not null, so
    // `??` falls straight through it and yields ''. An empty published
    // timestamp then skipped the window filter entirely and pulled in filings
    // from outside the collection window. Absent means absent, whichever way
    // the API spells it.
    const filingDate = blankToNull(recent.filingDate?.[i])
    // acceptanceDateTime is the precise instant; filingDate is the day. Prefer
    // the precise one and record which precision we actually got, rather than
    // pretending a date is a timestamp.
    const acceptance = blankToNull(recent.acceptanceDateTime?.[i])
    const publishedAt = acceptance ?? (filingDate ? `${filingDate}T00:00:00Z` : null)
    const precision = acceptance ? 'minute' : filingDate ? 'day' : null

    if (publishedAt) {
      if (publishedAt < window.start || publishedAt >= window.end) continue
    }

    const primary = recent.primaryDocument?.[i] ?? ''
    const folder = accessionNoDashes(accession)
    const numericCik = String(Number(cik))
    const base = `https://www.sec.gov/Archives/edgar/data/${numericCik}/${folder}`

    out.push({
      sourceDocumentId: accession,
      url: primary ? `${base}/${primary}` : `${base}/${accession}-index.htm`,
      canonicalUrl: `${base}/${accession}-index.htm`,
      title: `${form} — ${target.canonicalName}${
        recent.primaryDocDescription?.[i] ? ` — ${recent.primaryDocDescription[i]}` : ''
      }`,
      publishedAt,
      publishedPrecision: precision,
      documentType: form.toUpperCase(),
      organizationEntityKey: target.entityKey,
      discoveryPath: 'sec:submissions-api',
      metadata: {
        cik,
        accessionNumber: accession,
        filingDate,
        reportDate: recent.reportDate?.[i] ?? null,
        items: recent.items?.[i] ?? null,
        primaryDocument: primary,
        archiveFolder: base,
      },
    })
  }
  return out
}

/**
 * Older filings live in paged files named by `filings.files[]`.
 *
 * Only pages whose name suggests they could overlap the window are fetched.
 * EDGAR encodes the covered range in the filename (`CIK…-submissions-001.json`
 * carries no dates, so when in doubt the page IS fetched) — guessing wrong in
 * the direction of fetching is a wasted request; guessing wrong the other way
 * silently truncates history.
 */
export async function discoverSecFilings(
  ctx: ConnectorContext,
  targets: readonly SecCompanyTarget[],
): Promise<DiscoveryOutcome> {
  const forms = (ctx.config.forms as string[] | undefined) ?? [...COLLECTED_FORMS]

  await ctx.pacer.take()
  const tickerResponse = await ctx.get(COMPANY_TICKERS_URL, { accept: 'application/json' })
  if (tickerResponse.status !== 200) {
    return {
      kind: 'unavailable',
      httpStatus: tickerResponse.status,
      note: `company_tickers.json answered HTTP ${tickerResponse.status}; no CIK could be resolved, so no filing was collected.`,
    }
  }

  let tickerFile: Record<string, TickerRow>
  try {
    tickerFile = JSON.parse(decodeUtf8(tickerResponse.body)) as Record<string, TickerRow>
  } catch {
    return { kind: 'unavailable', note: 'company_tickers.json was not parseable JSON.' }
  }

  const documents: DiscoveredDocument[] = []
  const failures: string[] = []

  for (const target of targets) {
    let cik: string
    try {
      cik = resolveCikFromTickerFile(tickerFile, target)
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error))
      continue
    }
    ctx.log(`[sec] ${target.canonicalName} resolved to CIK ${cik} from company_tickers.json`)

    await ctx.pacer.take()
    const response = await ctx.get(SUBMISSIONS_URL(cik), { accept: 'application/json' })
    if (response.status !== 200) {
      failures.push(`submissions for CIK ${cik} answered HTTP ${response.status}`)
      continue
    }

    let submissions: SubmissionsDocument
    try {
      submissions = JSON.parse(decodeUtf8(response.body)) as SubmissionsDocument
    } catch {
      failures.push(`submissions for CIK ${cik} was not parseable JSON`)
      continue
    }

    // The filer SEC returns must be the filer we asked about. A redirect or a
    // stale CIK that lands on another company would otherwise file its
    // documents under our organization without a word.
    if (submissions.name && normalizeCompanyName(submissions.name) !== normalizeCompanyName(target.canonicalName)) {
      const submissionsCik = submissions.cik ? padCik(submissions.cik) : null
      if (submissionsCik && submissionsCik !== cik) {
        failures.push(
          `submissions for CIK ${cik} identify a different filer (${submissionsCik}); skipped rather than misattributed`,
        )
        continue
      }
    }

    documents.push(...filingsFromSubmissions(submissions, cik, target, ctx.window, forms))

    for (const page of submissions.filings?.files ?? []) {
      if (!page?.name) continue
      await ctx.pacer.take()
      const pageResponse = await ctx.get(SUBMISSIONS_PAGE_URL(page.name), { accept: 'application/json' })
      if (pageResponse.status !== 200) {
        failures.push(`submissions page ${page.name} answered HTTP ${pageResponse.status}`)
        continue
      }
      try {
        const parsed = JSON.parse(decodeUtf8(pageResponse.body)) as RecentFilings
        documents.push(
          ...filingsFromSubmissions({ filings: { recent: parsed } }, cik, target, ctx.window, forms),
        )
      } catch {
        failures.push(`submissions page ${page.name} was not parseable JSON`)
      }
    }
  }

  if (documents.length === 0 && failures.length > 0) {
    return { kind: 'unavailable', note: failures.join('; ') }
  }
  if (failures.length > 0) ctx.log(`[sec] partial discovery: ${failures.join('; ')}`)
  return { kind: 'documents', documents }
}

/**
 * Exhibits attached to a filing, from the folder's own index.json.
 *
 * An 8-K's substance is usually in EX-99.1, not the four-paragraph form. Only
 * announcement exhibits are followed, because fetching every exhibit of every
 * filing is both a large amount of traffic and mostly XBRL.
 */
export async function discoverExhibits(
  ctx: ConnectorContext,
  filing: DiscoveredDocument,
): Promise<DiscoveredDocument[]> {
  const folder = filing.metadata.archiveFolder as string | undefined
  if (!folder) return []

  await ctx.pacer.take()
  const response = await ctx.get(`${folder}/index.json`, { accept: 'application/json' })
  if (response.status !== 200) return []

  let index: { directory?: { item?: { name?: string; type?: string }[] } }
  try {
    index = JSON.parse(decodeUtf8(response.body))
  } catch {
    return []
  }

  const out: DiscoveredDocument[] = []
  for (const item of index.directory?.item ?? []) {
    const name = item?.name
    if (!name || !ANNOUNCEMENT_EXHIBIT.test(name)) continue
    out.push({
      ...filing,
      sourceDocumentId: `${filing.sourceDocumentId}:${name}`,
      url: `${folder}/${name}`,
      canonicalUrl: `${folder}/${name}`,
      title: `${filing.documentType} exhibit ${name} — ${filing.title.split(' — ').slice(1).join(' — ')}`,
      documentType: `${filing.documentType}:EXHIBIT`,
      discoveryPath: 'sec:filing-index',
      metadata: { ...filing.metadata, exhibitName: name, parentAccession: filing.sourceDocumentId },
    })
  }
  return out
}

export async function retrieveSecDocument(
  ctx: ConnectorContext,
  document: DiscoveredDocument,
): Promise<RetrievedDocument> {
  const cached = await ctx.cache.read(SEC_SOURCE_ID, document.url)

  await ctx.pacer.take()
  const response = await ctx.get(document.url, {
    accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
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
      mimeType: 'application/octet-stream',
      retrievedAt,
      etag: etag ?? cached?.etag ?? null,
      lastModified: lastModified ?? cached?.lastModified ?? null,
      unchanged: true,
      extractedText: null,
      extractionStatus: 'success',
    }
  }

  const hash = await contentHash(response.body)
  const mimeType = (response.headers['content-type'] ?? 'application/octet-stream').split(';')[0]!.trim()
  const text = mimeType.includes('html') || mimeType.includes('text')
    ? htmlToText(decodeUtf8(response.body))
    : null

  await ctx.cache.write(SEC_SOURCE_ID, document.url, {
    etag,
    lastModified,
    contentHash: hash,
    status: response.status,
  })

  return {
    document,
    finalUrl: response.finalUrl,
    status: response.status,
    bytes: response.body,
    contentHash: hash,
    mimeType,
    retrievedAt,
    etag,
    lastModified,
    // A byte-identical body is unchanged even when the server did not say so.
    unchanged: cached?.contentHash === hash,
    extractedText: text,
    extractionStatus: text ? 'success' : mimeType.includes('pdf') ? 'unsupported' : 'partial',
  }
}

export const SEC_SOURCE_ID = 'sec-edgar'

export function secConnector(targets: readonly SecCompanyTarget[]): Connector {
  return {
    id: 'sec-edgar',
    version: SEC_CONNECTOR_VERSION,
    sourceId: SEC_SOURCE_ID,
    hosts: [...SEC_HOSTS],
    async discover(ctx) {
      const outcome = await discoverSecFilings(ctx, targets)
      if (outcome.kind !== 'documents') return outcome
      const withExhibits = await mapWithLimit(outcome.documents, FETCH_CONCURRENCY, async (filing) =>
        filing.documentType.startsWith('8-K') ? await discoverExhibits(ctx, filing) : [],
      )
      return { kind: 'documents', documents: [...outcome.documents, ...withExhibits.flat()] }
    },
    retrieve: retrieveSecDocument,
  }
}

export const SEC_PACING = { minIntervalMs: MIN_REQUEST_INTERVAL_MS, concurrency: FETCH_CONCURRENCY }

export { classifyRestriction }
