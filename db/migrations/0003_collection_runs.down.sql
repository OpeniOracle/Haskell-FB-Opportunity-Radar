drop table if exists parked_messages cascade;
drop table if exists source_run_attempts cascade;

drop index if exists source_runs_logical_key;

alter table source_runs
    drop constraint if exists source_runs_run_status_check,
    drop constraint if exists source_runs_window_interval,
    drop constraint if exists source_runs_counts_non_negative;
alter table source_runs
    drop column if exists collection_window_start,
    drop column if exists collection_window_end,
    drop column if exists run_status,
    drop column if exists items_seen,
    drop column if exists items_stored;

alter table sources
    drop constraint if exists sources_license_mode_check,
    drop constraint if exists sources_access_mode_check,
    drop constraint if exists sources_sensitivity_check,
    drop constraint if exists sources_circuit_state_check,
    drop constraint if exists sources_retention_positive,
    drop constraint if exists sources_cadence_positive,
    drop constraint if exists sources_failures_non_negative;
alter table sources
    drop column if exists license_mode,
    drop column if exists access_mode,
    drop column if exists data_sensitivity_class,
    drop column if exists retention_days,
    drop column if exists expected_cadence_hours,
    drop column if exists circuit_state,
    drop column if exists circuit_opened_at,
    drop column if exists consecutive_failures;
