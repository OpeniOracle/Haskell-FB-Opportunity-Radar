/**
 * `GET /api/session` — "is this session still allowed to be here?"
 *
 * The browser cannot answer this for itself, and that is deliberate. Migration
 * 0016 revokes `auth_invite_allowlist` from `authenticated`, so a signed-in
 * session cannot read the list it is on — publishing the roster of everyone
 * with access to every person with access is not a trade this project makes.
 * The one bit a client legitimately needs is whether IT is still on the list.
 *
 * So this endpoint exists to return that bit and almost nothing else. It is
 * called when a session is established — restored on load, created at sign-in,
 * redeemed from an invitation — which is what makes removal from the allowlist
 * take effect on the person's next page load rather than at token expiry.
 *
 * It is deliberately NOT `/api/status`. That endpoint is an operator
 * diagnostic: it probes storage, the schema version and the guard function, and
 * reports a dozen fields. Calling it on every page load would be three extra
 * round trips to learn one boolean, and would put operational detail in front
 * of an ordinary user.
 *
 * WHAT IS NOT RETURNED. No email address, no allowlist contents, no session id,
 * no token, no role. A caller learns about itself and about nobody else.
 */
import type { Handler } from '@netlify/functions'
import { UnauthorizedError, requireUser } from './_shared/auth.js'
import { KeyShapeError, MissingEnvError, serverEnv } from './_shared/env.js'
import { failure, json, methodNotAllowed } from './_shared/http.js'

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'GET') return methodNotAllowed('GET')

  try {
    serverEnv()
  } catch (error) {
    if (error instanceof MissingEnvError) {
      return failure(503, 'not_configured', 'Authentication is not configured.')
    }
    /*
       A variable that is PRESENT but holds the wrong kind of key used to fall
       through to `throw`, and an unhandled throw in a Netlify function is an
       HTML error page. The caller then gets HTML from an endpoint that
       promises JSON -- the same class of failure as the routing bug, arriving
       by a different door. It is an answer, so it is answered in JSON.

       The message names the VARIABLE and the problem, never the value.
    */
    if (error instanceof KeyShapeError) {
      return failure(503, 'not_configured', error.message)
    }
    throw error
  }

  const authorization = event.headers.authorization ?? event.headers.Authorization

  let caller
  try {
    caller = await requireUser({ authorization })
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      // One message for every authentication failure. "No session", "expired"
      // and "not a real token" are the same answer to whoever is asking.
      return failure(401, 'unauthorized', 'Authentication required.')
    }
    throw error
  }

  return json(200, {
    userId: caller.userId,
    // Re-read from the allowlist on every call, never from the token. A token
    // minted before someone was removed is still perfectly valid.
    invited: caller.invited,
    isAnonymous: caller.isAnonymous,
  })
}
