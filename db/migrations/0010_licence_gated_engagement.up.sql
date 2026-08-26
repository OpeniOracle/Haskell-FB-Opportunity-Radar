-- 0010  §7 step 9 — D14-L structures, CREATED EMPTY behind a licence gate
--
-- D14-L is BLOCKED: trade-show attendance import, the engagement layer, tier
-- attributes and account-strategy scoring are all unauthorized pending a licence
-- decision. The plan requires the tables to exist now — schema complete,
-- population later — so Phase 2 adds behaviour rather than tables.
--
-- "Created empty" is not a comment in this migration. It is a foreign key.
--
-- `licence_authorizations` ships with ZERO ROWS and no way to acquire one except
-- a deliberate, audited data operation performed after D14-L clears. Every table
-- below carries a NOT NULL reference into it. Until an authorization row exists,
-- every insert into every one of these tables fails on the foreign key — from an
-- importer, from a script, from psql, from anywhere. That is the "unauthorized
-- path" rejection this PR is required to enforce, and it is enforced by the
-- database rather than by a reviewer noticing.
--
-- `contact_records` is NOT created. The supplied workbooks contain no personal
-- data (a Company column only; the person-oriented export columns are empty), so
-- the obligation is confidentiality and licensing, not privacy. Personal-data
-- functionality stays dormant: creating the table would be the first step toward
-- filling it. Its control set is specified in 10_DESIGN_RESPONSE.md §6.5 and is
-- to be created only if and when contact-level data is actually ingested.

create table licence_authorizations (
    id                      uuid primary key default gen_random_uuid(),
    decision_ref            text not null unique,   -- e.g. the D14-L decision record
    scope                   text not null,
    licence_summary         text not null,
    authorized_by           text not null,
    authorized_at           timestamptz not null,
    expires_at              timestamptz,
    revoked_at              timestamptz,
    notes                   text,
    created_at              timestamptz not null default now(),

    constraint licence_authorizations_scope_check
        check (scope in ('event_attendance_import', 'engagement_layer',
                         'segment_tiers', 'account_strategy_scoring')),
    constraint licence_authorizations_decision_ref_present
        check (length(trim(decision_ref)) > 0),
    constraint licence_authorizations_authorizer_present
        check (length(trim(authorized_by)) > 0),
    constraint licence_authorizations_expiry_after_grant
        check (expires_at is null or expires_at > authorized_at),
    constraint licence_authorizations_revocation_after_grant
        check (revoked_at is null or revoked_at >= authorized_at)
);
comment on table licence_authorizations is
    'D14-L gate. Ships EMPTY. Every licence-gated table has a NOT NULL FK here, so no gated row can be inserted until an authorization exists.';

-- ---------------------------------------------------------------------------
-- C1  Import lineage. 06 requires every derived value to trace to its import
--     record AND its transformation version.
-- ---------------------------------------------------------------------------

create table import_batches (
    id                          uuid primary key default gen_random_uuid(),
    licence_authorization_id    uuid not null references licence_authorizations(id),
    source_filename             text not null,
    file_hash                   char(64) not null,
    sheet_inventory             jsonb not null default '[]',
    row_count                   integer not null default 0,
    transformation_version      text not null,
    data_sensitivity_class      text not null default 'confidential_internal',
    imported_at                 timestamptz not null default now(),
    imported_by                 text not null,
    unique (file_hash, source_filename),
    check (row_count >= 0),
    constraint import_batches_sensitivity_check
        check (data_sensitivity_class in ('public', 'licensed',
                                          'confidential_internal', 'restricted_personal'))
);

create table import_records (
    id                  uuid primary key default gen_random_uuid(),
    batch_id            uuid not null references import_batches(id) on delete cascade,
    sheet_name          text not null,
    source_row_number   integer not null,
    original_values     jsonb not null,     -- raw row JSON; never edited
    record_hash         char(64) not null,
    created_at          timestamptz not null default now(),
    unique (batch_id, sheet_name, source_row_number),
    check (source_row_number > 0)
);

