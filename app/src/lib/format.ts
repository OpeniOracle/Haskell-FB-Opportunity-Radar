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
  archived_full_text: 'Public record — full text may be kept',
  licensed_full_text: 'Licensed source — full text may be kept',
  reference_only: 'Reference only — no copy kept',
  metadata_only: 'Listing only — no copy kept',
}

/**
 * WHAT THE RADAR HOLDS OF A SOURCE'S TEXT, said without claiming a saved copy.
 *
 * `access_mode` is a RETENTION PERMISSION: `archived_full_text` means the
 * source may be kept in full, not that a saved copy exists. Whether an archived
 * object exists is `archive_uri`, and the browser cannot see that column --
 * migration 0015 withholds it, with `body_text` and the storage paths, by
 * design. So the interface never says a saved copy exists: it has no way to
 * know, and today none does. No server path writes an archive object yet
 * (`src/test/evidenceRetention.test.ts` fails the day one does, which is the
 * day this wording must change, and only on a server-verified signal).
 *
 * Where the source permits it, the extracted text is held in the Radar's
 * database for re-checking. That text is never served to the interface, and
 * the wording says so rather than implying a copy the reader could open.
 */
export function savedCopyStatement(accessMode: string): string {
  switch (accessMode) {
    case 'reference_only':
      return 'None. This source is kept by reference only: its text is not stored, apart from the short excerpt shown.'
    case 'metadata_only':
      return 'None. Only the listing details are kept.'
    case 'structured_primary':
    case 'archived_full_text':
    case 'licensed_full_text':
      return (
        'No saved copy is available to open. The source permits keeping its full text, and the ' +
        "Radar holds the extracted text in its database for re-checking; it is not shown here. " +
        'Read the original at the source reference.'
      )
    default:
      return 'No saved copy is available to open. Read the original at the source reference.'
  }
}

/**
 * How a collection run ended, for a reader.
 *
 * A run that stopped early must never read as a finished one: "partial" says
 * in words that the run did not check everything it found.
 */
export const runOutcomeLabel: Record<string, string> = {
  success: 'complete',
  unchanged: 'complete, nothing new',
  partial_success: 'partial — did not check everything',
  failure: 'failed',
  running: 'in progress',
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
 * THE CLOCK EVERY RELATIVE LABEL IS MEASURED AGAINST.
 *
 * This defaulted to `FIXTURE_NOW` — a frozen instant in the middle of August
 * 2026 — because the preview build needed reproducible screenshots. Production
 * inherited the default, so a filing collected on 14 September was compared
 * against 17 August and rendered "in 4 weeks": today's evidence, presented as a
 * future event, on the surface whose entire claim is that it does not overstate
 * what it knows about time.
 *
 * The default is now the REAL clock, and the frozen instant is something a
 * caller has to ask for. That is the correct direction for the failure to run
 * in: a preview that forgets to freeze its clock produces drifting screenshots,
 * which someone notices. A production build that silently inherits a frozen one
 * produces confident, wrong dates, which nobody does.
 */
let displayClock: (() => Date) | null = null

/** Freeze the display clock. `null` restores the real one. */
export function setDisplayClock(clock: (() => Date) | null): void {
  displayClock = clock
}

/** The instant relative labels are measured from. Real time unless frozen. */
export function displayNow(): Date {
  return displayClock ? displayClock() : new Date()
}

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
export function isFutureInstant(iso: string, now: Date = displayNow()): boolean {
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
export function relativeTime(iso: string, now: Date = displayNow()): string {
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
