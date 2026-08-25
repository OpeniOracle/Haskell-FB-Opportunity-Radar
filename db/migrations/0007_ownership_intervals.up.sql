-- 0007  §7 step 6 — time-bounded ownership and corporate relationships
--
-- ADR 0005 (ownership corollary Accepted via D18) and C24.
--
-- HALF-OPEN INTERVALS. `from_date` is INCLUSIVE, `to_date` is EXCLUSIVE.
-- A sale on the 6th is written as to_date = 2025-12-06 on the outgoing edge and
-- from_date = 2025-12-06 on the incoming one. There is exactly one holder on the
-- 6th and no gap, which closed intervals cannot give you without an off-by-one
-- convention that every query has to remember.
--
-- As-at-date resolution is therefore:
--     where from_date <= :as_at and (to_date is null or to_date > :as_at)
--
-- A zero-length interval is meaningless under these semantics, so the constraint
-- requires to_date > from_date, not >=. That is one of the eight rejections this
-- PR is required to enforce.
--
-- The primary key includes from_date because the SAME pair can hold the SAME
-- relationship over more than one interval — reacquisition happens, and the v0.1
-- shape (pair + relationship) could only record it once.

create table facility_organizations (
    id                  uuid primary key default gen_random_uuid(),
    facility_id         uuid not null references facilities(id) on delete cascade,
    organization_id     uuid not null references organizations(id) on delete cascade,
    relationship        text not null,
    evidence_id         uuid references evidence(id) on delete set null,
    from_date           date,           -- inclusive
    to_date             date,           -- EXCLUSIVE; null = open-ended
    from_precision      text,
    to_precision        text,
    basis               text not null default 'stated',
    inference_note      text,
    created_at          timestamptz not null default now(),

    constraint facility_organizations_relationship_check
        check (relationship in ('owner', 'operator', 'tenant', 'co_manufacturer',
                                'brand_produced_here', 'former_owner', 'unknown')),

    -- ---- REJECTS: an ownership interval where to_date <= from_date. -----
    constraint facility_organizations_half_open
        check (to_date is null or from_date is null or to_date > from_date),

    constraint facility_organizations_precision_check
        check ((from_date is null or from_precision is not null)
               and (to_date is null or to_precision is not null)),
    constraint facility_organizations_basis_check
        check (basis in ('stated', 'inferred', 'unknown')),
    constraint facility_organizations_inference_has_note
        check (basis <> 'inferred'
               or (inference_note is not null and length(trim(inference_note)) > 0)),

    unique (facility_id, organization_id, relationship, from_date)
);
comment on table facility_organizations is
    'Half-open [from_date, to_date). to_date is EXCLUSIVE.';

create table organization_relationships (
    id                          uuid primary key default gen_random_uuid(),
    parent_organization_id      uuid not null references organizations(id) on delete cascade,
    child_organization_id       uuid not null references organizations(id) on delete cascade,
    relationship                text not null,
    ownership_percent           numeric(6,3),
    ownership_percent_basis     text,
    evidence_id                 uuid references evidence(id) on delete set null,
    from_date                   date,   -- inclusive
    to_date                     date,   -- EXCLUSIVE; null = open-ended
    from_precision              text,
    to_precision                text,
    basis                       text not null default 'stated',
    inference_note              text,
    created_at                  timestamptz not null default now(),

    constraint organization_relationships_relationship_check
        check (relationship in ('parent_subsidiary', 'brand_owner', 'division',
                                'joint_venture', 'franchise_bottler',
                                'co_manufacturer', 'former_parent',
                                -- a retained stake after a demerger or partial sale
                                'minority_interest')),

    -- ---- REJECTS: an ownership interval where to_date <= from_date. -----
    constraint organization_relationships_half_open
        check (to_date is null or from_date is null or to_date > from_date),

    constraint organization_relationships_not_self
        check (parent_organization_id <> child_organization_id),
    constraint organization_relationships_percent_range
        check (ownership_percent is null or ownership_percent between 0 and 100),
    constraint organization_relationships_percent_basis_check
        check (ownership_percent_basis is null
               or ownership_percent_basis in ('stated', 'approximate', 'inferred')),
    -- A minority interest with no percentage records that something was retained
    -- while losing the only fact that makes it commercially meaningful.
    constraint organization_relationships_minority_has_percent
        check (relationship <> 'minority_interest' or ownership_percent is not null),
    constraint organization_relationships_precision_check
        check ((from_date is null or from_precision is not null)
               and (to_date is null or to_precision is not null)),
    constraint organization_relationships_basis_check
        check (basis in ('stated', 'inferred', 'unknown')),
    constraint organization_relationships_inference_has_note
        check (basis <> 'inferred'
               or (inference_note is not null and length(trim(inference_note)) > 0)),

    unique (parent_organization_id, child_organization_id, relationship, from_date)
);

-- WORKED EXAMPLE, recorded here because the external research record collapsed
-- three distinct events into one and got the control date wrong:
--
--   2025-07-01  standalone operations began   -- OPERATIONAL separation
--   2025-12-06  legal demerger completed      -- the CONTROL event
--   2025-12-08  listing and trading commenced -- the MARKET event
--
-- Control ends at the legal demerger, not at the listing. Under half-open
-- semantics that is to_date = 2025-12-06, so the parent controlled the business
-- through 5 December inclusive. Two rows, not one:
--
--   (parent, child, 'parent_subsidiary', pct null,  from ...,        to 2025-12-06)
--   (parent, child, 'minority_interest', pct 19.85, from 2025-12-06, to null)
--
-- A demerger is NOT a clean termination. Recording only the ended parent edge
-- would assert a complete separation that did not happen.
--
-- The 2025-07-01 operational milestone is not an ownership edge at all. It is an
-- ORGANIZATION-LEVEL event and must never be written per facility: no source
-- says any particular site changed hands that day, and writing it per plant
-- would manufacture that claim once per plant. There is deliberately no place in
-- this migration to store it as a facility event.

create index on facility_organizations (facility_id, from_date);
create index on facility_organizations (organization_id, from_date);
create index on facility_organizations (facility_id) where to_date is null;
create index on organization_relationships (parent_organization_id, from_date);
create index on organization_relationships (child_organization_id, from_date);
