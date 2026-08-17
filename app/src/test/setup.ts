import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(() => {
  cleanup()
  document.documentElement.removeAttribute('data-theme')
  window.localStorage.clear()
})

// jsdom does not implement matchMedia, which the reduced-motion and
// colour-scheme queries rely on. A minimal always-false stub is enough: the
// tests assert the DOM contract, not the browser's media evaluation.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}
