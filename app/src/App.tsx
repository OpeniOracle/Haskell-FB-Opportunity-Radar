import type { ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AppShell } from '@/components/AppShell'
import { DataSourceProvider } from '@/data/DataSourceContext'
import { parseScenario } from '@/data/fixtureDataSource'
import {
  LEGACY_OPPORTUNITY_PARAM,
  opportunityDetailPath,
} from '@/lib/opportunityFilters'
import { RESERVED_DESTINATIONS, SURFACES } from '@/routes'
import { CompanyDetail } from '@/surfaces/CompanyDetail'
import { CompanyList } from '@/surfaces/CompanyList'
import { EvidenceDetail } from '@/surfaces/EvidenceDetail'
import { FacilityDetail } from '@/surfaces/FacilityDetail'
import { Opportunities } from '@/surfaces/Opportunities'
import { OpportunityDetailPage } from '@/surfaces/OpportunityDetailPage'
import { NotFound, ReservedPlaceholder, SurfacePlaceholder } from '@/surfaces/Placeholder'
import { Pulse } from '@/surfaces/Pulse'
import { SavedViews } from '@/surfaces/SavedViews'
import { SourceHealth } from '@/surfaces/SourceHealth'

/**
 * Routes with a built surface.
 *
 * All seven Phase 1 surfaces are now built, so the placeholder fallback below is
 * unreachable in practice. It stays as the failure mode for a route registered
 * in `routes.ts` before its component exists: a scheduled surface should say so,
 * not 404.
 */
const BUILT: Record<string, ReactNode> = {
  '/': <Pulse />,
  '/opportunities': <OpportunitiesRoute />,
  '/opportunities/:opportunityId': <OpportunityDetailPage />,
  '/accounts': <CompanyList />,
  '/accounts/:accountId': <CompanyDetail />,
  '/facilities/:facilityId': <FacilityDetail />,
  '/evidence/:evidenceId': <EvidenceDetail />,
  '/admin/health': <SourceHealth />,
  '/views': <SavedViews />,
}

/**
 * Route table.
 *
 * Every route of every Phase 1 surface is registered, built or not, plus the
 * three reserved destinations — so the shape of the product is visible in the
 * running preview rather than only in a plan.
 *
 * The inventory itself lives in `routes.ts` and follows
 * `15_PHASE_1_IMPLEMENTATION_PLAN.md` §11.2 and §11.4: seven surfaces across five
 * primary navigation entries and two contextual routes, with Market Trends, Map
 * and Briefings reserved rather than counted.
 */
export function App() {
  const { search } = useLocation()
  const scenario = parseScenario(search)

  return (
    <DataSourceProvider scenario={scenario}>
      <Routes>
        <Route element={<AppShell />}>
          {SURFACES.flatMap((surface) =>
            surface.routes.map((path) => (
              <Route
                key={path}
                path={path}
                element={BUILT[path] ?? <SurfacePlaceholder surface={surface} />}
              />
            )),
          )}

          {RESERVED_DESTINATIONS.map((destination) => (
            <Route
              key={destination.path}
              path={destination.path}
              element={<ReservedPlaceholder destination={destination} />}
            />
          ))}

          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </DataSourceProvider>
  )
}

/**
 * Legacy drawer link.
 *
 * The first milestone addressed an opportunity as `/opportunities?opportunity=x`,
 * which reopened the drawer. `10_DESIGN_RESPONSE.md` §5.3 requires a shared link
 * to resolve to the full page, so any such address still in circulation lands
 * there instead. `replace` keeps the dead address out of history, so Back does
 * not bounce the user through it.
 */
function OpportunitiesRoute() {
  const { search } = useLocation()
  const legacyId = new URLSearchParams(search).get(LEGACY_OPPORTUNITY_PARAM)

  if (legacyId) {
    return <Navigate to={opportunityDetailPath(legacyId, search)} replace />
  }
  return <Opportunities />
}
