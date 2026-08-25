-- 0013  §7 step 12 — signals, opportunities, trends and alerts: STRUCTURE ONLY
--
-- Present so that Phase 2 adds BEHAVIOUR, not tables. Nothing in this PR writes
-- any of it.
--
-- Three corrections to the v0.1 baseline land here:
--
--   ADR 0008 — the baseline hard-codes the scoring model in CHECK constraints:
--   per-dimension caps of 30/25/20/15/10 and an enumerated confidence multiplier
--   of exactly (0.60, 0.80, 1.00). Those are SCORING THRESHOLDS, and weights will
--   change during the pilot. Encoded as constraints, every re-weighting is a
--   migration and a deploy, and historical snapshots become unwritable the moment
--   the caps move. They are replaced by a reference to the scoring config version
--   in force. What remains is structural: a score is a non-negative number, a
--   multiplier is a positive fraction of at most one.
--
--   D14-L — `account_strategy` is the account-strategy scoring dimension, which
--   is licence-blocked. It becomes nullable and gated: a row may only carry a
--   value if it names the authorization that permits one. Same gate as the
--   engagement tables in 0010, applied to the one scoring dimension that depends
--   on the same blocked source.
--
--   C7 — alert deduplication keyed on `(subscription_id, material_change_key)`
--   does not deduplicate when `subscription_id` is null, which is exactly the
--   system-generated case. The key becomes recipient- and channel-aware.
--
-- No promotion rule, no threshold and no automated confidence decision is
-- encoded anywhere below. D16 and D19 are open.

-- ---- signals: vocabulary moves to the reference tables (ADR 0008) ---------

alter table signals
    drop constraint if exists signals_signal_family_check;

alter table signals
    add constraint signals_signal_family_fk
        foreign key (signal_family) references signal_families(code),
    add constraint signals_event_type_fk
        foreign key (event_type) references signal_event_types(code);

alter table signals
    add column if not exists event_date_precision text,
    add column if not exists event_date_basis text,
    add column if not exists event_date_inference_note text,
    add column if not exists scoring_config_version text references scoring_configs(version);

alter table signals
    -- Same temporal discipline as evidence (ADR 0004).
    add constraint signals_event_date_requires_precision
        check (event_date is null or event_date_precision is not null),
    add constraint signals_event_date_precision_check
        check (event_date_precision is null or event_date_precision in
               ('exact_day', 'month', 'quarter', 'season', 'half_year',
                'year', 'range', 'relative', 'unknown')),
    add constraint signals_event_date_basis_check
        check (event_date_basis is null or event_date_basis in
               ('stated', 'inferred', 'unknown')),
    add constraint signals_event_date_inference_has_note
        check (event_date_basis is distinct from 'inferred'
               or (event_date_inference_note is not null
                   and length(trim(event_date_inference_note)) > 0)),
    add constraint signals_observation_window_valid
        check (last_observed_at >= first_observed_at);

-- ---- opportunities: scoring moves to versioned config (ADR 0008, D14-L) ---

alter table opportunities
    drop constraint if exists opportunities_haskell_fit_check,
    drop constraint if exists opportunities_project_maturity_check,
    drop constraint if exists opportunities_potential_scope_check,
    drop constraint if exists opportunities_timing_momentum_check,
    drop constraint if exists opportunities_account_strategy_check,
    drop constraint if exists opportunities_raw_score_check,
    drop constraint if exists opportunities_final_score_check,
    drop constraint if exists opportunities_confidence_multiplier_check;

alter table opportunities
    alter column account_strategy drop not null,
    alter column account_strategy drop default;

alter table opportunities
    add column if not exists scoring_config_version text references scoring_configs(version),
    add column if not exists account_strategy_licence_id uuid references licence_authorizations(id),
    add column if not exists scope_class_at_scoring text;

alter table opportunities
    -- Structural only. The CAPS live in scoring_configs.
    add constraint opportunities_dimensions_non_negative
        check (haskell_fit >= 0 and project_maturity >= 0
               and potential_scope >= 0 and timing_momentum >= 0
               and (account_strategy is null or account_strategy >= 0)),
    add constraint opportunities_scores_non_negative
        check (raw_score >= 0 and final_score >= 0),
    add constraint opportunities_multiplier_is_a_fraction
        check (confidence_multiplier > 0 and confidence_multiplier <= 1),

    -- ---- REJECTS: D14-L data through an unauthorized path. --------------
    -- The account-strategy dimension may not carry a value unless the row names
    -- the licence authorization that permits one. `licence_authorizations` is
    -- empty, so today this reduces to "account_strategy must be null".
    add constraint opportunities_account_strategy_is_licensed
        check (account_strategy is null or account_strategy_licence_id is not null);

