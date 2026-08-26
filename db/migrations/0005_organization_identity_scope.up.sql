-- 0005  §7 step 4 — organization identity and scope classification
--
-- C12: the v0.1 baseline puts a GLOBAL unique index on lower(canonical_name).
-- Two legitimately distinct registrants that share a name cannot both exist, so
-- the first correct record blocks the second and the resolver is pushed into a
-- premature merge. Identity comes from identifiers, not from a string. The
-- uniqueness moves to `entity_key`, which is derived from identifiers; the name
-- index survives as a non-unique lookup index.
--
-- C22 / D11: scope_class is a four-value vocabulary. It is a FIXED classification
-- axis rather than evolving business vocabulary, so a CHECK is appropriate here
-- where ADR 0008 pushed sectors and capabilities into reference rows.
--
-- D11 is approved PROVISIONALLY: every classification made before F&B
-- market-leader confirmation is provisional, and pilot relevance metrics must be
-- able to exclude provisional accounts because their classification changes the
-- relevance denominator. `scope_class_status` records that state. It implements
-- an approved decision; it does not make a new one.

drop index if exists organizations_canonical_name_lower_uidx;

create index if not exists organizations_canonical_name_lower_idx
    on organizations (lower(canonical_name));

alter table organizations
    add column if not exists entity_key text,
    add column if not exists scope_class text not null default 'unknown',
    add column if not exists scope_class_status text not null default 'provisional',
    add column if not exists scope_class_confirmed_by text,
    add column if not exists scope_class_confirmed_at timestamptz,
    -- Supplier routing is a property of WHICH FACILITY a signal concerns, not of
    -- the account class: a signal about a supplier's own plant is eligible, one
    -- about its customers' plants is account intelligence.
    add column if not exists supplier_routing boolean not null default false;

alter table organizations
    add constraint organizations_scope_class_check
        check (scope_class in ('fnb_core', 'fnb_adjacent', 'non_fnb', 'unknown')),
    add constraint organizations_scope_class_status_check
        check (scope_class_status in ('provisional', 'confirmed')),
    -- A confirmation with no confirmer and no date is not a confirmation.
    add constraint organizations_scope_class_confirmation_ck
        check (scope_class_status <> 'confirmed'
               or (scope_class_confirmed_by is not null
                   and scope_class_confirmed_at is not null));

create unique index if not exists organizations_entity_key_uidx
    on organizations (entity_key) where entity_key is not null;

create index if not exists organizations_scope_class_idx
    on organizations (scope_class, scope_class_status);

comment on column organizations.entity_key is
    'Deterministic identifier-derived key. Unique when present; null while identity is unresolved (ADR 0005 — unresolved is a terminal state, not an error).';
comment on column organizations.scope_class_status is
    'D11 is approved provisionally. Relevance metrics must be able to exclude provisional rows.';
