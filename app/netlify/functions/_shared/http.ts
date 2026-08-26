/** Response helpers, so every function answers in the same shape. */
export interface JsonResponse {
  statusCode: number
  headers: Record<string, string>
  body: string
}

const BASE_HEADERS: Record<string, string> = {
  'content-type': 'application/json; charset=utf-8',
  // An API response is never a document and never cacheable by an intermediary.
  'cache-control': 'no-store',
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
