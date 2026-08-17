import type { IconName } from '@/components/Icon'

/**
 * The route inventory.
 *
 * Seven surfaces across five primary navigation entries plus two contextual
 * routes, matching §3 of `docs/design/15_PHASE_1_IMPLEMENTATION_PLAN.md`.
 * Contextual routes are reached from a card or a row, not from the nav rail —
 * they are not orphaned, they simply have a parent.
 *
 * `implemented` marks what PR 1 actually ships. Everything else renders a
 * placeholder that names the milestone it belongs to, so no reviewer has to guess
 * whether a screen is missing or merely later.
 */
export interface RouteDescriptor {
  path: string
  label: string
  shortLabel: string
  icon: IconName
  /** Primary = in the nav rail. Contextual = reached from within a surface. */
  placement: 'primary' | 'contextual'
  implemented: boolean
  summary: string
  /** What the surface will do once built. Shown on placeholders. */
  scheduled: string[]
  milestone: string
}

export const ROUTES: RouteDescriptor[] = [
  {
    path: '/',
    label: 'Daily Pulse',
    shortLabel: 'Pulse',
    icon: 'pulse',
    placement: 'primary',
    implemented: true,
    summary: 'What changed across the monitored accounts since your last visit.',
    scheduled: [],
    milestone: 'PR 1',
  },
  {
    path: '/opportunities',
    label: 'Opportunities',
    shortLabel: 'Opportunities',
    icon: 'target',
    placement: 'primary',
    implemented: true,
    summary: 'Every live opportunity, ranked, with the reasoning on the card.',
    scheduled: [],
    milestone: 'PR 1',
  },
  {
    path: '/accounts',
    label: 'Accounts',
    shortLabel: 'Accounts',
    icon: 'building',
    placement: 'primary',
    implemented: false,
    summary: 'The 15 pilot accounts, their coverage, and their open opportunities.',
    scheduled: [
      'Account list with per-account coverage against expected sources',
      'Ownership and operator relationships shown as at a chosen date',
      'Tier and engagement state, seeded from the roadmap identities',
    ],
    milestone: 'a later Phase 1 milestone',
  },
  {
    path: '/trends',
    label: 'Trends',
    shortLabel: 'Trends',
    icon: 'trend',
    placement: 'primary',
    implemented: false,
    summary: 'Corroborated patterns across accounts, separated from single projects.',
    scheduled: [
      'Trend records with their supporting signals listed, not summarised away',
      'Explicit separation of a trend from the opportunities that evidence it',
    ],
    milestone: 'a later Phase 1 milestone',
  },
  {
    path: '/operations',
    label: 'Operations',
    shortLabel: 'Ops',
    icon: 'settings',
    placement: 'primary',
    implemented: false,
    summary: 'Connector health, run history, and coverage gaps — for the operator.',
    scheduled: [
      'Per-source run history with failures kept visible, not overwritten',
      'Coverage gaps named by account, held separate from connector health',
      'Controlled connector-maintenance tasks, never routine data entry',
    ],
    milestone: 'a later Phase 1 milestone',
  },
  {
    path: '/opportunities/:opportunityId',
    label: 'Opportunity detail',
    shortLabel: 'Opportunity detail',
    icon: 'document',
    placement: 'contextual',
    implemented: false,
    summary: 'One opportunity with its full evidence chain and correction history.',
    scheduled: [
      'Every piece of supporting evidence, with access mode and retrieval time',
      'Correction history shown as supersession, never as an overwrite',
      'The three confidence axes with the guardrail that produced them',
    ],
    milestone: 'a later Phase 1 milestone',
  },
  {
    path: '/accounts/:accountId',
    label: 'Account detail',
    shortLabel: 'Account detail',
    icon: 'building',
    placement: 'contextual',
    implemented: false,
    summary: 'One account: timeline, facilities, coverage, and open opportunities.',
    scheduled: [
      'Time-bounded ownership shown with half-open intervals',
      'Facility roll-up with operator attribution as at a chosen date',
      'Source expectations against actual coverage',
    ],
    milestone: 'a later Phase 1 milestone',
  },
]

export const PRIMARY_ROUTES = ROUTES.filter((r) => r.placement === 'primary')
export const CONTEXTUAL_ROUTES = ROUTES.filter((r) => r.placement === 'contextual')
