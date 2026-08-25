alter table facility_candidates
    drop constraint if exists facility_candidates_organization_candidate_fk;

drop table if exists organization_segment_tiers cascade;
drop table if exists engagement_observations cascade;
drop table if exists approved_entity_mappings cascade;
drop table if exists organization_candidates cascade;
drop table if exists import_records cascade;
drop table if exists import_batches cascade;
drop table if exists licence_authorizations cascade;
