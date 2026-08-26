-- 0012  §7 step 11 — the change ledger, read state, and audit
--
-- C17. Pulse deltas, the "what changed" summary on a card, alert deduplication
-- and the daily brief are four views of one question. Built separately they grow
-- four half-correct diffing implementations that disagree with each other, and
-- the disagreement surfaces as "the dashboard says three new, the email said
-- two". One append-only ledger, four readers.
--
-- Materiality is recorded on the row rather than derived at read time, because
-- the decision depends on the scoring version in force WHEN THE CHANGE HAPPENED.
-- Recomputing it later against today's rules rewrites history.

create table change_events (
    id              uuid primary key default gen_random_uuid(),
    object_type     text not null,
    object_id       uuid not null,
    change_type     text not null,      -- stage_promoted, evidence_added, closed, ...
    from_state      jsonb,
    to_state        jsonb,
    materiality     text not null,
    dedupe_key      text not null,
    scoring_version text,
    actor_type      text not null default 'system',
    occurred_at     timestamptz not null default now(),
    unique (object_type, object_id, dedupe_key),

    constraint change_events_object_type_check
        check (object_type in ('opportunity', 'signal', 'market_trend',
                               'facility', 'organization', 'source')),
    constraint change_events_materiality_check
        check (materiality in ('material', 'minor', 'silent')),
    constraint change_events_actor_type_check
        check (actor_type in ('user', 'system', 'connector', 'model')),
    -- An empty dedupe key deduplicates nothing and would collapse every change
    -- on an object into one row.
    constraint change_events_dedupe_key_present
        check (length(trim(dedupe_key)) > 0)
);

create index change_events_recent_idx on change_events (occurred_at desc)
    where materiality = 'material';
create index change_events_object_idx
    on change_events (object_type, object_id, occurred_at desc);

create table user_read_state (
    user_id         text not null,
    surface         text not null,      -- 'pulse', 'opportunities', 'alerts'
    last_seen_at    timestamptz not null,
    updated_at      timestamptz not null default now(),
    primary key (user_id, surface)
);
comment on table user_read_state is
    'Per-user read watermark. Identity arrives with authentication in a later PR; this table stores the subject reference only.';

-- C18  01 requires a reason on dismissal. The v0.1 baseline captures reasons
--      only inside `manual_override`, and status transitions have no history at
--      all, so "why was this dismissed" has no answer three weeks later.
create table opportunity_status_history (
    id              uuid primary key default gen_random_uuid(),
    opportunity_id  uuid not null references opportunities(id) on delete cascade,
    from_status     text,
    to_status       text not null,
    actor_type      text not null,
    actor_id        text not null,
    reason_code     text,
    reason_text     text,
    occurred_at     timestamptz not null default now(),
    constraint opportunity_status_history_actor_check
        check (actor_type in ('user', 'system', 'model')),
    -- The three transitions that remove something from the working set must say
    -- why. These are the ones a reviewer asks about.
    constraint opportunity_status_history_negative_needs_reason
        check (to_status not in ('dismissed', 'closed_lost', 'on_hold')
               or reason_code is not null)
);

create index on opportunity_status_history (opportunity_id, occurred_at desc);

-- The baseline audit table records actor, action and object but not the request
-- or the surface it came from, so two operators acting simultaneously produce an
-- interleaved log nobody can untangle.
alter table audit_events
    add column if not exists request_id text,
    add column if not exists surface text,
    add column if not exists ip_hash text,
    add column if not exists scoring_version text;

create index if not exists audit_events_request_idx
    on audit_events (request_id) where request_id is not null;
create index if not exists audit_events_actor_idx
    on audit_events (actor_type, actor_id, occurred_at desc);
