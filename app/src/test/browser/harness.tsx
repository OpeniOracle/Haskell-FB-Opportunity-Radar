import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App } from '@/App'
import { FakeAuth, makeSession } from '@/test/authFake'
import '@/styles/tokens.css'
import '@/styles/base.css'

/**
 * A real browser, real CSS, real layout -- the thing jsdom cannot be.
 *
 * The responsive defect that shipped (an unsized `<svg>` expanding to fill its
 * flex line and squeezing the message into a column a few characters wide) is
 * invisible to every DOM-only test in this repository, because jsdom has no
 * layout engine: `getBoundingClientRect()` there returns zeroes. The suite was
 * not weak, it was blind. So this mounts the ACTUAL pages in Chromium and the
 * assertions are measurements.
 *
 * BrowserRouter, not MemoryRouter, and that is the point for the callback
 * scenarios: `CallbackPage` reads `window.location.hash`, which a memory router
 * does not populate. The harness server serves this page for every path, so the
 * browser's real URL -- fragment and all -- is what the page parses. That is
 * the only way to exercise a Supabase implicit invitation redirect honestly.
 *
 * NOT PART OF `npm run build`. It is built by `vite.harness.config.ts` into
 * `dist-harness/`, which is gitignored and never deployed. It imports the test
 * fake, so shipping it would put a bypassable authentication port in the
 * bundle; the boundary suite fails the build if this file ever becomes
 * reachable from `src/main.tsx`.
 */

const params = new URLSearchParams(window.location.search)
const scenario = params.get('scenario') ?? 'login'
document.documentElement.dataset.theme = params.get('theme') ?? 'light'

/** Each scenario is one screen this correction is accountable for. */
const SCENARIOS: Record<string, () => FakeAuth> = {
  // A rejected sign-in: the error callout, adjacent to the form.
  login: () => new FakeAuth({ signInFailure: { code: 'invalid_credentials' } }),
  // A spent or expired invitation: the neutral link failure.
  'callback-failure': () => new FakeAuth({ redeemResult: { ok: false, reason: 'expired' } }),
  // The forgot-password confirmation: the success callout, inside the card.
  'forgot-sent': () => new FakeAuth(),
  // Password policy and mismatch, on the invitation set-password form.
  'password-policy': () => new FakeAuth({ initialSession: makeSession() }),
  'password-mismatch': () => new FakeAuth({ initialSession: makeSession() }),
  // The whole invitation journey, from a realistic Supabase implicit fragment.
  invitation: () => new FakeAuth(),
  /*
     THE SCREEN THE ROUTING FAULT PRODUCED.

     `/api/session` returned the SPA instead of JSON, `confirmStanding()` could
     not parse it, and the gate reported `unknown` -- a service failure. The
     page then told the operator their allowlist row was missing. It was not.
     `standing: 'unknown'` reproduces that exactly.
  */
  'callback-service-failure': () => new FakeAuth({ standing: 'unknown' }),
  // The genuinely de-listed account, for contrast: the one case where the
  // allowlist really is the thing to go and look at.
  'callback-not-invited': () => new FakeAuth({ standing: 'not_invited' }),
  /*
     RECOVERY BY CODE, WHICH IS NOW A PAGE AN UNAUTHENTICATED VISITOR SEES.

     Two fields and a refusal, at every width and in both themes. It is the
     first screen a reviewer meets when setting a password for the first time,
     so a layout fault here is a layout fault in the onboarding path.
  */
  'recovery-code': () => new FakeAuth(),
}

const build = SCENARIOS[scenario]
if (!build) throw new Error(`Unknown harness scenario: ${scenario}`)

const container = document.getElementById('root')
if (!container) throw new Error('Root element #root is missing.')

createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <App authPort={build()} />
    </BrowserRouter>
  </StrictMode>,
)
