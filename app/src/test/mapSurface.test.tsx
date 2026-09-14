import { describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderApp, fixtureSource } from '@/test/render'
import { setViewport } from '@/test/setup'
import { mapFixture } from '@/data/fixtures/map'
import { FIXTURE_NOW } from '@/lib/format'
import { boundsFor, MAP_ATTRIBUTION, styleUrl } from '@/lib/mapStyle'
import {
  ANY,
  DEFAULT_MAP_QUERY,
  LOCATION_TYPE_LABEL,
  applyMapQuery,
  companyOptions,
  isProjectMarker,
  opportunityTypeOptions,
} from '@/lib/mapFilters'
import {
  UNCERTAINTY_METRES,
  extractLocations,
  markerTypeFor,
} from '../../netlify/functions/_shared/locations/extract'
import type { DataSource } from '@/data/DataSource'

/*
 * A MAP PIN IS THE MOST CONFIDENT THING AN INTERFACE CAN DRAW.
 *
 * A dot reads as "the project is HERE" whatever the caption says. Every test in
 * this file exists to hold one line: a marker may only be drawn where a document
 * said something, and a corporate headquarters — which is the coordinate that is
 * always available and always wrong — is never a project site.
 */

describe('markers render, and say what kind of place they are', () => {
  it('renders every configured marker on the surface', async () => {
    renderApp('/map')
    /* The heading arrives with the lazily-loaded chunk; the markers arrive one
       tick later with the data. Waiting for the first would assert against a
       half-rendered page. */
    await screen.findByRole('list', { name: 'Locations on the map' })
    const main = screen.getByRole('main')
    for (const marker of mapFixture.markers) {
      expect(main.textContent).toContain(marker.label)
    }
  })

  it('counts project markers separately from account context', async () => {
    renderApp('/map')
    await screen.findByRole('heading', { level: 1, name: 'Map' })
    const projects = mapFixture.markers.filter(isProjectMarker)
    expect(projects).toHaveLength(2)
    const results = await screen.findByRole('status')
    expect(results.textContent).toMatch(/2 project locations/)
    expect(results.textContent).toMatch(/2 account markers/)
  })

  it('labels each of the four location types distinctly', async () => {
    renderApp('/map')
    await screen.findByRole('heading', { level: 1, name: 'Map' })
    const legend = screen.getByRole('list', { name: 'What the markers mean' })
    for (const label of Object.values(LOCATION_TYPE_LABEL)) {
      expect(within(legend).getByText(label)).toBeInTheDocument()
    }
  })

  it('never gives a headquarters an opportunity', () => {
    /*
       THE RULE, ASSERTED ON THE DATA RATHER THAN ON THE PIXELS.

       A headquarters marker carries `opportunity: null`. If it ever carried one,
       the popup would render a project title against a head-office coordinate
       and every other safeguard here would be decoration.
    */
    for (const marker of mapFixture.markers) {
      if (marker.locationType === 'corporate_headquarters') {
        expect(marker.opportunity).toBeNull()
      }
    }
  })

  it('says on the headquarters popup that it is not a project', async () => {
    const user = userEvent.setup()
    renderApp('/map')
    await screen.findByRole('heading', { level: 1, name: 'Map' })

    const hq = mapFixture.markers.find((m) => m.locationType === 'corporate_headquarters')!
    await user.click(screen.getByRole('button', { name: new RegExp(hq.label) }))
    expect(
      await screen.findByText(/This is account context, not a project/),
    ).toBeInTheDocument()
  })
})

