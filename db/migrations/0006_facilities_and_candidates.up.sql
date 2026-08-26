-- 0006  §7 step 5 — facilities and facility candidates
--
-- 06 §Data-quality rules: an address that arrives from an import or a filing is
-- a facility CANDIDATE, never a confirmed plant. Confusing the two is how a
-- mailing address becomes a manufacturing site on a map.
--
-- STORAGE ONLY. No automated resolution or promotion ladder is implemented in
-- this PR. `corroboration_status` records where a human or a later phase put the
-- candidate; nothing in this migration moves it. The one rule enforced is that a
-- candidate cannot CLAIM to have been promoted without naming both the facility
-- it became and the evidence that corroborated it.

alter table facilities
    add column if not exists facility_role text not null default 'unknown',
    add column if not exists address_precision text,
    add column if not exists opened_precision text,
    add column if not exists closed_precision text,
    add column if not exists entity_key text,
    add column if not exists source_evidence_id uuid references evidence(id);

alter table facilities
    add constraint facilities_role_check
        check (facility_role in ('manufacturing', 'distribution', 'headquarters',
                                 'office', 'laboratory', 'mixed', 'unknown')),
    -- Same temporal discipline as evidence (ADR 0004): a stored date that does
    -- not say how precise it is cannot be rendered honestly.
    add constraint facilities_opened_precision_required
        check (opened_at is null or opened_precision is not null),
    add constraint facilities_closed_precision_required
        check (closed_at is null or closed_precision is not null),
    add constraint facilities_opened_precision_check
        check (opened_precision is null or opened_precision in
               ('exact_day', 'month', 'quarter', 'season', 'half_year',
                'year', 'range', 'relative', 'unknown')),
    add constraint facilities_closed_precision_check
        check (closed_precision is null or closed_precision in
               ('exact_day', 'month', 'quarter', 'season', 'half_year',
                'year', 'range', 'relative', 'unknown')),
    add constraint facilities_address_precision_check
        check (address_precision is null or address_precision in
               ('full_address', 'street', 'city', 'region', 'country', 'unknown')),
    add constraint facilities_lifecycle_order
        check (closed_at is null or opened_at is null or closed_at >= opened_at);

create unique index if not exists facilities_entity_key_uidx
    on facilities (entity_key) where entity_key is not null;

create table facility_candidates (
    id                          uuid primary key default gen_random_uuid(),
    -- A candidate may originate from an import row, from evidence, or from an
    -- organization we already know. All three are nullable because a candidate
    -- whose organization is unresolved is a CORRECT state, not an error.
    organization_id             uuid references organizations(id) on delete cascade,
    organization_candidate_id   uuid,   -- FK added in 0010, with its table
    address                     jsonb not null,
    address_precision           text,
    source_kind                 text not null,
    source_evidence_id          uuid references evidence(id) on delete set null,
    corroboration_status        text not null default 'uncorroborated',
    corroborating_evidence_id   uuid references evidence(id) on delete set null,
    promoted_facility_id        uuid references facilities(id) on delete set null,
    rejection_reason            text,
    notes                       text,
    created_at                  timestamptz not null default now(),
    updated_at                  timestamptz not null default now(),

    constraint facility_candidates_source_kind_check
        check (source_kind in ('event_import', 'regulatory', 'permit',
                               'company_source', 'news', 'research_claim', 'other')),
    constraint facility_candidates_status_check
        check (corroboration_status in ('uncorroborated', 'corroborated',
                                        'rejected', 'promoted')),
    constraint facility_candidates_address_precision_check
        check (address_precision is null or address_precision in
               ('full_address', 'street', 'city', 'region', 'country', 'unknown')),

    -- A promotion has to name what it became and what corroborated it. Without
    -- this a candidate can be marked promoted with nothing to audit.
    constraint facility_candidates_promotion_is_evidenced
        check (corroboration_status <> 'promoted'
               or (promoted_facility_id is not null
                   and corroborating_evidence_id is not null)),

    -- A rejected candidate must say why, for the same reason a rejected research
    -- claim must: an unexplained rejection is rediscovered and re-rejected.
    constraint facility_candidates_rejection_has_reason
        check (corroboration_status <> 'rejected'
               or (rejection_reason is not null and length(trim(rejection_reason)) > 0))
);
comment on table facility_candidates is
    'Storage only. No automated resolution or promotion ladder is implemented in roadmap PR 3.';

create index on facility_candidates (corroboration_status);
create index on facility_candidates (organization_id);
create index on facility_candidates (organization_candidate_id);
create index on facility_candidates (promoted_facility_id);
