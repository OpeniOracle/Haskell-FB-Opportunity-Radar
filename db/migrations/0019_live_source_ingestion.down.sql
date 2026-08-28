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

-- RESTORING NOT NULL IS NOT ALWAYS POSSIBLE, AND MUST NOT BE FAKED.
--
-- 0019 made the scoring columns nullable so a signal-derived opportunity could
-- exist before anyone had scored it. Rolling that back requires every row to
-- carry a number again. There are only three ways to get there and two of them
-- are unacceptable: inventing a score puts a fabricated number in the column an
-- analyst's real one lives in, and deleting the rows destroys collected work.
--
-- So this refuses, and says exactly what to do. An empty or never-collected
-- database rolls back cleanly, which is the case CI exercises.
do $$
declare
    unscored bigint;
begin
    select count(*) into unscored from opportunities
     where haskell_fit is null or project_maturity is null or potential_scope is null
        or timing_momentum is null or raw_score is null or confidence_multiplier is null
        or final_score is null or why_it_matters is null;

    if unscored > 0 then
        raise exception using
            errcode = 'check_violation',
            message = format('Cannot roll back 0019: %s opportunity row(s) have no score.', unscored),
            detail  = 'These were derived from collected evidence and have not been scored yet.',
            hint    = 'Score them, or delete them deliberately, then run this rollback again. '
                      'This migration will not invent a score and will not delete your rows.';
    end if;
end
$$;

alter table opportunities
    alter column haskell_fit           set not null,
    alter column project_maturity      set not null,
    alter column potential_scope       set not null,
    alter column timing_momentum       set not null,
    alter column raw_score             set not null,
    alter column confidence_multiplier set not null,
    alter column final_score           set not null,
    alter column why_it_matters        set not null;

alter table evidence drop constraint if exists evidence_supersession_is_consistent;
drop index if exists evidence_last_seen_idx;
drop index if exists evidence_document_lookup_idx;
drop index if exists evidence_current_document_uidx;
alter table evidence drop constraint if exists evidence_review_status_check;
alter table evidence drop constraint if exists evidence_classification_status_check;
alter table evidence
    drop column if exists superseded_at,
    drop column if exists review_status,
    drop column if exists classification_status,
    drop column if exists last_seen_at,
    drop column if exists first_seen_at,
    drop column if exists connector_version,
    drop column if exists connector_id,
    drop column if exists document_revision,
    drop column if exists source_document_id;

commit;
