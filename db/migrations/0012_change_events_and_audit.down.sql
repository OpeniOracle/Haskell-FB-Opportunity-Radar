drop index if exists audit_events_actor_idx;
drop index if exists audit_events_request_idx;

alter table audit_events
    drop column if exists scoring_version,
    drop column if exists ip_hash,
    drop column if exists surface,
    drop column if exists request_id;

drop table if exists opportunity_status_history cascade;
drop table if exists user_read_state cascade;
drop table if exists change_events cascade;
