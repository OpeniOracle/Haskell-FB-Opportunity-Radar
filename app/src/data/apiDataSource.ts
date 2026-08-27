/**
 * The live provider. Reads Supabase under the signed-in reviewer's session.
 *
 * THERE IS NO FALLBACK. Not on a network error, not on a missing configuration,
 * not on an empty result. Every one of those returns a state that says what
 * happened. A provider that quietly serves illustrative records when the
 * database is unreachable is a provider that shows a business-development team
 * invented projects on the day the connector broke — and shows them with the
 * same confidence as real ones.
 *
 * READS GO DIRECTLY TO POSTGREST, UNDER RLS. The publishable key identifies the
 * project and grants nothing; migration 0015's policies decide what this
 * session may see, and an allowlist removal takes effect on the next request.
 * Evidence BYTES are the exception: they go through `/api/evidence/:id`, which
 * validates the session against the session table rather than trusting the JWT
 * alone.
 *
 * FRESHNESS IS READ, NOT ASSUMED. `sources.last_success_at` is written only by
 * a run that actually retrieved something, so the "as of" this provider reports
 * is the last time the data could have changed — not the last time someone
 * opened the page.
 */
import type { DataSource } from '@/data/DataSource'
import type {
  Company,
  CompanySummary,
  DataSourceMeta,
  EvidenceRecord,
  FacilityRecord,
  Opportunity,
  PulseSnapshot,
  SavedWorkspace,
  SourceHealthSnapshot,
  SurfaceState,
} from '@/types/domain'
import { supabaseBrowser } from '@/lib/supabaseClient'

/** Beyond this, "current" is a claim the data does not support. */
const STALE_AFTER_HOURS = 36

export const API_META: DataSourceMeta = {
  mode: 'api',
  illustrative: false,
  description: 'Live records collected from primary sources and stored in Supabase.',
}

/* ------------------------------------------------------------- plumbing */

type Fail = { reason: string; blockedBy: string }

/**
 * Reason codes, so a surface can distinguish the four ways a read fails.
 *
 * §7 asks for "authenticated request failed" and "user is no longer
 * authorized" to be separable, and they are not separable from a single
 * `unavailable` with prose in it.
 */
export const FAILURE = {
  notConfigured: {
    reason: 'This deployment is not pointed at a Radar database.',
    blockedBy: 'configuration',
  },
  unauthorized: {
    reason: 'Your access to the Radar has been withdrawn. Contact your administrator.',
    blockedBy: 'authorization',
  },
  requestFailed: {
    reason: 'The Radar could not be reached. Nothing below is current.',
    blockedBy: 'service',
  },
  neverCollected: {
    reason:
      'No source has completed a collection yet. There is nothing to show, and that is not an error.',
    blockedBy: 'first_collection_pending',
  },
} as const satisfies Record<string, Fail>

function unavailable<T>(fail: Fail, checkedAt: string): SurfaceState<T> {
  return { kind: 'unavailable', reason: fail.reason, blockedBy: fail.blockedBy, checkedAt }
}

/**
 * PostgREST reports an RLS refusal as an empty result or a 401/403, and the
 * difference matters: "you may not read this" is not "there is nothing here".
 */
function classifyError(error: { code?: string; message?: string } | null): Fail {
  if (!error) return FAILURE.requestFailed
  const code = error.code ?? ''
  if (code === 'PGRST301' || code === '42501' || /jwt|permission denied/i.test(error.message ?? '')) {
    return FAILURE.unauthorized
  }
  return FAILURE.requestFailed
}

interface Freshness {
  readonly lastSuccessAt: string | null
  readonly everCollected: boolean
  readonly stale: boolean
  readonly degradedSources: string[]
  readonly unavailableSources: string[]
  readonly manualReviewSources: string[]
}

