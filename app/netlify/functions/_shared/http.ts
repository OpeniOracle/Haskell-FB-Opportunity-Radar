/** Response helpers, so every function answers in the same shape. */
export interface JsonResponse {
  statusCode: number
  headers: Record<string, string>
  body: string
}

const BASE_HEADERS: Record<string, string> = {
  'content-type': 'application/json; charset=utf-8',
  /*
     `private` as well as `no-store`.

     `no-store` alone already forbids storing the response, but `private` states
     the intent that no SHARED cache -- a CDN node, a corporate proxy -- may
     hold it under any interpretation. These bodies are per-caller by
     construction: `/api/session` answers about the bearer of one token and
     `/api/status` reports that caller's own access. A shared cache serving one
     analyst's answer to another is the failure worth being explicit about,
     including on the error paths, which is why it lives in the base headers
     rather than on the success path only.
  */
  'cache-control': 'private, no-store',
  'x-content-type-options': 'nosniff',
}

export function json(statusCode: number, body: unknown): JsonResponse {
  return { statusCode, headers: { ...BASE_HEADERS }, body: JSON.stringify(body) }
}

/**
 * Error bodies carry a code and a safe message, never the underlying exception.
 * A stack trace or a driver error in a response body is how connection strings
 * end up in someone's browser console.
 */
export function failure(statusCode: number, code: string, message: string): JsonResponse {
  return json(statusCode, { error: { code, message } })
}

export function methodNotAllowed(allowed: string): JsonResponse {
  return {
    ...failure(405, 'method_not_allowed', `Only ${allowed} is accepted.`),
    headers: { ...BASE_HEADERS, allow: allowed },
  }
}
