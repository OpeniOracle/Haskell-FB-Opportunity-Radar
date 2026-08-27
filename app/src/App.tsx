import type { ReactNode } from 'react'
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { AppShell } from '@/components/AppShell'
import { AuthProvider } from '@/auth/AuthProvider'
import { CallbackPage } from '@/auth/CallbackPage'
import { ForgotPasswordPage } from '@/auth/ForgotPasswordPage'
import { LoginPage } from '@/auth/LoginPage'
import { RequireAuth } from '@/auth/RequireAuth'
import { SetPasswordPage } from '@/auth/SetPasswordPage'
import type { AuthPort } from '@/auth/authPort'
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
 * The five addresses a signed-out visitor may reach.
 *
 * Listed here as data, not only as JSX, because two other places need to agree
 * with it: `returnPath.ts` refuses to send anyone back to one of these after
 * signing in, and `authGate.test.tsx` asserts that every OTHER route in the
 * application is behind the gate. A route added to one and forgotten in the
 * others is exactly how a surface ends up public.
 */
export const PUBLIC_AUTH_ROUTES = [
  '/login',
  '/auth/callback',
  '/auth/set-password',
  '/forgot-password',
  '/auth/reset-password',
] as const

/**
 * Route table.
 *
 * TWO HALVES, and the split is the security boundary.
 *
 * The public half is the five authentication routes above. Everything else —
 * every surface, every reserved placeholder, the 404, and the preview
 * surface-state controls that live inside the surfaces — sits inside
 * `RequireAuth`, which renders NOTHING until the session question is answered.
 * The catch-all `*` is inside the gate on purpose: a signed-out visitor typing
 * a wrong address gets the sign-in page, not a 404 page wearing the
 * application's navigation.
 *
 * `DataSourceProvider` is also inside the gate. It is the fixture data source,
 * and constructing it outside would mean the data existed in the page before
 * anyone had established a right to it, even if nothing rendered it.
 */
export function App({ authPort }: { authPort?: AuthPort } = {}) {
  return (
    <AuthProvider port={authPort}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/auth/callback" element={<CallbackPage />} />
        <Route path="/auth/set-password" element={<SetPasswordPage mode="invitation" />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/auth/reset-password" element={<SetPasswordPage mode="recovery" />} />

        <Route element={<RequireAuth />}>
          <Route element={<ProtectedApplication />}>
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
          </Route>
        </Route>
      </Routes>
    </AuthProvider>
  )
}

/**
 * The fixture data source, scoped to authenticated routes.
 *
 * A layout route rather than a wrapper around `<Routes>`, so `useLocation` here
 * reads the matched application address and the scenario parameter keeps
 * working exactly as before.
 */
function ProtectedApplication() {
  const { search } = useLocation()
  const scenario = parseScenario(search)
  return (
    <DataSourceProvider scenario={scenario}>
      <Outlet />
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
