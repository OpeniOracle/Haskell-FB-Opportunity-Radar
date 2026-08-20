import type { SavedWorkspace } from '@/types/domain'

/**
 * ILLUSTRATIVE FIXTURE DATA — NOT REAL INTELLIGENCE.
 *
 * Saved views and watches are **local preview mechanics only**. There is no
 * persistence layer in Phase 1, so nothing here is written anywhere — renaming
 * or removing an item lasts as long as the tab does, and the surface says so.
 *
 * D8 (ownership of tier changes and overrides) is **Open**, so no ownership,
 * collaboration, assignment or approval semantics are modelled: a view has no
 * owner, no sharing state and no approver.
 */
export const savedWorkspaceFixture: SavedWorkspace = {
  views: [
    {
      id: 'view-1',
      name: 'Confirmed, Southeast',
      surface: 'opportunities',
      filterSummary: ['Stage: Confirmed', 'Geography: GA', 'Sort: Priority score'],
      resultCount: 1,
      createdAt: '2026-08-12T11:00:00Z',
    },
    {
      id: 'view-2',
      name: 'Process systems pipeline',
      surface: 'opportunities',
      filterSummary: ['Capability: Process systems', 'Sort: Newest evidence'],
      resultCount: 2,
      createdAt: '2026-08-14T08:30:00Z',
    },
    {
      id: 'view-3',
      name: 'Under-covered accounts',
      surface: 'accounts',
      filterSummary: ['Coverage: Below expected'],
      resultCount: 4,
      createdAt: '2026-08-16T07:45:00Z',
    },
  ],
  watches: [
    {
      id: 'watch-1',
      kind: 'company',
      targetId: 'org-fixture-2',
      label: 'Example Meals & Sauces Co.',
      context: 'Ownership changed twice; a minority interest is still retained.',
      addedAt: '2026-08-13T09:15:00Z',
    },
    {
      id: 'watch-2',
      kind: 'facility',
      targetId: 'fac-fixture-2',
      label: 'Proposed site — county parcel filing',
      context: 'Candidate facility awaiting corroboration.',
      addedAt: '2026-08-14T16:20:00Z',
    },
    {
      id: 'watch-3',
      kind: 'opportunity',
      targetId: 'opp-fixture-1',
      label: 'Aseptic filling line and warehouse automation at Southeast plant',
      context: 'Highest-scoring open opportunity.',
      addedAt: '2026-08-16T10:05:00Z',
    },
  ],
}