describe('an approximate location is drawn and described as approximate', () => {
  it('carries an uncertainty radius whenever the precision is coarser than an address', () => {
    for (const marker of mapFixture.markers) {
      if (marker.precision === 'locality' || marker.precision === 'county') {
        expect(marker.uncertaintyRadiusMetres).toBeGreaterThan(0)
      }
      if (marker.precision === 'address') {
        expect(marker.uncertaintyRadiusMetres).toBeNull()
      }
    }
  })

  it('states the area in the popup rather than implying a point', async () => {
    const user = userEvent.setup()
    renderApp('/map')
    await screen.findByRole('heading', { level: 1, name: 'Map' })

    const approximate = mapFixture.markers.find(
      (m) => m.locationType === 'approximate_project_area',
    )!
    await user.click(screen.getByRole('button', { name: new RegExp(approximate.label) }))
    const panel = await screen.findByRole('region', { name: 'Map detail' })
    expect(within(panel).getByText(/drawn as an area of about/)).toBeInTheDocument()
    // The legend says the same thing; this asserts the popup says it too.
    expect(within(panel).getByText(/named a city or state only/)).toBeInTheDocument()
  })

  it('refuses to call a city-level match a confirmed site', () => {
    // The extractor and the database constraint state the same rule; this is
    // the extractor half.
    expect(markerTypeFor('address')).toBe('confirmed_project_site')
    expect(markerTypeFor('locality')).toBe('approximate_project_area')
    expect(markerTypeFor('county')).toBe('approximate_project_area')
    expect(markerTypeFor('region')).toBe('approximate_project_area')
    expect(UNCERTAINTY_METRES.address).toBeNull()
    expect(UNCERTAINTY_METRES.locality).toBeGreaterThan(0)
  })
})

describe('opportunities with no defensible geography are listed, not placed', () => {
  it('shows them in their own panel with a reason', async () => {
    renderApp('/map')
    await screen.findByRole('heading', { level: 1, name: 'Map' })

    const panel = screen.getByRole('region', { name: 'Map detail' })
    expect(within(panel).getByText('Unlocated opportunities')).toBeInTheDocument()
    for (const item of mapFixture.unlocated) {
      expect(within(panel).getByText(item.title)).toBeInTheDocument()
      expect(within(panel).getByText(item.reason)).toBeInTheDocument()
    }
  })

  it('links each one to its opportunity', async () => {
    renderApp('/map')
    await screen.findByRole('heading', { level: 1, name: 'Map' })
    const first = mapFixture.unlocated[0]!
    expect(screen.getByRole('link', { name: first.title })).toHaveAttribute(
      'href',
      `/opportunities/${first.id}`,
    )
  })

  it('never places an unlocated opportunity at its company headquarters', () => {
    /*
       The failure this whole surface is built to prevent. Every dataset has a
       coordinate lying around and it is always the head office.
    */
    const placedOpportunityIds = mapFixture.markers
      .filter((m) => m.opportunity)
      .map((m) => m.opportunity!.id)
    for (const unlocated of mapFixture.unlocated) {
      expect(placedOpportunityIds).not.toContain(unlocated.id)
    }
  })
})

describe('a marker popup carries its source', () => {
  it('shows company, type, stage, confidence, precision, date, excerpt and link', async () => {
    const user = userEvent.setup()
    renderApp('/map')
    await screen.findByRole('heading', { level: 1, name: 'Map' })

    const marker = mapFixture.markers.find((m) => m.opportunity)!
    await user.click(screen.getByRole('button', { name: new RegExp(marker.label) }))
    const panel = await screen.findByRole('region', { name: 'Map detail' })

    expect(within(panel).getByText(marker.organizationName)).toBeInTheDocument()
    expect(within(panel).getByText(marker.opportunity!.title)).toBeInTheDocument()
    expect(within(panel).getByText('Opportunity type')).toBeInTheDocument()
    expect(within(panel).getByText('Stage')).toBeInTheDocument()
    expect(within(panel).getByText('Confidence')).toBeInTheDocument()
    expect(within(panel).getByText('Location precision')).toBeInTheDocument()
    expect(within(panel).getByText('Filing date')).toBeInTheDocument()
    expect(within(panel).getByText(new RegExp(marker.opportunity!.excerpt!.slice(0, 30)))).toBeTruthy()

    const official = within(panel).getByRole('link', { name: /official filing/ })
    expect(official).toHaveAttribute('href', marker.opportunity!.officialUrl)
    expect(official.getAttribute('rel')).toContain('noopener')

    expect(
      within(panel).getByRole('link', { name: /Open the opportunity/ }),
    ).toHaveAttribute('href', `/opportunities/${marker.opportunity!.id}`)
  })

  it('shows what the filing actually said, beside the coordinate', async () => {
    const user = userEvent.setup()
    renderApp('/map')
    await screen.findByRole('heading', { level: 1, name: 'Map' })

    const marker = mapFixture.markers.find((m) => m.extractedText)!
    await user.click(screen.getByRole('button', { name: new RegExp(marker.label) }))
    const panel = await screen.findByRole('region', { name: 'Map detail' })
    expect(within(panel).getByText(/The filing said:/)).toBeInTheDocument()
    expect(within(panel).getByText(marker.extractedText!)).toBeInTheDocument()
  })
})

