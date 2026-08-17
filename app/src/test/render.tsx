import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
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

/** Render an isolated element inside a router, for component-level tests. */
export function renderAt(element: ReactElement, initialEntry = '/') {
  return render(<MemoryRouter initialEntries={[initialEntry]}>{element}</MemoryRouter>)
}
