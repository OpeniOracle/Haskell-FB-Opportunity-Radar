/**
 * The single egress gateway.
 *
 * ADR 0002: every outbound request the Radar makes leaves through one function,
 * so "what does this system talk to" is answerable by reading one allowlist
 * rather than grepping for `fetch` forever. Connectors do not call `fetch`; a
 * lint rule and a boundary test enforce that.
 *
 * What this gives us that scattered fetch calls do not:
 *   - an allowlist that is checked after redirects, not only before
 *   - a declared User-Agent on every request, which SEC EDGAR requires
 *   - one place where a timeout, a byte cap and a retry budget are real
 *   - one place that records what was requested, for Source Health
 */

export interface EgressResult {
  readonly url: string
  readonly finalUrl: string
  readonly status: number
  readonly headers: Readonly<Record<string, string>>
  readonly body: Uint8Array
  readonly startedAt: string
  readonly finishedAt: string
  readonly redirects: readonly string[]
  /**
   * The server answered 304. `body` is empty and carries no meaning — the
   * caller already has the bytes and must not treat this as an empty document.
   */
  readonly notModified: boolean
}

export class EgressDeniedError extends Error {
  constructor(readonly host: string, readonly allowlist: readonly string[]) {
    super(
      `Egress to "${host}" is not on the allowlist. ` +
        `Permitted: ${allowlist.length ? allowlist.join(', ') : '(none configured)'}.`,
    )
    this.name = 'EgressDeniedError'
  }
}

export class EgressLimitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EgressLimitError'
  }
}

export interface EgressOptions {
  readonly userAgent: string
  readonly allowlist: readonly string[]
  /** Hard ceiling on the response body. A source that returns a DVD is a bug. */
  readonly maxBytes?: number
  readonly timeoutMs?: number
  readonly maxRedirects?: number
  readonly accept?: string
  /**
   * Conditional-request validators. SEC fair access is not only a rate limit:
   * re-downloading a filing that has not changed is exactly the traffic the
   * guidance asks callers not to generate.
   */
  readonly ifNoneMatch?: string
  readonly ifModifiedSince?: string
}

const DEFAULT_MAX_BYTES = 8 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 20_000
const DEFAULT_MAX_REDIRECTS = 5

/**
 * `example.com` on the allowlist permits `example.com` and `news.example.com`,
 * and does NOT permit `notexample.com` or `example.com.attacker.net`. Suffix
 * matching without the dot check is the classic way an allowlist stops working.
 */
export function hostAllowed(host: string, allowlist: readonly string[]): boolean {
  const h = host.toLowerCase()
  return allowlist.some((entry) => {
    const e = entry.toLowerCase()
    return h === e || h.endsWith(`.${e}`)
  })
}

function assertAllowed(rawUrl: string, allowlist: readonly string[]): URL {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new EgressDeniedError(rawUrl, allowlist)
  }
  // Only https. An http URL is a downgrade and a redirect target waiting to happen.
  if (url.protocol !== 'https:') {
    throw new EgressDeniedError(`${url.protocol}//${url.host}`, allowlist)
  }
  if (!hostAllowed(url.hostname, allowlist)) {
    throw new EgressDeniedError(url.hostname, allowlist)
  }
  return url
}

/**
 * Redirects are followed manually so that EVERY hop is checked against the
 * allowlist. `redirect: 'follow'` would check the first URL and then go wherever
 * it was sent, which is not an allowlist.
 */
export async function egressGet(rawUrl: string, options: EgressOptions): Promise<EgressResult> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS

  const startedAt = new Date().toISOString()
  const redirects: string[] = []
  let current = assertAllowed(rawUrl, options.allowlist)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    for (let hop = 0; ; hop += 1) {
      if (hop > maxRedirects) {
        throw new EgressLimitError(`More than ${maxRedirects} redirects from ${rawUrl}.`)
      }

      const response = await fetch(current, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': options.userAgent,
          Accept: options.accept ?? '*/*',
          'Accept-Encoding': 'gzip, deflate',
          ...(hop === 0 && options.ifNoneMatch ? { 'If-None-Match': options.ifNoneMatch } : {}),
          ...(hop === 0 && options.ifModifiedSince
            ? { 'If-Modified-Since': options.ifModifiedSince }
            : {}),
        },
      })

      // 304 lives in the 3xx range but is not a redirect. Checked first, or
      // the redirect branch below demands a Location header that is not there
      // and turns "nothing changed" into an error.
      if (response.status === 304) {
        const headers: Record<string, string> = {}
        response.headers.forEach((value, key) => {
          headers[key.toLowerCase()] = value
        })
        return {
          url: rawUrl,
          finalUrl: current.toString(),
          status: 304,
          headers,
          body: new Uint8Array(0),
          startedAt,
          finishedAt: new Date().toISOString(),
          redirects,
          notModified: true,
        }
      }

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location')
        if (!location) {
          throw new EgressLimitError(`Redirect ${response.status} with no Location header.`)
        }
        redirects.push(current.toString())
        current = assertAllowed(new URL(location, current).toString(), options.allowlist)
        continue
      }

      const declared = Number(response.headers.get('content-length') ?? '0')
      if (declared > maxBytes) {
        throw new EgressLimitError(
          `Response declares ${declared} bytes, over the ${maxBytes}-byte ceiling.`,
        )
      }

      const buffer = new Uint8Array(await response.arrayBuffer())
      // Checked again after reading: content-length is a claim, not a fact.
      if (buffer.byteLength > maxBytes) {
        throw new EgressLimitError(
          `Response body is ${buffer.byteLength} bytes, over the ${maxBytes}-byte ceiling.`,
        )
      }

      const headers: Record<string, string> = {}
      response.headers.forEach((value, key) => {
        headers[key.toLowerCase()] = value
      })

      return {
        url: rawUrl,
        finalUrl: current.toString(),
        status: response.status,
        headers,
        body: buffer,
        startedAt,
        finishedAt: new Date().toISOString(),
        redirects,
        notModified: false,
      }
    }
  } finally {
    clearTimeout(timer)
  }
}

