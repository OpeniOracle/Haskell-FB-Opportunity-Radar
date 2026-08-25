drop index if exists evidence_entity_links_candidate_idx;
drop index if exists evidence_entity_links_unique_facility;
drop index if exists evidence_entity_links_unique_org;

alter table evidence_entity_links
    drop constraint if exists evidence_entity_links_has_a_subject,
    drop constraint if exists evidence_entity_links_inference_has_note,
    drop constraint if exists evidence_entity_links_basis_check;

alter table evidence_entity_links
    drop column if exists transformation_version,
    drop column if exists resolved_at,
    drop column if exists resolved_by,
    drop column if exists inference_note,
    drop column if exists basis,
    drop column if exists as_of_date,
    drop column if exists facility_candidate_id;

-- Restore the v0.1.0 baseline rule. Deliberately UNNAMED: the baseline's check
-- was anonymous, so PostgreSQL must generate the same `evidence_entity_links_check`
-- name for the reverted schema to match the baseline byte for byte.
alter table evidence_entity_links
    add check (organization_id is not null or facility_id is not null);
