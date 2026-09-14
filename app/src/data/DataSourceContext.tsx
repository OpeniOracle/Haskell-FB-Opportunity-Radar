import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { DataSource } from '@/data/DataSource'
import { createApiDataSource } from '@/data/apiDataSource'

/**
 * Dependency injection for the data seam — and the boundary that keeps
 * illustrative records out of a production session.
 *
 * PRODUCTION HAS ONE PROVIDER AND NO FALLBACK. `createApiDataSource` is the
 * only thing this module imports statically. The fixture provider is reached
 * by a dynamic import that is unreachable unless the build says it is a
 * development build, so a production bundle has no path to it — this is a
 * structural exclusion, not a runtime `if` that a later edit could invert.
 * `boundaries.test.ts` asserts the absence, and a CI step scans the built
 * bundle for known fixture payloads.
 *
 * WHY NOT A RUNTIME FLAG. A flag means the fixture code SHIPS, and shipping it
 * means one mistake — a stray query parameter, an inverted condition, a
 * misconfigured environment variable — puts invented projects in front of a
 * business-development team with a real record's confidence. The strongest
 * version of "production never shows fixtures" is that production does not
 * contain them.
 *
 * THE PREVIEW SCENARIOS ARE A DEVELOPMENT TOOL. `?state=empty` exists so a
 * designer can see the empty state without emptying a database. In any build
 * that is not development it does nothing at all: the parameter is read, found
 * to be inapplicable, and ignored.
 */
const DataSourceContext = createContext<DataSource | null>(null)

/** True only for a local development build. Vite inlines this at build time. */
export const FIXTURES_AVAILABLE = import.meta.env.DEV === true

interface ProviderProps {
  children: ReactNode
  /** Injected directly in tests. The only supported way to supply a fake. */
  source?: DataSource
  /** Honoured in development builds only; ignored everywhere else. */
  scenario?: string
}

export function DataSourceProvider({ children, source, scenario }: ProviderProps) {
  const live = useMemo(() => createApiDataSource(), [])

  /*
    AN INJECTED SOURCE IS USED DIRECTLY, WITH NO STATE IN BETWEEN.

    The first version ran everything through `useState` + `useEffect`, including
    the injected case, so a test's data source arrived one render late and any
    change of identity restarted the cycle. Only the DEVELOPMENT fixture path
    genuinely needs an effect, because only it awaits a dynamic import.
  */
  const [devFixtures, setDevFixtures] = useState<DataSource | null>(null)

  useEffect(() => {
    if (source || !FIXTURES_AVAILABLE || !scenario) {
      setDevFixtures(null)
      return
    }
    let cancelled = false
    // Dynamic, and guarded by a build-time constant, so the production bundle
    // contains no reference to this module at all.
    void import('@/data/fixtureDataSource')
      .then(({ createFixtureDataSource, isFixtureScenario }) => {
        if (cancelled) return
        setDevFixtures(isFixtureScenario(scenario) ? createFixtureDataSource(scenario) : null)
      })
      .catch(() => {
        if (!cancelled) setDevFixtures(null)
      })
    return () => {
      cancelled = true
    }
  }, [source, scenario])

  const resolved = source ?? devFixtures ?? live

  return <DataSourceContext.Provider value={resolved}>{children}</DataSourceContext.Provider>
}

// The provider and its hook are colocated deliberately — splitting them across
// two files to satisfy fast refresh would separate the context from its only
// legitimate accessor. The cost is losing HMR for this one module.
// eslint-disable-next-line react-refresh/only-export-components
export function useDataSource(): DataSource {
  const value = useContext(DataSourceContext)
  if (!value) {
    throw new Error('useDataSource must be used inside a <DataSourceProvider>.')
  }
  return value
}
