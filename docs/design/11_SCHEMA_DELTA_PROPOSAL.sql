-- Haskell Food & Beverage Opportunity Radar
-- PROPOSED schema delta v0.1.0 -> v0.2.0 -> v0.3.0
--
-- THIS IS A DESIGN PROPOSAL, NOT A MIGRATION. Do not run it.
-- Nothing here has been applied to any database.
-- It exists to make the recommendations in docs/design/10_DESIGN_RESPONSE.md §6
-- concrete enough to argue with. Migration authoring happens after gate G-4.
--
-- Revision 0.2 reconciles this file with the design-reconciliation pass:
--   * full temporal model, replacing the narrower date-precision proposal   (C2)
--   * confidence decomposed into three axes                                 (C4)
--   * five evidence access modes, replacing the two-tier split              (C5)
--   * event data reclassified as company-level confidential business data,
--     with personal-data structures made CONDITIONAL and dormant            (C6)
--   * alert dedupe key made non-null and recipient/channel aware            (C7)
--   * logical source runs separated from retry attempts                     (C8)
--   * expected-coverage model, so health is not mistaken for coverage       (C23)
--   * time-bounded ownership for corporate reorganizations                  (C24)
--   * replay-cache key covering every effective model input                 (C25)
--
-- Revision 0.3 adds the external-research reconciliation deltas:
--   * evidence corrections as relationships, never overwrites                (C26)
--   * per-source cadence and yield baselines                                 (C27)
--   * outbound-alert circuit breaker, quarantine before delivery             (C28)
--   * bounded retries, parked messages, per-source circuit state             (C29)
--   * research-claim staging with an activation gate that fails closed  (ADR 0011)
--   * 'season' added to temporal_precision, from a real mis-stored date       (C2)
--   * four-value scope vocabulary: fnb_core/fnb_adjacent/non_fnb/unknown     (C22)
--   * provisional signal subtypes and ranking hypotheses, all NON-SCORING
--   * a register of permanently unavailable sources
--
-- Each block cites the conflict-register ID from 10_DESIGN_RESPONSE.md §2.
-- Ordering below is dependency order, not priority order.

-- ---------------------------------------------------------------------------
-- C1  Ingestion model required by 06_SOURCE_DATA_PROFILE.md but absent from
--     schemas/database.sql. Without these tables there is nowhere to put an
--     unresolved PACK EXPO row, which blocks Phase 1 entirely.
--
--     Note transformation_version on every derived row: 06 requires that every
--     derived value trace to its import record AND its transformation version.
-- ---------------------------------------------------------------------------

create table import_batches (
    id uuid primary key default gen_random_uuid(),
    source_filename text not null,
    file_hash char(64) not null,
    sheet_inventory jsonb not null default '[]',
    row_count integer not null check (row_count >= 0),
    transformation_version text not null,
    data_sensitivity_class text not null default 'confidential_internal',
    imported_at timestamptz not null default now(),
    imported_by text not null,
    unique (file_hash, source_filename)
);

create table import_records (
    id uuid primary key default gen_random_uuid(),
    batch_id uuid not null references import_batches(id) on delete cascade,
    sheet_name text not null,
    source_row_number integer not null check (source_row_number > 0),
    original_values jsonb not null,     -- raw row JSON; never edited
    record_hash char(64) not null,
    created_at timestamptz not null default now(),
    unique (batch_id, sheet_name, source_row_number)
);

-- An organization candidate may remain unresolved indefinitely. That is a
-- correct terminal state, not an error (03 §Entity resolution, ADR 0005).
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
    transformation_version text not null,
    resolved_at timestamptz,
    resolved_by text,
    created_at timestamptz not null default now(),
    check (resolved_organization_id is null or resolution_method is not null)
);

create index organization_candidates_state_idx
    on organization_candidates(resolution_state, normalized_string);

-- Durable approved mappings. A human resolution decision must survive re-import,
-- re-normalization, and extractor upgrades, or the unresolved queue regenerates
-- the same work forever.
create table approved_entity_mappings (
    id uuid primary key default gen_random_uuid(),
    normalized_string text not null,
    scope text not null default 'global' check (scope in ('global', 'source', 'import')),
    scope_key text,
    organization_id uuid references organizations(id) on delete cascade,
    facility_id uuid references facilities(id) on delete cascade,
    evidence_id uuid,                    -- FK added after evidence exists
    approved_by text not null,
    approved_at timestamptz not null default now(),
    active boolean not null default true,
    check (organization_id is not null or facility_id is not null),
    unique (normalized_string, scope, scope_key)
);

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
    transformation_version text not null,
    created_at timestamptz not null default now(),
    check (organization_candidate_id is not null or organization_id is not null)
);

