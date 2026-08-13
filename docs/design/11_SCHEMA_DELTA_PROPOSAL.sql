-- Haskell Food & Beverage Opportunity Radar
-- PROPOSED schema delta v0.1.0 -> v0.2.0
--
-- THIS IS A DESIGN PROPOSAL, NOT A MIGRATION. Do not run it.
-- It exists to make the recommendations in docs/design/10_DESIGN_RESPONSE.md §6
-- concrete enough to argue with. Migration authoring happens after gate G-4.
--
-- Each block cites the conflict-register ID from 10_DESIGN_RESPONSE.md §2.
-- Ordering below is dependency order, not priority order.

-- ---------------------------------------------------------------------------
-- C1  Ingestion model required by 06_SOURCE_DATA_PROFILE.md but absent from
--     schemas/database.sql. Without these tables there is nowhere to put an
--     unresolved PACK EXPO row, which blocks Phase 1 entirely.
-- ---------------------------------------------------------------------------

create table import_batches (
    id uuid primary key default gen_random_uuid(),
    source_filename text not null,
    file_hash char(64) not null,
    sheet_inventory jsonb not null default '[]',
    row_count integer not null check (row_count >= 0),
    imported_at timestamptz not null default now(),
    imported_by text not null,
    unique (file_hash, source_filename)
);

create table import_records (
    id uuid primary key default gen_random_uuid(),
    batch_id uuid not null references import_batches(id) on delete cascade,
    sheet_name text not null,
    source_row_number integer not null check (source_row_number > 0),
    original_values jsonb not null,     -- never edited; the audit anchor
    record_hash char(64) not null,
    created_at timestamptz not null default now(),
    unique (batch_id, sheet_name, source_row_number)
);

-- An organization candidate may remain unresolved indefinitely. That is a
-- correct terminal state, not an error (02 §Entity resolution).
create table organization_candidates (
    id uuid primary key default gen_random_uuid(),
    import_record_id uuid references import_records(id) on delete cascade,
    original_string text not null,
    normalized_string text not null,
    resolved_organization_id uuid references organizations(id),
    resolution_confidence numeric(4,3) check (
        resolution_confidence is null or resolution_confidence between 0 and 1
    ),
    resolution_method text,
    resolution_state text not null default 'unresolved' check (resolution_state in (
        'unresolved', 'auto_resolved', 'human_approved', 'human_rejected', 'ambiguous'
    )),
    resolved_at timestamptz,
    resolved_by text,
    created_at timestamptz not null default now(),
    check (resolved_organization_id is null or resolution_method is not null)
);

create index organization_candidates_state_idx
    on organization_candidates(resolution_state, normalized_string);

-- Replaces organizations.engagement jsonb (C11) so engagement traces to a row.
create table engagement_observations (
    id uuid primary key default gen_random_uuid(),
    organization_candidate_id uuid references organization_candidates(id) on delete cascade,
    organization_id uuid references organizations(id) on delete cascade,
    import_record_id uuid references import_records(id) on delete set null,
    event_name text not null,
    event_year smallint,
    declared_interests text[] not null default '{}',
    industry_response text,
    company_role_response text,
    address_candidate jsonb,
    repeat_count integer not null default 1 check (repeat_count >= 1),
    created_at timestamptz not null default now(),
    check (organization_candidate_id is not null or organization_id is not null)
);

