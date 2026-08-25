drop table if exists alert_dispatch_windows cascade;

drop index if exists alerts_dedupe_uidx;
drop index if exists alerts_status_created_at_idx;

comment on column opportunities.account_strategy is null;

alter table alerts
    drop constraint if exists alerts_suppression_has_reason,
    drop constraint if exists alerts_quarantine_has_reason,
    drop constraint if exists alerts_delivery_channel_check,
    drop constraint if exists alerts_material_change_key_present,
    drop constraint if exists alerts_recipient_present;

alter table alerts
    drop column if exists suppressed_reason,
    drop column if exists quarantine_reason,
    drop column if exists quarantined_at,
    drop column if exists change_event_id,
    drop column if exists recipient_ref;

alter table alerts
    add constraint alerts_subscription_id_material_change_key_key
        unique (subscription_id, material_change_key);

alter table market_trends
    drop constraint if exists market_trends_observation_window_valid;
alter table market_trends
    drop column if exists taxonomy_version,
    drop column if exists scoring_config_version;

alter table opportunity_score_snapshots
    drop constraint if exists opportunity_score_snapshots_account_strategy_is_licensed;
alter table opportunity_score_snapshots
    drop column if exists account_strategy_licence_id,
    drop column if exists scoring_config_version;
alter table opportunity_score_snapshots
    alter column account_strategy set not null;

alter table opportunities
    drop constraint if exists opportunities_account_strategy_is_licensed,
    drop constraint if exists opportunities_multiplier_is_a_fraction,
    drop constraint if exists opportunities_scores_non_negative,
    drop constraint if exists opportunities_dimensions_non_negative;

alter table opportunities
    drop column if exists scope_class_at_scoring,
    drop column if exists account_strategy_licence_id,
    drop column if exists scoring_config_version;

alter table opportunities
    alter column account_strategy set not null;

-- Restore the v0.1.0 baseline scoring constraints exactly.
alter table opportunities
    add constraint opportunities_haskell_fit_check
        check (haskell_fit between 0 and 30),
    add constraint opportunities_project_maturity_check
        check (project_maturity between 0 and 25),
    add constraint opportunities_potential_scope_check
        check (potential_scope between 0 and 20),
    add constraint opportunities_timing_momentum_check
        check (timing_momentum between 0 and 15),
    add constraint opportunities_account_strategy_check
        check (account_strategy between 0 and 10),
    add constraint opportunities_raw_score_check
        check (raw_score between 0 and 100),
    add constraint opportunities_final_score_check
        check (final_score between 0 and 100),
    add constraint opportunities_confidence_multiplier_check
        check (confidence_multiplier in (0.60, 0.80, 1.00));

alter table signals
    drop constraint if exists signals_observation_window_valid,
    drop constraint if exists signals_event_date_inference_has_note,
    drop constraint if exists signals_event_date_basis_check,
    drop constraint if exists signals_event_date_precision_check,
    drop constraint if exists signals_event_date_requires_precision;

alter table signals
    drop column if exists scoring_config_version,
    drop column if exists event_date_inference_note,
    drop column if exists event_date_basis,
    drop column if exists event_date_precision;

alter table signals
    drop constraint if exists signals_event_type_fk,
    drop constraint if exists signals_signal_family_fk;

alter table signals
    add constraint signals_signal_family_check
        check (signal_family in (
            'facility_capacity', 'process_systems', 'packaging_systems',
            'automation_controls', 'food_safety_compliance',
            'utilities_sustainability', 'distribution_supply_chain',
            'corporate_capital', 'market_demand'));
