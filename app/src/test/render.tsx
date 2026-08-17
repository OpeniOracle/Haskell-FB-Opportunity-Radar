import { render } from '@testing-library/react'
import { BrowserRouter, MemoryRouter } from 'react-router-dom'
import type { ReactElement } from 'react'
import { App } from '@/App'

/** Render the whole application at a given URL, as a user would arrive at it. */
export function renderApp(initialEntry = '/') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <App />
    </MemoryRouter>,
  )
}

/**
 * Render against real browser history.
 *
 * `MemoryRouter` is enough for most tests, but not for anything that asserts the
 * address bar or uses the back button — drawer state lives in the URL, so those
 * need a router wired to `window.history`.
 */
export function renderAppWithHistory(initialEntry = '/') {
  window.history.pushState({}, '', initialEntry)
  return render(
    <BrowserRouter>
      <App />
    </BrowserRouter>,
  )
}

/** Drive a browser navigation the way a link or the back button would. */
export function navigate(url: string) {
  window.history.pushState({}, '', url)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

/** Render an isolated element inside a router, for component-level tests. */
export function renderAt(element: ReactElement, initialEntry = '/') {
  return render(<MemoryRouter initialEntries={[initialEntry]}>{element}</MemoryRouter>)
}
