import type {
  ChangeEvent,
  ChangeKind,
  ChangeTone,
  OpportunityStage,
  OpportunityStatus,
} from '@/types/domain'
import { stageLabel, statusLabel } from '@/lib/format'

/**
 * WHAT THE DAILY PULSE CHANGE FEED MAY SAY, AND WHAT IT MAY NOT.
 *
 * A change feed is a list of claims: "this happened to that, then". Every claim
 * here is built from fields a database row actually carries, and where a field is
 * absent, unrecognised or inconsistent the sentence gets SHORTER, never fuller.
 * Nothing in this file names an organisation, a project, a date or a commercial
 * consequence that the row does not itself contain, and nothing here says why a
 * change matters to business development: the ledger records that a change
 * happened and whether its writer judged it material, and that is all it knows.
 *
 * TWO LEDGERS, TWO CHANNELS
 *
 *   change_events         the market ledger (ADR 0007): what changed on an
 *                         opportunity, signal, account or facility.
 *   source_health_events  the operational ledger: what happened to a connector.
 *
 * They are read separately and kept separate: a market change is `channel:
 * 'market'`, a connector event is `channel: 'system'`, decided by WHICH LEDGER A
 * ROW CAME FROM and by nothing in its text. Daily Pulse leads with the first and
 * files the second underneath.
 *
 * WHAT IS ACTUALLY WRITTEN TODAY
 *
 * `source_health_events` has a writer: the connector runner records every health
 * transition and every run it abandons, skips, defers or blocks
 * (`runner.ts`, `recordSourceOutcome`), with a plain-language `summary` of its own.
 *
 * `change_events` has NO writer. ADR 0007 gives it to the scoring-and-promotion
 * engine and the classification pipeline, and neither exists yet; no application
 * code and no database trigger inserts into it. The market vocabulary below is
 * therefore a READING CONTRACT, built from the identifiers the repository itself
 * names (the column comment in migration 0012, and `ChangeKind`) and from the
 * materiality list in ADR 0007, and it is validated on every row. It describes
 * rows if and when a writer produces them; it is not an observed distribution.
 *
 * UNRECOGNISED ROWS ARE COUNTED, NOT SHOWN AS SOMETHING ELSE
 *
 * `change_type` and `event_type` are free text, with no CHECK constraint. A value
 * not in the vocabulary, or a known value on an object type it is not defined
 * for, is left out of the list and counted in `notListed`. It is never relabelled
 * as the nearest known type: relabelling is exactly how every row once became
 * "evidence added".
 *
 * Pure functions, no I/O.
 */

/* ------------------------------------------------------------------- shapes */

/** A row as the database returns it. Nothing about its shape is trusted. */
type Row = Record<string, unknown>

export type ChangeObjectType =
  | 'opportunity'
  | 'signal'
  | 'market_trend'
  | 'facility'
  | 'organization'
  | 'source'

const OBJECT_TYPES: ReadonlySet<string> = new Set<ChangeObjectType>([
  'opportunity',
  'signal',
  'market_trend',
  'facility',
  'organization',
  'source',
])

/** The `object_type` values the ledger's CHECK constraint allows, for tests to compare with the DDL. */
export const CHANGE_OBJECT_TYPES: readonly string[] = [...OBJECT_TYPES]

/** Records the page already holds, so a subject can be named without another read. */
export interface RecordLookup {
  opportunity(id: string): { title: string; organizationName: string | null } | null
  organization(id: string): { name: string } | null
  signal(id: string): { title: string | null } | null
  source(id: string): { name: string } | null
  /**
   * Whether the read behind that lookup was whole. When it was, an absent record is
   * ABSENT; when it was not, it may simply not have loaded, and the label says so.
   */
  wasWhole(kind: 'opportunity' | 'organization' | 'signal' | 'source'): boolean
}

/**
 * Why a row is not in the list.
 *
 * `not_material` is by design and is not counted: the market ledger holds minor
 * and silent rows for other readers, and ADR 0007 gives Pulse the material ones.
 * The others are counted, because each is a recorded change the page could not
 * stand behind.
 */