-- 06: an event address is a facility CANDIDATE, never a confirmed plant.
-- Promotion requires corroborating evidence, and records which evidence.
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
    corroborating_evidence_id uuid,      -- FK added after evidence exists
    promoted_facility_id uuid references facilities(id),
    created_at timestamptz not null default now(),
    check (corroboration_status <> 'promoted'
           or (promoted_facility_id is not null and corroborating_evidence_id is not null))
);

-- ---------------------------------------------------------------------------
-- C6  CORRECTED IN 0.2.
--
--     The supplied workbooks contain NO personal data. The "Pack Expo 2025
--     Email List" sheet carries a Company column only -- 519 populated rows,
--     183 unique company strings -- and the XPressLeads export's person-
--     oriented columns (UserAccount, DeviceLabel) are empty. TerminalID holds
--     two manual-import identifiers, which are provenance, not people.
--
--     The obligation is confidentiality and licensing, not privacy. Sources and
--     evidence therefore carry a sensitivity class, and the event imports land
--     as confidential_internal.
-- ---------------------------------------------------------------------------

alter table sources
    add column data_sensitivity_class text not null default 'public'
        check (data_sensitivity_class in (
            'public', 'licensed', 'confidential_internal', 'restricted_personal'
        ));

alter table evidence
    add column data_sensitivity_class text not null default 'public'
        check (data_sensitivity_class in (
            'public', 'licensed', 'confidential_internal', 'restricted_personal'
        ));

-- CONDITIONAL AND DORMANT. Create this table only if and when contact-level,
-- badge-holder, email, or individual campaign data is actually ingested.
-- Trigger conditions and the full control set are in 10_DESIGN_RESPONSE.md §6.5.
-- It is written here so the controls exist before the data does, not after.
--
-- create table contact_records (
--     id uuid primary key default gen_random_uuid(),
--     import_record_id uuid not null references import_records(id) on delete cascade,
--     organization_candidate_id uuid references organization_candidates(id),
--     personal_data jsonb not null,             -- encrypted at rest
--     lawful_basis text not null,               -- ingestion fails closed without it
--     retention_expires_at timestamptz not null,
--     created_at timestamptz not null default now()
-- );
-- comment on table contact_records is
--     'Restricted personal data. Independent access control. Never reachable '
--     'from any Radar API surface, briefing, export, or model prompt.';

-- ---------------------------------------------------------------------------
-- C3 + C24  Ownership is time-bounded and evidence-backed.
--
--     Verification found four completed corporate reorganizations across the
--     15-account pilot cohort in roughly twenty months, with two more in
--     flight (Mars/Kellanova, Nestle Waters -> BlueTriton -> Primo Brands,
--     Unilever's ice cream demerger, KDP/JDE Peet's and its planned split,
--     Kimberly-Clark/Kenvue pending). A single current-owner pointer
--     misattributes projects after every one of them.
--
--     Attribution rule: a project belongs to the operator AS AT THE EVENT DATE.
-- ---------------------------------------------------------------------------

create table facility_organizations (
    facility_id uuid not null references facilities(id) on delete cascade,
    organization_id uuid not null references organizations(id) on delete cascade,
    relationship text not null check (relationship in (
        'owner', 'operator', 'tenant', 'co_manufacturer', 'brand_produced_here',
        'former_owner', 'unknown'
    )),
    evidence_id uuid,                    -- FK added after evidence exists
    from_date date,
    to_date date,
    created_at timestamptz not null default now(),
    primary key (facility_id, organization_id, relationship),
    check (to_date is null or from_date is null or to_date >= from_date)
);

create table organization_relationships (
    parent_organization_id uuid not null references organizations(id) on delete cascade,
    child_organization_id uuid not null references organizations(id) on delete cascade,
    relationship text not null check (relationship in (
        'parent_subsidiary', 'brand_owner', 'division', 'joint_venture',
        'franchise_bottler', 'co_manufacturer', 'former_parent'
    )),
    evidence_id uuid,                    -- FK added after evidence exists
    from_date date,
    to_date date,
    created_at timestamptz not null default now(),
    primary key (parent_organization_id, child_organization_id, relationship),
    check (parent_organization_id <> child_organization_id),
    check (to_date is null or from_date is null or to_date >= from_date)
);

-- facilities.organization_id is retained as the denormalized current operator.
-- organizations.parent_organization_id is retained as the current parent.
-- Neither may be used for as-at-date attribution.

-- ---------------------------------------------------------------------------
-- C2  TEMPORAL MODEL. A non-negotiable requirement the v0.1 schema cannot meet:
--     "in 2027" currently has to be stored as 2027-01-01, i.e. invented. The
--     v0.1 schema also cannot distinguish a date the source STATED from one the
--     platform INFERRED.
--
--     Six fields replace one. The interval is what does the work -- a point plus
--     a precision label still tempts every consumer to read the point.
-- ---------------------------------------------------------------------------