-- 06: an event address is a facility CANDIDATE, never a confirmed plant.
create table facility_candidates (
    id uuid primary key default gen_random_uuid(),
    organization_candidate_id uuid references organization_candidates(id) on delete cascade,
    address jsonb not null,
    source_kind text not null check (source_kind in (
        'event_import', 'regulatory', 'permit', 'company_source', 'news', 'other'
    )),
    corroboration_status text not null default 'uncorroborated' check (
        corroboration_status in ('uncorroborated', 'corroborated', 'rejected', 'promoted')
    ),
    promoted_facility_id uuid references facilities(id),
    created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- C6  PACK EXPO email list is personal data. Segregated store, own retention,
--     never joined into any Radar-facing view. Access is granted separately.
-- ---------------------------------------------------------------------------

create table contact_records (
    id uuid primary key default gen_random_uuid(),
    import_record_id uuid not null references import_records(id) on delete cascade,
    organization_candidate_id uuid references organization_candidates(id),
    personal_data jsonb not null,             -- encrypted at rest
    lawful_basis text not null,
    retention_expires_at timestamptz not null,
    created_at timestamptz not null default now()
);

comment on table contact_records is
    'Restricted. Personal data from event exports. Not exposed through any '
    'Radar API surface. Subject to independent retention and access control.';

-- ---------------------------------------------------------------------------
-- C3  A facility can be operated, owned, or used by more than one organization
--     (co-manufacturing, JVs, multi-tenant cold storage). 01 requires this.
-- ---------------------------------------------------------------------------

create table facility_organizations (
    facility_id uuid not null references facilities(id) on delete cascade,
    organization_id uuid not null references organizations(id) on delete cascade,
    relationship text not null check (relationship in (
        'owner', 'operator', 'tenant', 'co_manufacturer', 'brand_produced_here',
        'former_owner', 'unknown'
    )),
    evidence_id uuid references evidence(id),
    from_date date,
    to_date date,
    created_at timestamptz not null default now(),
    primary key (facility_id, organization_id, relationship)
);

-- facilities.organization_id is retained as the denormalized primary operator.

-- ---------------------------------------------------------------------------
-- C2  Date precision. A non-negotiable requirement the v0.1 schema cannot meet:
--     "in 2027" currently has to be stored as 2027-01-01, i.e. invented.
--     Applies identically to evidence, signals, and facility open/close dates.
-- ---------------------------------------------------------------------------

alter table evidence
    add column event_date_end date,
    add column event_date_precision text not null default 'unknown'
        check (event_date_precision in (
            'day', 'month', 'quarter', 'year', 'range', 'unknown'
        )),
    add constraint evidence_event_date_precision_ck
        check (event_date is null or event_date_precision <> 'unknown');

alter table signals
    add column event_date_end date,
    add column event_date_precision text not null default 'unknown'
        check (event_date_precision in (
            'day', 'month', 'quarter', 'year', 'range', 'unknown'
        )),
    add constraint signals_event_date_precision_ck
        check (event_date is null or event_date_precision <> 'unknown');

-- C10  A market_demand signal may have no organization and no facility, but it
--      still has a place. There is currently nowhere to record it.
alter table signals
    add column geo_country_code char(2),
    add column geo_region text,
    add column geo_metro text;

-- C16  Corroboration counts independent organizations and evidence families,
--      not article copies. signal_evidence.source_family_key currently
--      references nothing.
create table evidence_families (
    id uuid primary key default gen_random_uuid(),
    family_key text not null unique,
    origin_evidence_id uuid references evidence(id),
    detection_method text not null check (detection_method in (
        'canonical_url', 'content_hash', 'syndication_header', 'semantic_similarity',
        'manual'
    )),
    created_at timestamptz not null default now()
);

alter table signals
    rename column independent_source_count to independent_publisher_count;

alter table signals
    add column independent_evidence_family_count integer not null default 1
        check (independent_evidence_family_count >= 1),
    add column independent_organization_count integer not null default 0
        check (independent_organization_count >= 0);

-- ---------------------------------------------------------------------------
-- C17  One ledger that powers Pulse deltas, "material change summary" on the
--      card, alert deduplication, and the daily brief. Without it these grow
--      three separate half-correct diffing implementations.
-- ---------------------------------------------------------------------------

create table change_events (
    id uuid primary key default gen_random_uuid(),
    object_type text not null check (object_type in (
        'opportunity', 'signal', 'market_trend', 'facility', 'organization', 'source'
    )),
    object_id uuid not null,
    change_type text not null,          -- e.g. stage_promoted, evidence_added, closed
    from_state jsonb,
    to_state jsonb,
    materiality text not null check (materiality in ('material', 'minor', 'silent')),
    dedupe_key text not null,
    occurred_at timestamptz not null default now(),
    unique (object_type, object_id, dedupe_key)
);

create index change_events_recent_idx on change_events(occurred_at desc)
    where materiality = 'material';

create table user_read_state (
    user_id text not null,
    surface text not null,              -- 'pulse', 'opportunities', 'alerts'
    last_seen_at timestamptz not null,
    primary key (user_id, surface)
);

-- C18  01 requires a reason on dismissal; v0.1 captures reasons only inside
--      manual_override, and status transitions have no history at all.
create table opportunity_status_history (
    id uuid primary key default gen_random_uuid(),
    opportunity_id uuid not null references opportunities(id) on delete cascade,
    from_status text,
    to_status text not null,
    actor_type text not null check (actor_type in ('user', 'system', 'model')),
    actor_id text not null,
    reason_code text,
    reason_text text,
    occurred_at timestamptz not null default now(),
    check (to_status not in ('dismissed', 'closed_lost', 'on_hold')
           or reason_code is not null)
);

-- ---------------------------------------------------------------------------
-- C7  alerts uniqueness is (subscription_id, material_change_key) and
--     subscription_id is nullable. NULLs are distinct in PostgreSQL, so
--     system-generated alerts can duplicate without bound. Dedupe belongs at
--     the recipient level anyway: one user with three matching saved views
--     should receive one alert.
-- ---------------------------------------------------------------------------

alter table alerts
    add column recipient_key text;

create unique index alerts_recipient_change_uidx
    on alerts (recipient_key, material_change_key);

create unique index alerts_system_change_uidx
    on alerts (material_change_key)
    where subscription_id is null and recipient_key is null;

-- C8  No idempotency key on source_runs: a scheduler retry or duplicate worker
--     lease produces two runs for one slot, corrupting the 95% success metric
--     that Phase 2 exit depends on.
create unique index source_runs_slot_uidx
    on source_runs (source_id, scheduled_for)
    where scheduled_for is not null;

-- ---------------------------------------------------------------------------
-- C9, C21, C5, D7  Source contract additions: timezone, robots posture,
--     licensing mode, retention, and the two-tier evidence model that resolves
--     broad news discovery against the destination allowlist.
-- ---------------------------------------------------------------------------

alter table sources
    add column schedule_timezone text not null default 'UTC',
    add column user_agent text,
    add column robots_policy text not null default 'respect'
        check (robots_policy in ('respect', 'not_applicable_api', 'exempt_licensed')),
    add column license_mode text not null default 'unknown'
        check (license_mode in (
            'public_domain', 'open_attribution', 'licensed_full_text',
            'reference_only', 'unknown'
        )),
    add column retention_days integer check (retention_days is null or retention_days > 0),
    add column evidence_mode text not null default 'full'
        check (evidence_mode in ('full', 'reference'));

alter table evidence
    add column evidence_mode text not null default 'full'
        check (evidence_mode in ('full', 'reference')),
    add column retention_expires_at timestamptz;

-- reference-mode evidence stores metadata and a link only, never a body.
alter table evidence
    add constraint evidence_reference_mode_ck
        check (evidence_mode <> 'reference'
               or (raw_storage_uri is null and extracted_text_uri is null));

-- ---------------------------------------------------------------------------
-- C12  A global unique index on lower(canonical_name) forces a premature merge
--      of two legitimately distinct entities that share a name -- the exact
--      failure 06 §Data-quality rules warns against. Identity should come from
--      identifiers, not from a string.
-- ---------------------------------------------------------------------------

drop index organizations_canonical_name_lower_uidx;

alter table organizations
    add column entity_key text;         -- deterministic, identifier-derived

create unique index organizations_entity_key_uidx
    on organizations (entity_key) where entity_key is not null;

create index organizations_canonical_name_lower_idx
    on organizations (lower(canonical_name));

-- C13  Tier is assigned per segment sheet in the source workbook (Nestle
--      appears in both Food and Beverage & Dairy), not per organization.
create table organization_segment_tiers (
    organization_id uuid not null references organizations(id) on delete cascade,
    sector text not null,
    target_tier text not null check (target_tier in (
        'tier_1', 'tier_2', 'tier_3', 'discovery', 'not_targeted'
    )),
    import_record_id uuid references import_records(id),
    primary key (organization_id, sector)
);

-- ---------------------------------------------------------------------------
-- C14, C15  Ontology and scoring configuration move out of check constraints
--     into versioned reference data. Two reasons: 05 requires a reusable market
--     module for other Haskell departments, and scoring weights will change
--     during the pilot -- that must be a config version bump with recomputable
--     snapshots, not a migration. signals.event_type is currently free text
--     with no vocabulary at all.
-- ---------------------------------------------------------------------------

create table signal_event_types (
    code text primary key,
    signal_family text not null,
    display_name text not null,
    negative_by_default boolean not null default false,
    retired_at timestamptz
);

alter table signals
    add constraint signals_event_type_fk
    foreign key (event_type) references signal_event_types(code);

create table scoring_configs (
    version text primary key,
    dimension_caps jsonb not null,      -- {"haskell_fit":30, ...}
    confidence_multipliers jsonb not null,
    promotion_thresholds jsonb not null,
    effective_from timestamptz not null,
    retired_at timestamptz
);

-- The multiplier set moves into scoring_configs; the column keeps a range
-- check only, so changing a multiplier stops being a schema migration.
alter table opportunities
    drop constraint opportunities_confidence_multiplier_check;

alter table opportunities
    add constraint opportunities_confidence_multiplier_range_ck
        check (confidence_multiplier > 0 and confidence_multiplier <= 1);

alter table opportunities
    add column scoring_version text references scoring_configs(version);

-- ---------------------------------------------------------------------------
-- C4  Stage 'confirmed' and confidence 'confirmed' are different concepts with
--     the same word; "Confirmed / Possible" is a legitimate and confusing
--     combination. Stage labels stay -- they are the plain-language ones users
--     want. Confidence values are renamed; the semantics in 02 are unchanged.
--
--     possible  -> single_source
--     probable  -> corroborated
--     confirmed -> authoritative
--
--     Applies to evidence-derived confidence on signals and opportunities and
--     to every enum in schemas/platform.schema.json. Deliberately left as an
--     explicit rename rather than sketched here, because it touches stored
--     rows, the JSON Schema, the UI copy, and the briefing templates -- and it
--     is cheap now and expensive after any of those ship.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- C19  market_trends.velocity is constrained to [-1, 1] with no definition of
--      how it is computed or over what window; two implementations would
--      produce different numbers for the same data.
-- ---------------------------------------------------------------------------

alter table market_trends
    add column velocity_method text not null default 'org_weighted_rate_v1',
    add column window_days smallint not null default 30,
    add column baseline_days smallint not null default 90;

-- ---------------------------------------------------------------------------
-- Deliberately NOT changed, so the record shows these were considered:
--   * the seven source_run statuses               (02 -- correct as written)
--   * the three opportunity stages                (02 -- correct as written)
--   * the five scoring dimensions and their caps  (02 -- account_strategy
--                                                  capped at 10 is the whole
--                                                  point; do not raise it)
--   * the ten opportunity statuses                (02)
--   * the nine signal families                    (02)
--   * the eighteen organization roles             (02)
--   * evidence unique (source_id, content_hash)   -- per-source copies are
--     intentionally distinct evidence; cross-source dedup is the job of
--     evidence_families, not of this constraint.
-- ---------------------------------------------------------------------------
