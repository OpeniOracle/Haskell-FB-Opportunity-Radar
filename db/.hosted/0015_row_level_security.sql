-- 0015  Row-level security: deny by default, read by exception
--
-- The browser holds the Supabase publishable ("anon") key. That key is in the
-- JavaScript bundle and is readable by anyone who opens developer tools, so it
-- is not a secret and must never be treated as one. The only thing standing
-- between it and the data is row-level security. That is why this migration
-- starts by enabling RLS on EVERY table in `public` rather than on a chosen
-- list: a table added later and forgotten here would otherwise be world-readable
-- the moment it exists, and nothing would fail.
--
-- Posture:
--
--   anon (unauthenticated)   nothing. The pilot is invite-only; there is no
--                            public surface and no public read.
--   authenticated            SELECT on the dashboard tables, and nothing else.
--                            No INSERT, no UPDATE, no DELETE anywhere.
--   service_role             bypasses RLS by role attribute. Every write in the
--                            system goes through a server-side Netlify Function
--                            holding that key, never through the browser.
--
-- Writes are deliberately absent rather than merely unimplemented. D8 (ownership
-- of tier changes and overrides) is Open, so there is no approved answer to
-- "who may change what", and a permissive write policy now would be a decision
-- made by omission.

-- ---------------------------------------------------------------------------
-- 1. RLS on everything. Uniform, so nothing can be missed by being forgotten.
-- ---------------------------------------------------------------------------
do $$
declare
    t record;
begin
    for t in
        select tablename from pg_tables where schemaname = 'public'
    loop
        execute format('alter table public.%I enable row level security', t.tablename);
    end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- 2. Revoke the default grants, then grant back only what a dashboard reads.
--
-- Supabase grants ALL on public tables to `anon` and `authenticated` by default.
-- RLS alone would already stop reads, but a table privilege nobody needs is a
-- privilege that survives a future policy mistake, so it goes too.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;

-- Future tables inherit the same posture rather than the permissive default.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The readable set.
--
-- `grant select` first, then a policy. Both are required: the grant says the
-- role may read the table at all, the policy says which rows. Column lists are
-- used where a table holds something the browser has no business receiving.
-- ---------------------------------------------------------------------------

-- Reference vocabulary. Not sensitive, and every surface renders labels from it.
grant select on sectors, capabilities, signal_families, signal_event_types to authenticated;

-- Entities and their relationships.
--
-- Two columns are excluded at the column level rather than trusted to stay
-- empty. `engagement` is the v0.1 jsonb the engagement layer replaces, and
-- `target_tier` is the per-segment tier assigned from the attendance workbook.
-- Both are D14-L blocked.
--
-- `highest_value` IS readable: pilot-cohort membership comes from the approved
-- public-research package, not from the blocked workbook, and it is what the
-- account surfaces sort by.
grant select (
    id, canonical_name, legal_name, organization_role, parent_organization_id,
    sectors, official_website, headquarters, scope_class, scope_class_status,
    supplier_routing, highest_value, entity_key, source_provenance,
    created_at, updated_at
) on organizations to authenticated;

grant select on facilities to authenticated;
grant select on facility_organizations to authenticated;
grant select on organization_relationships to authenticated;
grant select on organization_aliases, organization_identifiers to authenticated;
grant select on facility_aliases, facility_identifiers to authenticated;

-- Evidence.
--
-- `body_text`, `archive_uri`, `raw_storage_uri` and `extracted_text_uri` are
-- excluded. Preserved content lives in a PRIVATE storage bucket and is served,
-- when it may be served at all, through a signed URL minted by a server-side
-- function that checks the access mode first. Handing the browser a storage path
-- and relying on it not to ask is not a control.
grant select (
    id, source_id, source_run_id, original_url, resolved_url, canonical_url,
    title, publisher, published_at, published_precision, published_basis,
    event_date, retrieved_at, content_hash, mime_type, byte_size,
    extraction_status, extraction_method, extractor_version, evidence_excerpt,
    evidence_locator, display_restrictions, access_mode, locator,
    temporal_raw_expression, temporal_start, temporal_end, temporal_precision,
    temporal_basis, temporal_inference_note,
    evidence_strength, assessment_type, confidence_level,
    data_sensitivity_class, superseded_by_evidence_id, evidence_family_id,
    transformation_version, created_at
) on evidence to authenticated;

grant select on evidence_families, evidence_relationships, evidence_entity_links to authenticated;

