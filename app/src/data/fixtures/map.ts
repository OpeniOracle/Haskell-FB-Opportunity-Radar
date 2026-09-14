import type { MapSnapshot } from '@/types/domain'

/**
 * Illustrative map locations, for the development preview only.
 *
 * Every company, site and coordinate here is FICTIONAL. The coordinates are
 * real points in the United States because a map needs somewhere to draw, but
 * nothing in this file describes a real organization or a real project, and
 * none of it ships: `fixtureDataSource.production-stub.ts` replaces this module
 * in a production build.
 *
 * The set is chosen to exercise the four marker types and the unlocated panel,
 * because those are the distinctions the surface exists to make and a preview
 * that only shows confirmed sites demonstrates nothing.
 */
export const mapFixture: MapSnapshot = {
  markers: [
    {
      id: 'map-1',
      locationType: 'confirmed_project_site',
      precision: 'address',
      latitude: 41.878,
      longitude: -87.63,
      uncertaintyRadiusMetres: null,
      label: 'Example Snack Foods bakery',
      extractedText: '1400 West Industrial Drive, Chicago, Illinois',
      normalizedAddress: '1400 W Industrial Dr, Chicago, IL, USA',
      organizationId: 'org-fixture-1',
      organizationName: 'Example Snack Foods, Inc.',
      opportunity: {
        id: 'opp-fixture-1',
        title: 'Facility construction — bakery',
        opportunityType: 'Facility construction',
        stage: 'developing',
        confidenceLevel: 'moderate',
        filingDate: '2026-08-04T00:00:00Z',
        documentType: '8-K',
        publisher: 'Example Snack Foods, Inc.',
        excerpt:
          'The company will build a new bakery at 1400 West Industrial Drive, Chicago, Illinois, representing an investment of $180 million.',
        officialUrl: 'https://example.invalid/filings/8-k-2026-08-04',
      },
      resolvedAt: '2026-08-16T09:00:00Z',
    },
    {
      id: 'map-2',
      locationType: 'approximate_project_area',
      precision: 'locality',
      latitude: 36.181,
      longitude: -94.161,
      uncertaintyRadiusMetres: 8000,
      label: 'Springdale, Arkansas',
      extractedText: 'Springdale, Arkansas',
      normalizedAddress: 'Springdale, AR, USA',
      organizationId: 'org-fixture-2',
      organizationName: 'Example Protein Company',
      opportunity: {
        id: 'opp-fixture-2',
        title: 'Facility expansion — processing facility',
        opportunityType: 'Facility expansion',
        stage: 'emerging',
        confidenceLevel: 'low',
        filingDate: '2026-07-22T00:00:00Z',
        documentType: '10-Q',
        publisher: 'Example Protein Company',
        excerpt:
          'Work is under way to expand the processing facility in Springdale, Arkansas during the coming year.',
        officialUrl: 'https://example.invalid/filings/10-q-2026-07-22',
      },
      resolvedAt: '2026-08-16T09:00:00Z',
    },
    {
      id: 'map-3',
      locationType: 'corporate_headquarters',
      precision: 'address',
      latitude: 41.04,
      longitude: -73.715,
      uncertaintyRadiusMetres: null,
      label: 'Example Snack Foods corporate headquarters',
      extractedText: null,
      normalizedAddress: '1 Example Plaza, Purchase, NY, USA',
      organizationId: 'org-fixture-1',
      organizationName: 'Example Snack Foods, Inc.',
      /* Null, and it must stay null. A headquarters carries no opportunity. */
      opportunity: null,
      resolvedAt: '2026-08-16T09:00:00Z',
    },
    {
      id: 'map-4',
      locationType: 'known_company_facility',
      precision: 'locality',
      latitude: 39.768,
      longitude: -86.158,
      uncertaintyRadiusMetres: 8000,
      label: 'Example Protein Indianapolis plant',
      extractedText: null,
      normalizedAddress: 'Indianapolis, IN, USA',
      organizationId: 'org-fixture-2',
      organizationName: 'Example Protein Company',
      opportunity: null,
      resolvedAt: '2026-08-16T09:00:00Z',
    },
  ],
  unlocated: [
    {
      id: 'opp-fixture-3',
      title: 'Capacity change — production line',
      organizationName: 'Example Confectionery Group',
      reason: 'The filing did not name a site, a city or a state for this project.',
    },
  ],
  generatedAt: '2026-08-17T06:15:00Z',
}