/** SHA-256 of exactly the bytes retrieved, for `evidence.content_hash`. */
export async function contentHash(body: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', body as BufferSource)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/* ==================================================================== */
/* Fair access: pacing, retries, and a ceiling on concurrency           */
/* ==================================================================== */

export interface RetryPolicy {
  /** Total attempts, including the first. */
  readonly attempts: number
  /** First backoff, doubled each attempt. */
  readonly baseDelayMs: number
  readonly maxDelayMs: number
}

export const DEFAULT_RETRY: RetryPolicy = { attempts: 4, baseDelayMs: 500, maxDelayMs: 8_000 }

/**
 * WHICH FAILURES ARE WORTH REPEATING.
 *
 * A 429 or a 5xx is the server asking for time. A 403 or a 404 is an answer,
 * and asking again is both useless and — on a source with fair-access rules —
 * exactly the behaviour that gets a caller blocked. Retrying everything is how
 * a client turns one refusal into a pattern of refusals.
 */
export function isRetryable(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || (status >= 500 && status < 600)
}

/**
 * `Retry-After` is honoured when present, in both of its documented forms.
 * Ignoring it and applying our own backoff is not politeness, it is guessing
 * over an explicit instruction.
 */
export function retryAfterMs(headerValue: string | undefined, now: number): number | null {
  if (!headerValue) return null
  const seconds = Number(headerValue.trim())
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 300_000)
  const at = Date.parse(headerValue)
  if (Number.isNaN(at)) return null
  return Math.max(0, Math.min(at - now, 300_000))
}

export function backoffDelayMs(attempt: number, policy: RetryPolicy, jitter = Math.random): number {
  const exponential = policy.baseDelayMs * 2 ** (attempt - 1)
  const capped = Math.min(exponential, policy.maxDelayMs)
  // Full jitter. Without it, every retry in a batch lands at the same instant
  // and the second wave looks exactly like the burst that caused the first.
  return Math.floor(capped * (0.5 + 0.5 * jitter()))
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export interface RetryingGetOptions extends EgressOptions {
  readonly retry?: RetryPolicy
  /** Injected in tests so backoff is deterministic and instant. */
  readonly waiter?: (ms: number) => Promise<void>
  readonly jitter?: () => number
}

/**
 * One request, with the retry budget the source's terms imply.
 *
 * Returns the LAST response rather than throwing on a non-retryable status:
 * a 404 for a filing that no longer exists is a fact the run should record,
 * not an exception that aborts the other nineteen documents.
 */
export async function egressGetWithRetry(
  rawUrl: string,
  options: RetryingGetOptions,
): Promise<EgressResult> {
  const policy = options.retry ?? DEFAULT_RETRY
  const wait = options.waiter ?? sleep
  const jitter = options.jitter ?? Math.random

  let lastError: unknown
  for (let attempt = 1; attempt <= policy.attempts; attempt += 1) {
    try {
      const result = await egressGet(rawUrl, options)
      if (!isRetryable(result.status) || attempt === policy.attempts) return result
      const declared = retryAfterMs(result.headers['retry-after'], Date.now())
      await wait(declared ?? backoffDelayMs(attempt, policy, jitter))
      continue
    } catch (error) {
      // An allowlist denial is a configuration fact. Repeating it changes
      // nothing and buries the real reason under three more identical errors.
      if (error instanceof EgressDeniedError) throw error
      lastError = error
      if (attempt === policy.attempts) break
      await wait(backoffDelayMs(attempt, policy, jitter))
    }
  }
  throw lastError
}

/**
 * Bounded concurrency, preserving input order in the output.
 *
 * SEC asks callers to stay within a documented request rate. The honest way to
 * hold a ceiling is to have one — a `Promise.all` over a filing index is an
 * unbounded burst wearing a tidy syntax.
 */
export async function mapWithLimit<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (limit < 1) throw new RangeError('Concurrency limit must be at least 1.')
  const results = new Array<R>(items.length)
  let next = 0

  async function pump(): Promise<void> {
    for (;;) {
      const index = next
      next += 1
      if (index >= items.length) return
      results[index] = await worker(items[index]!, index)
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, pump))
  return results
}

/**
 * A minimum gap between requests to one host.
 *
 * Concurrency alone does not bound a RATE: ten sequential requests with a
 * limit of one can still be ten requests in a hundred milliseconds. SEC's
 * guidance is expressed per second, so something has to measure per second.
 */
export class RequestPacer {
  private lastAt = 0
  constructor(
    private readonly minIntervalMs: number,
    private readonly now: () => number = Date.now,
    private readonly waiter: (ms: number) => Promise<void> = sleep,
  ) {}

  async take(): Promise<void> {
    const elapsed = this.now() - this.lastAt
    if (this.lastAt !== 0 && elapsed < this.minIntervalMs) {
      await this.waiter(this.minIntervalMs - elapsed)
    }
    this.lastAt = this.now()
  }
}
