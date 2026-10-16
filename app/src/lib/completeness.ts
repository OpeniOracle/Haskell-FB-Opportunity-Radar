import type {
  DatasetFailureReason,
  DatasetKey,
  DatasetReadReport,
  ReadCompleteness,
} from '@/types/domain'

/**
 * WHETHER A READ RETURNED EVERYTHING, AND HOW TO SAY SO.
 *
 * The browser reads whole tables with a row cap. Past the cap, the database
 * returns the first N rows and says nothing, and a page built from those rows
 * reads as if it were built from all of them: a count of 1,000 beside 1,500
 * stored records, an opportunity with fewer documents than it has, an account
 * reported as uncovered because the link that covers it fell past the cap.
 *
 * Nothing here repairs that. Ordering a query makes the rows it keeps
 * DETERMINISTIC; it does not make them COMPLETE, and no function in this file
 * treats the two as the same thing. What this does is make the gap visible: the
 * database is asked for its own total in the same request, the rows that came
 * back are compared with it, and the answer is one of four statuses a surface
 * can render.
 *
 * Pure functions only, so the rules are testable without a database.
 */

export const DATASET_LABEL: Record<DatasetKey, string> = {
  organizations: 'accounts',
  opportunities: 'opportunities',
  signals: 'signals',
  evidence: 'evidence records',
  opportunity_signals: 'opportunity–signal links',
  signal_evidence: 'signal–evidence links',
  sources: 'sources',
  account_source_expectations: 'coverage expectations',
  source_runs: 'collection runs',
  organization_locations: 'account locations',
  opportunity_locations: 'project locations',
  change_events: 'market changes',
  source_health_events: 'source status changes',
}

/**
 * The datasets a derived relationship passes through: an opportunity's
 * documents are reached opportunity -> link -> signal -> link -> evidence, so
 * truncation anywhere along the path can make the result short.
 */
export const RELATIONSHIP_DATASETS: readonly DatasetKey[] = [
  'opportunities',
  'signals',
  'evidence',
  'opportunity_signals',
  'signal_evidence',
]

/**
 * A count the database sent back, if it is a count.
 *
 * PostgREST returns the total in `Content-Range`, which supabase-js parses into
 * `count`. A proxy that strips the header, a view that does not support
 * counting, or a client that was never asked all produce `null` or `undefined`
 * here, and so does anything that is not a non-negative whole number. Each of
 * those means "the total is not known", which is different from "the total is
 * zero", and nothing below treats them the same.
 */
export function validCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
}

/**
 * What a full-table read turned out to be.
 *
 * The comparison is against THE DATABASE'S TOTAL, never against the row limit
 * the client asked for. A server-side cap lower than the client's limit (Supabase
 * ships with 1,000) would otherwise make a truncated read look complete the
 * moment it returned fewer rows than the client's own limit.
 */
export function reportRead(
  dataset: DatasetKey,
  returned: number,
  count: unknown,
  limit: number,
): DatasetReadReport {
  const base = { dataset, label: DATASET_LABEL[dataset], returned, limit }
  const total = validCount(count)

  // No total, or a total smaller than what came back (an inconsistent response):
  // nothing can be claimed about whether the rows are all of them.
  if (total === null || returned > total) {
    return { ...base, status: 'indeterminate', total: null }
  }
  return { ...base, status: returned === total ? 'complete' : 'truncated', total }
}

/** A read that asks for a bounded slice on purpose: the latest N. Not a fault. */
export function reportLimited(dataset: DatasetKey, returned: number, limit: number): DatasetReadReport {
  return { dataset, label: DATASET_LABEL[dataset], status: 'limited', returned, total: null, limit }
}

/**
 * A read that errored where the surface can still say something without it.
 *
 * `reason` says what kind of failure it was, so "the account may not read this",
 * "the table is not there yet" and "the request did not complete" are not all
 * reported as the same sentence. It defaults to the least specific, `error`.
 */
export function reportFailed(
  dataset: DatasetKey,
  limit: number,
  reason: DatasetFailureReason = 'error',
): DatasetReadReport {
  return {
    dataset,
    label: DATASET_LABEL[dataset],
    status: 'failed',
    reason,
    returned: 0,
    total: null,
    limit,
  }
}

/** `complete` is false for anything but complete or deliberately limited. */
export function completenessOf(datasets: DatasetReadReport[]): ReadCompleteness {
  return {
    complete: datasets.every((d) => d.status === 'complete' || d.status === 'limited'),
    datasets,
  }
}

/** Only the reports a surface depends on, in the order it names them. */
export function pick(all: Partial<Record<DatasetKey, DatasetReadReport>>, keys: DatasetKey[]): DatasetReadReport[] {
  return keys.map((k) => all[k]).filter((r): r is DatasetReadReport => Boolean(r))
}