create type temporal_precision as enum (
    'exact_day',    -- "on 14 March 2027"
    'month',        -- "in March 2027"
    'quarter',      -- "in Q3 2027"
    'season',       -- "by spring 2029" -- added by the external-research pass, where an
                    -- external record had stored exactly this phrase as 2029-03-31
    'half_year',    -- "in the second half of 2027"
    'year',         -- "in 2027"
    'range',        -- "between 2027 and 2029"
    'relative',     -- "within 18 months of closing" -- anchor not yet resolved
    'unknown'       -- source gives no timing at all
);

create type temporal_basis as enum (
    'stated',       -- the source gives this timing
    'inferred',     -- the platform derived it; explanation required
    'unknown'
);

-- Applied identically to evidence, signals, and facility open/close dates.
alter table evidence
    add column temporal_raw_expression text,
    add column temporal_start date,
    add column temporal_end date,
    add column temporal_precision temporal_precision not null default 'unknown',
    add column temporal_basis temporal_basis not null default 'unknown',
    add column temporal_inference_note text,
    add constraint evidence_temporal_interval_ck
        check (temporal_end is null or temporal_start is null
               or temporal_end >= temporal_start),
    add constraint evidence_temporal_precision_ck
        check (temporal_precision = 'unknown'
               or temporal_start is not null
               or temporal_precision = 'relative'),
    add constraint evidence_temporal_inference_ck
        check (temporal_basis <> 'inferred' or temporal_inference_note is not null);

alter table signals
    add column temporal_raw_expression text,
    add column temporal_start date,
    add column temporal_end date,
    add column temporal_precision temporal_precision not null default 'unknown',
    add column temporal_basis temporal_basis not null default 'unknown',
    add column temporal_inference_note text,
    add constraint signals_temporal_interval_ck
        check (temporal_end is null or temporal_start is null
               or temporal_end >= temporal_start),
    add constraint signals_temporal_inference_ck
        check (temporal_basis <> 'inferred' or temporal_inference_note is not null);

-- "production begins in 2027" is stored as:
--   temporal_raw_expression = 'production begins in 2027'
--   temporal_start          = 2027-01-01
--   temporal_end            = 2027-12-31
--   temporal_precision      = 'year'
--   temporal_basis          = 'stated'
-- and is queried by interval overlap, never by equality on a fabricated day:
--   where temporal_start <= '2027-12-31' and temporal_end >= '2027-01-01'
-- and is rendered "expected 2027", never "1 January 2027".

-- The existing event_date columns remain during transition and are then dropped;
-- they must not be read once temporal_start exists, or the fabricated day
-- re-enters through the back door.

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
-- C5  EVIDENCE ACCESS MODES. Broad news discovery and a strict destination
--     allowlist are in direct tension, and the v0.1 two-tier split was too
--     coarse to express how much of a document we actually hold.
--
--     Promotion rules below are the enforceable half of ADR 0006.
-- ---------------------------------------------------------------------------

create type evidence_access_mode as enum (
    'structured_primary',   -- parsed records from an official API or filing
    'archived_full_text',   -- full text archived and excerptable
    'licensed_full_text',   -- full text held under licence, display bounded
    'reference_only',       -- URL + title + publisher + timestamps + given snippet
    'metadata_only'         -- existence and identifiers; no text at all
);

alter table sources
    add column default_access_mode evidence_access_mode not null
        default 'archived_full_text',
    add column license_mode text not null default 'unknown'
        check (license_mode in (
            'public_domain', 'open_attribution', 'licensed_full_text',
            'reference_only', 'unknown'
        )),
    add column retention_days integer check (retention_days is null or retention_days > 0),
    add column schedule_timezone text not null default 'UTC',   -- C9
    add column user_agent text,                                 -- C21
    add column robots_policy text not null default 'respect'    -- C21
        check (robots_policy in ('respect', 'not_applicable_api', 'exempt_licensed'));

alter table evidence
    add column access_mode evidence_access_mode not null default 'archived_full_text',
    add column retention_expires_at timestamptz;

-- Reference-only and metadata-only evidence store metadata and a link. Never a body.
alter table evidence
    add constraint evidence_access_mode_body_ck
        check (access_mode not in ('reference_only', 'metadata_only')
               or (raw_storage_uri is null and extracted_text_uri is null));

-- ---------------------------------------------------------------------------
-- C4  CONFIDENCE DECOMPOSED. The single enum answered three questions at once,
--     and reused the word "confirmed" for a lifecycle stage.
--
--     THE LIFECYCLE IS UNCHANGED: emerging -> developing -> confirmed.
--     Only our description of KNOWLEDGE changes.
-- ---------------------------------------------------------------------------

create type evidence_strength as enum (
    'indicative',       -- credible but incomplete, indirect, or single non-authoritative
    'corroborated',     -- independent publishers or consistent structured data
    'authoritative'     -- a primary source explicitly establishes it
);

