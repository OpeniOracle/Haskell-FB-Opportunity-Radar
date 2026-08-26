/**
 * The ONE module in the browser bundle permitted to make a network request.
 *
 * Until this file existed, `app/src/test/boundaries.test.ts` forbade `fetch`
 * anywhere in the application, which was the right rule for a fixture-backed
 * preview. The rule is not removed now that the application needs a network — it
 * is narrowed to this module and to `supabaseClient.ts`. Everywhere else, a
 * `fetch` is still a failing test.
 *
 * That distinction matters: "the app may talk to the network" and "any component
 * may talk to anywhere" are very different postures, and the second one is how a
 * surface ends up quietly calling a third party.
 *
 * Same-origin only. Every call goes to `/api/*`, which Netlify routes to a
 * function. The browser never addresses an external host directly, so the CSP
 * `connect-src` needs to permit exactly two things: this origin, and the
 * Supabase project.
 */

export interface ApiError {
  readonly code: string
  readonly message: string
  readonly status: number
}

export type ApiResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ApiError }

const API_ROOT = '/api'

/** A caller-supplied absolute URL would defeat the same-origin rule. */
function assertRelative(path: string): void {
  if (!path.startsWith('/') || path.startsWith('//')) {
    throw new Error(`API paths must be root-relative and same-origin. Got "${path}".`)
  }
}

export interface ApiRequest {
  readonly path: string
  readonly method?: 'GET' | 'POST'
  readonly accessToken?: string | null
  readonly body?: unknown
  readonly signal?: AbortSignal
}

export async function apiRequest<T>(request: ApiRequest): Promise<ApiResult<T>> {
  const path = `${API_ROOT}${request.path}`
  assertRelative(path)

  const headers: Record<string, string> = { accept: 'application/json' }
  if (request.accessToken) headers.authorization = `Bearer ${request.accessToken}`
  if (request.body !== undefined) headers['content-type'] = 'application/json'

  let response: Response
  try {
    response = await fetch(path, {
      method: request.method ?? 'GET',
      headers,
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
      credentials: 'same-origin',
      ...(request.signal ? { signal: request.signal } : {}),
    })
  } catch (error) {
    // A network failure is a state the interface shows, not an exception it
    // throws: every surface already renders `unavailable` honestly.
    return {
      ok: false,
      error: {
        code: 'network_unreachable',
        message: error instanceof Error ? error.message : 'The request could not be sent.',
        status: 0,
      },
    }
  }

  const text = await response.text()
  let parsed: unknown = null
  if (text) {
    try {
      parsed = JSON.parse(text)
    } catch {
      return {
        ok: false,
        error: {
          code: 'invalid_response',
          message: 'The server returned a response that was not JSON.',
          status: response.status,
        },
      }
    }
  }

  if (!response.ok) {
    const body = parsed as { error?: { code?: string; message?: string } } | null
    return {
      ok: false,
      error: {
        code: body?.error?.code ?? 'request_failed',
        message: body?.error?.message ?? `Request failed with status ${response.status}.`,
        status: response.status,
      },
    }
  }

  return { ok: true, value: parsed as T }
}

export interface StatusResponse {
  readonly ok: boolean
  readonly radarEnv: string
  readonly caller: { readonly userId: string }
  readonly database:
    | { readonly reachable: true; readonly organizationsVisible: number }
    | { readonly reachable: false; readonly code: string }
  readonly model: { readonly available: boolean; readonly describe: string }
}

export function getStatus(accessToken: string | null): Promise<ApiResult<StatusResponse>> {
  return apiRequest<StatusResponse>({ path: '/status', accessToken })
}

/**
 * Fetch a preserved evidence object through the authenticated proxy.
 *
 * The caller only ever knows an evidence id. There is no storage path in the
 * browser, no signed URL to copy out of devtools, and nothing that keeps working
 * after the session ends — every fetch is re-authorised server-side.
 *
 * Returns a Blob rather than an object URL: an object URL would outlive the
 * check that produced it, which is the property this design exists to remove.
 */
export async function fetchEvidenceObject(
  evidenceId: string,
  accessToken: string | null,
): Promise<ApiResult<Blob>> {
  const path = `${API_ROOT}/evidence/${encodeURIComponent(evidenceId)}`
  assertRelative(path)

  const headers: Record<string, string> = {}
  if (accessToken) headers.authorization = `Bearer ${accessToken}`

  let response: Response
  try {
    response = await fetch(path, { method: 'GET', headers, credentials: 'same-origin' })
  } catch (error) {
    return {
      ok: false,
      error: {
        code: 'network_unreachable',
        message: error instanceof Error ? error.message : 'The request could not be sent.',
        status: 0,
      },
    }
  }

  if (!response.ok) {
    let code = 'request_failed'
    let message = `Request failed with status ${response.status}.`
    try {
      const body = (await response.json()) as { error?: { code?: string; message?: string } }
      code = body?.error?.code ?? code
      message = body?.error?.message ?? message
    } catch {
      /* A non-JSON error body is still an error; the status carries the meaning. */
    }
    return { ok: false, error: { code, message, status: response.status } }
  }

  return { ok: true, value: await response.blob() }
}
