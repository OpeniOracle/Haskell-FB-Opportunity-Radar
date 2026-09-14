/**
 * Pulling a PLACE out of the passage a filing was matched on.
 *
 * This is deliberately conservative and deliberately dumb. It recognises four
 * shapes of American place reference and nothing else, and when it recognises
 * none it says so and the opportunity goes in the unlocated list. That is the
 * correct outcome: an opportunity with no stated location is a real and common
 * thing, and the alternative — reaching for the nearest coordinate, which is
 * always the company's head office — is the one failure this whole feature
 * exists to prevent.
 *
 * WHAT IT WILL NOT DO:
 *
 *   - It will not infer a site from a company name.
 *   - It will not fall back to a headquarters, ever, at any confidence.
 *   - It will not return a state alone as a project SITE. A state is an area,
 *     and it is returned as one, with the precision that says so.
 *
 * Everything returned carries `text`: the substring of the document it came
 * from, kept so the coordinate can always be checked against what was actually
 * written.
 */

export type ExtractedPrecision = 'address' | 'locality' | 'county' | 'region'

export interface ExtractedLocation {
  /** Verbatim from the document. The audit trail for the coordinate. */
  text: string
  /** A query a geocoder can answer. Built only from `text`. */
  query: string
  precision: ExtractedPrecision
  facilityName: string | null
  addressText: string | null
  locality: string | null
  county: string | null
  region: string | null
  /** Character offset in the searched text, so the nearest match can be chosen. */
  offset: number
}

/**
 * The fifty states and DC, with their postal abbreviations.
 *
 * An explicit list rather than a `[A-Z]{2}` pattern, because "in Purchase, NY"
 * and "in Item 5, OF" are the same shape and only one of them is a place.
 */
const STATES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia',
  FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
  ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan',
  MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota',
  OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota',
  TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia',
  WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
}

const STATE_NAMES = new Set(Object.values(STATES).map((n) => n.toLowerCase()))

function stateFrom(token: string): string | null {
  const trimmed = token.trim().replace(/\.$/, '')
  const upper = trimmed.toUpperCase()
  if (STATES[upper]) return STATES[upper]!
  if (STATE_NAMES.has(trimmed.toLowerCase())) {
    return Object.values(STATES).find((n) => n.toLowerCase() === trimmed.toLowerCase())!
  }
  return null
}

/** "1200 Industrial Parkway, Springdale, Arkansas" — a street address. */
const ADDRESS = new RegExp(
  String.raw`\b(\d{1,6}\s+[A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*){0,4}\s+` +
    String.raw`(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Boulevard|Blvd|Parkway|Pkwy|Lane|Ln|Way|Highway|Hwy|Route|Court|Ct|Circle|Cir)\.?)` +
    String.raw`\s*,\s*([A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*){0,3})\s*,\s*([A-Za-z.]{2,20})\b`,
  'g',
)

/** "Clanton County, Alabama" — a county. */
const COUNTY = new RegExp(
  String.raw`\b([A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*){0,2})\s+County\s*,\s*([A-Za-z.]{2,20})\b`,
  'g',
)

/** "in Springdale, Arkansas" — a city and state. */
const LOCALITY = new RegExp(
  String.raw`\b([A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*){0,3})\s*,\s*([A-Za-z.]{2,20})\b`,
  'g',
)

/**
 * A named plant, when the document gives one.
 *
 * Only accepted WITH a place — a facility name on its own is not a location, and
 * geocoding "the Springdale plant" without a state is how a pin lands in the
 * wrong country.
 */
const FACILITY_NAME = new RegExp(
  String.raw`\b((?:[A-Z][A-Za-z.'-]*\s+){1,4}(?:plant|facility|factory|mill|bakery|brewery|distribution\s+cent(?:er|re)|warehouse|campus))\b`,
  'gi',
)

/** Words that look like a city but are structural furniture in a filing. */
const NOT_A_PLACE = new Set([
  'inc', 'inc.', 'llc', 'l.l.c.', 'corp', 'corp.', 'corporation', 'company',
  'ltd', 'ltd.', 'co', 'co.', 'the', 'item', 'note', 'exhibit', 'section',
  'washington', // "Washington, D.C." as a filing address, not a project site
])