create type assessment_type as enum (
    'observed_fact',    -- the evidence states the claim
    'inference',        -- the evidence supports the claim indirectly
    'hypothesis'        -- the evidence merely suggests the claim
);

create type confidence_level as enum ('low', 'moderate', 'high');

alter table signals
    add column evidence_strength evidence_strength,
    add column assessment_type assessment_type,
    add column confidence_level confidence_level;

alter table opportunities
    add column evidence_strength evidence_strength,
    add column assessment_type assessment_type,
    add column confidence_level confidence_level;

-- Guardrails: a strong source cannot launder a weak claim.
alter table signals
    add constraint signals_inference_confidence_ck
        check (assessment_type is null
               or assessment_type = 'observed_fact'
               or (assessment_type = 'inference'  and confidence_level <> 'high')
               or (assessment_type = 'hypothesis' and confidence_level = 'low'));

alter table opportunities
    add constraint opportunities_inference_confidence_ck
        check (assessment_type is null
               or assessment_type = 'observed_fact'
               or (assessment_type = 'inference'  and confidence_level <> 'high')
               or (assessment_type = 'hypothesis' and confidence_level = 'low'));

-- Promotion rules (C5 + C4 together), enforced in versioned application logic
-- because they span rows; stated here so the intent is reviewable:
--
--   1. Evidence with access_mode in ('reference_only','metadata_only') may not
--      raise evidence_strength above 'indicative', however many such records agree.
--   2. An opportunity may not enter stage 'confirmed' unless at least one
--      supporting signal has evidence_strength = 'authoritative'
--      AND assessment_type = 'observed_fact'.
--   3. Any number of reference_only records may raise momentum and trend
--      velocity, and may create or sustain an 'emerging' opportunity.
--   4. Syndicated copies collapse into one evidence_family before corroboration
--      is counted.
--
-- The 02 multipliers carry over unchanged, keyed on confidence_level:
--   low = 0.60, moderate = 0.80, high = 1.00
-- The old three-value confidence column is dropped after backfill.

-- ---------------------------------------------------------------------------
-- C17  One append-only ledger powers Pulse deltas, the card's "material change
--      summary", alert deduplication, and the daily brief. Built separately,
--      these grow four half-correct diffing implementations that disagree.
-- ---------------------------------------------------------------------------