/**
 * Whether a figure built from these datasets can be shown as exact.
 *
 * `completeness` absent means the state makes no claim either way (a fixture, a
 * single-record read), and the figure is exact. When it IS present, a dataset
 * the figure depends on that has no report, or any status but `complete`,
 * makes the figure inexact: a missing report is a bug in the caller, and the
 * safe reading of a bug is "do not claim exactness".
 */
export function figureIsExact(
  completeness: ReadCompleteness | undefined,
  ...keys: DatasetKey[]
): boolean {
  if (!completeness) return true
  return keys.every((key) => completeness.datasets.find((d) => d.dataset === key)?.status === 'complete')
}

/** What the database says exists, when it said. */
export function datasetTotal(
  completeness: ReadCompleteness | undefined,
  key: DatasetKey,
): number | null {
  return completeness?.datasets.find((d) => d.dataset === key)?.total ?? null
}

/**
 * The plain-language content of the notice, separated from its markup so the
 * wording can be asserted on without rendering anything.
 *
 * `shortfalls` say what is missing, in numbers. `consequences` say what that
 * does to the figures on the page, and are written to be accurate rather than
 * alarming: the stored records are not lost, this view of them is limited.
 */
export interface IncompletenessDescription {
  shortfalls: string[]
  consequences: string[]
}

const n = (value: number) => value.toLocaleString('en-US')

/**
 * One sentence per kind of failure, each pointing at what is actually wrong.
 *
 * A missing privilege is a deployment fault and is said not to be about the
 * reader; a table that does not exist yet is a pending migration; neither is an
 * outage, and neither is "empty".
 */
function failureSentence(d: DatasetReadReport): string {
  switch (d.reason) {
    case 'not_permitted':
      return `The ${d.label} could not be read: a database permission is missing. Your access is unaffected; this is a deployment fault.`
    case 'not_migrated':
      return `The ${d.label} are not available yet: a database migration is outstanding.`
    case 'unauthorized':
      return `The ${d.label} could not be read: the session was not accepted.`
    default:
      return `The ${d.label} could not be read.`
  }
}

export function describeIncompleteness(completeness: ReadCompleteness): IncompletenessDescription {
  const short = completeness.datasets.filter(
    (d) => d.status === 'truncated' || d.status === 'indeterminate' || d.status === 'failed',
  )
  if (short.length === 0) return { shortfalls: [], consequences: [] }

  const shortfalls = short.map((d) => {
    switch (d.status) {
      case 'truncated':
        return `Showing ${n(d.returned)} of ${n(d.total ?? d.returned)} ${d.label}.`
      case 'indeterminate':
        return `Could not confirm that all ${d.label} were loaded (${n(d.returned)} came back).`
      default:
        return failureSentence(d)
    }
  })

  const affected = new Set(short.map((d) => d.dataset))
  const any = (...keys: DatasetKey[]) => keys.some((k) => affected.has(k))
  const consequences: string[] = []

  // Said first because it is the sentence people act on, and kept literally true:
  // every count on an affected surface is either the database's own total or is
  // marked as a floor. A dataset that did not produce counts says nothing here.
  if (any('opportunities', 'signals', 'evidence', 'source_runs', 'organization_locations', 'opportunity_locations')) {
    consequences.push(
      'Where the database reported a total it is shown. Every other count is marked “at least”. Lists show only the records that loaded.',
    )
  }
  if (RELATIONSHIP_DATASETS.some((k) => affected.has(k))) {
    consequences.push(
      'Links between opportunities, signals and documents are incomplete, so an opportunity can show fewer documents than it has, and coverage can look worse than it is.',
    )
  }
  if (any('organizations')) {
    consequences.push('Accounts that did not load are not listed, and their coverage is not counted.')
  }
  if (any('sources')) {
    consequences.push('Source health covers only the sources that loaded.')
  }
  if (any('account_source_expectations')) {
    consequences.push('Coverage gaps cannot be judged reliably without every coverage expectation.')
  }
  if (any('organization_locations', 'opportunity_locations')) {
    consequences.push(
      'Some projects may be missing from the map, and a project listed without a location may simply not have had its location loaded.',
    )
  }
  if (any('source_runs')) {
    consequences.push('Run totals cover the loaded runs only.')
  }
  if (any('change_events')) {
    consequences.push('Market changes are missing from the recent-changes list.')
  }
  if (any('source_health_events')) {
    consequences.push('Source status changes are missing from the recent-changes list.')
  }
  consequences.push('The stored records are unchanged; it is this view of them that is limited.')

  return { shortfalls, consequences }
}
