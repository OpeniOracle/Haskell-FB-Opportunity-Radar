import { createContext, useContext, useMemo, type ReactNode } from 'react'
import type { DataSource } from '@/data/DataSource'
import { createFixtureDataSource, type FixtureScenario } from '@/data/fixtureDataSource'

/**
 * Dependency injection for the data seam.
 *
 * Surfaces call `useDataSource()` and never construct a source themselves. That
 * is what makes PR 9's swap a one-line change at the provider and what lets tests
 * render a surface against any scenario without touching a component.
 */
const DataSourceContext = createContext<DataSource | null>(null)

interface ProviderProps {
  children: ReactNode
  /** Injected directly in tests; the app passes a scenario instead. */
  source?: DataSource
  scenario?: FixtureScenario
}

export function DataSourceProvider({ children, source, scenario = 'ready' }: ProviderProps) {
  const value = useMemo(
    () => source ?? createFixtureDataSource(scenario),
    [source, scenario],
  )
  return <DataSourceContext.Provider value={value}>{children}</DataSourceContext.Provider>
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