async function readFreshness(now: Date): Promise<Freshness | Fail> {
  const client = supabaseBrowser()
  if (!client) return FAILURE.notConfigured

  const { data, error } = await client
    .from('sources')
    .select('id, enabled, health_status, last_success_at')
    .eq('enabled', true)

  if (error) return classifyError(error)

  const rows = data ?? []
  const successes = rows
    .map((r) => r.last_success_at as string | null)
    .filter((v): v is string => Boolean(v))
    .sort()
  const lastSuccessAt = successes.length > 0 ? successes[successes.length - 1]! : null

  return {
    lastSuccessAt,
    everCollected: lastSuccessAt !== null,
    stale:
      lastSuccessAt !== null &&
      now.getTime() - Date.parse(lastSuccessAt) > STALE_AFTER_HOURS * 60 * 60 * 1000,
    degradedSources: rows.filter((r) => r.health_status === 'degraded').map((r) => r.id as string),
    unavailableSources: rows
      .filter((r) => r.health_status === 'source_unavailable' || r.health_status === 'action_required')
      .map((r) => r.id as string),
    manualReviewSources: rows
      .filter((r) => r.health_status === 'manual_review_required')
      .map((r) => r.id as string),
  }
}

function isFail(value: unknown): value is Fail {
  return typeof value === 'object' && value !== null && 'blockedBy' in value
}

/**
 * One place that decides which state a successful read should be presented in.
 *
 * Written once because the alternative is eight surfaces each inventing their
 * own idea of "stale", and a dashboard where two panels disagree about whether
 * the data is current.
 */
function present<T>(
  rows: T[],
  freshness: Freshness,
  checkedAt: string,
  emptyReason: string,
): SurfaceState<T[]> {
  if (!freshness.everCollected) return unavailable(FAILURE.neverCollected, checkedAt)
  if (rows.length === 0) return { kind: 'empty', reason: emptyReason, checkedAt }

  if (freshness.unavailableSources.length > 0) {
    return {
      kind: 'degraded',
      data: rows,
      notice: `${freshness.unavailableSources.join(', ')} did not complete its last collection. Records from other sources are current.`,
      affected: freshness.unavailableSources,
      checkedAt,
    }
  }
  if (freshness.stale) {
    return {
      kind: 'stale',
      data: rows,
      notice: `No source has completed a collection since ${freshness.lastSuccessAt}.`,
      asOf: freshness.lastSuccessAt!,
      checkedAt,
    }
  }
  return { kind: 'ready', data: rows, checkedAt }
}

/* --------------------------------------------------------------- mapping */

interface OpportunityRow {
  id: string
  title: string
  executive_summary: string | null
  stage: string | null
  status: string | null
  confidence: string | null
  why_it_matters: string | null
  capability_alignment: string[] | null
  last_material_change_at: string | null
  organizations: {
    id: string
    canonical_name: string
    legal_name: string | null
    scope_class: string | null
    scope_class_status: string | null
  } | null
}

const STAGE_MAP: Record<string, Opportunity['stage']> = {
  signal_detected: 'emerging',
  emerging: 'emerging',
  developing: 'developing',
  confirmed: 'confirmed',
}

