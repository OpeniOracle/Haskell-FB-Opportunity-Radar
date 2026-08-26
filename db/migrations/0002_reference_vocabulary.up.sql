-- 0002  §7 step 1 — reference and configuration vocabulary
--
-- ADR 0008 (Proposed) argues that ontology and scoring belong in versioned
-- CONFIGURATION, not in database constraints. So sectors, capabilities, signal
-- families and signal event types are ROWS in reference tables, not values in a
-- CHECK. Adding a capability becomes an insert; today it would be a migration
-- and a deploy, and a taxonomy that expensive to change stops being maintained.
--
-- Constraints here express only stable STRUCTURAL invariants: a code is unique,
-- a parent must exist, a retired entry must say when it was retired.

create table sectors (
    id              uuid primary key default gen_random_uuid(),
    code            text not null unique,
    label           text not null,
    parent_id       uuid references sectors(id),
    sort_order      integer not null default 0,
    retired_at      timestamptz,
    created_at      timestamptz not null default now(),
    check (parent_id is null or parent_id <> id)
);
comment on table sectors is
    'F&B sector vocabulary. Rows, not a CHECK constraint — see ADR 0008.';

create table capabilities (
    id              uuid primary key default gen_random_uuid(),
    code            text not null unique,
    label           text not null,
    parent_id       uuid references capabilities(id),
    sort_order      integer not null default 0,
    retired_at      timestamptz,
    created_at      timestamptz not null default now(),
    check (parent_id is null or parent_id <> id)
);
comment on table capabilities is
    'Haskell delivery-capability vocabulary. Rows, not a CHECK — see ADR 0008.';

create table signal_families (
    id              uuid primary key default gen_random_uuid(),
    code            text not null unique,
    label           text not null,
    description     text,
    retired_at      timestamptz,
    created_at      timestamptz not null default now()
);

create table signal_event_types (
    id                  uuid primary key default gen_random_uuid(),
    code                text not null unique,
    label               text not null,
    signal_family_id    uuid not null references signal_families(id),
    -- Provisional subtypes exist in the proposal and are explicitly NON-SCORING.
    -- The flag records that; it does not decide anything.
    provisional         boolean not null default false,
    retired_at          timestamptz,
    created_at          timestamptz not null default now()
);
comment on column signal_event_types.provisional is
    'Recorded, not acted on. No scoring behaviour is attached in Phase 1.';

-- Scoring lives in versioned config rows so that "reprocess everything affected
-- by taxonomy v3" is a query rather than an archaeology exercise (ADR 0008).
create table scoring_configs (
    id              uuid primary key default gen_random_uuid(),
    version         text not null unique,
    config          jsonb not null,
    notes           text,
    effective_from  timestamptz,
    effective_to    timestamptz,
    created_at      timestamptz not null default now(),
    -- Structural: an interval must not end before it starts. Half-open, so a
    -- zero-length window is also rejected.
    constraint scoring_configs_effective_interval
        check (effective_to is null or effective_from is null or effective_to > effective_from)
);
comment on table scoring_configs is
    'Versioned scoring configuration. No threshold is encoded in schema — D16 and D19 are open.';

create index on sectors (parent_id);
create index on capabilities (parent_id);
create index on signal_event_types (signal_family_id);
