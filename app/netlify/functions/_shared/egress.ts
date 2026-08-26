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
        },
      })

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