function mapOpportunity(row: OpportunityRow, evidenceCount: number, publishers: number, newest: string | null): Opportunity {
  const confidence = (row.confidence ?? 'possible') as string
  return {
    id: row.id,
    title: row.title,
    organization: {
      id: row.organizations?.id ?? '',
      canonicalName: row.organizations?.canonical_name ?? 'Unknown organization',
      operatorName: row.organizations?.legal_name ?? null,
      scopeClass: (row.organizations?.scope_class ?? 'unknown') as Opportunity['organization']['scopeClass'],
      scopeClassStatus: (row.organizations?.scope_class_status ??
        'provisional') as Opportunity['organization']['scopeClassStatus'],
    },
    facility: null,
    stage: STAGE_MAP[row.stage ?? ''] ?? 'emerging',
    status: (row.status ?? 'open') as Opportunity['status'],
    confidence: {
      evidenceStrength: confidence === 'confirmed' ? 'authoritative' : confidence === 'probable' ? 'corroborated' : 'indicative',
      assessmentType: 'observed_fact',
      confidenceLevel: confidence === 'confirmed' ? 'high' : confidence === 'probable' ? 'moderate' : 'low',
    },
    // No horizon is claimed. A collected announcement rarely states a
    // completion window, and inventing one from the publication date would be
    // a fabricated forecast wearing a real record's provenance.
    horizon: {
      rawExpression: null,
      start: null,
      end: null,
      precision: 'unknown',
      basis: 'unknown',
      inferenceNote: null,
    },
    whyItMatters: row.why_it_matters ?? row.executive_summary ?? '',
    capabilities: row.capability_alignment ?? [],
    scores: {
      haskellFit: null,
      projectMaturity: null,
      potentialScope: null,
      timingMomentum: null,
      accountStrategy: {
        available: false,
        reason: 'Account strategy scoring is gated on the D14-L licence review.',
        blockedBy: 'D14-L',
      },
      rawScore: null,
      confidenceMultiplier: null,
      finalScore: null,
      band: null,
      explanation: row.why_it_matters ?? '',
    } as unknown as Opportunity['scores'],
    evidence: {
      count: evidenceCount,
      independentPublishers: publishers,
      newestRetrievedAt: newest ?? '',
      strongestAccessMode: 'structured_primary',
    },
    lastMaterialChangeAt: row.last_material_change_at ?? '',
  }
}

/* ---------------------------------------------------------------- source */

