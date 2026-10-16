import type { Row } from './fakeSupabase'

/**
 * A coherent, synthetic record graph of any size, for reading through the fake.
 *
 * Every id is zero-padded to five digits so that string order equals numeric
 * order past a thousand rows, which is what lets a test say precisely which rows
 * a capped, ordered read keeps. Nothing here is a real organisation, filing or
 * source: names are `Org 00001`, hosts are absent, and the sources are the two
 * identifiers the application already knows by name.
 */

export const NOW = new Date('2026-10-16T12:00:00.000Z')

export const pad = (n: number) => String(n).padStart(5, '0')
export const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString()

/**
 * The columns the two change ledgers really have, as `db/migrations/0012` and
 * `schemas/database.sql` define them. `changeFeed.test.ts` checks this against
 * the DDL itself, so it cannot drift from the schema without a test failing.
 */
export const LEDGER_SCHEMA: Record<string, readonly string[]> = {
  change_events: [
    'id',
    'object_type',
    'object_id',
    'change_type',
    'from_state',
    'to_state',
    'materiality',
    'dedupe_key',
    'scoring_version',
    'actor_type',
    'occurred_at',
  ],
  source_health_events: [
    'id',
    'source_id',
    'source_run_id',
    'prior_status',
    'new_status',
    'event_type',
    'summary',
    'coverage_impact',
    'action_required',
    'resolved_at',
    'created_at',
  ],
}

export interface WorldSize {
  sources?: number
  organizations?: number
  opportunities?: number
  signals?: number
  evidence?: number
  /** Signals linked to each opportunity. */
  linksPerOpportunity?: number
  /** Evidence linked to each signal. */
  evidencePerSignal?: number
  runs?: number
  /** Material `change_events` rows, newest first, typed `evidence_added` on an opportunity. */
  changeEvents?: number
  /** `source_health_events` rows, newest first: a source going from healthy to degraded. */
  healthEvents?: number
  organizationLocations?: number
  opportunityLocations?: number
  expectations?: number
}

