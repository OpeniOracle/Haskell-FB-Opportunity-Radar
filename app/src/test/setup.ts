import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

/**
 * Media-query stub.
 *
 * jsdom does not implement `matchMedia`, and the shell now uses it to decide
 * between the side rail and the bottom navigation. `setViewport` lets a test
 * choose which one renders; the default is the wide layout.
 */
let narrowViewport = false

export function setViewport(width: 'wide' | 'narrow') {
  narrowViewport = width === 'narrow'
}

window.matchMedia = ((query: string) => ({
  matches: narrowViewport && query.includes('max-width'),
  media: query,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia

afterEach(() => {
  cleanup()
  narrowViewport = false
  document.documentElement.removeAttribute('data-theme')
  window.localStorage.clear()
})
