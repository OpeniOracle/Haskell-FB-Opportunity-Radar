drop index if exists organizations_scope_class_idx;
drop index if exists organizations_entity_key_uidx;

alter table organizations
    drop constraint if exists organizations_scope_class_confirmation_ck,
    drop constraint if exists organizations_scope_class_status_check,
    drop constraint if exists organizations_scope_class_check;

alter table organizations
    drop column if exists supplier_routing,
    drop column if exists scope_class_confirmed_at,
    drop column if exists scope_class_confirmed_by,
    drop column if exists scope_class_status,
    drop column if exists scope_class,
    drop column if exists entity_key;

drop index if exists organizations_canonical_name_lower_idx;

-- Restore the v0.1.0 baseline index exactly as it was.
create unique index if not exists organizations_canonical_name_lower_uidx
    on organizations (lower(canonical_name));
