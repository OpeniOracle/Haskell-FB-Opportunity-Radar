import { render } from '@testing-library/react'
import { BrowserRouter, MemoryRouter } from 'react-router-dom'
import type { ReactElement } from 'react'
import { App } from '@/App'
import { AuthProvider } from '@/auth/AuthProvider'
import { FakeAuth, signedIn } from '@/test/authFake'
import { createFixtureDataSource, isFixtureScenario } from '@/data/fixtureDataSource'
import type { DataSource } from '@/data/DataSource'

/**
 * Fixtures are handed IN, never reached by default.
 *
 * The application's own provider is the live one. A surface test wants the
 * fixture corpus, so the helper supplies it explicitly — which is also what
 * keeps the fixture modules out of the production import graph entirely.
 */
export function fixtureSource(scenario: string | undefined): DataSource {
  const candidate = scenario ?? null
  return createFixtureDataSource(isFixtureScenario(candidate) ? candidate : 'ready')
}

/**
 * Rendering the application in tests, now that there is a gate in front of it.
 *
 * EVERY SURFACE TEST IS SIGNED IN BY DEFAULT. That is not a way of getting the
 * gate out of the way — those tests are about what a surface renders, and
 * making six hundred of them perform a sign-in would test the login form six
 * hundred times and the surfaces once each.
 *
 * The gate itself is exercised where it belongs, in `authGate.test.tsx` and
 * `authFlows.test.tsx`, which pass their own `FakeAuth` in whatever state the
 * case is about. `authGate.test.tsx` additionally walks EVERY route in the
 * application signed out, so "the default is authenticated" can never quietly
 * become "nothing checks".
 *
 * The default fake resolves its session synchronously-ish (a microtask), so
 * surface tests see the same first paint they always did once the promise
 * settles. Anything asserting the loading frame must use `signedOut()` or
 * `pendingAuth()` and assert deliberately.
 */

export interface RenderAppOptions {
  /** Supply a fake in a particular state. Defaults to signed in and invited. */
  readonly auth?: FakeAuth
  /** Supply a data source. Defaults to the fixture corpus for the `?state=`. */
  readonly data?: DataSource | ((scenario: string | undefined) => DataSource)
}

/** Render the whole application at a given URL, as a user would arrive at it. */
export function renderApp(initialEntry = '/', options: RenderAppOptions = {}) {
  const auth = options.auth ?? signedIn()
  const result = render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <App authPort={auth} dataSource={options.data ?? fixtureSource} />
    </MemoryRouter>,
  )
  return Object.assign(result, { auth })
}

/**
 * Render against real browser history.
 *
 * `MemoryRouter` is enough for most tests, but not for anything that asserts the
 * address bar or uses the back button — drawer state lives in the URL, so those
 * need a router wired to `window.history`. The invitation callback needs it too:
 * it reads `window.location` and then rewrites the history entry.
 */
export function renderAppWithHistory(initialEntry = '/', options: RenderAppOptions = {}) {
  const auth = options.auth ?? signedIn()
  window.history.pushState({}, '', initialEntry)
  const result = render(
    <BrowserRouter>
      <App authPort={auth} dataSource={options.data ?? fixtureSource} />
    </BrowserRouter>,
  )
  return Object.assign(result, { auth })
}

/** Drive a browser navigation the way a link or the back button would. */
export function navigate(url: string) {
  window.history.pushState({}, '', url)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

/**
 * Render an isolated element inside a router, for component-level tests.
 *
 * Wrapped in an `AuthProvider` because components in the authenticated shell may
 * legitimately call `useAuth` — the sign-out control does.
 */
export function renderAt(
  element: ReactElement,
  initialEntry = '/',
  options: RenderAppOptions = {},
) {
  const auth = options.auth ?? signedIn()
  const result = render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <AuthProvider port={auth}>{element}</AuthProvider>
    </MemoryRouter>,
  )
  return Object.assign(result, { auth })
}