export type SkipReason = 'not_material' | 'unsupported_type' | 'unsupported_subject' | 'malformed'

export type Described = { event: ChangeEvent } | { skipped: SkipReason }

/* ------------------------------------------------------------------ helpers */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const has = (object: object, key: string) => Object.prototype.hasOwnProperty.call(object, key)

/** A string that is present. Empty or whitespace-only is not. */
function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

/**
 * A timestamp the row actually holds. An unparseable one is not repaired or
 * replaced with "now": a change with no usable date cannot be placed in a
 * newest-first list, so it is left out and counted.
 */
function timestamp(value: unknown): string | null {
  const raw = text(value)
  return raw !== null && Number.isFinite(Date.parse(raw)) ? raw : null
}

function stageIn(state: unknown): OpportunityStage | null {
  const value = isRecord(state) ? state.stage : undefined
  return typeof value === 'string' && has(stageLabel, value) ? (value as OpportunityStage) : null
}

function statusIn(state: unknown): OpportunityStatus | null {
  const value = isRecord(state) ? state.status : undefined
  return typeof value === 'string' && has(statusLabel, value) ? (value as OpportunityStatus) : null
}

/** Statuses that end an opportunity's life, per the `opportunities.status` vocabulary. */
const CLOSING_STATUSES: ReadonlySet<OpportunityStatus> = new Set<OpportunityStatus>([
  'closed_won',
  'closed_lost',
  'cancelled',
  'expired',
])

const NOUN: Record<ChangeObjectType, string> = {
  opportunity: 'opportunity',
  signal: 'signal',
  market_trend: 'market trend',
  facility: 'facility',
  organization: 'account',
  source: 'source',
}

const capitalised = (value: string) => value.charAt(0).toUpperCase() + value.slice(1)

interface Subject {
  label: string
  noun: string
  /** Set only when the opportunity is one the page holds, so the link opens something. */
  opportunityId: string | null
}

/**
 * Name the object a change happened to, using only records already loaded.
 *
 * A record that is not among them is named by its KIND with the honest reason:
 * "not found" when the read was whole and it is not there, "not loaded" when the
 * read fell short and it might be. Facilities and market trends are not read by
 * this page at all, so they are named by kind alone and nothing is said about
 * whether they exist.
 */
function subjectOf(objectType: ChangeObjectType, objectId: string, lookup: RecordLookup): Subject {
  const noun = NOUN[objectType]

  if (objectType === 'opportunity') {
    const found = lookup.opportunity(objectId)
    if (found) {
      return {
        label: found.organizationName ? `${found.title} — ${found.organizationName}` : found.title,
        noun,
        opportunityId: objectId,
      }
    }
  } else if (objectType === 'organization') {
    const found = lookup.organization(objectId)
    if (found) return { label: found.name, noun, opportunityId: null }
  } else if (objectType === 'signal') {
    const found = lookup.signal(objectId)
    // A signal that exists with no title is named for that, not as a missing record.
    if (found) return { label: found.title ?? 'Signal (no title recorded)', noun, opportunityId: null }
  } else if (objectType === 'source') {
    const found = lookup.source(objectId)
    if (found) return { label: found.name, noun, opportunityId: null }
  } else {
    return { label: capitalised(noun), noun, opportunityId: null }
  }

  const reason = lookup.wasWhole(objectType) ? 'not found' : 'not loaded'
  return { label: `${capitalised(noun)} (record ${reason})`, noun, opportunityId: null }
}

/* ------------------------------------------------------------ market ledger */

interface MarketRule {
  kind: ChangeKind
  /** The object types this change is defined for. Any other is `unsupported_subject`. */
  objects: readonly ChangeObjectType[]
  title: string
  detail(from: unknown, to: unknown, subject: Subject, objectType: ChangeObjectType): string
  tone(from: unknown, to: unknown): ChangeTone
}

