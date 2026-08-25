-- 0003  §7 step 2 — sources, logical runs, attempts, parked messages
--
-- C8: a logical run is not a retry attempt. The v0.1 baseline conflated them,
-- so a scheduler firing twice looked like two collections and three retries of
-- one failure looked like three runs. A logical run is keyed on
-- (source_id, collection_window_start); attempts are child rows.
--
-- No connector is implemented here. This is where one will write.

alter table sources
    add column if not exists license_mode text not null default 'unknown',
    add column if not exists access_mode text not null default 'reference_only',
    add column if not exists data_sensitivity_class text not null default 'public',
    add column if not exists retention_days integer,
    add column if not exists expected_cadence_hours integer,
    add column if not exists circuit_state text not null default 'closed',
    add column if not exists circuit_opened_at timestamptz,
    add column if not exists consecutive_failures integer not null default 0;

alter table sources
    add constraint sources_license_mode_check
        check (license_mode in ('open', 'licensed', 'restricted', 'unknown')),
    -- Unknown licensing defaults to reference-only. Plan §9 requires this to be
    -- a schema constraint, not a convention.
    add constraint sources_access_mode_check
        check (access_mode in ('structured_primary', 'archived_full_text',
                               'licensed_full_text', 'reference_only', 'metadata_only')),
    add constraint sources_sensitivity_check
        check (data_sensitivity_class in ('public', 'licensed',
                                          'confidential_internal', 'restricted_personal')),
    add constraint sources_circuit_state_check
        check (circuit_state in ('closed', 'open', 'half_open')),
    add constraint sources_retention_positive
        check (retention_days is null or retention_days > 0),
    add constraint sources_cadence_positive
        check (expected_cadence_hours is null or expected_cadence_hours > 0),
    add constraint sources_failures_non_negative
        check (consecutive_failures >= 0);

alter table source_runs
    add column if not exists collection_window_start timestamptz,
    add column if not exists collection_window_end timestamptz,
    add column if not exists run_status text not null default 'pending',
    add column if not exists items_seen integer not null default 0,
    add column if not exists items_stored integer not null default 0;

alter table source_runs
    -- The seven-state model. Stable and structural: these are lifecycle states
    -- the harness itself depends on, not evolving business vocabulary.
    add constraint source_runs_run_status_check
        check (run_status in ('pending', 'running', 'success', 'partial_success',
                              'unchanged', 'failure', 'skipped')),
    add constraint source_runs_window_interval
        check (collection_window_end is null or collection_window_start is null
               or collection_window_end > collection_window_start),
    add constraint source_runs_counts_non_negative
        check (items_seen >= 0 and items_stored >= 0);

-- One logical run per source per collection window. A duplicate scheduler fire
-- collides here rather than producing a second run.
create unique index if not exists source_runs_logical_key
    on source_runs (source_id, collection_window_start)
    where collection_window_start is not null;

create table source_run_attempts (
    id                  uuid primary key default gen_random_uuid(),
    source_run_id       uuid not null references source_runs(id) on delete cascade,
    attempt_number      integer not null,
    started_at          timestamptz not null default now(),
    finished_at         timestamptz,
    outcome             text not null default 'pending',
    http_status         integer,
    error_class         text,
    error_detail        text,
    bytes_fetched       bigint,
    created_at          timestamptz not null default now(),
    unique (source_run_id, attempt_number),
    check (attempt_number >= 1),
    check (outcome in ('pending', 'success', 'partial_success', 'unchanged',
                       'failure', 'timeout', 'refused')),
    check (finished_at is null or finished_at >= started_at),
    check (bytes_fetched is null or bytes_fetched >= 0),
    -- A failed attempt has to say why. A failure with no error class is a
    -- failure nobody can act on.
    constraint source_run_attempts_failure_has_class
        check (outcome not in ('failure', 'timeout', 'refused') or error_class is not null)
);
comment on table source_run_attempts is
    'Retry attempts as child rows of one logical run (C8).';

create table parked_messages (
    id                  uuid primary key default gen_random_uuid(),
    source_id           text references sources(id) on delete set null,
    source_run_id       uuid references source_runs(id) on delete set null,
    payload             jsonb not null,
    parked_reason       text not null,
    attempts_made       integer not null default 0,
    parked_at           timestamptz not null default now(),
    released_at         timestamptz,
    check (attempts_made >= 0),
    check (released_at is null or released_at >= parked_at),
    -- Parking without a reason produces a queue nobody can triage.
    constraint parked_messages_reason_present check (length(trim(parked_reason)) > 0)
);
comment on table parked_messages is
    'Bounded retries end here rather than redelivering forever (C29).';

create index on source_run_attempts (source_run_id);
create index on parked_messages (source_id);
create index on parked_messages (parked_at);
