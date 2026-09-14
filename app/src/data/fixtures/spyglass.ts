import type { SpyglassSnapshot } from '@/types/domain'

/**
 * Illustrative Spyglass configuration, for the development preview only.
 *
 * The dashboard link is the real configured default, because it is a link and
 * not data. The widgets are NOT real embeds — the ids are fictional and the
 * frames will not load, which is deliberate: the preview is where the fallback
 * state should be visible, and a fallback nobody ever sees is a fallback nobody
 * has checked.
 *
 * `viewerIsAdministrator` is true here so the editing control can be reviewed
 * without an administrator row. It has no authority: the row-level policy in
 * migration 0024 decides what a write may do, and this only decides what is
 * rendered.
 */
export const spyglassFixture: SpyglassSnapshot = {
  settings: {
    dashboardUrl: 'https://zign.al/urgnr9l3',
    dashboardLabel: 'Openi Spyglass',
    updatedAt: '2026-08-17T06:15:00Z',
  },
  widgets: [
    {
      id: 'widget-fixture-1',
      title: 'Total mentions',
      embedUrl: 'https://embeddable-widgets.zignallabs.com/000000000000000000000001?theme=Light',
      enabled: true,
      displayOrder: 10,
      snapshotGeneratedAt: '2026-08-14T09:00:00Z',
      theme: 'auto',
      fallbackUrl: 'https://zign.al/urgnr9l3',
    },
    {
      id: 'widget-fixture-2',
      title: 'Net sentiment',
      embedUrl: 'https://embeddable-widgets.zignallabs.com/000000000000000000000002?theme=Light',
      enabled: true,
      displayOrder: 20,
      snapshotGeneratedAt: '2026-08-14T09:00:00Z',
      theme: 'auto',
      fallbackUrl: 'https://zign.al/urgnr9l3',
    },
    {
      id: 'widget-fixture-3',
      title: 'Top stories by MQS',
      embedUrl: 'https://embeddable-widgets.zignallabs.com/000000000000000000000003?theme=Light',
      enabled: true,
      displayOrder: 30,
      snapshotGeneratedAt: '2026-08-14T09:00:00Z',
      theme: 'auto',
      fallbackUrl: 'https://zign.al/urgnr9l3',
    },
  ],
  viewerIsAdministrator: true,
  generatedAt: '2026-08-17T06:15:00Z',
}
