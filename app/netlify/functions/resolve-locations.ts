/**
 * `POST /api/resolve-locations` — turn stored filing text into map coordinates.
 *
 * WHY THIS IS A SERVER FUNCTION AND NOT BROWSER CODE. Two reasons, and both are
 * structural:
 *
 *   1. `evidence.body_text` is withheld from the `authenticated` grant by
 *      migration 0015. The filing text lives here or nowhere.
 *   2. The Stadia API key is a secret. Tiles authenticate by domain and need no
 *      key in the client; geocoding does, so it happens behind this endpoint.
 *
 * WHAT IT DOES NOT DO. It does not refetch anything from SEC — it reads text the
 * ingestion already stored. It does not modify evidence, signals or
 * opportunities: it only INSERTS into `opportunity_locations` and fills in
 * coordinates on `organization_locations` rows the migration seeded. Existing
 * production records are untouched, which is the constraint this pass was given.
 *
 * IT IS RE-RUNNABLE. Locations are keyed on (opportunity_id, extracted_text) and
 * every geocode goes through the cache, so a second run re-reads, re-extracts,
 * writes nothing new and asks Stadia nothing.
 *
 * Authenticated with the operator secret, like `/api/admin-run`. A signed-in
 * pilot user cannot trigger paid geocoding.
 */
import type { Handler } from '@netlify/functions'
import { failure, json, methodNotAllowed } from './_shared/http.js'
import { UnauthorizedError, requireOperator } from './_shared/auth.js'
import { MissingEnvError, demand, serverEnv } from './_shared/env.js'
import { supabaseAdmin } from './_shared/supabaseAdmin.js'
import {
  UNCERTAINTY_METRES,
  extractLocations,
  markerTypeFor,
  type ExtractedLocation,
} from './_shared/locations/extract.js'
import { geocodeCached } from './_shared/locations/geocode.js'

const EXTRACTOR_VERSION = 'locations@1'

/**
 * How far either side of the matched excerpt to read.
 *
 * The excerpt is the passage the classifier matched, and a filing often names
 * the site a sentence or two away from the announcement itself. This widens the
 * search without turning it into a scan of the whole document, where a place
 * name has no demonstrable connection to the project.
 */
const CONTEXT_CHARS = 1200

export interface ResolveSummary {
  opportunitiesConsidered: number
  locationsExtracted: number
  locationsWritten: number
  locationsAlreadyPresent: number
  geocodeMisses: number
  headquartersResolved: number
  unlocated: { opportunityId: string; reason: string }[]
}

/**
 * The text to search for a place, centred on the matched passage.
 *
 * Falls back to the excerpt alone when no body text was retained — a
 * reference-only record has none, and that is a legitimate state rather than an
 * error.
 */