create table change_events (
    id uuid primary key default gen_random_uuid(),
    object_type text not null check (object_type in (
        'opportunity', 'signal', 'market_trend', 'facility', 'organization', 'source'
    )),
    object_id uuid not null,
    change_type text not null,          -- stage_promoted, evidence_added, closed, ...
    from_state jsonb,
    to_state jsonb,
    materiality text not null check (materiality in ('material', 'minor', 'silent')),
    dedupe_key text not null,
    scoring_version text,
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
-- C7  ALERT IDEMPOTENCY REPAIRED. v0.1 keyed on (subscription_id,
--     material_change_key) with subscription_id nullable -- and NULLs are
--     distinct in PostgreSQL, so system alerts could duplicate without bound.
--     The key also omitted recipient and channel, so one person matching
--     through three saved views was told three times.
--
--     The new key is NON-NULL and self-sufficient.
-- ---------------------------------------------------------------------------

alter table alerts
    add column recipient_key text,
    add column target_type text,
    add column target_id uuid,
    add column material_change_fingerprint text,
    add column alert_dedupe_key text;

-- alert_dedupe_key = hash(recipient_key, delivery_channel, target_type, target_id,
--                         material_change_fingerprint)
-- material_change_fingerprint = hash(change_type, from_state_digest,
--                                    to_state_digest, scoring_version)
--
-- Recipient rather than subscription: one user, one alert.
-- Channel included: a Teams alert and tomorrow's email digest are not duplicates.
-- scoring_version included: a deliberate rescoring run may re-notify; an
-- unchanged recomputation may not.

alter table alerts
    alter column alert_dedupe_key set not null;

alter table alerts
    add constraint alerts_dedupe_key_uidx unique (alert_dedupe_key);

-- the old partial-index workaround is unnecessary once the key is non-null.

-- ---------------------------------------------------------------------------
-- C8  LOGICAL RUNS vs RETRY ATTEMPTS. v0.1 had no idempotency key at all, and
--     no way to tell a collection cycle from the tries inside it. Retries
--     inflated run counts and corrupted the 95% success rate that Phase 2 exit
--     depends on: a source succeeding on its third try looked like two failures
--     and a success.
-- ---------------------------------------------------------------------------

alter table source_runs
    add column collection_window_start timestamptz,
    add column collection_window_end timestamptz,
    add column attempt_count integer not null default 1 check (attempt_count >= 1);

create unique index source_runs_logical_uidx
    on source_runs (source_id, collection_window_start)
    where collection_window_start is not null;

create table source_run_attempts (
    id uuid primary key default gen_random_uuid(),
    source_run_id uuid not null references source_runs(id) on delete cascade,
    attempt_number integer not null check (attempt_number >= 1),
    started_at timestamptz not null default now(),
    completed_at timestamptz,
    status text not null check (status in (
        'running', 'success', 'partial_success', 'unchanged', 'failed', 'action_required'
    )),
    error_code text,
    error_summary text,
    http_status_distribution jsonb not null default '{}',
    redirect_violations integer not null default 0,
    bytes_fetched bigint,
    checkpoint text,
    unique (source_run_id, attempt_number)
);

create index source_run_attempts_run_idx on source_run_attempts(source_run_id);

-- Metric rule, stated so it cannot drift:
--   connector execution success = logical runs ending success/unchanged/
--   partial_success  DIVIDED BY  scheduled logical runs.
--   Attempts are EXCLUDED from that denominator and reported separately as
--   "attempts per successful run", which is the earlier warning signal.

-- ---------------------------------------------------------------------------
-- C23  EXPECTED COVERAGE. 05 leads Phase 2 exit with a connector-success rate.
--      Nothing stops that being read as market coverage. For the four pilot
--      accounts with no periodic SEC filing coverage -- Nestle, Mars, Danone,
--      Niagara Bottling -- every enabled connector can be green while the
--      account is effectively unmonitored, because the sources that would carry
--      their signals were never built.
--
--      This table gives "coverage" a denominator.
-- ---------------------------------------------------------------------------

create table account_source_expectations (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references organizations(id) on delete cascade,
    source_family text not null,        -- 'sec_edgar', 'company_newsroom', ...
    expectation text not null check (expectation in (
        'required',        -- coverage gap if absent or unhealthy
        'expected',        -- counts toward completeness
        'optional',        -- neither counted nor penalised
        'not_applicable'   -- silence here is CORRECT; do not alarm
    )),
    rationale text not null,
    reviewed_at timestamptz,
    unique (organization_id, source_family)
);

-- Seeded directly from docs/design/12_PILOT_SOURCE_COVERAGE_MATRIX.md.
-- Two examples of why the 'not_applicable' value matters:
--   * FDA food enforcement for Kimberly-Clark and Procter & Gamble: they are
--     Adjacent Consumer Products accounts. Silence is correct, and the account
--     must not be penalised for a source that was never going to fire.
--   * SEC EDGAR for Mars and Niagara Bottling: no periodic filings exist, so
--     coverage must come from newsrooms, incentives, and permits instead.

-- C22  Account scope classification, so non-core F&B accounts are classified
--      rather than treated as list errors. Four-value vocabulary per the external
--      research reconciliation; 'unknown' is a transient state, not a resting place.
alter table organizations
    add column scope_class text not null default 'unknown'
        check (scope_class in (
            'fnb_core',
            'fnb_adjacent',      -- adjacent manufacturer OR strategic supplier/partner
            'non_fnb',
            'unknown'
        ));

-- Supplier routing is a property of WHICH FACILITY a signal concerns, not of the
-- account class: a signal about a supplier's own plant is eligible, one about its
-- customers' plants is account intelligence.
alter table organizations
    add column supplier_routing boolean not null default false;

-- ---------------------------------------------------------------------------
-- C25  MODEL REPLAY CACHE. The v0.1 key -- content hash, prompt version, model,
--      schema version -- was incomplete, and an incomplete cache key is worse
--      than no cache: it serves stale output as if it were fresh.
--
--      structured_context_digest is the one most easily forgotten and the most
--      dangerous: classification prompts include resolved account and facility
--      context, so the same article legitimately classifies differently once a
--      facility resolves. Without it in the key, the cache pins the
--      pre-resolution answer forever.
-- ---------------------------------------------------------------------------

create table model_replay_cache (
    replay_key char(64) primary key,     -- hash of every column below
    content_hash char(64) not null,
    preprocessing_version text not null, -- extractor / OCR version
    task text not null,                  -- extract | classify | align | summarize | cluster
    provider text not null,
    model text not null,
    model_parameters jsonb not null,     -- temperature, top_p, max_tokens, seed, tools
    system_instructions_hash char(64) not null,
    prompt_version text not null,
    schema_version text not null,
    taxonomy_version text not null,
    structured_context_digest char(64) not null,
    output jsonb not null,
    output_valid boolean not null,
    created_at timestamptz not null default now(),
    last_hit_at timestamptz
);

-- Components are stored alongside the hash so a version bump can be scoped
-- precisely: "reprocess everything affected by taxonomy v3" is a query, not a
-- full recompute.
create index model_replay_cache_taxonomy_idx on model_replay_cache(taxonomy_version);
create index model_replay_cache_prompt_idx on model_replay_cache(task, prompt_version);
create index model_replay_cache_content_idx on model_replay_cache(content_hash);

-- ---------------------------------------------------------------------------
-- C12  A global unique index on lower(canonical_name) forces a premature merge
--      of two legitimately distinct entities that share a name -- the exact
--      failure 06 §Data-quality rules warns against. Identity should come from
--      identifiers, not from a string. ("Niagara Bottling" vs the several
--      unrelated "Niagara" registrants found during source verification is a
--      live example.)
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
-- C14, C15, C19  Ontology and scoring configuration move out of check
--     constraints into versioned reference data. 05 requires a reusable market
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
    confidence_multipliers jsonb not null,   -- keyed on confidence_level now
    promotion_thresholds jsonb not null,
    materiality_rules jsonb not null,   -- one definition of "material" (C17)
    effective_from timestamptz not null,
    retired_at timestamptz
);