function cleanCity(value: string): string | null {
  const trimmed = value.trim().replace(/\s+/g, ' ')
  if (!trimmed) return null
  const last = trimmed.split(' ').pop()!.toLowerCase()
  if (NOT_A_PLACE.has(last)) return null
  if (NOT_A_PLACE.has(trimmed.toLowerCase())) return null
  return trimmed
}

/**
 * Every place the passage names, most precise first.
 *
 * Overlapping matches are resolved by precision, not by position: an address and
 * the city inside it are the same place said twice, and the address is the one
 * worth keeping.
 */
export function extractLocations(text: string): ExtractedLocation[] {
  if (!text || text.trim().length < 10) return []

  const found: ExtractedLocation[] = []
  const claimed: { start: number; end: number }[] = []

  const claim = (start: number, end: number): boolean => {
    if (claimed.some((c) => start < c.end && end > c.start)) return false
    claimed.push({ start, end })
    return true
  }

  const facilities = [...text.matchAll(FACILITY_NAME)].map((m) => ({
    name: m[1]!.trim(),
    offset: m.index ?? 0,
  }))

  /** The plant name nearest a place, when one is close enough to be about it. */
  const facilityNear = (offset: number): string | null => {
    let best: { name: string; distance: number } | null = null
    for (const f of facilities) {
      const distance = Math.abs(f.offset - offset)
      if (distance > 200) continue
      if (!best || distance < best.distance) best = { name: f.name, distance }
    }
    return best?.name ?? null
  }

  for (const match of text.matchAll(ADDRESS)) {
    const region = stateFrom(match[3]!)
    const locality = cleanCity(match[2]!)
    if (!region || !locality) continue
    const start = match.index ?? 0
    if (!claim(start, start + match[0]!.length)) continue
    found.push({
      text: match[0]!.trim(),
      query: `${match[1]!.trim()}, ${locality}, ${region}`,
      precision: 'address',
      facilityName: facilityNear(start),
      addressText: match[1]!.trim(),
      locality,
      county: null,
      region,
      offset: start,
    })
  }

  for (const match of text.matchAll(COUNTY)) {
    const region = stateFrom(match[2]!)
    if (!region) continue
    const start = match.index ?? 0
    if (!claim(start, start + match[0]!.length)) continue
    found.push({
      text: match[0]!.trim(),
      query: `${match[1]!.trim()} County, ${region}`,
      precision: 'county',
      facilityName: facilityNear(start),
      addressText: null,
      locality: null,
      county: `${match[1]!.trim()} County`,
      region,
      offset: start,
    })
  }

  for (const match of text.matchAll(LOCALITY)) {
    const region = stateFrom(match[2]!)
    const locality = cleanCity(match[1]!)
    if (!region || !locality) continue
    const start = match.index ?? 0
    if (!claim(start, start + match[0]!.length)) continue
    found.push({
      text: match[0]!.trim(),
      query: `${locality}, ${region}`,
      precision: 'locality',
      facilityName: facilityNear(start),
      addressText: null,
      locality,
      county: null,
      region,
      offset: start,
    })
  }

  const RANK: Record<ExtractedPrecision, number> = {
    address: 0,
    county: 1,
    locality: 2,
    region: 3,
  }
  return found.sort((a, b) => RANK[a.precision] - RANK[b.precision] || a.offset - b.offset)
}

/**
 * What KIND of marker an extraction earns.
 *
 * Only a street address counts as a confirmed site. Everything coarser is an
 * area, and is labelled as one — the schema enforces the same rule, so the two
 * cannot drift apart.
 */
export function markerTypeFor(
  precision: ExtractedPrecision,
): 'confirmed_project_site' | 'approximate_project_area' {
  return precision === 'address' ? 'confirmed_project_site' : 'approximate_project_area'
}

/** How wide a circle each coarse precision honestly covers, in metres. */
export const UNCERTAINTY_METRES: Record<ExtractedPrecision, number | null> = {
  address: null,
  locality: 8000,
  county: 25000,
  region: 150000,
}
