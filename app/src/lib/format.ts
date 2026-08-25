import type {
  AssessmentType,
  ConfidenceAxes,
  EvidenceStrength,
  OpportunityStage,
  OpportunityStatus,
  TemporalValue,
} from '@/types/domain'

/* ------------------------------------------------------------------ Temporal */

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const

function parseIsoDate(iso: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!match) return null
  const [, y, m, d] = match
  if (y === undefined || m === undefined || d === undefined) return null
  return { y: Number(y), m: Number(m), d: Number(d) }
}

/**
 * Render a temporal value at the precision it was actually recorded at.
 *
 * This is the D15 / ADR 0004 rule made visible: "by spring 2029" must never be
 * displayed as 31 March 2029. When a raw expression was captured we show it,
 * because it is what the source said. The computed interval is available as a
 * secondary line for anyone who needs the machine-readable bounds.
 */
export function formatTemporal(value: TemporalValue): string {
  if (value.rawExpression) return value.rawExpression

  if (value.precision === 'unknown' || !value.start) return 'No date given'

  const start = parseIsoDate(value.start)
  if (!start) return value.start

  switch (value.precision) {
    case 'exact_day':
      return `${start.d} ${MONTHS[start.m - 1]} ${start.y}`
    case 'month':
      return `${MONTHS[start.m - 1]} ${start.y}`
    case 'quarter':
      return `Q${Math.floor((start.m - 1) / 3) + 1} ${start.y}`
    case 'half_year':
      return `${start.m <= 6 ? 'First' : 'Second'} half of ${start.y}`
    case 'season':
      return `${seasonName(start.m)} ${start.y}`
    case 'year':
      return `${start.y}`
    case 'range': {
      const end = value.end ? parseIsoDate(value.end) : null
      if (!end) return `From ${start.d} ${MONTHS[start.m - 1]} ${start.y}`
      return `${MONTHS[start.m - 1]} ${start.y} – ${MONTHS[end.m - 1]} ${end.y}`
    }
    case 'relative':
      return 'Relative to an unresolved reference date'
    default:
      return value.start
  }
}

function seasonName(month: number): string {
  if (month <= 2 || month === 12) return 'Winter'
  if (month <= 5) return 'Spring'
  if (month <= 8) return 'Summer'
  return 'Autumn'
}

/** The precision label shown beside a horizon, so nobody over-reads the value. */
export function precisionLabel(value: TemporalValue): string {
  const precision: Record<TemporalValue['precision'], string> = {
    exact_day: 'exact date',
    month: 'month precision',
    quarter: 'quarter precision',
    season: 'season precision',
    half_year: 'half-year precision',
    year: 'year precision',
    range: 'date range',
    relative: 'relative date',
    unknown: 'no date recorded',
  }
  const base = precision[value.precision]
  return value.basis === 'inferred' ? `${base}, inferred` : base
}

/* ------------------------------------------------------------------- Labels */

export const stageLabel: Record<OpportunityStage, string> = {
  emerging: 'Emerging',
  developing: 'Developing',
  confirmed: 'Confirmed',
}

export const statusLabel: Record<OpportunityStatus, string> = {
  new: 'New',
  watching: 'Watching',
  pursue: 'Pursuing',
  assigned: 'Assigned',
  on_hold: 'On hold',
  dismissed: 'Dismissed',
  closed_won: 'Closed — won',
  closed_lost: 'Closed — lost',
  cancelled: 'Cancelled',
  expired: 'Expired',
}

export const evidenceStrengthLabel: Record<EvidenceStrength, string> = {
  indicative: 'Indicative',
  corroborated: 'Corroborated',
  authoritative: 'Authoritative',
}

export const assessmentTypeLabel: Record<AssessmentType, string> = {
  observed_fact: 'Observed fact',
  inference: 'Inference',
  hypothesis: 'Hypothesis',
}

/**
 * Access mode in the words a business-development reader uses.
 *
 * `structured_primary` and the rest are the recorded values and stay exactly as
 * they are in the model. What changes is only what the primary reading path
 * says: an F&B account manager should not have to learn the vocabulary of an
 * evidence pipeline to find out where a claim came from. The precise recorded
 * value is kept alongside, in secondary text.
 */
export const accessModeLabel: Record<string, string> = {
  structured_primary: 'Official structured record',
  archived_full_text: 'Saved copy of the full article',
  licensed_full_text: 'Licensed copy of the full article',
  reference_only: 'Reference only — no copy kept',
  metadata_only: 'Listing only — no copy kept',
}