export function searchWindow(bodyText: string | null, excerpt: string | null): string {
  if (!bodyText) return excerpt ?? ''
  if (!excerpt) return bodyText.slice(0, CONTEXT_CHARS * 2)
  const at = bodyText.indexOf(excerpt.slice(0, 120))
  if (at < 0) return `${excerpt}\n${bodyText.slice(0, CONTEXT_CHARS)}`
  return bodyText.slice(
    Math.max(0, at - CONTEXT_CHARS),
    Math.min(bodyText.length, at + excerpt.length + CONTEXT_CHARS),
  )
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') return methodNotAllowed('POST')

  try {
    /* Read for its SIDE EFFECT: the scope check. `admin-run` requires the
       operator secret to be configured, so an unconfigured deployment answers
       503 with the variable named rather than 401 with a misleading one. */
    serverEnv('admin-run')
    requireOperator(event.headers)
  } catch (error) {
    if (error instanceof UnauthorizedError) return failure(401, 'unauthorized', error.message)
    if (error instanceof MissingEnvError) {
      return failure(503, 'not_configured', error.message)
    }
    throw error
  }

  let apiKey: string
  try {
    apiKey = demand(process.env.STADIA_API_KEY, 'STADIA_API_KEY')
  } catch {
    /*
       A NAMED FAILURE, NOT A SILENT ONE.

       Without a key nothing can be geocoded, and the honest answer is to say
       which variable is missing. The map itself degrades to its empty state and
       says the same thing, rather than rendering a blank rectangle.
    */
    return failure(
      503,
      'not_configured',
      'STADIA_API_KEY is not set in this environment, so no location can be geocoded. ' +
        'Set it in Netlify (Functions scope) and run this again.',
    )
  }

  const client = supabaseAdmin()
  const now = new Date().toISOString()
  const summary: ResolveSummary = {
    opportunitiesConsidered: 0,
    locationsExtracted: 0,
    locationsWritten: 0,
    locationsAlreadyPresent: 0,
    geocodeMisses: 0,
    headquartersResolved: 0,
    unlocated: [],
  }

  /* ---------------------------------------------------- 1. Headquarters.
     Seeded as text by migration 0023 with no coordinates. Resolved here so the
     numbers on the map come from the geocoder and not from a keyboard. */
  const { data: hqRows, error: hqError } = await client
    .from('organization_locations')
    .select('id, address_text, locality, region, country, precision')
    .eq('precision', 'unresolved')
  if (hqError) return failure(500, 'read_failed', hqError.message)

  for (const row of hqRows ?? []) {
    const query = [row.address_text, row.locality, row.region, row.country]
      .filter(Boolean)
      .join(', ')
    if (!query) continue
    const result = await geocodeCached(client, query, apiKey)
    if (!result.matched) {
      summary.geocodeMisses += 1
      continue
    }
    const { error } = await client
      .from('organization_locations')
      .update({
        latitude: result.latitude,
        longitude: result.longitude,
        normalized_address: result.normalizedAddress,
        precision: result.precision,
        resolved_at: now,
        updated_at: now,
      })
      .eq('id', row.id)
    if (error) return failure(500, 'write_failed', error.message)
    summary.headquartersResolved += 1
  }

  /* ------------------------------------- 2. Project locations, from filings. */
  const { data: opportunities, error: oppError } = await client
    .from('opportunities')
    .select('id, title, organization_id')
  if (oppError) return failure(500, 'read_failed', oppError.message)

  const { data: oppSignals } = await client
    .from('opportunity_signals')
    .select('opportunity_id, signal_id')
  const { data: signalEvidence } = await client
    .from('signal_evidence')
    .select('signal_id, evidence_id')

  const signalsByOpportunity = new Map<string, string[]>()
  for (const link of oppSignals ?? []) {
    const list = signalsByOpportunity.get(link.opportunity_id as string) ?? []
    list.push(link.signal_id as string)
    signalsByOpportunity.set(link.opportunity_id as string, list)
  }
  const evidenceBySignal = new Map<string, string[]>()
  for (const link of signalEvidence ?? []) {
    const list = evidenceBySignal.get(link.signal_id as string) ?? []
    list.push(link.evidence_id as string)
    evidenceBySignal.set(link.signal_id as string, list)
  }

  for (const opportunity of opportunities ?? []) {
    summary.opportunitiesConsidered += 1
    const opportunityId = opportunity.id as string

    const evidenceIds = new Set<string>()
    for (const signalId of signalsByOpportunity.get(opportunityId) ?? []) {
      for (const id of evidenceBySignal.get(signalId) ?? []) evidenceIds.add(id)
    }
    if (evidenceIds.size === 0) {
      summary.unlocated.push({
        opportunityId,
        reason: 'no evidence is linked to this opportunity',
      })
      continue
    }

    /* `body_text` IS readable here and only here. */
    const { data: evidenceRows, error: evidenceError } = await client
      .from('evidence')
      .select('id, body_text, evidence_excerpt')
      .in('id', [...evidenceIds])
    if (evidenceError) return failure(500, 'read_failed', evidenceError.message)

    let placed = 0
    for (const row of evidenceRows ?? []) {
      const window = searchWindow(
        (row.body_text as string) ?? null,
        (row.evidence_excerpt as string) ?? null,
      )
      const extracted = extractLocations(window)
      summary.locationsExtracted += extracted.length

      /* The most precise place the document named, and only that one. Writing
         every candidate would put four pins on one project and let a reader
         pick whichever suits them. */
      const best: ExtractedLocation | undefined = extracted[0]
      if (!best) continue

      const { data: existing } = await client
        .from('opportunity_locations')
        .select('id')
        .eq('opportunity_id', opportunityId)
        .eq('extracted_text', best.text)
        .maybeSingle()
      if (existing) {
        summary.locationsAlreadyPresent += 1
        placed += 1
        continue
      }

      const result = await geocodeCached(client, best.query, apiKey)
      if (!result.matched) {
        summary.geocodeMisses += 1
        continue
      }

      /*
         THE SCHEMA AND THE EXTRACTOR AGREE ON WHAT COUNTS AS A SITE.

         `markerTypeFor` returns a confirmed site only for a street address, and
         `opportunity_locations_confirmed_site_is_precise` refuses anything else
         at the database. Two independent statements of one rule, so neither can
         drift alone.
      */
      const precision = result.precision === 'exact' ? 'address' : result.precision
      const locationType =
        precision === 'address' ? markerTypeFor(best.precision) : 'approximate_project_area'

      const { error } = await client.from('opportunity_locations').insert({
        opportunity_id: opportunityId,
        evidence_id: row.id,
        location_type: locationType,
        extracted_text: best.text,
        facility_name: best.facilityName,
        address_text: best.addressText,
        locality: best.locality,
        county: best.county,
        region: best.region,
        country: 'United States',
        normalized_address: result.normalizedAddress,
        latitude: result.latitude,
        longitude: result.longitude,
        precision,
        uncertainty_radius_m:
          precision === 'address' ? null : (UNCERTAINTY_METRES[best.precision] ?? 25000),
        extractor: EXTRACTOR_VERSION,
        resolved_at: now,
      })
      if (error) return failure(500, 'write_failed', error.message)
      summary.locationsWritten += 1
      placed += 1
    }

    if (placed === 0) {
      summary.unlocated.push({
        opportunityId,
        reason: 'no filing linked to this opportunity named a site, a city or a state',
      })
    }
  }

  return json(200, { ok: true, summary })
}
