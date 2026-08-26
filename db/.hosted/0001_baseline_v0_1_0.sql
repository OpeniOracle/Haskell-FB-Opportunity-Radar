-- 0001  v0.1.0 reference schema
--
-- Reproduces `schemas/database.sql` so that an EMPTY database reaches the same
-- starting point a database already carrying v0.1.0 is at. On a database that
-- already has it, the harness STAMPS this migration instead of running it.
--
-- `schemas/database.sql` is not edited by this PR. It remains the design
-- baseline; this file is the executable equivalent.

create extension if not exists pgcrypto;

-- \ir resolves relative to THIS file, so the harness needs no variables.
-- >>> inlined from ../../schemas/database.sql
-- Haskell Food & Beverage Opportunity Radar
-- PostgreSQL reference schema
-- Version 0.1.0
-- This is a design baseline. Review tenancy, identity, retention, RLS, and
-- deployment-specific extensions before production migration authoring.

create extension if not exists pgcrypto;

create table organizations (
    id uuid primary key default gen_random_uuid(),
    canonical_name text not null,
    legal_name text,
    organization_role text not null check (organization_role in (
        'manufacturer_brand',
        'parent_company',
        'subsidiary_division',
        'co_manufacturer_private_label',
        'retailer',
        'distributor_logistics',
        'ingredient_supplier',
        'packaging_supplier',
        'equipment_oem',
        'engineering_contractor_consultant',
        'competitor',
        'investor_lender',
        'government_regulator',
        'economic_development',
        'academic_research',
        'media_trade_publication',
        'other',
        'unknown'
    )),
    parent_organization_id uuid references organizations(id),
    target_tier text not null default 'not_targeted' check (target_tier in (
        'tier_1', 'tier_2', 'tier_3', 'discovery', 'not_targeted'
    )),
    highest_value boolean not null default false,
    sectors text[] not null default '{}',
    official_website text,
    headquarters jsonb,
    engagement jsonb not null default '{}',
    source_provenance jsonb not null default '[]',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create unique index organizations_canonical_name_lower_uidx
    on organizations (lower(canonical_name));
create index organizations_parent_idx on organizations(parent_organization_id);
create index organizations_target_idx on organizations(target_tier, highest_value);
create index organizations_sectors_gin_idx on organizations using gin(sectors);

create table organization_aliases (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references organizations(id) on delete cascade,
    alias text not null,
    normalized_alias text not null,
    alias_type text not null default 'name' check (alias_type in (
        'name', 'brand', 'division', 'prior_name', 'event_import', 'domain', 'other'
    )),
    source_evidence_id uuid,
    verified boolean not null default false,
    created_at timestamptz not null default now(),
    unique (organization_id, normalized_alias)
);

create index organization_aliases_normalized_idx
    on organization_aliases(normalized_alias);

create table organization_identifiers (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references organizations(id) on delete cascade,
    identifier_system text not null,
    identifier_value text not null,
    source_url text,
    verified_at timestamptz,
    created_at timestamptz not null default now(),
    unique (identifier_system, identifier_value)
);

create table facilities (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references organizations(id),
    canonical_name text not null,
    facility_types text[] not null default '{}',
    operating_status text not null default 'unknown' check (operating_status in (
        'proposed', 'planning', 'under_construction', 'active', 'expanding',
        'idled', 'closing', 'closed', 'unknown'
    )),
    address_line_1 text,
    address_line_2 text,
    city text,
    region text,
    postal_code text,
    country_code char(2),
    latitude numeric(9,6),
    longitude numeric(9,6),
    geocode_precision text check (geocode_precision is null or geocode_precision in (
        'rooftop', 'parcel', 'street', 'city', 'region', 'country', 'unknown'
    )),
    products_processes text[] not null default '{}',
    capabilities_relevant text[] not null default '{}',
    opened_at date,
    closed_at date,
    source_provenance jsonb not null default '[]',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    check (latitude is null or latitude between -90 and 90),
    check (longitude is null or longitude between -180 and 180)
);

create index facilities_organization_idx on facilities(organization_id);
create index facilities_location_idx on facilities(country_code, region, city);
create index facilities_status_idx on facilities(operating_status);

create table facility_aliases (
    id uuid primary key default gen_random_uuid(),
    facility_id uuid not null references facilities(id) on delete cascade,
    alias text not null,
    normalized_alias text not null,
    source_evidence_id uuid,
    created_at timestamptz not null default now(),
    unique (facility_id, normalized_alias)
);

create table facility_identifiers (
    id uuid primary key default gen_random_uuid(),
    facility_id uuid not null references facilities(id) on delete cascade,
    identifier_system text not null,
    identifier_value text not null,
    source_url text,
    verified_at timestamptz,
    created_at timestamptz not null default now(),
    unique (identifier_system, identifier_value)
);

create table sources (
    id text primary key,
    name text not null,
    source_type text not null,
    collection_method text not null,
    base_url text not null check (base_url like 'https://%'),
    allowed_domains text[] not null,
    redirect_policy text not null default 'allowlist_only' check (redirect_policy in (
        'deny', 'same_domain', 'allowlist_only'
    )),
    authentication_mode text not null default 'none' check (authentication_mode in (
        'none', 'api_key', 'oauth', 'service_account', 'operator_session'
    )),
    schedule text not null,
    freshness_sla_hours integer not null check (freshness_sla_hours > 0),
    enabled boolean not null default false,
    health_status text not null default 'disabled' check (health_status in (
        'healthy', 'degraded', 'action_required', 'disabled', 'unsupported'
    )),
    terms_reviewed_at timestamptz,
    license_notes text,
    query_scope jsonb not null default '{}',
    extraction_config jsonb not null default '{}',
    retry_policy jsonb not null default '{}',
    operator_intervention jsonb not null default '{}',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index sources_health_idx on sources(enabled, health_status);

create table source_runs (
    id uuid primary key default gen_random_uuid(),
    source_id text not null references sources(id),
    status text not null check (status in (
        'queued', 'running', 'success', 'partial_success', 'unchanged',
        'failed', 'action_required'
    )),
    scheduled_for timestamptz,
    started_at timestamptz not null default now(),
    completed_at timestamptz,
    checkpoint text,
    error_code text,
    error_summary text,
    discovered_count integer not null default 0 check (discovered_count >= 0),
    fetched_count integer not null default 0 check (fetched_count >= 0),
    extracted_count integer not null default 0 check (extracted_count >= 0),
    rejected_count integer not null default 0 check (rejected_count >= 0),
    duplicate_count integer not null default 0 check (duplicate_count >= 0),
    metrics jsonb not null default '{}',
    created_at timestamptz not null default now()
);

create index source_runs_source_started_idx
    on source_runs(source_id, started_at desc);
create index source_runs_status_idx on source_runs(status, started_at desc);

create table evidence (
    id uuid primary key default gen_random_uuid(),
    source_id text not null references sources(id),
    source_run_id uuid not null references source_runs(id),
    original_url text not null,
    resolved_url text not null,
    canonical_url text,
    title text not null,
    publisher text,
    published_at timestamptz,
    event_date date,
    retrieved_at timestamptz not null,
    content_hash char(64) not null,
    mime_type text not null,
    byte_size bigint check (byte_size is null or byte_size >= 0),
    raw_storage_uri text,
    extracted_text_uri text,
    extraction_status text not null check (extraction_status in (
        'pending', 'success', 'partial', 'failed', 'unsupported'
    )),
    extraction_method text,
    extractor_version text,
    evidence_excerpt text,
    evidence_locator jsonb not null default '{}',
    display_restrictions text,
    created_at timestamptz not null default now(),
    unique (source_id, content_hash)
);

create index evidence_published_idx on evidence(published_at desc);
create index evidence_retrieved_idx on evidence(retrieved_at desc);
create index evidence_url_idx on evidence(canonical_url);
create index evidence_extraction_idx on evidence(extraction_status);

alter table organization_aliases
    add constraint organization_aliases_source_evidence_fk
    foreign key (source_evidence_id) references evidence(id) on delete set null;

alter table facility_aliases
    add constraint facility_aliases_source_evidence_fk
    foreign key (source_evidence_id) references evidence(id) on delete set null;

create table evidence_entity_links (
    id uuid primary key default gen_random_uuid(),
    evidence_id uuid not null references evidence(id) on delete cascade,
    organization_id uuid references organizations(id) on delete cascade,
    facility_id uuid references facilities(id) on delete cascade,
    relationship text not null check (relationship in (
        'subject', 'mentioned', 'owner', 'operator', 'parent', 'partner',
        'regulator', 'contractor', 'unknown'
    )),
    resolution_confidence numeric(4,3) not null check (
        resolution_confidence between 0 and 1
    ),
    resolution_method text not null,
    created_at timestamptz not null default now(),
    check (organization_id is not null or facility_id is not null)
);

create index evidence_entity_links_evidence_idx
    on evidence_entity_links(evidence_id);
create index evidence_entity_links_organization_idx
    on evidence_entity_links(organization_id) where organization_id is not null;
create index evidence_entity_links_facility_idx
    on evidence_entity_links(facility_id) where facility_id is not null;

create table signals (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid references organizations(id),
    facility_id uuid references facilities(id),
    title text not null,
    summary text not null,
    signal_family text not null check (signal_family in (
        'facility_capacity',
        'process_systems',
        'packaging_systems',
        'automation_controls',
        'food_safety_compliance',
        'utilities_sustainability',
        'distribution_supply_chain',
        'corporate_capital',
        'market_demand'
    )),
    event_type text not null,
    event_date date,
    first_observed_at timestamptz not null,
    last_observed_at timestamptz not null,
    confidence text not null check (confidence in ('possible', 'probable', 'confirmed')),
    independent_source_count integer not null default 1 check (independent_source_count >= 1),
    capability_alignment text[] not null default '{}',
    amount_value numeric,
    amount_currency char(3),
    amount_qualifier text,
    negative_signal boolean not null default false,
    cluster_key text,
    model_metadata jsonb not null default '{}',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    check (organization_id is not null or facility_id is not null or signal_family = 'market_demand')
);

create index signals_org_idx on signals(organization_id, last_observed_at desc);
create index signals_facility_idx on signals(facility_id, last_observed_at desc);
create index signals_family_idx on signals(signal_family, last_observed_at desc);
create index signals_cluster_idx on signals(cluster_key);

create table signal_evidence (
    signal_id uuid not null references signals(id) on delete cascade,
    evidence_id uuid not null references evidence(id) on delete cascade,
    evidence_role text not null default 'supporting' check (evidence_role in (
        'primary', 'supporting', 'corroborating', 'contradicting'
    )),
    source_family_key text,
    created_at timestamptz not null default now(),
    primary key (signal_id, evidence_id)
);

create table opportunities (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references organizations(id),
    title text not null,
    executive_summary text not null default '',
    stage text not null check (stage in ('emerging', 'developing', 'confirmed')),
    status text not null default 'new' check (status in (
        'new', 'watching', 'pursue', 'assigned', 'on_hold', 'dismissed',
        'closed_won', 'closed_lost', 'cancelled', 'expired'
    )),
    confidence text not null check (confidence in ('possible', 'probable', 'confirmed')),
    forecast_horizon text not null default 'unknown' check (forecast_horizon in (
        '0_6_months', '6_12_months', '12_24_months', '24_36_months',
        '36_plus_months', 'unknown'
    )),
    sectors text[] not null default '{}',
    capability_alignment text[] not null,
    why_it_matters text not null,
    recommended_next_action text,
    momentum text not null default 'new' check (momentum in (
        'new', 'increasing', 'stable', 'declining'
    )),
    haskell_fit smallint not null check (haskell_fit between 0 and 30),
    project_maturity smallint not null check (project_maturity between 0 and 25),
    potential_scope smallint not null check (potential_scope between 0 and 20),
    timing_momentum smallint not null check (timing_momentum between 0 and 15),
    account_strategy smallint not null check (account_strategy between 0 and 10),
    raw_score smallint not null check (raw_score between 0 and 100),
    confidence_multiplier numeric(3,2) not null check (confidence_multiplier in (0.60, 0.80, 1.00)),
    final_score smallint not null check (final_score between 0 and 100),
    score_explanation text not null default '',
    assigned_to text,
    last_material_change_at timestamptz,
    manual_override jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index opportunities_priority_idx
    on opportunities(status, final_score desc, last_material_change_at desc);
create index opportunities_org_idx on opportunities(organization_id, updated_at desc);
create index opportunities_stage_idx on opportunities(stage, confidence);

create table opportunity_facilities (
    opportunity_id uuid not null references opportunities(id) on delete cascade,
    facility_id uuid not null references facilities(id) on delete cascade,
    relationship text not null default 'subject',
    primary key (opportunity_id, facility_id)
);

create table opportunity_signals (
    opportunity_id uuid not null references opportunities(id) on delete cascade,
    signal_id uuid not null references signals(id) on delete cascade,
    signal_role text not null default 'supporting' check (signal_role in (
        'trigger', 'supporting', 'corroborating', 'negative', 'closing'
    )),
    created_at timestamptz not null default now(),
    primary key (opportunity_id, signal_id)
);

create table opportunity_score_snapshots (
    id uuid primary key default gen_random_uuid(),
    opportunity_id uuid not null references opportunities(id) on delete cascade,
    haskell_fit smallint not null,
    project_maturity smallint not null,
    potential_scope smallint not null,
    timing_momentum smallint not null,
    account_strategy smallint not null,
    raw_score smallint not null,
    confidence_multiplier numeric(3,2) not null,
    final_score smallint not null,
    calculation_version text not null,
    explanation text not null,
    computed_at timestamptz not null default now()
);

create index opportunity_score_snapshots_opportunity_idx
    on opportunity_score_snapshots(opportunity_id, computed_at desc);

create table market_trends (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    summary text not null,
    direction text not null check (direction in ('growing', 'stable', 'declining', 'mixed')),
    velocity numeric(5,4) not null check (velocity between -1 and 1),
    sectors text[] not null default '{}',
    capability_alignment text[] not null default '{}',
    independent_organization_count integer not null check (independent_organization_count >= 2),
    facility_count integer not null default 0 check (facility_count >= 0),
    geographies text[] not null default '{}',
    first_observed_at timestamptz not null,
    last_updated_at timestamptz not null,
    created_at timestamptz not null default now()
);

create index market_trends_velocity_idx
    on market_trends(direction, velocity desc, last_updated_at desc);

create table market_trend_signals (
    market_trend_id uuid not null references market_trends(id) on delete cascade,
    signal_id uuid not null references signals(id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (market_trend_id, signal_id)
);

create table subscriptions (
    id uuid primary key default gen_random_uuid(),
    user_id text not null,
    name text not null,
    delivery_channel text not null check (delivery_channel in (
        'in_app', 'email', 'teams'
    )),
    cadence text not null check (cadence in (
        'immediate', 'daily', 'weekly'
    )),
    filters jsonb not null default '{}',
    enabled boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table alerts (
    id uuid primary key default gen_random_uuid(),
    subscription_id uuid references subscriptions(id) on delete set null,
    opportunity_id uuid references opportunities(id) on delete cascade,
    signal_id uuid references signals(id) on delete cascade,
    market_trend_id uuid references market_trends(id) on delete cascade,
    material_change_key text not null,
    title text not null,
    body text not null,
    delivery_channel text not null,
    status text not null check (status in ('queued', 'sent', 'failed', 'suppressed')),
    delivered_at timestamptz,
    created_at timestamptz not null default now(),
    unique (subscription_id, material_change_key),
    check (
        opportunity_id is not null or signal_id is not null or market_trend_id is not null
    )
);

create table source_health_events (
    id uuid primary key default gen_random_uuid(),
    source_id text not null references sources(id),
    source_run_id uuid references source_runs(id),
    prior_status text,
    new_status text not null,
    event_type text not null,
    summary text not null,
    coverage_impact jsonb not null default '{}',
    action_required jsonb,
    resolved_at timestamptz,
    created_at timestamptz not null default now()
);

create index source_health_events_open_idx
    on source_health_events(source_id, resolved_at, created_at desc);

create table audit_events (
    id uuid primary key default gen_random_uuid(),
    actor_type text not null check (actor_type in ('user', 'system', 'connector', 'model')),
    actor_id text not null,
    action text not null,
    object_type text not null,
    object_id text not null,
    before_state jsonb,
    after_state jsonb,
    reason text,
    occurred_at timestamptz not null default now()
);

create index audit_events_object_idx
    on audit_events(object_type, object_id, occurred_at desc);

-- Recommended production follow-up:
-- 1. Add tenant or business-unit ownership columns if the deployment is shared.
-- 2. Add row-level security policies tied to the approved identity provider.
-- 3. Add immutable raw-evidence storage policies and retention enforcement.
-- 4. Add full-text and vector search only after retrieval requirements are approved.
-- 5. Implement score calculations in versioned application logic or auditable SQL.
-- 6. Validate every migration from an empty database and from the prior release.

-- <<< end ../../schemas/database.sql
