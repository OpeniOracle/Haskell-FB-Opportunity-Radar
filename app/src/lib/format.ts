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

export const accessModeLabel: Record<string, string> = {
  structured_primary: 'Structured primary source',
  archived_full_text: 'Archived full text',
  licensed_full_text: 'Licensed full text',
  reference_only: 'Reference only',
  metadata_only: 'Metadata only',
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

export function relativeTime(iso: string, now: Date = FIXTURE_NOW): string {
  const then = new Date(iso)
  const diffMs = now.getTime() - then.getTime()
  if (Number.isNaN(diffMs)) return iso

  const minutes = Math.round(diffMs / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`

  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hr ago`

  const days = Math.round(hours / 24)
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`

  const weeks = Math.round(days / 7)
  if (weeks < 5) return `${weeks} week${weeks === 1 ? '' : 's'} ago`

  return absoluteDate(iso)
}

export function absoluteDate(iso: string): string {
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return iso
  return `${then.getUTCDate()} ${MONTHS[then.getUTCMonth()]} ${then.getUTCFullYear()}`
}

export function absoluteDateTime(iso: string): string {
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return iso
  const hh = String(then.getUTCHours()).padStart(2, '0')
  const mm = String(then.getUTCMinutes()).padStart(2, '0')
  return `${absoluteDate(iso)}, ${hh}:${mm} UTC`
}