-- Signals and opportunities.
--
-- `opportunities.account_strategy` is the D14-L scoring dimension. It is
-- licence-gated at write time and excluded at read time, so the browser cannot
-- receive it even if a row somehow carried one.
grant select on signals, signal_evidence to authenticated;
grant select (
    id, organization_id, title, executive_summary, stage, status, confidence,
    forecast_horizon, sectors, capability_alignment, why_it_matters,
    recommended_next_action, momentum, haskell_fit, project_maturity,
    potential_scope, timing_momentum, raw_score, confidence_multiplier,
    final_score, score_explanation, scoring_config_version,
    last_material_change_at, created_at, updated_at
) on opportunities to authenticated;
grant select on opportunity_facilities, opportunity_signals to authenticated;
grant select (
    id, opportunity_id, haskell_fit, project_maturity, potential_scope,
    timing_momentum, raw_score, confidence_multiplier, final_score,
    calculation_version, scoring_config_version, explanation, computed_at
) on opportunity_score_snapshots to authenticated;

grant select on market_trends, market_trend_signals to authenticated;

-- Source Health & Coverage.
--
-- `sources` config columns are excluded: query scopes, extraction rules and
-- retry policy are operational configuration, and one of them is the shape of
-- our collection strategy.
grant select (
    id, name, source_type, collection_method, base_url, schedule,
    freshness_sla_hours, enabled, health_status, terms_reviewed_at,
    license_notes, license_mode, access_mode, data_sensitivity_class,
    expected_cadence_hours, circuit_state, circuit_opened_at,
    consecutive_failures, created_at, updated_at
) on sources to authenticated;

grant select on source_runs, source_run_attempts, source_health_events to authenticated;
grant select on account_source_expectations to authenticated;
grant select on change_events to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Policies.
--
-- Everything readable is readable by every invited user: the pilot cohort is one
-- team looking at one account list, and inventing per-user visibility here would
-- be answering D8 without approval. Two tables are per-user because they are
-- per-user by nature.
-- ---------------------------------------------------------------------------
do $$
declare
    t text;
    shared text[] := array[
        'sectors', 'capabilities', 'signal_families', 'signal_event_types',
        'organizations', 'organization_aliases', 'organization_identifiers',
        'organization_relationships',
        'facilities', 'facility_aliases', 'facility_identifiers',
        'facility_organizations',
        'evidence', 'evidence_families', 'evidence_relationships',
        'evidence_entity_links',
        'signals', 'signal_evidence',
        'opportunities', 'opportunity_facilities', 'opportunity_signals',
        'opportunity_score_snapshots',
        'market_trends', 'market_trend_signals',
        'sources', 'source_runs', 'source_run_attempts', 'source_health_events',
        'account_source_expectations', 'change_events'
    ];
begin
    foreach t in array shared loop
        execute format(
            'create policy %I on public.%I for select to authenticated using (true)',
            t || '_read_authenticated', t);
    end loop;
end
$$;

-- Per-user rows. `auth.uid()` is null for an unauthenticated request, and
-- `user_id = null` is never true, so an anonymous caller matches nothing even if
-- a grant were added by mistake.
grant select on user_read_state to authenticated;
create policy user_read_state_own_rows on public.user_read_state
    for select to authenticated
    using (user_id = auth.uid()::text);

grant select (
    id, subscription_id, opportunity_id, signal_id, market_trend_id,
    material_change_key, title, body, delivery_channel, status, delivered_at,
    recipient_ref, change_event_id, suppressed_reason, created_at
) on alerts to authenticated;
create policy alerts_own_rows on public.alerts
    for select to authenticated
    using (recipient_ref = 'user:' || auth.uid()::text);

-- ---------------------------------------------------------------------------
-- 5. What is deliberately unreachable from the browser.
--
-- These tables have RLS enabled and NO policy, and no grant. They are invisible
-- to both `anon` and `authenticated` — a select returns "permission denied",
-- not an empty set.
--
--   licence_authorizations, import_batches, import_records,
--   organization_candidates, approved_entity_mappings, engagement_observations,
--   organization_segment_tiers   D14-L. Blocked, and unreadable as well as
--                                unwritable.
--   research_batches, research_claims                staging, never canonical
--   facility_candidates                              unconfirmed by definition
--   audit_events, opportunity_status_history         audit trail
--   model_replay_cache                               prompts and model output
--   parked_messages                                  raw payloads
--   scoring_configs                                  scoring model internals
--   ranking_hypotheses, evaluation_corpora,
--   evaluation_corpus_entries, unavailable_sources   non-scoring internals
--   subscriptions, alert_dispatch_windows            delivery internals
--   schema_migrations                                harness state
-- ---------------------------------------------------------------------------

-- Deliberately NOT recorded as a schema comment. `comment on schema public` has
-- no clean inverse: PostgreSQL ships a default comment on `public`, so setting
-- one and then nulling it leaves the schema measurably different from the
-- baseline rather than identical to it. The rollback test caught that. The
-- posture is documented at the top of this file instead.
