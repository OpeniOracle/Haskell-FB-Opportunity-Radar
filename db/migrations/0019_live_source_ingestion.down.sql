begin;

drop table if exists source_document_cache;

alter table sources
    drop column if exists connector_id,
    drop column if exists connector_config,
    drop column if exists last_success_at;

alter table sources drop constraint if exists sources_health_status_check;
alter table sources
    add constraint sources_health_status_check
        check (health_status in ('healthy', 'degraded', 'action_required', 'disabled', 'unsupported'));

drop index if exists source_runs_single_active_uidx;

drop index if exists opportunities_organization_key_uidx;
alter table opportunities
    drop column if exists opportunity_key,
    drop column if exists derived_by,
    drop column if exists derived_at;

drop index if exists signals_organization_cluster_uidx;

alter table evidence drop constraint if exists evidence_published_is_not_retrieved;
drop index if exists evidence_last_seen_idx;
drop index if exists evidence_document_lookup_idx;
drop index if exists evidence_current_document_uidx;
alter table evidence drop constraint if exists evidence_review_status_check;
alter table evidence drop constraint if exists evidence_classification_status_check;
alter table evidence
    drop column if exists review_status,
    drop column if exists classification_status,
    drop column if exists last_seen_at,
    drop column if exists first_seen_at,
    drop column if exists connector_version,
    drop column if exists connector_id,
    drop column if exists document_revision,
    drop column if exists source_document_id;

commit;