alter table opportunities
    drop constraint opportunities_confidence_multiplier_check;

alter table opportunities
    add constraint opportunities_confidence_multiplier_range_ck
        check (confidence_multiplier > 0 and confidence_multiplier <= 1);

alter table opportunities
    add column scoring_version text references scoring_configs(version);

-- C19  market_trends.velocity is constrained to [-1, 1] with no definition of
--      how it is computed or over what window; two implementations would
--      produce different numbers for the same data.
alter table market_trends
    add column velocity_method text not null default 'org_weighted_rate_v1',
    add column window_days smallint not null default 30,
    add column baseline_days smallint not null default 90;

-- ---------------------------------------------------------------------------
-- C26  CORRECTIONS SUPERSEDE; THEY DO NOT OVERWRITE. (ADR 0012)
--
--      An external review proposed that newer documents automatically overwrite
--      older conflicting properties. Rejected: evidence is immutable, and
--      recency is not authority -- a syndicated copy published Thursday is newer
--      and weaker than the company's own Tuesday release.
-- ---------------------------------------------------------------------------

create table evidence_relationships (
    id uuid primary key default gen_random_uuid(),
    subject_evidence_id uuid not null references evidence(id) on delete cascade,
    object_evidence_id uuid not null references evidence(id) on delete cascade,
    relationship text not null check (relationship in (
        'corrects', 'retracts', 'withdraws', 'contradicts',
        'supersedes', 'delays', 'cancels'
    )),
    detected_by text not null check (detected_by in (
        'explicit_marker', 'publisher_notice', 'model_candidate', 'manual'
    )),
    detected_at timestamptz not null default now(),
    check (subject_evidence_id <> object_evidence_id),
    unique (subject_evidence_id, object_evidence_id, relationship)
);

create index evidence_relationships_object_idx
    on evidence_relationships(object_evidence_id, relationship);

-- Project/opportunity lifecycle gains the matching states so a delayed or
-- cancelled project is a STATE, not a deletion.
alter table signals
    add column correction_state text not null default 'current'
        check (correction_state in (
            'current', 'corrected', 'retracted', 'withdrawn', 'superseded', 'disputed'
        ));

-- The presented view is COMPUTED, never stored, in this order:
--   1. correction status  (retracted/withdrawn leave the view, stay readable)
--   2. source authority   (primary > official_secondary > secondary)
--   3. specificity        (names a facility > names a region)
--   4. temporal applicability (as-at the event date -- ADR 0005)
--   5. recency            (final tiebreak, never the first test)
-- A materialized projection for read performance is acceptable later, provided
-- it is derived and rebuildable. It must not become the system of record.

alter table sources
    add column source_authority text not null default 'unknown'
        check (source_authority in (
            'primary', 'official_secondary', 'secondary', 'unknown'
        ));

-- ---------------------------------------------------------------------------
-- C27, C28, C29  OPERABILITY CONTAINMENT.
-- ---------------------------------------------------------------------------

-- C27  Per-source cadence and yield baselines. A global "novelty below P99 over
--      7 days" rule was rejected: meaningless for a board that meets quarterly,
--      and noise-dominated on low-count series.
alter table sources
    add column expected_cadence interval,
    add column baseline_yield_per_cycle numeric(8,2),
    add column baseline_observed_cycles integer not null default 0,
    add column cadence_grace_multiplier numeric(3,2) not null default 2.0;

-- C29  Bounded retries -> parked queue -> circuit breaker recorded on the source.
alter table sources
    add column circuit_state text not null default 'closed'
        check (circuit_state in ('closed', 'half_open', 'open')),
    add column circuit_opened_at timestamptz,
    add column max_attempts_per_run integer not null default 4
        check (max_attempts_per_run between 1 and 10);

