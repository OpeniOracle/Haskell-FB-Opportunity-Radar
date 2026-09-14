import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import maplibregl, { type Map as MapLibreMap, type Marker as MapLibreMarker } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { Icon } from '@/components/Icon'
import { IllustrativeNote } from '@/components/Illustrative'
import { StatusPill } from '@/components/StatusPill'
import {
  EmptyState,
  LoadingState,
  DegradedNotice,
  StaleNotice,
  UnavailableState,
} from '@/components/SurfaceStates'
import { useDataSource } from '@/data/DataSourceContext'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { useSurfaceData } from '@/hooks/useSurfaceData'
import { absoluteDate } from '@/lib/format'
import { opportunityDetailPath } from '@/lib/opportunityFilters'
import { MAP_ATTRIBUTION, boundsFor, styleUrl } from '@/lib/mapStyle'
import {
  ANY,
  DEFAULT_MAP_QUERY,
  LOCATION_TYPE_LABEL,
  LOCATION_TYPE_SHORT,
  activeMapFilterCount,
  applyMapQuery,
  companyOptions,
  isProjectMarker,
  opportunityTypeOptions,
  type MapQuery,
} from '@/lib/mapFilters'
import type { MapMarker, MapSnapshot } from '@/types/domain'

/**
 * Map — `/map`.
 *
 * ONE RULE GOVERNS THIS SURFACE, AND EVERYTHING ELSE ON IT IS SUBORDINATE:
 * a pin says "the project is here", and it may only be drawn where a document
 * said so.
 *
 * That is why the four location types are visually distinct rather than
 * decorated variants of one another, why a coarse match is a circle rather than
 * a point, why a corporate headquarters is drawn as a hollow ring and carries no
 * opportunity at all, and why an opportunity with no stated geography goes into
 * a list beside the map rather than being dropped on the company's head office.
 * The last of those is the failure this surface was built to make impossible:
 * every dataset has a coordinate lying around, and it is always the wrong one.
 *
 * The map itself is MapLibre against Stadia tiles, authenticated by domain so no
 * key is in this bundle. See `mapStyle.ts`.
 */
export function MapSurface() {
  const source = useDataSource()
  const load = useCallback(() => source.getMapLocations(), [source])
  const state = useSurfaceData(load, [load])

  const hasData =
    state.kind === 'ready' || state.kind === 'degraded' || state.kind === 'stale'

  return (
    <>
      <header className="page-head page-head--tight">
        <div>
          <h1 className="page-head__title">Map</h1>
          <p className="page-head__sub">
            Where the collected projects are. A marker is drawn only where a filing named
            a place, and a head office is never treated as a project site.
          </p>
        </div>
        {/* The preview build marks every surface that renders illustrative
            records. Production has no fixtures to mark, and this renders
            nothing there. */}
        <div className="page-head__meta">
          <IllustrativeNote />
        </div>
      </header>

      {state.kind === 'loading' && <LoadingState label="Loading project locations" rows={2} />}

      {state.kind === 'empty' && (
        <EmptyState
          title="Nothing has been placed on the map yet"
          body={state.reason}
          next="Locations are extracted from collected filings by the location resolver."
          checkedAt={state.checkedAt}
        />
      )}

      {state.kind === 'unavailable' && (
        <UnavailableState
          title="The map isn’t ready yet"
          reason={state.reason}
          blockedBy={state.blockedBy}
          checkedAt={state.checkedAt}
        />
      )}

      {state.kind === 'degraded' && (
        <DegradedNotice
          notice={state.notice}
          affected={state.affected}
          checkedAt={state.checkedAt}
        />
      )}

      {state.kind === 'stale' && (
        <StaleNotice notice={state.notice} asOf={state.asOf} checkedAt={state.checkedAt} />
      )}

      {hasData && <MapWorkspace snapshot={state.data} />}
    </>
  )
}

