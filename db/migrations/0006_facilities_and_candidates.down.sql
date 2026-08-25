drop table if exists facility_candidates cascade;

drop index if exists facilities_entity_key_uidx;

alter table facilities
    drop constraint if exists facilities_lifecycle_order,
    drop constraint if exists facilities_address_precision_check,
    drop constraint if exists facilities_closed_precision_check,
    drop constraint if exists facilities_opened_precision_check,
    drop constraint if exists facilities_closed_precision_required,
    drop constraint if exists facilities_opened_precision_required,
    drop constraint if exists facilities_role_check;

alter table facilities
    drop column if exists source_evidence_id,
    drop column if exists entity_key,
    drop column if exists closed_precision,
    drop column if exists opened_precision,
    drop column if exists address_precision,
    drop column if exists facility_role;
