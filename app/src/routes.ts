import type { IconName } from '@/components/Icon'

/**
 * The authoritative Phase 1 surface inventory.
 *
 * Source of truth: `docs/design/15_PHASE_1_IMPLEMENTATION_PLAN.md` §11.2 and
 * §11.4, cross-checked against `10_DESIGN_RESPONSE.md` §5.2.
 *
 *   Seven surfaces = five primary navigation entries + two contextual surfaces.
 *
 * The model here is SURFACE-oriented, not route-oriented, because that is the
 * distinction the plan draws and the one the previous inventory got wrong. A
 * surface may own more than one route: Opportunities owns `/opportunities` and
 * `/opportunities/:id`, Company owns `/accounts` and `/accounts/:id`. Those
 * detail routes are part of their parent surface — counting them as separate
 * surfaces is what produced a seven that contained the wrong seven things.
 *
 * Market Trends, Map and Briefings are NOT Phase 1 surfaces. §11.4: all three
 * depend on signals, opportunities or alerting, and "the navigation reserves
 * their positions and renders them as explicitly unavailable rather than hiding
 * them, so the eventual shape is visible from the first preview." They are
 * modelled separately, as reserved destinations, so they can never be counted
 * among the seven again.
 */

export type SurfaceStatus =
  /** Shipped and rendering fixtures. */
  | 'implemented'
  /** A Phase 1 surface whose fixture-backed build is roadmap PR 2. */
  | 'pr2'

export interface SurfaceDescriptor {
  id: string
  label: string
  shortLabel: string
  icon: IconName
  placement: 'primary' | 'contextual'
  /** Every route this surface owns. The first is the one navigation targets. */
  routes: string[]
  status: SurfaceStatus
  summary: string
  /** What the surface will do once built. Shown on the PR 2 placeholders. */
  scheduled: string[]
}

export const SURFACES: SurfaceDescriptor[] = [
  {
    id: 'pulse',
    label: 'Daily Pulse',
    shortLabel: 'Pulse',
    icon: 'pulse',
    placement: 'primary',
    routes: ['/'],
    status: 'implemented',
    summary: 'What changed across the monitored accounts since your last visit.',
    scheduled: [],
  },
  {
    id: 'opportunities',
    label: 'Opportunities',
    shortLabel: 'Opportunities',
    icon: 'target',
    placement: 'primary',
    routes: ['/opportunities', '/opportunities/:opportunityId'],
    status: 'implemented',
    summary: 'Every live opportunity, ranked, with the reasoning behind each score.',
    scheduled: [],
  },
  {
    id: 'company',
    label: 'Company',
    shortLabel: 'Company',
    icon: 'building',
    placement: 'primary',
    routes: ['/accounts', '/accounts/:accountId'],
    status: 'pr2',
    summary:
      'Account summary, related entities, facility list, timeline, and coverage status.',
    scheduled: [
      'Account list with per-account coverage against expected sources',
      'Time-bounded ownership shown with half-open intervals and as-at-date attribution',
      'Provisional scope classification rendered as provisional and excluded from relevance metrics',
      'Facility roll-up reached from the account, and the no-facilities-resolved state',
    ],
  },
  {
    id: 'facility',
    label: 'Facility',
    shortLabel: 'Facility',
    icon: 'pin',
    placement: 'contextual',
    routes: ['/facilities/:facilityId'],
    status: 'pr2',
    summary: 'One site: operating status, identifiers, evidence timeline, operator as at a date.',
    scheduled: [
      'Facility detail with operating status and identifiers',
      'Operator attribution as at a chosen date',
      'Candidate facilities shown as visually distinct from confirmed ones',
    ],
  },
  {
    id: 'evidence',
    label: 'Evidence detail',
    shortLabel: 'Evidence',
    icon: 'document',
    placement: 'contextual',
    routes: ['/evidence/:evidenceId'],
    status: 'pr2',
    summary:
      'One piece of evidence: source, timing, excerpt, locator, access mode, and corrections.',
    scheduled: [
      'Source, retrieval time, publication time, excerpt and locator',
      'Temporal value rendered at its recorded precision and basis',
      'Correction relationships shown as supersession, never as an overwrite',
      'Access mode recorded and displayed',
    ],
  },
  {
    id: 'health',
    label: 'Source Health & Coverage',
    shortLabel: 'Health',
    icon: 'settings',
    placement: 'primary',
    routes: ['/admin/health'],
    status: 'pr2',
    summary:
      'Two panels that are never merged: connector health, and expected coverage per account.',
    scheduled: [
      'Per-source run history with failures kept visible rather than overwritten',
      'Expected coverage per account, named rather than only counted',
      'An account with every connector healthy but no expected coverage reported as uncovered, not quiet',
    ],
  },
  {
    id: 'views',
    label: 'Saved Pursuits & Watches',
    shortLabel: 'Saved',
    icon: 'inbox',
    placement: 'primary',
    routes: ['/views'],
    status: 'pr2',
    summary: 'Saved views, watch list, and action affordances.',
    scheduled: [
      'Saved views and watch list mechanics',
      'Action affordances consistent with the local previews on Opportunities',
      'Empty of opportunities, because none exist yet in Phase 1',
    ],
  },
]

/**
 * Navigation positions reserved for later phases.
 *
 * These are not surfaces and must never be counted among the seven. They are
 * rendered so the eventual shape of the product is visible from the first
 * preview, and they say plainly that they are not part of Phase 1.
 */
export interface ReservedDestination {
  id: string
  label: string
  shortLabel: string
  icon: IconName
  path: string
  /** Why it cannot be built in Phase 1. */
  dependsOn: string
}

export const RESERVED_DESTINATIONS: ReservedDestination[] = [
  {
    id: 'trends',
    label: 'Market Trends',
    shortLabel: 'Trends',
    icon: 'trend',
    path: '/trends',
    dependsOn: 'signals and corroborated cross-account patterns',
  },
  {
    id: 'map',
    label: 'Map',
    shortLabel: 'Map',
    icon: 'pin',
    path: '/map',
    dependsOn: 'resolved facilities and opportunities to place on it',
  },
  {
    id: 'briefings',
    label: 'Briefings',
    shortLabel: 'Briefings',
    icon: 'document',
    path: '/briefings',
    dependsOn: 'opportunities and an alerting decision',
  },
]

export const PRIMARY_SURFACES = SURFACES.filter((s) => s.placement === 'primary')
export const CONTEXTUAL_SURFACES = SURFACES.filter((s) => s.placement === 'contextual')

/** Every route the application registers, surface routes first. */
export const ALL_SURFACE_ROUTES = SURFACES.flatMap((s) => s.routes)

export function surfaceForRoute(path: string): SurfaceDescriptor | undefined {
  return SURFACES.find((s) => s.routes.includes(path))
}