export function buildWorld(size: WorldSize = {}): Record<string, Row[]> {
  const n = {
    sources: size.sources ?? 2,
    organizations: size.organizations ?? 3,
    opportunities: size.opportunities ?? 3,
    signals: size.signals ?? size.opportunities ?? 3,
    evidence: size.evidence ?? size.signals ?? size.opportunities ?? 3,
    linksPerOpportunity: size.linksPerOpportunity ?? 1,
    evidencePerSignal: size.evidencePerSignal ?? 1,
    runs: size.runs ?? 2,
    changeEvents: size.changeEvents ?? 0,
    healthEvents: size.healthEvents ?? 0,
    organizationLocations: size.organizationLocations ?? 0,
    opportunityLocations: size.opportunityLocations ?? 0,
    expectations: size.expectations ?? 0,
  }
  const sourceIds = Array.from({ length: n.sources }, (_, i) =>
    i === 0 ? 'sec-edgar' : i === 1 ? 'mars-newsroom' : `source-${pad(i)}`,
  )

  const sources = sourceIds.map((id) => ({
    id,
    name: id,
    enabled: true,
    health_status: 'healthy',
    last_success_at: ago(120),
    expected_cadence_hours: 24,
    consecutive_failures: 0,
  }))

  const organizations = Array.from({ length: n.organizations }, (_, i) => ({
    id: `org-${pad(i + 1)}`,
    canonical_name: `Org ${pad(i + 1)}`,
    legal_name: null,
    organization_role: null,
    parent_organization_id: null,
    sectors: [],
    official_website: null,
    scope_class: 'core_fb',
    scope_class_status: 'confirmed',
  }))

  const opportunities = Array.from({ length: n.opportunities }, (_, i) => ({
    id: `opp-${pad(i + 1)}`,
    organization_id: `org-${pad((i % Math.max(1, n.organizations)) + 1)}`,
    title: `Opportunity ${pad(i + 1)}`,
    executive_summary: null,
    stage: 'emerging',
    status: 'new',
    confidence: 'probable',
    why_it_matters: null,
    capability_alignment: [],
    forecast_horizon: null,
    haskell_fit: null,
    project_maturity: null,
    potential_scope: null,
    timing_momentum: null,
    raw_score: null,
    confidence_multiplier: null,
    final_score: null,
    // Distinct and descending, so "newest first" is unambiguous: opp-00001 is newest.
    last_material_change_at: ago(i + 1),
  }))

  const signals = Array.from({ length: n.signals }, (_, i) => ({
    id: `sig-${pad(i + 1)}`,
    organization_id: `org-${pad((i % Math.max(1, n.organizations)) + 1)}`,
    title: `Signal ${pad(i + 1)}`,
    summary: null,
    signal_family: 'facility_capacity',
    event_type: 'new_facility_announced',
    event_date: null,
    first_observed_at: ago(i + 1),
    last_observed_at: ago(i + 1),
    confidence: 'probable',
    independent_source_count: 1,
    negative_signal: false,
    model_metadata: { classifierFamily: 'facility_construction' },
  }))

  const evidence = Array.from({ length: n.evidence }, (_, i) => ({
    id: `ev-${pad(i + 1)}`,
    source_id: sourceIds[i % sourceIds.length],
    title: `Document ${pad(i + 1)}`,
    publisher: 'Synthetic Publisher',
    canonical_url: null,
    locator: null,
    published_at: ago(i + 1),
    retrieved_at: ago(i + 1),
    evidence_excerpt: null,
    evidence_locator: null,
    access_mode: 'reference_only',
  }))

  const opportunitySignals: Row[] = []
  for (let i = 0; i < n.opportunities; i += 1) {
    for (let k = 0; k < n.linksPerOpportunity && k < n.signals; k += 1) {
      opportunitySignals.push({
        opportunity_id: `opp-${pad(i + 1)}`,
        signal_id: `sig-${pad(((i + k) % n.signals) + 1)}`,
      })
    }
  }

  const signalEvidence: Row[] = []
  for (let j = 0; j < n.signals; j += 1) {
    for (let k = 0; k < n.evidencePerSignal && k < n.evidence; k += 1) {
      const e = (j + k) % n.evidence
      signalEvidence.push({
        signal_id: `sig-${pad(j + 1)}`,
        evidence_id: `ev-${pad(e + 1)}`,
        source_family_key: sourceIds[e % sourceIds.length],
      })
    }
  }

  const runs = Array.from({ length: n.runs }, (_, i) => ({
    id: `run-${pad(i + 1)}`,
    source_id: sourceIds[i % sourceIds.length],
    run_status: 'success',
    started_at: ago(i + 1),
    completed_at: ago(i),
    items_seen: 5,
    items_stored: 5,
    error_summary: null,
    metrics: {},
  }))

  const changeEvents = Array.from({ length: n.changeEvents }, (_, i) => ({
    id: `chg-${pad(i + 1)}`,
    object_type: 'opportunity',
    object_id: `opp-${pad((i % Math.max(1, n.opportunities)) + 1)}`,
    change_type: 'evidence_added',
    from_state: null,
    to_state: null,
    materiality: 'material',
    dedupe_key: `evidence-${pad(i + 1)}`,
    scoring_version: null,
    actor_type: 'system',
    occurred_at: ago(i + 1),
  }))

  const healthEvents = Array.from({ length: n.healthEvents }, (_, i) => ({
    id: `she-${pad(i + 1)}`,
    source_id: sourceIds[i % sourceIds.length],
    source_run_id: null,
    prior_status: 'healthy',
    new_status: 'degraded',
    event_type: 'status_change',
    summary: `Run ${pad(i + 1)} stored 3 of 5 documents.`,
    coverage_impact: {},
    action_required: null,
    resolved_at: null,
    created_at: ago(i + 1),
  }))

  const organizationLocations = Array.from({ length: n.organizationLocations }, (_, i) => ({
    id: `oloc-${pad(i + 1)}`,
    organization_id: `org-${pad((i % Math.max(1, n.organizations)) + 1)}`,
    location_type: 'corporate_headquarters',
    label: `Head office ${pad(i + 1)}`,
    normalized_address: null,
    latitude: 40 + (i % 10) / 10,
    longitude: -80 - (i % 10) / 10,
    precision: 'locality',
    resolved_at: ago(1),
  }))

  const opportunityLocations = Array.from({ length: n.opportunityLocations }, (_, i) => ({
    id: `ploc-${pad(i + 1)}`,
    opportunity_id: `opp-${pad((i % Math.max(1, n.opportunities)) + 1)}`,
    evidence_id: null,
    location_type: 'approximate_project_area',
    extracted_text: `Place ${pad(i + 1)}`,
    facility_name: null,
    normalized_address: null,
    latitude: 41 + (i % 10) / 10,
    longitude: -81 - (i % 10) / 10,
    precision: 'locality',
    uncertainty_radius_m: 8000,
    resolved_at: ago(1),
  }))

  const expectations = Array.from({ length: n.expectations }, (_, i) => ({
    organization_id: `org-${pad(i + 1)}`,
    source_family: 'sec-edgar',
    expectation: 'required',
    rationale: 'synthetic',
  }))

  return {
    sources,
    organizations,
    opportunities,
    signals,
    evidence,
    opportunity_signals: opportunitySignals,
    signal_evidence: signalEvidence,
    source_runs: runs,
    change_events: changeEvents,
    source_health_events: healthEvents,
    organization_locations: organizationLocations,
    opportunity_locations: opportunityLocations,
    account_source_expectations: expectations,
  }
}
