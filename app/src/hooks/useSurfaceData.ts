import { useEffect, useState } from 'react'
import type { SurfaceState } from '@/types/domain'

/**
 * Load one surface's data and hold its `SurfaceState`.
 *
 * The state starts as `loading` and is replaced by whatever the DataSource
 * returns. There is no separate `error` boolean: a failure is expressed as the
 * `unavailable` member of the union, so a surface cannot render a happy path by
 * forgetting to check a flag.
 */
export function useSurfaceData<T>(
  load: () => Promise<SurfaceState<T>>,
  deps: readonly unknown[],
): SurfaceState<T> {
  const [state, setState] = useState<SurfaceState<T>>({ kind: 'loading' })

  useEffect(() => {
    let active = true
    setState({ kind: 'loading' })

    load()
      .then((next) => {
        if (active) setState(next)
      })
      .catch((error: unknown) => {
        if (!active) return
        setState({
          kind: 'unavailable',
          reason:
            'This surface could not be loaded. The failure has been surfaced rather than shown as an empty result.',
          blockedBy: error instanceof Error ? error.message : 'Unknown error',
        })
      })

    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return state
}
