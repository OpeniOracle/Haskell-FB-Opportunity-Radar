import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { FIXTURE_NOW, setDisplayClock } from '@/lib/format'

/**
 * THE TEST SUITE FREEZES THE CLOCK. PRODUCTION DOES NOT.
 *
 * Relative labels used to default to `FIXTURE_NOW` inside `format.ts`, which
 * gave the tests reproducibility and gave production a filing collected today
 * rendered as "in 4 weeks". The default is now the real clock, so the freeze
 * has to be asked for — and this is the place that asks, once, for every test
 * that renders a timestamp.
 *
 * A test that cares about the real clock overrides it with `setDisplayClock`
 * and `beforeEach` restores the freeze afterwards.
 */
beforeEach(() => {
  setDisplayClock(() => FIXTURE_NOW)
})

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
  setDisplayClock(() => FIXTURE_NOW)
  narrowViewport = false
  // Drawer state lives in the URL, so one test's address must not leak into the next.
  window.history.pushState({}, '', '/')
  document.documentElement.removeAttribute('data-theme')
  window.localStorage.clear()
})


/**
 * jsdom shims the map and the lazy embeds depend on.
 *
 * `IntersectionObserver` gates the Spyglass frames, and `ResizeObserver` and
 * `URL.createObjectURL` are used by MapLibre. None exist in jsdom, and their
 * absence throws during render rather than degrading.
 */
class StubObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return []
  }
}

/**
 * An IntersectionObserver that actually INTERSECTS.
 *
 * A no-op stub was the first version, and it meant every lazily-gated element
 * stayed un-gated forever: the Spyglass frames never entered the document and
 * every assertion about them passed vacuously against an empty list. jsdom has
 * no layout, so there is no honest answer to "is this in the viewport" — and of
 * the two available lies, "yes" is the one that exercises the code.
 */
class IntersectingObserver {
  constructor(private readonly callback: IntersectionObserverCallback) {}
  observe(target: Element) {
    queueMicrotask(() =>
      this.callback(
        [{ isIntersecting: true, target } as unknown as IntersectionObserverEntry],
        this as unknown as IntersectionObserver,
      ),
    )
  }
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return []
  }
}

if (typeof window.ResizeObserver === 'undefined') {
  window.ResizeObserver = StubObserver as unknown as typeof ResizeObserver
}
if (typeof window.IntersectionObserver === 'undefined') {
  window.IntersectionObserver = IntersectingObserver as unknown as typeof IntersectionObserver
}
if (typeof URL.createObjectURL === 'undefined') {
  URL.createObjectURL = () => 'blob:stub'
  URL.revokeObjectURL = () => {}
}