function MapWorkspace({ snapshot }: { snapshot: MapSnapshot }) {
  const { search } = useLocation()
  const [query, setQuery] = useState<MapQuery>(DEFAULT_MAP_QUERY)
  const [selected, setSelected] = useState<MapMarker | null>(null)
  const narrow = useMediaQuery('(max-width: 900px)')

  const visible = useMemo(() => applyMapQuery(snapshot.markers, query), [snapshot.markers, query])
  const companies = useMemo(() => companyOptions(snapshot.markers), [snapshot.markers])
  const types = useMemo(() => opportunityTypeOptions(snapshot.markers), [snapshot.markers])
  const activeCount = activeMapFilterCount(query)

  const projects = visible.filter(isProjectMarker)
  const context = visible.filter((m) => !isProjectMarker(m))

  const patch = useCallback(
    (next: Partial<MapQuery>) => setQuery((current) => ({ ...current, ...next })),
    [],
  )

  return (
    <>
      <section className="filters" aria-label="Filter the map">
        <div className="filters__row">
          <label className="field">
            <span className="field__label">Company</span>
            <select
              className="field__select"
              value={query.company}
              onChange={(e) => patch({ company: e.target.value })}
            >
              <option value={ANY}>Any company</option>
              {companies.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field__label">Opportunity type</span>
            <select
              className="field__select"
              value={query.opportunityType}
              onChange={(e) => patch({ opportunityType: e.target.value })}
            >
              <option value={ANY}>Any type</option>
              {types.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field__label">Confidence</span>
            <select
              className="field__select"
              value={query.confidence}
              onChange={(e) => patch({ confidence: e.target.value })}
            >
              <option value={ANY}>Any confidence</option>
              <option value="high">High</option>
              <option value="moderate">Moderate</option>
              <option value="low">Low</option>
            </select>
          </label>
          <label className="field">
            <span className="field__label">Stage</span>
            <select
              className="field__select"
              value={query.stage}
              onChange={(e) => patch({ stage: e.target.value })}
            >
              <option value={ANY}>Any stage</option>
              <option value="emerging">Emerging</option>
              <option value="developing">Developing</option>
              <option value="confirmed">Confirmed</option>
            </select>
          </label>
          <label className="field">
            <span className="field__label">Location</span>
            <select
              className="field__select"
              value={query.placement}
              onChange={(e) => patch({ placement: e.target.value as MapQuery['placement'] })}
            >
              <option value={ANY}>Confirmed and approximate</option>
              <option value="confirmed">Confirmed site only</option>
              <option value="approximate">Approximate area only</option>
            </select>
          </label>
          <button
            type="button"
            className="btn btn--quiet filters__clear"
            disabled={activeCount === 0}
            onClick={() => setQuery(DEFAULT_MAP_QUERY)}
          >
            Clear filters
            {activeCount > 0 && <span className="filters__count">{activeCount}</span>}
          </button>
        </div>
      </section>

      <div className="results" role="status">
        <p className="results__count">
          <strong>{projects.length}</strong>{' '}
          {projects.length === 1 ? 'project location' : 'project locations'}
          {context.length > 0 && (
            <span className="results__filtered">
              {' '}
              · {context.length} account {context.length === 1 ? 'marker' : 'markers'}
            </span>
          )}
          {activeCount > 0 && <span className="results__filtered"> · filtered</span>}
        </p>
      </div>

      <div className={`map-layout${narrow ? ' map-layout--stacked' : ''}`}>
        <div className="map-layout__map">
          <MapCanvas markers={visible} onSelect={setSelected} selectedId={selected?.id ?? null} />
          <MapLegend />
          {/*
            THE MARKER LIST IS ALWAYS RENDERED, NOT ONLY WHEN THE MAP FAILS.

            Two reasons, and the second is the one that matters more.

            A canvas full of pins is unreadable to a screen reader and
            unreachable by keyboard — there is no accessible way to present a
            WebGL map, so the same markers exist here as real buttons.

            And a map can fail SILENTLY. MapLibre fires no `error` when WebGL is
            simply unavailable, so a browser without it renders a grey rectangle
            and nothing else, with no event to catch. A list that is always
            present means the locations are readable whatever the canvas does.
          */}
          <MarkerList markers={visible} onSelect={setSelected} selectedId={selected?.id ?? null} />
        </div>

        {/* An explicit `region`, because this panel is addressed by name from
            the marker list and a complementary landmark is not what it is. */}
        <aside className="map-layout__aside" role="region" aria-label="Map detail">
          {selected ? (
            <MarkerDetail marker={selected} search={search} onClose={() => setSelected(null)} />
          ) : (
            <p className="map-aside__hint">
              Select a marker to see the company, the filing and the source link.
            </p>
          )}

          {/*
            UNLOCATED OPPORTUNITIES, IN FULL, BESIDE THE MAP.

            Every one of these is a real opportunity whose filing named no place.
            Omitting them would make the map look more complete than the data is;
            placing them at their company's head office would make it look more
            precise than the data is. Listing them is the only option that
            misrepresents nothing.
          */}
          <section className="map-unlocated" aria-labelledby="unlocated-title">
            <h2 className="section__title" id="unlocated-title">
              Unlocated opportunities
            </h2>
            <span className="section__count">{snapshot.unlocated.length}</span>
            {snapshot.unlocated.length === 0 ? (
              <p className="map-aside__hint">
                Every opportunity on record has a location from its source document.
              </p>
            ) : (
              <ul className="map-unlocated__list">
                {snapshot.unlocated.map((item) => (
                  <li className="map-unlocated__item" key={item.id}>
                    <Link to={opportunityDetailPath(item.id, search)}>{item.title}</Link>
                    <span className="map-unlocated__company">{item.organizationName}</span>
                    <span className="map-unlocated__reason">{item.reason}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </>
  )
}

/** The four marker kinds, stated once, in the order of decreasing certainty. */
function MapLegend() {
  return (
    <ul className="map-legend" aria-label="What the markers mean">
      {(
        [
          'confirmed_project_site',
          'approximate_project_area',
          'known_company_facility',
          'corporate_headquarters',
        ] as const
      ).map((type) => (
        <li className="map-legend__item" key={type}>
          <span className={`map-pin map-pin--${type} map-pin--legend`} aria-hidden="true" />
          {LOCATION_TYPE_LABEL[type]}
        </li>
      ))}
    </ul>
  )
}

/**
 * The MapLibre instance.
 *
 * Created once and kept in a ref. Markers are torn down and rebuilt whenever the
 * filtered set changes, which at this scale is cheaper and far less error-prone
 * than diffing them — and a stale marker on a map is a wrong claim, not a
 * cosmetic bug.
 *
 * If the style cannot load — no network, a domain that is not allow-listed on
 * the Stadia account, a blocked request — the surface says so in words instead
 * of showing an empty grey rectangle.
 */
function MapCanvas({
  markers,
  onSelect,
  selectedId,
}: {
  markers: MapMarker[]
  onSelect: (marker: MapMarker) => void
  selectedId: string | null
}) {
  const container = useRef<HTMLDivElement | null>(null)
  const map = useRef<MapLibreMap | null>(null)
  const drawn = useRef<MapLibreMarker[]>([])
  const [failed, setFailed] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  const theme =
    typeof document !== 'undefined' &&
    (document.documentElement.getAttribute('data-theme') === 'dark' ||
      (!document.documentElement.getAttribute('data-theme') &&
        typeof window !== 'undefined' &&
        window.matchMedia?.('(prefers-color-scheme: dark)').matches))
      ? 'dark'
      : 'light'

  useEffect(() => {
    if (!container.current || map.current) return
    let instance: MapLibreMap
    try {
      instance = new maplibregl.Map({
        container: container.current,
        style: styleUrl(theme),
        center: [-95, 39],
        zoom: 3,
        attributionControl: false,
      })
    } catch (error) {
      setFailed(error instanceof Error ? error.message : 'The map could not be created.')
      return
    }

    instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    /* Attribution is a control, not a caption, so a layout change cannot drop
       it. Stadia's terms and the ODbL both require it to stay visible. */
    instance.addControl(
      new maplibregl.AttributionControl({ compact: true, customAttribution: MAP_ATTRIBUTION }),
    )
    instance.on('load', () => setReady(true))
    instance.on('error', (event) => {
      setFailed(
        event?.error?.message ??
          'Map tiles could not be loaded. Check that this domain is allow-listed on the Stadia Maps account.',
      )
    })
    map.current = instance

    return () => {
      instance.remove()
      map.current = null
    }
    // The theme is read once at construction; a theme change re-creates nothing
    // here because MapLibre can swap a style in place, which the effect below
    // does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (map.current && ready) map.current.setStyle(styleUrl(theme))
  }, [theme, ready])

  useEffect(() => {
    const instance = map.current
    if (!instance) return

    for (const marker of drawn.current) marker.remove()
    drawn.current = []

    for (const marker of markers) {
      const element = document.createElement('button')
      element.type = 'button'
      element.className = `map-pin map-pin--${marker.locationType}${
        marker.id === selectedId ? ' map-pin--selected' : ''
      }`
      element.setAttribute(
        'aria-label',
        `${marker.label}. ${LOCATION_TYPE_LABEL[marker.locationType]}`,
      )
      element.addEventListener('click', () => onSelect(marker))

      drawn.current.push(
        new maplibregl.Marker({ element })
          .setLngLat([marker.longitude, marker.latitude])
          .addTo(instance),
      )
    }

    const bounds = boundsFor(markers)
    if (bounds) instance.fitBounds(bounds, { padding: 48, maxZoom: 11, duration: 0 })
  }, [markers, onSelect, selectedId, ready])

  if (failed) {
    return (
      <div className="map-canvas map-canvas--failed" role="alert">
        <Icon name="alert" className="notice__icon" />
        <p>
          <strong>The base map could not be loaded. </strong>
          The project locations below are unaffected — they come from the Radar database,
          not from the map provider.
        </p>
        <p className="map-canvas__detail">{failed}</p>
        <p>The locations are listed below and remain fully usable.</p>
      </div>
    )
  }

  return <div className="map-canvas" ref={container} data-testid="map-canvas" role="application" aria-label="Project location map" />
}

/**
 * Every marker on the map, as buttons.
 *
 * This is the accessible representation of the canvas and it is not a fallback:
 * it is present on every render, at every width, whether or not the tiles
 * loaded. Each entry says what KIND of place it is, because a list of names
 * without that distinction reproduces exactly the ambiguity the map's four pin
 * styles exist to remove.
 */
function MarkerList({
  markers,
  onSelect,
  selectedId,
}: {
  markers: MapMarker[]
  onSelect: (marker: MapMarker) => void
  selectedId: string | null
}) {
  if (markers.length === 0) {
    return (
      <p className="map-aside__hint">
        No marker matches the current filters. Nothing has been hidden — the filters
        currently exclude every location.
      </p>
    )
  }

  return (
    <ul className="map-markers" aria-label="Locations on the map">
      {markers.map((marker) => (
        <li key={marker.id}>
          <button
            type="button"
            className={`map-markers__item${marker.id === selectedId ? ' map-markers__item--on' : ''}`}
            aria-pressed={marker.id === selectedId}
            onClick={() => onSelect(marker)}
          >
            <span className={`map-pin map-pin--${marker.locationType} map-pin--legend`} aria-hidden="true" />
            <span className="map-markers__label">{marker.label}</span>
            <span className="map-markers__type">
              {LOCATION_TYPE_SHORT[marker.locationType]}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

/**
 * What one marker says when you open it.
 *
 * The order is deliberate and it is the same order the opportunity detail uses:
 * what it is, how sure we are, HOW PRECISE THE LOCATION IS, then the document —
 * excerpt and official link — and only then a way deeper in. Location precision
 * sits above the source because it is the thing a reader is most likely to
 * over-read from a pin.
 */
function MarkerDetail({
  marker,
  search,
  onClose,
}: {
  marker: MapMarker
  search: string
  onClose: () => void
}) {
  const { opportunity } = marker

  return (
    <article className="map-detail" aria-live="polite">
      <div className="map-detail__head">
        <h2 className="map-detail__company">{marker.organizationName}</h2>
        <button type="button" className="btn btn--quiet" onClick={onClose}>
          Close
        </button>
      </div>

      <StatusPill
        tone={
          marker.locationType === 'confirmed_project_site'
            ? 'confirmed'
            : marker.locationType === 'approximate_project_area'
              ? 'developing'
              : 'neutral'
        }
        icon="pin"
        label={LOCATION_TYPE_SHORT[marker.locationType]}
        title={LOCATION_TYPE_LABEL[marker.locationType]}
      />

      {opportunity ? (
        <>
          <h3 className="map-detail__title">{opportunity.title}</h3>
          <dl className="drawer__facts">
            <div className="fact">
              <dt>Opportunity type</dt>
              <dd>{opportunity.opportunityType}</dd>
            </div>
            <div className="fact">
              <dt>Stage</dt>
              <dd>{opportunity.stage}</dd>
            </div>
            <div className="fact">
              <dt>Confidence</dt>
              <dd>{opportunity.confidenceLevel}</dd>
            </div>
            <div className="fact">
              <dt>Location precision</dt>
              <dd>
                {LOCATION_TYPE_LABEL[marker.locationType]}
                {marker.uncertaintyRadiusMetres && (
                  <span className="fact__qualifier">
                    {' '}
                    (drawn as an area of about{' '}
                    {Math.round(marker.uncertaintyRadiusMetres / 1000)} km)
                  </span>
                )}
              </dd>
            </div>
            <div className="fact">
              <dt>Filing date</dt>
              <dd>
                {opportunity.filingDate
                  ? absoluteDate(opportunity.filingDate)
                  : 'Not stated in the source'}
              </dd>
            </div>
          </dl>

          {marker.extractedText && (
            <p className="map-detail__extracted">
              <strong>The filing said: </strong>
              <q>{marker.extractedText}</q>
            </p>
          )}

          {opportunity.excerpt && (
            <blockquote className="source-card__excerpt">{opportunity.excerpt}</blockquote>
          )}

          <p className="source-card__links">
            {opportunity.officialUrl && (
              <a
                className="btn btn--primary"
                href={opportunity.officialUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {opportunity.publisher ?? 'Official'}
                {opportunity.documentType ? ` ${opportunity.documentType}` : ''} — official
                filing
              </a>
            )}
            <Link className="btn btn--quiet" to={opportunityDetailPath(opportunity.id, search)}>
              Open the opportunity
              <Icon name="chevron" className="btn__icon" />
            </Link>
          </p>
        </>
      ) : (
        <>
          <h3 className="map-detail__title">{marker.label}</h3>
          {/*
            SAID PLAINLY, ON THE MARKER ITSELF.

            Someone who opens a headquarters pin expecting a project should read
            the correction here rather than infer it from a legend they scrolled
            past.
          */}
          <p className="map-detail__context">
            This is account context, not a project. No filing has placed a project at this
            address, and this marker must not be read as one.
          </p>
          {marker.normalizedAddress && (
            <p className="map-detail__address">{marker.normalizedAddress}</p>
          )}
        </>
      )}
    </article>
  )
}