/** How the value is recorded, for the reader who wants the exact term. */
export const accessModeRecordedValue: Record<string, string> = {
  structured_primary: 'structured_primary',
  archived_full_text: 'archived_full_text',
  licensed_full_text: 'licensed_full_text',
  reference_only: 'reference_only',
  metadata_only: 'metadata_only',
}

/** Confidence level, title-cased at the source rather than by a CSS transform. */
export const confidenceLevelLabel: Record<string, string> = {
  high: 'High',
  moderate: 'Moderate',
  low: 'Low',
}

/** How a stated timing was arrived at, in plain words. */
export const timingBasisLabel: Record<string, string> = {
  stated: 'Stated by the source',
  inferred: 'Worked out by the platform',
  unknown: 'Not recorded',
}

/**
 * One sentence describing all three confidence axes together.
 *
 * The axes are shown separately in the UI; this is the accessible-name version
 * so a screen reader user hears the whole assessment rather than three
 * disconnected pills.
 */
export function confidenceSentence(c: ConfidenceAxes): string {
  return `${evidenceStrengthLabel[c.evidenceStrength]} evidence, recorded as ${assessmentTypeLabel[
    c.assessmentType
  ].toLowerCase()}, ${c.confidenceLevel} confidence.`
}

/* -------------------------------------------------------------------- Dates */

/**
 * A fixed reference "now" so screenshots and tests are deterministic.
 *
 * Fixture timestamps are relative to this instant. A real clock would make the
 * relative labels drift every time a reviewer opens the preview, which would make
 * the screenshots in the PR unreproducible.
 */
export const FIXTURE_NOW = new Date('2026-08-17T08:00:00Z')

/**
 * A value that could not be read as an instant.
 *
 * Returning the raw string here used to be the fallback, which put a fragment of
 * a malformed payload in front of a user as though it were a date. Saying the
 * date is unavailable is the honest option; the caller keeps the raw value and
 * can show it as technical detail.
 */
export const INVALID_INSTANT = 'Date unavailable'

/** Is this instant later than the reference now? */
export function isFutureInstant(iso: string, now: Date = FIXTURE_NOW): boolean {
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return false
  return then.getTime() > now.getTime()
}

/** Magnitude of a gap, with no direction attached. */
function magnitude(absMs: number): string | null {
  const minutes = Math.round(absMs / 60000)
  if (minutes < 60) return `${minutes} min`

  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hr`

  const days = Math.round(hours / 24)
  if (days < 7) return `${days} day${days === 1 ? '' : 's'}`

  const weeks = Math.round(days / 7)
  if (weeks < 5) return `${weeks} week${weeks === 1 ? '' : 's'}`

  // Past the point where "n weeks" is useful, an absolute date says more than a
  // relative one — in either direction.
  return null
}

/**
 * A human-readable gap between an instant and now.
 *
 * **Direction is never dropped.** The earlier version computed `now - then` and
 * sent anything under a minute to "just now", so a timestamp ten months in the
 * FUTURE — a clock-skewed collector, a source with a bad published date, a
 * fixture typo — rendered as though it had just happened. In a product whose
 * whole claim is that it does not overstate what it knows about time, that was
 * the worst possible failure: silent, confident, and wrong.
 *
 * Past reads "X ago", future reads "in X", and a future instant less than a
 * minute away reads "in under a minute" so it can never be mistaken for now.
 */
export function relativeTime(iso: string, now: Date = FIXTURE_NOW): string {
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return INVALID_INSTANT

  const diffMs = now.getTime() - then.getTime()
  const future = diffMs < 0
  const abs = Math.abs(diffMs)

  if (Math.round(abs / 60000) < 1) {
    // Distinguishable from "just now" even a second out.
    return future ? 'in under a minute' : 'just now'
  }

  const mag = magnitude(abs)
  if (mag === null) return absoluteDate(iso)
  return future ? `in ${mag}` : `${mag} ago`
}

export function absoluteDate(iso: string): string {
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return INVALID_INSTANT
  return `${then.getUTCDate()} ${MONTHS[then.getUTCMonth()]} ${then.getUTCFullYear()}`
}

export function absoluteDateTime(iso: string): string {
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return INVALID_INSTANT
  const hh = String(then.getUTCHours()).padStart(2, '0')
  const mm = String(then.getUTCMinutes()).padStart(2, '0')
  return `${absoluteDate(iso)}, ${hh}:${mm} UTC`
}
