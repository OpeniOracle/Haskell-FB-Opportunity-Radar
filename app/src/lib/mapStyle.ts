/**
 * The Stadia Maps style, and the rules that make it safe to load.
 *
 * NO API KEY APPEARS HERE OR ANYWHERE ELSE IN THE BUNDLE. Stadia authenticates
 * browser tile requests by DOMAIN: the request carries a `Referer`, Stadia
 * matches it against the domains allow-listed on the account, and serves or
 * refuses. That mechanism only works if the browser actually sends an origin,
 * which is why `Referrer-Policy: strict-origin-when-cross-origin` is set in
 * `netlify.toml` — `no-referrer` would silently break every tile.
 *
 * Server-side geocoding is the one thing that genuinely needs a key, and it
 * happens in `/api/resolve-locations` with `STADIA_API_KEY` read from the
 * Netlify environment. A `VITE_`-prefixed variable would be compiled into this
 * file; that is precisely what must not happen.
 *
 * ATTRIBUTION IS NOT OPTIONAL AND NOT REMOVABLE. Stadia's terms and the ODbL
 * both require it, so it is part of the style object rather than a caption
 * somewhere that a later layout change could drop.
 */

/** Shown on the map, always. Required by Stadia, OpenMapTiles and OSM. */
export const MAP_ATTRIBUTION =
  '&copy; <a href="https://stadiamaps.com/" target="_blank" rel="noopener noreferrer">Stadia Maps</a> ' +
  '&copy; <a href="https://openmaptiles.org/" target="_blank" rel="noopener noreferrer">OpenMapTiles</a> ' +
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors'

/** Every origin the map needs. Mirrored into the CSP by `generate-headers.mjs`. */
export const MAP_TILE_ORIGIN = 'https://tiles.stadiamaps.com'

/**
 * Light and dark, because the application has both and a map that ignores the
 * theme is the one element on the page that glows.
 */
export function styleUrl(theme: 'light' | 'dark'): string {
  return theme === 'dark'
    ? `${MAP_TILE_ORIGIN}/styles/alidade_smooth_dark.json`
    : `${MAP_TILE_ORIGIN}/styles/alidade_smooth.json`
}

/**
 * A bounding box around the markers, with a margin.
 *
 * Returns null for an empty set rather than a default view of the Atlantic:
 * "there is nothing to show" is a state the surface renders in words, and
 * framing an empty ocean is not an improvement on saying so.
 */
export function boundsFor(
  points: { latitude: number; longitude: number }[],
): [[number, number], [number, number]] | null {
  if (points.length === 0) return null
  let west = points[0]!.longitude
  let east = points[0]!.longitude
  let south = points[0]!.latitude
  let north = points[0]!.latitude
  for (const p of points) {
    west = Math.min(west, p.longitude)
    east = Math.max(east, p.longitude)
    south = Math.min(south, p.latitude)
    north = Math.max(north, p.latitude)
  }
  /* A single point has zero extent, and fitBounds on a zero-extent box zooms to
     the maximum. The pad gives it something to fit. */
  const pad = 0.25
  return [
    [west - pad, south - pad],
    [east + pad, north + pad],
  ]
}