create table parked_messages (
    id uuid primary key default gen_random_uuid(),
    source_id text references sources(id),
    queue_class text not null,
    payload_ref text not null,          -- reference, never the payload itself
    failure_code text not null,
    failure_detail text,
    attempts integer not null check (attempts >= 1),
    parked_at timestamptz not null default now(),
    replayed_at timestamptz,
    replay_outcome text
);

create index parked_messages_open_idx
    on parked_messages(queue_class, parked_at) where replayed_at is null;

-- Alerting is on oldest-parked-age, retry-exhaustion rate, and depth relative to
-- source volume. NOT on "parked_messages is non-empty" -- one permanently
-- malformed PDF would then page someone forever and train them to ignore it.

-- C28  Outbound-alert circuit breaker: quarantine BEFORE delivery. Deduplication
--      is not a defense against a legitimate-looking flood; it would ship the
--      storm perfectly.
create table alert_dispatch_windows (
    id uuid primary key default gen_random_uuid(),
    window_start timestamptz not null,
    window_end timestamptz not null,
    alerts_generated integer not null default 0,
    moving_average numeric(10,2),
    breaker_multiple numeric(4,2) not null default 3.0,
    breaker_tripped boolean not null default false,
    pinned_inference_version text,
    released_at timestamptz,
    released_by text,
    unique (window_start, window_end)
);

alter table alerts
    add column quarantined boolean not null default false,
    add column quarantine_window_id uuid references alert_dispatch_windows(id);

-- ---------------------------------------------------------------------------
-- C13 (E13/E14)  Provisional signal subtypes and ranking hypotheses from the
--      external backtest. They carry NO scoring weight. The backtest is a set of
--      worked examples -- one summarized row per project, no defined outcome
--      dates, most rows citing a bare domain -- so its thresholds (a 500,000
--      gal/day water figure, an SPE-implies->$100M correlation, a Series C
--      cut-off, a job-title filter) are NOT encoded as rules.
-- ---------------------------------------------------------------------------

alter table signal_event_types
    add column evaluation_status text not null default 'production'
        check (evaluation_status in ('production', 'hypothesis', 'retired')),
    add column hypothesis_source text;

-- Provisional subtypes, all evaluation_status = 'hypothesis', all non-scoring:
--   incentive_approval, zoning_variance, environmental_permit,
--   utility_load_study, capacity_guidance, plant_specific_hiring,
--   supplier_equipment_announcement, special_purpose_entity_formation

create table ranking_hypotheses (
    id uuid primary key default gen_random_uuid(),
    name text not null unique,
    description text not null,
    component_event_types text[] not null,
    proposed_by text not null,
    evidence_basis text not null,
    enabled boolean not null default false,   -- disabled until an evaluated corpus exists
    evaluation_corpus_id uuid,
    created_at timestamptz not null default now(),
    check (enabled = false or evaluation_corpus_id is not null)
);

-- E15  Negative controls belong in the evaluation corpus: cancelled projects and
--      lost-bid sites. A site-selection evaluation legitimately produces signals
--      at several locations, only one of which becomes a project.
create table evaluation_corpus_entries (
    id uuid primary key default gen_random_uuid(),
    corpus_id uuid not null,
    entry_kind text not null check (entry_kind in ('positive', 'negative_control')),
    subject text not null,
    outcome text not null,
    outcome_date date,
    outcome_date_precision temporal_precision not null default 'unknown',
    citation_url text,
    citation_status text not null default 'uncited'
        check (citation_status in ('uncited', 'cited', 'verified')),
    check (citation_status = 'uncited' or citation_url is not null)
);

-- ---------------------------------------------------------------------------
-- E26 / ADR 0011  RESEARCH-CLAIM STAGING. External research NEVER lands in a
--      canonical table. Activation FAILS CLOSED.
--
--      The interchange contract and a worked example are in
--      docs/design/14_EXTERNAL_RESEARCH_RECONCILIATION.md §6.
-- ---------------------------------------------------------------------------

create table research_batches (
    id uuid primary key default gen_random_uuid(),
    source_file text not null,
    file_hash char(64),
    tool_or_author text not null,
    received_at timestamptz not null default now(),
    record_count integer not null check (record_count >= 0),
    notes text
);