/** "Stage: Emerging → Developing." with whatever of it the row actually states. */
function stageDetail(from: unknown, to: unknown): string {
  const before = stageIn(from)
  const after = stageIn(to)
  if (before && after) return `Stage: ${stageLabel[before]} → ${stageLabel[after]}.`
  if (after) return `Now at stage ${stageLabel[after]}.`
  return 'The recorded change does not say which stages.'
}

const stageTone = (_from: unknown, to: unknown): ChangeTone => stageIn(to) ?? 'neutral'

/*
   WHERE EACH IDENTIFIER COMES FROM.

   Named literally in the repository:
     stage_promoted, evidence_added, closed   the column comment in migration 0012
     stage_promoted, evidence_added,
     facility_resolved, negative_signal        `ChangeKind`, the application's own vocabulary
   Taken from the materiality list in ADR 0007 ("stage promotion or demotion ...
   status change ... first facility resolution ... negative-signal arrival"), with
   the identifier spelt in the same pattern:
     stage_demoted, status_changed

   Nothing outside this list is described. See the file header.
*/
const MARKET_RULES: ReadonlyMap<string, MarketRule> = new Map<string, MarketRule>([
  [
    'stage_promoted',
    {
      kind: 'stage_promoted',
      objects: ['opportunity'],
      title: 'Stage promoted',
      detail: (from, to) => stageDetail(from, to),
      tone: stageTone,
    },
  ],
  [
    'stage_demoted',
    {
      kind: 'stage_demoted',
      objects: ['opportunity'],
      title: 'Stage demoted',
      detail: (from, to) => stageDetail(from, to),
      tone: stageTone,
    },
  ],
  [
    'status_changed',
    {
      kind: 'status_changed',
      objects: ['opportunity'],
      title: 'Status changed',
      detail: (from, to) => {
        const before = statusIn(from)
        const after = statusIn(to)
        if (before && after) return `Status: ${statusLabel[before]} → ${statusLabel[after]}.`
        if (after) return `Now ${statusLabel[after]}.`
        return 'The recorded change does not say which statuses.'
      },
      tone: () => 'neutral',
    },
  ],
  [
    'closed',
    {
      kind: 'closed',
      objects: ['opportunity'],
      title: 'Closed',
      detail: (_from, to) => {
        // Only a status that actually closes something is repeated. A "closed"
        // event whose to_state says "watching" contradicts itself, so it is not
        // quoted.
        const after = statusIn(to)
        return after && CLOSING_STATUSES.has(after)
          ? `Recorded as ${statusLabel[after]}.`
          : 'Recorded as closed; the outcome is not stated.'
      },
      tone: () => 'neutral',
    },
  ],
  [
    'evidence_added',
    {
      kind: 'evidence_added',
      objects: ['opportunity', 'signal', 'organization'],
      title: 'New evidence',
      detail: (_from, _to, subject) => `New evidence was recorded for this ${subject.noun}.`,
      tone: () => 'neutral',
    },
  ],
  [
    'facility_resolved',
    {
      kind: 'facility_resolved',
      objects: ['opportunity', 'organization', 'facility'],
      title: 'Facility resolved',
      detail: (_from, _to, subject, objectType) =>
        objectType === 'facility'
          ? 'This facility record was resolved.'
          : `A facility was resolved for this ${subject.noun}.`,
      tone: () => 'neutral',
    },
  ],
  [
    'negative_signal',
    {
      kind: 'negative_signal',
      objects: ['signal', 'opportunity', 'organization'],
      title: 'Negative signal',
      detail: (_from, _to, subject) => `A negative signal was recorded for this ${subject.noun}.`,
      tone: () => 'attention',
    },
  ],
])

/** The change types the market feed can describe, for tests and documentation. */
export const MARKET_CHANGE_TYPES: readonly string[] = [...MARKET_RULES.keys()]

/**
 * Describe one `change_events` row, or say why it is not listed.
 *
 * `needsAttention` is always false and `actionHint` always null. Whether a change
 * calls for action is a judgement about the account and the commercial position,
 * and the ledger does not carry one: it carries `materiality`, which only decides
 * whether the change is listed at all.
 */
