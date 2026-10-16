-- 0029 — The work queue durable collection needs (roadmap R4).
--
-- THE FAILURE THIS EXISTS FOR (docs/design/18 sections 4 and 9, doc 19 11.3).
--
-- A run has a time budget. When it runs out, the runner records how many
-- documents it did not reach (`documentsDeferred`) and stops, and the NEXT run
-- starts again from the beginning of the window, because nothing durable says
-- which documents are still waiting. A source that always runs out of budget is
-- therefore never fully checked, and "deferred" is a count with nothing behind
-- it. Continuation needs a queue that outlives the invocation: units of work
-- that are claimed, heartbeaten, finished, retried or given up on, and that a
-- different invocation can pick up.
--
-- THIS MIGRATION IS THE QUEUE AND ITS CONTRACT. It contains no dispatcher, no
-- worker and no scheduler (those are R4), and it enqueues nothing.
--
-- WHY ONE TABLE AND NOT `ingestion_jobs` + `ingestion_tasks`.
--
-- Doc 18 proposed both, after the Wastewater Monitor's `_jobs.mts`. In this
-- schema a JOB ALREADY EXISTS: `source_runs` is one collection pass over one
-- window of one source, with a status (`run_status`: pending | running |
-- success | partial_success | unchanged | failure | skipped), a window, a
-- checkpoint, counters, and at most one active run per source
-- (`source_runs_single_active_uidx`) with one run per window
-- (`source_runs_logical_key`). A second job table would restate all of that
-- under a competing status vocabulary and two places to keep in step. So a task
-- belongs to a run, and the dispatcher's idempotence is the run's: the same
-- window cannot be dispatched twice.
--
-- A TASK is one unit of work inside a run: a document to fetch and process, or a
-- page of a listing. `task_key` is its stable identity within the run, so
-- enqueueing the same unit twice is one row (a unique constraint, not a check
-- then insert).
--
-- STATUS reuses the run vocabulary, only the words that mean the same at this
-- level: pending | running | success | failure | skipped. (`partial_success`
-- and `unchanged` describe a whole pass and have no meaning for one unit.)
--
-- THE CLAIM PROTOCOL R4 builds on, stated here because the constraints enforce
-- it:
--
--   claim      update ... set status = 'running', claimed_by, claimed_at,
--              last_heartbeat_at, attempt = attempt + 1
--              where id = $1 and status = 'pending'
--              and (retry_after is null or retry_after <= now())
--              -- a compare-and-set: of two workers racing, exactly one row is
--              -- returned. No advisory locks and no SELECT FOR UPDATE, so it
--              -- works through PostgREST as the service role.
--   heartbeat  update ... set last_heartbeat_at = now()
--              where id = $1 and status = 'running' and claimed_by = $2
--   finish     status success | failure | skipped, completed_at = now()
--   re-queue   a RUNNING task whose heartbeat is older than the lease goes back
--              to pending with claim cleared and retry_after set (backoff), or
--              to failure when attempts are exhausted. The stale-lease query is
--              served by ingestion_tasks_stale_idx.
--
-- WHAT THE DATABASE REFUSES: a running task with no owner or heartbeat; a
-- pending task that still carries an owner (a half-released claim); a finished
-- task with no completion time, or a completion time on an unfinished one; a
-- failure with no error class (the rule source_run_attempts already has); a
-- heartbeat that predates the claim; a negative attempt count; a blank key.
--
-- SERVER-SIDE ONLY. The browser has no business with the queue: RLS is enabled
-- and forced, every privilege is revoked from anon and authenticated, and no
-- policy is created, so only the service role can reach it, as with
-- `source_document_cache` (0021) and `geocode_cache` (0023). A task's payload
-- holds URLs and cursors, never document bodies.

begin;

create table ingestion_tasks (
    id                 uuid primary key default gen_random_uuid(),
    source_run_id      uuid not null references source_runs (id) on delete cascade,
    task_key           text not null,
    payload            jsonb not null default '{}'::jsonb,
    status             text not null default 'pending',
    attempt            integer not null default 0,
    claimed_by         text,
    claimed_at         timestamptz,
    last_heartbeat_at  timestamptz,
    retry_after        timestamptz,
    error_class        text,
    error_summary      text,
    completed_at       timestamptz,
    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now(),

    constraint ingestion_tasks_run_key_unique unique (source_run_id, task_key),
    constraint ingestion_tasks_key_present check (length(btrim(task_key)) > 0),
    constraint ingestion_tasks_status_check
        check (status in ('pending', 'running', 'success', 'failure', 'skipped')),
    constraint ingestion_tasks_attempt_non_negative check (attempt >= 0),
    constraint ingestion_tasks_running_is_claimed
        check (status <> 'running'
               or (claimed_by is not null and claimed_at is not null
                   and last_heartbeat_at is not null)),
    constraint ingestion_tasks_pending_is_unclaimed
        check (status <> 'pending'
               or (claimed_by is null and claimed_at is null
                   and last_heartbeat_at is null)),
    constraint ingestion_tasks_heartbeat_follows_claim
        check (last_heartbeat_at is null or claimed_at is null
               or last_heartbeat_at >= claimed_at),
    constraint ingestion_tasks_terminal_is_completed
        check ((status in ('success', 'failure', 'skipped')) = (completed_at is not null)),
    constraint ingestion_tasks_failure_has_class
        check (status <> 'failure' or error_class is not null)
);

comment on table ingestion_tasks is
    'Roadmap R4. One unit of work inside a source_runs row: claimed, heartbeaten, finished, retried. A run is the job; this is its queue. Server-side only.';

-- Which task to claim next: pending work, oldest first. Partial, so the index
-- stays the size of the backlog and not of the history.
create index ingestion_tasks_claimable_idx
    on ingestion_tasks (created_at)
    where status = 'pending';

-- Which running tasks have gone quiet. Partial for the same reason.
create index ingestion_tasks_stale_idx
    on ingestion_tasks (last_heartbeat_at)
    where status = 'running';

alter table ingestion_tasks enable row level security;
alter table ingestion_tasks force row level security;

revoke all on ingestion_tasks from anon, authenticated;

-- No policy is created, deliberately. With RLS enabled and no policy every role
-- except the bypassing service_role reads nothing, and the dispatcher and
-- worker run as service_role.

commit;