create table research_claims (
    research_claim_id text primary key,
    batch_id uuid not null references research_batches(id) on delete cascade,
    source_file text not null,
    source_record_locator text not null,     -- JSONL line, table row, or heading
    claim_type text not null check (claim_type in (
        'entity', 'alias', 'facility', 'relationship', 'project', 'source',
        'hypothesis', 'network_assertion'
    )),
    -- 'network_assertion' added after both graph files were reviewed: each carries a
    -- record type asserting a COUNT rather than an instance -- "24 manufacturing plants
    -- in 18 states" for P&G, "7 owned and 17 leased production facilities" for KDP.
    -- These are true, useful, and not facility records. Forcing them into 'facility'
    -- would invent sites that the source explicitly declined to enumerate.
    subject_ref text not null,
    predicate text not null,
    object_value jsonb not null,

    -- valid time, same six-field temporal contract as canonical rows
    valid_raw_expression text,
    valid_start date,
    valid_end date,
    valid_precision temporal_precision not null default 'unknown',
    valid_basis temporal_basis not null default 'unknown',
    valid_inference_note text,

    observed_at date not null,
    evidence_urls text[] not null default '{}',
    verification_status text not null check (verification_status in (
        'unverified', 'corroborated', 'verified'
    )),
    source_authority text not null check (source_authority in (
        'primary', 'official_secondary', 'secondary', 'unknown'
    )),
    scope_classification text not null check (scope_classification in (
        'fnb_core', 'fnb_adjacent', 'non_fnb', 'unknown'
    )),
    activation_status text not null default 'staged' check (activation_status in (
        'staged', 'validated', 'rejected', 'superseded', 'needs_evidence'
    )),
    rejection_reason text,
    pilot_account_ref text,
    normalized_target_id uuid,
    created_at timestamptz not null default now(),

    -- THE ACTIVATION GATE. Fails closed.
    check (activation_status <> 'rejected'
           or (rejection_reason is not null and length(trim(rejection_reason)) > 0)),
    check (activation_status <> 'validated'
           or (normalized_target_id is not null
               and array_length(evidence_urls, 1) >= 1
               and scope_classification <> 'unknown'
               and (valid_start is null or valid_precision <> 'unknown')
               and (valid_basis <> 'inferred' or valid_inference_note is not null))),
    check (valid_basis <> 'inferred' or valid_inference_note is not null),
    check (valid_end is null or valid_start is null or valid_end >= valid_start)
);

create index research_claims_activation_idx
    on research_claims(activation_status, claim_type);
create index research_claims_subject_idx on research_claims(subject_ref);
create index research_claims_account_idx
    on research_claims(pilot_account_ref) where pilot_account_ref is not null;

-- 'unresolved' is a valid outcome that blocks activation without being an error
-- (ADR 0005). A claim may sit in 'staged' or 'needs_evidence' indefinitely.
--
-- pilot_account_ref is required for any claim about a Highest Value account or
-- its subsidiaries, so acquired and adjacent entities cannot silently become new
-- pilot accounts. Enforced in application logic because it depends on subject
-- resolution.

-- ---------------------------------------------------------------------------
-- E5  PERMANENTLY UNAVAILABLE SOURCES. Recorded so a future implementer does not
--     rediscover the same dead end. The FDA food facility registration list and
--     registration documents are not subject to FOIA disclosure, nor is derived
--     information identifying a registered person (21 U.S.C. 350d(a)(5)).
--     openFDA food enforcement remains useful for recalls and is NOT a facility
--     registry.
-- ---------------------------------------------------------------------------

create table unavailable_sources (
    id text primary key,
    name text not null,
    reason text not null check (reason in (
        'statutorily_nonpublic', 'license_prohibits', 'tos_prohibits',
        'no_machine_access', 'superseded_by_other_source'
    )),
    authority_citation text,
    evaluated_at date not null,
    substitute_source_id text references sources(id),
    notes text
);

-- ---------------------------------------------------------------------------
-- Deferred FKs, once evidence exists.
-- ---------------------------------------------------------------------------

alter table approved_entity_mappings
    add constraint approved_entity_mappings_evidence_fk
    foreign key (evidence_id) references evidence(id) on delete set null;

alter table facility_candidates
    add constraint facility_candidates_evidence_fk
    foreign key (corroborating_evidence_id) references evidence(id) on delete set null;

alter table facility_organizations
    add constraint facility_organizations_evidence_fk
    foreign key (evidence_id) references evidence(id) on delete set null;

alter table organization_relationships
    add constraint organization_relationships_evidence_fk
    foreign key (evidence_id) references evidence(id) on delete set null;

-- ---------------------------------------------------------------------------
-- Deliberately NOT changed, so the record shows these were considered:
--   * the seven source_run statuses                (02 -- correct as written)
--   * the three opportunity stages emerging /
--     developing / confirmed                       (02 -- KEPT; only the
--                                                   confidence enum is split)
--   * the five scoring dimensions and their caps   (02 -- account_strategy
--                                                   capped at 10 is the whole
--                                                   point; do not raise it)
--   * the confidence multiplier VALUES 0.60 /
--     0.80 / 1.00                                  (02 -- they now key on
--                                                   confidence_level)
--   * the ten opportunity statuses                 (02)
--   * the nine signal families                     (02)
--   * the eighteen organization roles              (02)
--   * evidence unique (source_id, content_hash)    -- per-source copies are
--     intentionally distinct evidence; cross-source dedup is the job of
--     evidence_families, not of this constraint.
-- ---------------------------------------------------------------------------