export function describeMarketChange(row: Row, lookup: RecordLookup): Described {
  if (row.materiality !== 'material') return { skipped: 'not_material' }

  const id = text(row.id)
  const occurredAt = timestamp(row.occurred_at)
  const objectId = text(row.object_id)
  const objectType = typeof row.object_type === 'string' ? row.object_type : ''
  const changeType = text(row.change_type)
  if (!id || !occurredAt || !objectId || !OBJECT_TYPES.has(objectType) || !changeType) {
    return { skipped: 'malformed' }
  }

  const rule = MARKET_RULES.get(changeType)
  if (!rule) return { skipped: 'unsupported_type' }
  const object = objectType as ChangeObjectType
  if (!rule.objects.includes(object)) return { skipped: 'unsupported_subject' }

  const subject = subjectOf(object, objectId, lookup)
  return {
    event: {
      id,
      kind: rule.kind,
      channel: 'market',
      tone: rule.tone(row.from_state, row.to_state),
      title: rule.title,
      detail: rule.detail(row.from_state, row.to_state, subject, object),
      occurredAt,
      subjectLabel: subject.label,
      needsAttention: false,
      actionHint: null,
      opportunityId: subject.opportunityId,
    },
  }
}

/* ------------------------------------------------------- operational ledger */

/** Every value `sources.health_status` may take (schemas/database.sql, migration 0021). */
const SOURCE_STATUS_LABEL: Readonly<Record<string, string>> = {
  healthy: 'Healthy',
  degraded: 'Degraded',
  action_required: 'Needs action',
  disabled: 'Disabled',
  unsupported: 'Unsupported',
  manual_review_required: 'Needs manual review',
  source_unavailable: 'Unavailable',
}

/** The `sources.health_status` values the feed can name, for tests to compare with the DDL. */
export const SOURCE_HEALTH_STATUSES: readonly string[] = Object.keys(SOURCE_STATUS_LABEL)

/** Statuses that mean the source is not collecting as it should. */
const UNHEALTHY: ReadonlySet<string> = new Set([
  'degraded',
  'action_required',
  'manual_review_required',
  'source_unavailable',
])

const DEGRADED_TITLE: Readonly<Record<string, string>> = {
  degraded: 'Source degraded',
  action_required: 'Source needs action',
  manual_review_required: 'Source needs manual review',
  source_unavailable: 'Source unavailable',
}

/**
 * The `event_type` values `runner.ts` writes when a source's status did not
 * change but something about a run is worth recording.
 */
const NOTICE: Readonly<Record<string, { title: string; tone: ChangeTone }>> = {
  run_abandoned: { title: 'Collection run abandoned', tone: 'attention' },
  failure: { title: 'Collection failed', tone: 'attention' },
  blocked_egress: { title: 'Collection blocked', tone: 'attention' },
  skipped_overlap: { title: 'Collection run skipped', tone: 'neutral' },
  deferred_time_budget: { title: 'Collection deferred', tone: 'neutral' },
}

/** The operational event types the feed can describe, for tests and documentation. */
export const SOURCE_EVENT_TYPES: readonly string[] = Object.keys(NOTICE)

/** The most of the collector's own summary that is repeated in the feed. */
const SUMMARY_LIMIT = 280

/**
 * What a stored `action_required` payload asks of a person, in the words the
 * runner's own `action` values carry. An action this does not know is reported
 * as "flagged for a person", which is all the row says.
 */
function actionHintOf(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const action = isRecord(value) ? value.action : undefined
  if (action === 'operator_import') return 'An operator import is needed for this source.'
  if (action === 'extend_egress_allowlist') {
    return "The collector's network allowlist needs extending for this source."
  }
  return 'This source has been flagged for a person to review.'
}

function truncated(value: string): string {
  const clean = value.replace(/\s+/g, ' ').trim()
  return clean.length > SUMMARY_LIMIT ? `${clean.slice(0, SUMMARY_LIMIT - 1).trimEnd()}…` : clean
}

