import { Route, Routes, useLocation } from 'react-router-dom'
import { AppShell } from '@/components/AppShell'
import { DataSourceProvider } from '@/data/DataSourceContext'
import { parseScenario } from '@/data/fixtureDataSource'
import { ROUTES } from '@/routes'
import { Opportunities } from '@/surfaces/Opportunities'
import { NotFound, Placeholder } from '@/surfaces/Placeholder'
import { Pulse } from '@/surfaces/Pulse'

const SURFACES: Record<string, React.ReactNode> = {
  '/': <Pulse />,
  '/opportunities': <Opportunities />,
}

/**
 * Route table.
 *
 * Every route in `routes.ts` is registered, implemented or not, so the shape of
 * the application is visible in the running preview rather than only in a plan.
 * The scenario is read from the query string here, at the provider, so the
 * surfaces never learn that scenarios exist.
 */
export function App() {
  const { search } = useLocation()
  const scenario = parseScenario(search)

  return (
    <DataSourceProvider scenario={scenario}>
      <Routes>
        <Route element={<AppShell />}>
          {ROUTES.map((route) => (
            <Route
              key={route.path}
              path={route.path}
              element={SURFACES[route.path] ?? <Placeholder route={route} />}
            />
          ))}
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </DataSourceProvider>
  )
}