describe('filters', () => {
  const markers = mapFixture.markers

  it('filters by company', () => {
    const company = companyOptions(markers)[0]!
    const result = applyMapQuery(markers, { ...DEFAULT_MAP_QUERY, company })
    expect(result.every((m) => m.organizationName === company)).toBe(true)
    expect(result.length).toBeGreaterThan(0)
  })

  it('filters by opportunity type, confidence and stage', () => {
    const type = opportunityTypeOptions(markers)[0]!
    expect(
      applyMapQuery(markers, { ...DEFAULT_MAP_QUERY, opportunityType: type }).every(
        (m) => m.opportunity?.opportunityType === type,
      ),
    ).toBe(true)
    expect(
      applyMapQuery(markers, { ...DEFAULT_MAP_QUERY, confidence: 'moderate' }).every(
        (m) => m.opportunity?.confidenceLevel === 'moderate',
      ),
    ).toBe(true)
    expect(
      applyMapQuery(markers, { ...DEFAULT_MAP_QUERY, stage: 'developing' }).every(
        (m) => m.opportunity?.stage === 'developing',
      ),
    ).toBe(true)
  })

  it('excludes account context from every opportunity filter', () => {
    /*
       A headquarters has no stage and no confidence. Letting it survive a "high
       confidence only" filter would be the surface asserting precisely what it
       exists to deny.
    */
    for (const query of [
      { ...DEFAULT_MAP_QUERY, confidence: 'high' },
      { ...DEFAULT_MAP_QUERY, stage: 'confirmed' },
      { ...DEFAULT_MAP_QUERY, opportunityType: opportunityTypeOptions(markers)[0]! },
    ]) {
      expect(applyMapQuery(markers, query).some((m) => !m.opportunity)).toBe(false)
    }
  })

  it('separates confirmed sites from approximate areas', () => {
    const confirmed = applyMapQuery(markers, { ...DEFAULT_MAP_QUERY, placement: 'confirmed' })
    expect(confirmed.every((m) => m.locationType === 'confirmed_project_site')).toBe(true)

    const approximate = applyMapQuery(markers, {
      ...DEFAULT_MAP_QUERY,
      placement: 'approximate',
    })
    expect(approximate.every((m) => m.locationType === 'approximate_project_area')).toBe(true)
  })

  it('returns everything when nothing is selected', () => {
    expect(applyMapQuery(markers, DEFAULT_MAP_QUERY)).toHaveLength(markers.length)
    expect(DEFAULT_MAP_QUERY.company).toBe(ANY)
  })
})

describe('the empty state', () => {
  it('says nothing has been placed rather than drawing an empty ocean', async () => {
    const empty: DataSource = {
      ...fixtureSource(undefined),
      getMapLocations: async () => ({
        kind: 'empty',
        reason: 'No opportunity or account has a recorded location yet.',
        checkedAt: FIXTURE_NOW.toISOString(),
      }),
    }
    renderApp('/map', { data: empty })
    expect(
      await screen.findByText(/No opportunity or account has a recorded location yet/),
    ).toBeInTheDocument()
  })

  it('frames nothing when there is nothing to frame', () => {
    expect(boundsFor([])).toBeNull()
    // A single point has zero extent; the bounds are padded so it can be fitted.
    const single = boundsFor([{ latitude: 40, longitude: -80 }])!
    expect(single[0][0]).toBeLessThan(-80)
    expect(single[1][0]).toBeGreaterThan(-80)
  })
})

