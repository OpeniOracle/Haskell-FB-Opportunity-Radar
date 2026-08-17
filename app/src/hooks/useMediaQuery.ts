import { useEffect, useState } from 'react'

/**
 * Subscribe to a media query.
 *
 * Used so the shell renders EITHER the side rail or the bottom bar, never both.
 * Rendering both and hiding one with CSS would put two `Primary` navigation
 * landmarks in the accessibility tree, and `display: none` is not a reliable way
 * to keep the hidden one out of every assistive technology.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false
    return window.matchMedia(query).matches
  })

  useEffect(() => {
    if (!window.matchMedia) return
    const list = window.matchMedia(query)
    const onChange = () => setMatches(list.matches)
    setMatches(list.matches)

    // `addListener` is the deprecated form, still needed by older Safari.
    if (list.addEventListener) list.addEventListener('change', onChange)
    else list.addListener(onChange)

    return () => {
      if (list.removeEventListener) list.removeEventListener('change', onChange)
      else list.removeListener(onChange)
    }
  }, [query])

  return matches
}

/** The single breakpoint the shell switches on. */
export const NARROW_QUERY = '(max-width: 900px)'