comment on column opportunities.account_strategy is
    'D14-L blocked. Nullable and licence-gated; no value can be stored until D14-L clears.';
comment on column opportunities.scoring_config_version is
    'The scoring configuration in force when this score was computed. Thresholds live there, not in constraints (ADR 0008).';

alter table opportunity_score_snapshots
    add column if not exists scoring_config_version text references scoring_configs(version),
    add column if not exists account_strategy_licence_id uuid references licence_authorizations(id);

alter table opportunity_score_snapshots
    alter column account_strategy drop not null;

alter table opportunity_score_snapshots
    add constraint opportunity_score_snapshots_account_strategy_is_licensed
        check (account_strategy is null or account_strategy_licence_id is not null);

-- ---- market trends --------------------------------------------------------

alter table market_trends
    add column if not exists scoring_config_version text references scoring_configs(version),
    add column if not exists taxonomy_version text;

alter table market_trends
    add constraint market_trends_observation_window_valid
        check (last_updated_at >= first_observed_at);

-- ---- alerts: a dedupe key that actually deduplicates (C7) -----------------

alter table alerts
    drop constraint if exists alerts_subscription_id_material_change_key_key;

alter table alerts
    add column if not exists recipient_ref text not null default '',
    add column if not exists change_event_id uuid references change_events(id) on delete set null,
    add column if not exists quarantined_at timestamptz,
    add column if not exists quarantine_reason text,
    add column if not exists suppressed_reason text;

alter table alerts
    -- The default exists only so the column can be added to an empty table
    -- NOT NULL. An insert that omits a recipient fails here rather than silently
    -- creating an unkeyed alert that deduplicates against nothing.
    add constraint alerts_recipient_present
        check (length(trim(recipient_ref)) > 0),
    add constraint alerts_material_change_key_present
        check (length(trim(material_change_key)) > 0),
    add constraint alerts_delivery_channel_check
        check (delivery_channel in ('in_app', 'email', 'teams')),
    add constraint alerts_quarantine_has_reason
        check (quarantined_at is null
               or (quarantine_reason is not null
                   and length(trim(quarantine_reason)) > 0)),
    add constraint alerts_suppression_has_reason
        check (status <> 'suppressed'
               or (suppressed_reason is not null
                   and length(trim(suppressed_reason)) > 0));

create unique index if not exists alerts_dedupe_uidx
    on alerts (recipient_ref, delivery_channel, material_change_key);

comment on index alerts_dedupe_uidx is
    'C7. The baseline key was (subscription_id, material_change_key), which does not deduplicate when subscription_id is null.';

-- C28  Outbound circuit breaker. A misconfigured rule that would fire two
--      hundred alerts must quarantine BEFORE delivery, not be apologised for
--      afterwards. Recorded here; the breaker itself is Phase 2 behaviour.
create table alert_dispatch_windows (
    id                  uuid primary key default gen_random_uuid(),
    window_start        timestamptz not null,
    window_end          timestamptz not null,
    delivery_channel    text not null,
    recipient_ref       text,
    dispatched_count    integer not null default 0,
    quarantined_count   integer not null default 0,
    breaker_state       text not null default 'closed',
    breaker_opened_at   timestamptz,
    created_at          timestamptz not null default now(),
    check (window_end > window_start),
    check (dispatched_count >= 0 and quarantined_count >= 0),
    constraint alert_dispatch_windows_channel_check
        check (delivery_channel in ('in_app', 'email', 'teams')),
    constraint alert_dispatch_windows_breaker_state_check
        check (breaker_state in ('closed', 'open', 'half_open')),
    -- No limit is stored. The threshold is configuration (ADR 0008); this table
    -- records what happened, not what was allowed.
    constraint alert_dispatch_windows_open_has_timestamp
        check (breaker_state <> 'open' or breaker_opened_at is not null)
);

create index on alerts (change_event_id);
create index on alerts (status, created_at desc);
create index on alert_dispatch_windows (window_start desc);
