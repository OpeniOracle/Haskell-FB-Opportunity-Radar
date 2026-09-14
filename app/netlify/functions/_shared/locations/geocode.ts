/**
 * Stadia Maps geocoding, server-side, cached, and never speculative.
 *
 * THE KEY NEVER REACHES THE BROWSER. Tiles authenticate by domain — Stadia
 * checks the `Referer` against the allow-listed production host, which is why
 * `Referrer-Policy: strict-origin-when-cross-origin` matters and is set in
 * `netlify.toml`. Geocoding has no such mechanism, so it runs here with
 * `STADIA_API_KEY` read from the Netlify environment. A `VITE_`-prefixed
 * variable would be compiled into the bundle; this one deliberately is not.
 *
 * EVERY ANSWER IS CACHED, INCLUDING THE MISSES. A phrase that resolved to
 * nothing will resolve to nothing again, and asking a paid API the same dead
 * question on every run is the kind of thing that is invisible until the bill
 * arrives. `geocode_cache.matched = false` records the miss.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

const ENDPOINT = 'https://api.stadiamaps.com/geocoding/v1/search'

export type GeocodePrecision = 'exact' | 'address' | 'locality' | 'county' | 'region' | 'unresolved'

export interface GeocodeResult {
  latitude: number | null
  longitude: number | null
  normalizedAddress: string | null
  precision: GeocodePrecision
  matched: boolean
}

/** One cache key per phrase, whatever the incidental spacing or casing. */
export function normalizeQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.,]+$/g, '')
}

/**
 * Pelias layers, in the vocabulary this application uses.
 *
 * A geocoder answering a city query with a city is a correct answer at city
 * precision — not a failed address lookup. Mapping the layer through rather
 * than assuming the requested precision is what keeps a coarse answer labelled
 * coarse when the provider silently widens a search.
 */
const LAYER_PRECISION: Record<string, GeocodePrecision> = {
  venue: 'address',
  address: 'address',
  street: 'address',
  locality: 'locality',
  borough: 'locality',
  localadmin: 'locality',
  county: 'county',
  macrocounty: 'county',
  region: 'region',
  macroregion: 'region',
}

interface PeliasFeature {
  geometry?: { coordinates?: [number, number] }
  properties?: { label?: string; layer?: string; confidence?: number }
}

/**
 * Ask Stadia, once, for one phrase.
 *
 * `boundary.country=USA` because the cohort files with an American regulator
 * about American sites, and an unbounded search turns "Springfield, MO" into a
 * choice between several countries' Springfields.
 */
export async function geocodeOnce(
  query: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GeocodeResult> {
  const url = new URL(ENDPOINT)
  url.searchParams.set('text', query)
  url.searchParams.set('size', '1')
  url.searchParams.set('boundary.country', 'USA')
  url.searchParams.set('api_key', apiKey)

  const response = await fetchImpl(url.toString(), {
    headers: { accept: 'application/json' },
  })
  if (!response.ok) {
    throw new Error(`Stadia geocoding answered HTTP ${response.status} for "${query}".`)
  }

  const body = (await response.json()) as { features?: PeliasFeature[] }
  const feature = body.features?.[0]
  const coordinates = feature?.geometry?.coordinates

  if (!feature || !coordinates || coordinates.length < 2) {
    return {
      latitude: null,
      longitude: null,
      normalizedAddress: null,
      precision: 'unresolved',
      matched: false,
    }
  }

  const [longitude, latitude] = coordinates
  return {
    latitude,
    longitude,
    normalizedAddress: feature.properties?.label ?? null,
    precision: LAYER_PRECISION[feature.properties?.layer ?? ''] ?? 'locality',
    matched: true,
  }
}

/**
 * The cached front door. Reads first, asks second, writes what it learned.
 *
 * A cached MISS is returned as a miss without a request. That is the half of a
 * cache people forget, and the half that actually bounds the spend.
 */
export async function geocodeCached(
  client: SupabaseClient,
  query: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GeocodeResult> {
  const key = normalizeQuery(query)

  const { data: cached } = await client
    .from('geocode_cache')
    .select('latitude, longitude, normalized_address, precision, matched')
    .eq('query_normalized', key)
    .maybeSingle()

  if (cached) {
    return {
      latitude: (cached.latitude as number) ?? null,
      longitude: (cached.longitude as number) ?? null,
      normalizedAddress: (cached.normalized_address as string) ?? null,
      precision: (cached.precision as GeocodePrecision) ?? 'unresolved',
      matched: Boolean(cached.matched),
    }
  }

  const result = await geocodeOnce(query, apiKey, fetchImpl)

  await client.from('geocode_cache').upsert(
    {
      query_normalized: key,
      query_as_asked: query,
      latitude: result.latitude,
      longitude: result.longitude,
      normalized_address: result.normalizedAddress,
      precision: result.precision,
      provider: 'stadiamaps',
      matched: result.matched,
      resolved_at: new Date().toISOString(),
    },
    { onConflict: 'query_normalized' },
  )

  return result
}
