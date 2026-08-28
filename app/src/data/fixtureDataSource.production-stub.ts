/**
 * What `@/data/fixtureDataSource` resolves to in a PRODUCTION build.
 *
 * The dynamic import in `DataSourceContext` is guarded by a build-time
 * constant, so production never executes it — but Vite still emitted the real
 * module as a separate chunk, which meant the illustrative corpus was sitting
 * in `dist/` waiting for anyone who requested the file. "Unreachable by the
 * application" is not the same as "not deployed".
 *
 * Aliasing the module away at build time makes the guarantee absolute: the
 * production output contains this file instead, and there is no fabricated
 * record anywhere in it to serve.
 */
import type { DataSource } from '@/data/DataSource'

export type FixtureScenario = never

export function isFixtureScenario(_value: string | null): _value is FixtureScenario {
  return false
}

export function parseScenario(_search: string): 'ready' {
  return 'ready'
}

export function createFixtureDataSource(): DataSource {
  throw new Error(
    'The fixture data source is not part of a production build. This is the stub that replaces it.',
  )
}
