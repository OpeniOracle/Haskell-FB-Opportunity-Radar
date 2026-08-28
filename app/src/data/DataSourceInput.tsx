import { createContext } from 'react'
import type { DataSource } from '@/data/DataSource'

/**
 * The one way a data source can be supplied from outside the application.
 *
 * It exists so that tests can render real surfaces against fixtures without
 * the application itself holding a reference to them. A function form is
 * accepted so a test can honour `?state=` and exercise the empty, degraded and
 * stale renderings that the preview parameter was built for.
 *
 * Nothing in `src/` outside a test passes this. `boundaries.test.ts` asserts
 * that, and it is what makes the production provider unconditional rather than
 * merely usually correct.
 */
export type DataSourceInput = DataSource | ((scenario: string | undefined) => DataSource) | undefined

export const DataSourceInputContext = createContext<DataSourceInput>(undefined)