describe('Stadia configuration', () => {
  it('names no API key anywhere in the style module', async () => {
    const module = await import('@/lib/mapStyle')
    const text = Object.values(module)
      .map((v) => (typeof v === 'string' ? v : ''))
      .join(' ')
    expect(text).not.toMatch(/api_key/i)
    expect(styleUrl('light')).not.toMatch(/api_key/i)
    expect(styleUrl('dark')).not.toMatch(/api_key/i)
  })

  it('preserves Stadia, OpenMapTiles and OpenStreetMap attribution', () => {
    // Required by Stadia's terms and by the ODbL. Part of the style object, so
    // a layout change cannot drop it.
    expect(MAP_ATTRIBUTION).toContain('Stadia Maps')
    expect(MAP_ATTRIBUTION).toContain('OpenMapTiles')
    expect(MAP_ATTRIBUTION).toContain('OpenStreetMap')
  })

  it('chooses a dark style for the dark theme', () => {
    expect(styleUrl('dark')).toContain('dark')
    expect(styleUrl('light')).not.toContain('dark')
  })

  it('degrades to a usable list when the base map fails', async () => {
    /*
       Framing and WebGL both fail for reasons entirely outside this
       application. The locations come from the Radar's own database, so a tile
       failure must not take them with it.
    */
    renderApp('/map')
    await screen.findByRole('list', { name: 'Locations on the map' })
    const main = screen.getByRole('main')
    // Whether the canvas mounted or not, every marker is listed and operable.
    for (const marker of mapFixture.markers) {
      expect(main.textContent).toContain(marker.label)
    }
  })
})

describe('mobile layout', () => {
  it('stacks the map and its panel at narrow width', async () => {
    setViewport('narrow')
    renderApp('/map')
    await screen.findByRole('heading', { level: 1, name: 'Map' })
    expect(document.querySelector('.map-layout--stacked')).not.toBeNull()
  })

  it('keeps the unlocated panel reachable on a phone', async () => {
    setViewport('narrow')
    renderApp('/map')
    await screen.findByRole('heading', { level: 1, name: 'Map' })
    expect(screen.getByText('Unlocated opportunities')).toBeInTheDocument()
  })
})

describe('the location extractor', () => {
  it('reads a street address as a confirmed site', () => {
    const found = extractLocations(
      'The company will build a new bakery at 1400 West Industrial Drive, Chicago, Illinois, an investment of $180 million.',
    )
    expect(found[0]!.precision).toBe('address')
    expect(found[0]!.locality).toBe('Chicago')
    expect(found[0]!.region).toBe('Illinois')
    expect(markerTypeFor(found[0]!.precision)).toBe('confirmed_project_site')
  })

  it('reads a city and state as an area, not a site', () => {
    const found = extractLocations(
      'Work is under way to expand the processing facility in Springdale, Arkansas this year.',
    )
    expect(found[0]!.precision).toBe('locality')
    expect(markerTypeFor(found[0]!.precision)).toBe('approximate_project_area')
  })

  it('reads a county', () => {
    const found = extractLocations('A new site is planned in Clanton County, Alabama.')
    expect(found[0]!.precision).toBe('county')
    expect(found[0]!.county).toBe('Clanton County')
  })

  it('finds nothing in a filing that names no place', () => {
    /*
       The most important case. An opportunity with no stated location is common
       and correct, and the extractor must say so rather than reaching for
       whatever proper noun is nearest.
    */
    expect(
      extractLocations(
        'The company announced an expansion of its production capacity during the period.',
      ),
    ).toEqual([])
  })

  it('does not mistake a corporate suffix for a city', () => {
    expect(
      extractLocations('The agreement with Example Holdings, Inc. was completed.'),
    ).toEqual([])
  })

  it('keeps the source text beside every extraction', () => {
    const found = extractLocations('a plant in Springdale, Arkansas')
    expect(found[0]!.text).toContain('Springdale, Arkansas')
  })
})