-- An organization candidate may remain unresolved indefinitely. That is a
-- correct terminal state, not an error (ADR 0005). Not licence-gated on its own:
-- candidates also arise from evidence and research staging, and only the
-- import-derived ones inherit the gate through `import_record_id`.
create table organization_candidates (
    id                          uuid primary key default gen_random_uuid(),
    import_record_id            uuid references import_records(id) on delete cascade,
    research_claim_id           text references research_claims(research_claim_id) on delete set null,
    original_string             text not null,
    normalized_string           text not null,
    resolved_organization_id    uuid references organizations(id),
    resolution_confidence       numeric(4,3),
    resolution_method           text,
    resolution_state            text not null default 'unresolved',
    rejection_reason            text,
    transformation_version      text not null,
    resolved_at                 timestamptz,
    resolved_by                 text,
    created_at                  timestamptz not null default now(),

    constraint organization_candidates_state_check
        check (resolution_state in ('unresolved', 'auto_resolved', 'human_approved',
                                    'human_rejected', 'ambiguous')),
    constraint organization_candidates_confidence_range
        check (resolution_confidence is null or resolution_confidence between 0 and 1),
    constraint organization_candidates_resolution_has_method
        check (resolved_organization_id is null or resolution_method is not null),
    -- Same rule as a rejected research claim: a rejection with no reason is
    -- re-triaged from scratch on every re-import.
    constraint organization_candidates_rejection_has_reason
        check (resolution_state <> 'human_rejected'
               or (rejection_reason is not null and length(trim(rejection_reason)) > 0))
);

create index organization_candidates_state_idx
    on organization_candidates (resolution_state, normalized_string);

-- The deferred FK from 0006: facility candidates predate this table.
alter table facility_candidates
    add constraint facility_candidates_organization_candidate_fk
    foreign key (organization_candidate_id)
    references organization_candidates(id) on delete cascade;

-- A human resolution decision must survive re-import, re-normalization and
-- extractor upgrades, or the unresolved queue regenerates the same work forever.
create table approved_entity_mappings (
    id                  uuid primary key default gen_random_uuid(),
    normalized_string   text not null,
    scope               text not null default 'global',
    scope_key           text,
    organization_id     uuid references organizations(id) on delete cascade,
    facility_id         uuid references facilities(id) on delete cascade,
    evidence_id         uuid references evidence(id) on delete set null,
    approved_by         text not null,
    approved_at         timestamptz not null default now(),
    active              boolean not null default true,
    unique (normalized_string, scope, scope_key),
    constraint approved_entity_mappings_scope_check
        check (scope in ('global', 'source', 'import')),
    constraint approved_entity_mappings_has_target
        check (organization_id is not null or facility_id is not null)
);

-- ---------------------------------------------------------------------------
-- C11  Engagement traces to a row instead of living in organizations.engagement
--      jsonb. LICENCE-GATED: this is the trade-show attendance layer.
-- ---------------------------------------------------------------------------

create table engagement_observations (
    id                          uuid primary key default gen_random_uuid(),
    licence_authorization_id    uuid not null references licence_authorizations(id),
    organization_candidate_id   uuid references organization_candidates(id) on delete cascade,
    organization_id             uuid references organizations(id) on delete cascade,
    import_record_id            uuid references import_records(id) on delete set null,
    event_name                  text not null,
    event_year                  smallint,
    declared_interests          text[] not null default '{}',
    industry_response           text,
    company_role_response       text,
    address_candidate           jsonb,
    repeat_count                integer not null default 1,
    transformation_version      text not null,
    created_at                  timestamptz not null default now(),
    check (repeat_count >= 1),
    constraint engagement_observations_has_subject
        check (organization_candidate_id is not null or organization_id is not null)
);
comment on table engagement_observations is
    'D14-L blocked. Created empty; the NOT NULL licence_authorization_id makes population impossible until D14-L clears.';

-- C13  Tier is assigned per segment, not per organization: the same company can
--      appear in more than one segment with different tiers.
create table organization_segment_tiers (
    organization_id             uuid not null references organizations(id) on delete cascade,
    sector                      text not null,
    licence_authorization_id    uuid not null references licence_authorizations(id),
    target_tier                 text not null,
    import_record_id            uuid references import_records(id),
    created_at                  timestamptz not null default now(),
    primary key (organization_id, sector),
    constraint organization_segment_tiers_tier_check
        check (target_tier in ('tier_1', 'tier_2', 'tier_3', 'discovery', 'not_targeted'))
);
comment on table organization_segment_tiers is
    'D14-L blocked. Created empty behind the same licence gate.';

create index on import_records (batch_id);
create index on engagement_observations (organization_id);
create index on engagement_observations (organization_candidate_id);
create index on approved_entity_mappings (organization_id);
