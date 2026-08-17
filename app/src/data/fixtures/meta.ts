import type { DataSourceMeta } from '@/types/domain'

/**
 * Provenance declaration for everything PR 1 renders.
 *
 * This object is the single source of truth behind the persistent "Illustrative
 * Data" marker. It is deliberately not a boolean literal scattered through the
 * components: when PR 9 introduces the API-backed DataSource, `illustrative`
 * becomes false in one place and every marker disappears together.
 */
export const fixtureMeta: DataSourceMeta = {
  mode: 'fixture',
  illustrative: true,
  description:
    'All content is fabricated fixture data created to demonstrate the interface. No real company, project, evidence, or account activity is shown.',
}
