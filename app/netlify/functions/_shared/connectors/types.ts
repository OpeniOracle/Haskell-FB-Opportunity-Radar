/**
 * The connector contract.
 *
 * Every source — a regulatory API, a newsroom feed, a server-rendered press
 * page — reduces to the same two questions: WHAT DOCUMENTS EXIST in this
 * window, and WHAT ARE THE BYTES of one of them. Discovery and retrieval are
 * separate because they fail separately and are paced differently: a single
 * index call can name two hundred filings, and fetching those two hundred is
 * the part that has to respect a rate limit.
 *
 * Nothing in here writes to the database. A connector returns descriptions; the
 * pipeline decides what is new, what supersedes what, and what any of it means.
 * That split is what makes a connector testable against a recorded transport
 * and what stops "we fetched it" from implying "we believe it".
 */
import type { EgressResult, RequestPacer, RetryingGetOptions } from '../egress.js'

/** Precision of a source-declared timestamp. Never widened to fit a parser. */
export type PublishedPrecision = 'minute' | 'hour' | 'day' | 'month' | 'quarter' | 'year'

/**
 * A document the source says exists. No bytes yet.
 *
 * `sourceDocumentId` is the stable identity — an SEC accession number, a feed
 * guid, a canonical path. It is what makes a second run recognise a document
 * it already has, and it is deliberately NOT derived from the content.
 */
export interface DiscoveredDocument {
  readonly sourceDocumentId: string
  readonly url: string
  readonly canonicalUrl: string
  readonly title: string
  /** From the SOURCE. Null when the source does not state one — never "now". */
  readonly publishedAt: string | null
  readonly publishedPrecision: PublishedPrecision | null
  readonly documentType: string
  /** Which approved company this document is about. */
  readonly organizationEntityKey: string
  /** Retrieval-strategy provenance: which layer of a layered connector found it. */
  readonly discoveryPath: string
  readonly metadata: Readonly<Record<string, unknown>>
}

export interface RetrievedDocument {
  readonly document: DiscoveredDocument
  readonly finalUrl: string
  readonly status: number
  readonly bytes: Uint8Array
  readonly contentHash: string
  readonly mimeType: string
  readonly retrievedAt: string
  readonly etag: string | null
  readonly lastModified: string | null
  /** The source answered 304, or the hash matched what we already hold. */
  readonly unchanged: boolean
  /** Text pulled out of the bytes, when the format admits it. */
  readonly extractedText: string | null
  readonly extractionStatus: 'success' | 'partial' | 'failed' | 'unsupported'
}

/**
 * Why a discovery attempt produced nothing.
 *
 * "Zero documents" and "we could not ask" are different facts and the interface
 * must never show them the same way. §5 of the live-data brief requires that
 * separation, and it starts here rather than at the presentation layer.
 */
export type DiscoveryOutcome =
  | { readonly kind: 'documents'; readonly documents: readonly DiscoveredDocument[] }
  | { readonly kind: 'unchanged'; readonly note: string }
  | { readonly kind: 'unavailable'; readonly note: string; readonly httpStatus?: number }
  | {
      /**
       * The source is reachable and legitimate, but no compliant automated path
       * exists — a robots rule, a terms restriction, or a challenge we will not
       * defeat. The source stays supported and a human imports from it.
       */
      readonly kind: 'manual_review_required'
      readonly note: string
      readonly evidenceOfRestriction: RestrictionReport
    }

/**
 * What was actually observed when access was refused.
 *
 * Recorded rather than summarised, because "Mars blocked us" is not something
 * anyone can act on, and because the answer to a WAF challenge is to find the
 * official feed, not to argue with the WAF.
 */
export interface RestrictionReport {
  readonly url: string
  readonly httpStatus: number | null
  readonly classification:
    | 'robots_disallow'
    | 'terms_prohibited'
    | 'captcha_or_challenge'
    | 'waf_block'
    | 'authentication_required'
    | 'rate_limited'
    | 'not_found'
    | 'transport_error'
  readonly redirectChain: readonly string[]
  readonly robotsRule: string | null
  /** A short, non-sensitive marker — never a response body. */
  readonly detail: string
}

export interface ConnectorConfig {
  readonly [key: string]: unknown
}

/**
 * Everything a connector may touch, handed in.
 *
 * A connector never imports `fetch`, never reads `process.env`, and never calls
 * `Date.now()` directly. That is not ceremony: it is what lets the SEC
 * connector be driven against a recorded transport in a unit test and what
 * keeps the User-Agent decision in one place instead of thirty.
 */
export interface ConnectorContext {
  readonly userAgent: string
  readonly allowlist: readonly string[]
  readonly get: (url: string, options?: Partial<RetryingGetOptions>) => Promise<EgressResult>
  readonly pacer: RequestPacer
  readonly cache: DocumentCachePort
  readonly now: () => Date
  readonly config: ConnectorConfig
  /** Window the run is collecting. Documents outside it are not discovered. */
  readonly window: { readonly start: string; readonly end: string }
  readonly log: (message: string) => void
}

/** Conditional-request validators, persisted between runs. */
export interface DocumentCachePort {
  read(sourceId: string, url: string): Promise<CachedValidator | null>
  write(sourceId: string, url: string, validator: CachedValidator): Promise<void>
}

export interface CachedValidator {
  readonly etag: string | null
  readonly lastModified: string | null
  readonly contentHash: string | null
  readonly status: number | null
}

export interface Connector {
  readonly id: string
  readonly version: string
  readonly sourceId: string
  /** Hosts this connector may reach. Merged into the egress allowlist. */
  readonly hosts: readonly string[]
  discover(ctx: ConnectorContext): Promise<DiscoveryOutcome>
  retrieve(ctx: ConnectorContext, document: DiscoveredDocument): Promise<RetrievedDocument>
}