/**
 * Describe one `source_health_events` row, or say why it is not listed.
 *
 * The sentence is the status transition the row records plus the collector's own
 * `summary`, repeated and shortened, not rewritten: the runner wrote it, from
 * what it observed, at the time.
 */
export function describeSourceEvent(row: Row, lookup: RecordLookup): Described {
  const id = text(row.id)
  const occurredAt = timestamp(row.created_at)
  const sourceId = text(row.source_id)
  const eventType = text(row.event_type)
  if (!id || !occurredAt || !sourceId || !eventType) return { skipped: 'malformed' }

  const next = typeof row.new_status === 'string' && has(SOURCE_STATUS_LABEL, row.new_status) ? row.new_status : null
  if (next === null) return { skipped: 'unsupported_type' }
  // A prior status that is present but not in the vocabulary is unknown, not
  // "no change": it must not be allowed to manufacture or hide a transition.
  const prior =
    typeof row.prior_status === 'string' && has(SOURCE_STATUS_LABEL, row.prior_status)
      ? row.prior_status
      : null
  // The status the source moved FROM, only when the row records a real move.
  const from = prior !== null && prior !== next ? prior : null

  const named = lookup.source(sourceId)
  const summary = text(row.summary)
  const transition = from !== null ? `Status: ${SOURCE_STATUS_LABEL[from]} → ${SOURCE_STATUS_LABEL[next]}.` : null
  const detail = [transition, summary ? truncated(summary) : null].filter(Boolean).join(' ')
  const actionHint = actionHintOf(row.action_required)

  let kind: ChangeKind
  let tone: ChangeTone
  let title: string

  if (from !== null && UNHEALTHY.has(from) && next === 'healthy') {
    kind = 'source_recovered'
    tone = 'neutral'
    title = 'Source recovered'
  } else if (from !== null && UNHEALTHY.has(next)) {
    kind = 'coverage_degraded'
    tone = 'attention'
    title = DEGRADED_TITLE[next] ?? 'Source degraded'
  } else if (from !== null) {
    // A real transition between two states that are neither a failure nor a
    // recovery, e.g. a source being enabled. Said as exactly that.
    kind = 'source_notice'
    tone = 'neutral'
    title = 'Source status changed'
  } else {
    const notice = has(NOTICE, eventType) ? NOTICE[eventType] : undefined
    if (!notice) return { skipped: 'unsupported_type' }
    kind = 'source_notice'
    tone = notice.tone
    title = notice.title
  }

  return {
    event: {
      id: `health:${id}`,
      kind,
      channel: 'system',
      tone,
      title,
      detail,
      occurredAt,
      subjectLabel: named?.name ?? sourceId,
      needsAttention: actionHint !== null,
      actionHint,
      opportunityId: null,
    },
  }
}

/* ----------------------------------------------------------------- assembly */

export interface AssembledFeed {
  events: ChangeEvent[]
  /** Recorded changes that were read and are not listed because they could not be described. */
  notListed: number
  /** True when more described changes exist than the limit allows. */
  overflowed: boolean
}

/**
 * Merge the described rows of both ledgers into one newest-first, bounded list.
 *
 * Ordered by the instant, not the string (offsets and fractional seconds differ),
 * and ties are broken by id, so two reads of the same rows list them identically.
 * Each ledger is read newest-first and bounded by the same limit, so the newest
 * `limit` of the union is always contained in what was read.
 */
export function assembleFeed(parts: readonly (readonly Described[])[], limit: number): AssembledFeed {
  const events: ChangeEvent[] = []
  let notListed = 0

  for (const part of parts) {
    for (const item of part) {
      if ('event' in item) events.push(item.event)
      else if (item.skipped !== 'not_material') notListed += 1
    }
  }

  events.sort((a, b) => {
    const delta = Date.parse(b.occurredAt) - Date.parse(a.occurredAt)
    return delta !== 0 ? delta : a.id.localeCompare(b.id)
  })

  return { events: events.slice(0, limit), notListed, overflowed: events.length > limit }
}