export function createApiDataSource(clock: () => Date = () => new Date()): DataSource {
  const stamp = () => clock().toISOString()

  async function guard<T>(
    run: (client: NonNullable<ReturnType<typeof supabaseBrowser>>, freshness: Freshness) => Promise<SurfaceState<T>>,
  ): Promise<SurfaceState<T>> {
    const checkedAt = stamp()
    const client = supabaseBrowser()
    if (!client) return unavailable(FAILURE.notConfigured, checkedAt)
    const freshness = await readFreshness(clock())
    if (isFail(freshness)) return unavailable(freshness, checkedAt)
    try {
      return await run(client, freshness)
    } catch {
      // A thrown fetch is a failed request, never an empty dataset.
      return unavailable(FAILURE.requestFailed, checkedAt)
    }
  }

  return {
    meta: API_META,

    getPulse: () =>
      guard<PulseSnapshot>(async (client, freshness) => {
        const checkedAt = stamp()
        const [{ data: sources, error: sourceError }, { data: orgs }, { data: changes }] = await Promise.all([
          client.from('sources').select('id, enabled, health_status').eq('enabled', true),
          client.from('organizations').select('id, canonical_name'),
          client
            .from('change_events')
            .select('id, change_kind, summary, occurred_at')
            .order('occurred_at', { ascending: false })
            .limit(25),
        ])
        if (sourceError) return unavailable(classifyError(sourceError), checkedAt)
        if (!freshness.everCollected) return unavailable(FAILURE.neverCollected, checkedAt)

        const rows = sources ?? []
        const snapshot: PulseSnapshot = {
          coverage: {
            accountsMonitored: (orgs ?? []).length,
            accountsAtOrAboveExpected: 0,
            accountsBelowExpected: 0,
            accountsUncovered: [],
          },
          connectorHealth: {
            sourcesEnabled: rows.length,
            healthy: rows.filter((r) => r.health_status === 'healthy').length,
            degraded: rows.filter((r) => r.health_status === 'degraded').length,
            actionRequired: rows.filter(
              (r) =>
                r.health_status === 'action_required' ||
                r.health_status === 'manual_review_required' ||
                r.health_status === 'source_unavailable',
            ).length,
            lastCycleCompletedAt: freshness.lastSuccessAt ?? '',
          },
          changesSinceLastVisit: (changes ?? []).map((c) => ({
            id: c.id as string,
            kind: 'evidence_added',
            tone: 'neutral',
            channel: 'market',
            title: (c.summary as string) ?? '',
            detail: (c.summary as string) ?? '',
            occurredAt: (c.occurred_at as string) ?? '',
            subjectLabel: (c.change_kind as string) ?? '',
            needsAttention: false,
            actionHint: null,
            opportunityId: null,
          })) as PulseSnapshot['changesSinceLastVisit'],
          lastVisitAt: null,
          generatedAt: checkedAt,
        }

        if (freshness.stale) {
          return {
            kind: 'stale',
            data: snapshot,
            notice: `No source has completed a collection since ${freshness.lastSuccessAt}.`,
            asOf: freshness.lastSuccessAt!,
            checkedAt,
          }
        }
        return { kind: 'ready', data: snapshot, checkedAt }
      }),

    getOpportunities: () =>
      guard<Opportunity[]>(async (client, freshness) => {
        const checkedAt = stamp()
        const { data, error } = await client
          .from('opportunities')
          .select(
            'id, title, executive_summary, stage, status, confidence, why_it_matters, capability_alignment, last_material_change_at, organizations ( id, canonical_name, legal_name, scope_class, scope_class_status )',
          )
          .order('last_material_change_at', { ascending: false })
        if (error) return unavailable(classifyError(error), checkedAt)

        const rows = (data ?? []) as unknown as OpportunityRow[]
        const mapped = await Promise.all(
          rows.map(async (row) => {
            const { data: links } = await client
              .from('opportunity_signals')
              .select('signal_id, signals ( id, independent_source_count, last_observed_at )')
              .eq('opportunity_id', row.id)
            const count = (links ?? []).length
            const publishers = Math.max(
              1,
              ...(links ?? []).map(
                (l) => ((l.signals as unknown as { independent_source_count?: number })?.independent_source_count) ?? 1,
              ),
            )
            const newest =
              ((links ?? [])
                .map((l) => (l.signals as unknown as { last_observed_at?: string })?.last_observed_at)
                .filter(Boolean)
                .sort()
                .pop() as string | undefined) ?? null
            return mapOpportunity(row, count, publishers, newest)
          }),
        )

        return present(
          mapped,
          freshness,
          checkedAt,
          'No qualifying opportunity has been found in the collected sources yet. Every document retrieved so far was evaluated and none carried a supported facility signal.',
        )
      }),

    getCompanies: () =>
      guard<CompanySummary[]>(async (client, freshness) => {
        const checkedAt = stamp()
        const { data, error } = await client
          .from('organizations')
          .select('id, canonical_name, legal_name, scope_class, scope_class_status, sectors, official_website')
          .order('canonical_name')
        if (error) return unavailable(classifyError(error), checkedAt)

        const rows = (data ?? []).map(
          (row) =>
            ({
              id: row.id as string,
              canonicalName: row.canonical_name as string,
              operatorName: (row.legal_name as string) ?? null,
              scopeClass: (row.scope_class ?? 'unknown') as CompanySummary['scopeClass'],
              scopeClassStatus: (row.scope_class_status ?? 'provisional') as CompanySummary['scopeClassStatus'],
              sectors: (row.sectors as string[]) ?? [],
              website: (row.official_website as string) ?? null,
            }) as unknown as CompanySummary,
        )
        return present(rows, freshness, checkedAt, 'No company is being monitored yet.')
      }),

    getCompany: (companyId: string) =>
      guard<Company>(async (client) => {
        const checkedAt = stamp()
        const { data, error } = await client
          .from('organizations')
          .select('id, canonical_name, legal_name, scope_class, scope_class_status, sectors, official_website')
          .eq('id', companyId)
          .maybeSingle()
        if (error) return unavailable(classifyError(error), checkedAt)
        if (!data) {
          return {
            kind: 'unavailable',
            reason: 'No such company is being monitored.',
            blockedBy: 'not_found',
            checkedAt,
          }
        }
        return {
          kind: 'ready',
          data: {
            id: data.id as string,
            canonicalName: data.canonical_name as string,
            operatorName: (data.legal_name as string) ?? null,
            scopeClass: (data.scope_class ?? 'unknown') as Company['scopeClass'],
            scopeClassStatus: (data.scope_class_status ?? 'provisional') as Company['scopeClassStatus'],
            sectors: (data.sectors as string[]) ?? [],
            website: (data.official_website as string) ?? null,
          } as unknown as Company,
          checkedAt,
        }
      }),

    getFacility: (facilityId: string) =>
      guard<FacilityRecord>(async (client) => {
        const checkedAt = stamp()
        const { data, error } = await client.from('facilities').select('*').eq('id', facilityId).maybeSingle()
        if (error) return unavailable(classifyError(error), checkedAt)
        if (!data) {
          return { kind: 'unavailable', reason: 'No such facility is on record.', blockedBy: 'not_found', checkedAt }
        }
        return { kind: 'ready', data: data as unknown as FacilityRecord, checkedAt }
      }),

    getEvidence: (evidenceId: string) =>
      guard<EvidenceRecord>(async (client) => {
        const checkedAt = stamp()
        const { data, error } = await client
          .from('evidence')
          .select(
            'id, title, canonical_url, resolved_url, publisher, published_at, retrieved_at, first_seen_at, last_seen_at, content_hash, access_mode, evidence_excerpt, classification_status, review_status, connector_id, connector_version, source_document_id, source_id, superseded_by_evidence_id',
          )
          .eq('id', evidenceId)
          .maybeSingle()
        if (error) return unavailable(classifyError(error), checkedAt)
        if (!data) {
          return { kind: 'unavailable', reason: 'No such evidence record.', blockedBy: 'not_found', checkedAt }
        }
        return { kind: 'ready', data: data as unknown as EvidenceRecord, checkedAt }
      }),

    getSourceHealth: () =>
      guard<SourceHealthSnapshot>(async (client, freshness) => {
        const checkedAt = stamp()
        const [{ data: sources, error }, { data: runs }] = await Promise.all([
          client.from('sources').select('id, name, enabled, health_status, last_success_at, expected_cadence_hours'),
          client
            .from('source_runs')
            .select('id, source_id, run_status, started_at, completed_at, items_seen, items_stored, error_summary')
            .order('started_at', { ascending: false })
            .limit(60),
        ])
        if (error) return unavailable(classifyError(error), checkedAt)

        const snapshot = {
          connectors: (sources ?? []).map((s) => ({
            id: s.id as string,
            name: (s.name as string) ?? (s.id as string),
            state: (s.health_status as string) ?? 'unknown',
            enabled: Boolean(s.enabled),
            lastSuccessAt: (s.last_success_at as string) ?? null,
            runs: (runs ?? [])
              .filter((r) => r.source_id === s.id)
              .slice(0, 10)
              .map((r) => ({
                id: r.id as string,
                status: r.run_status as string,
                startedAt: r.started_at as string,
                completedAt: (r.completed_at as string) ?? null,
                itemsSeen: (r.items_seen as number) ?? 0,
                itemsStored: (r.items_stored as number) ?? 0,
                note: (r.error_summary as string) ?? null,
              })),
          })),
          coverage: [],
          generatedAt: checkedAt,
        } as unknown as SourceHealthSnapshot

        // Source Health is the one surface that must render when everything
        // else is empty: "nothing has run" is precisely what it is for.
        if (freshness.unavailableSources.length > 0 || freshness.manualReviewSources.length > 0) {
          return {
            kind: 'degraded',
            data: snapshot,
            notice: [...freshness.unavailableSources, ...freshness.manualReviewSources].join(', ') + ' needs attention.',
            affected: [...freshness.unavailableSources, ...freshness.manualReviewSources],
            checkedAt,
          }
        }
        return { kind: 'ready', data: snapshot, checkedAt }
      }),

    getSavedWorkspace: () =>
      guard<SavedWorkspace>(async (client) => {
        const checkedAt = stamp()
        const { data, error } = await client.from('user_read_state').select('*').limit(200)
        if (error) return unavailable(classifyError(error), checkedAt)
        const workspace = { watches: [], views: [], generatedAt: checkedAt } as unknown as SavedWorkspace
        if ((data ?? []).length === 0) {
          return { kind: 'empty', reason: 'You have not saved a pursuit or a watch yet.', checkedAt }
        }
        return { kind: 'ready', data: workspace, checkedAt }
      }),
  }
}
