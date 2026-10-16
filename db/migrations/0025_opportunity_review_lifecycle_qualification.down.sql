-- Reverses 0025.
--
-- DROPPING THESE COLUMNS DESTROYS WHATEVER A PERSON RECORDED IN THEM.
--
-- On a database where nobody has accepted, rejected or assessed anything, every
-- row still holds the defaults and nothing is lost. Once review has started, the
-- column values are the only copy of that work, so this refuses rather than
-- discard it. Export or deliberately reset the rows first.

begin;

do $$
declare
    recorded bigint;
begin
    select count(*) into recorded from opportunities
     where review_state <> 'unreviewed'
        or project_lifecycle <> 'unknown'
        or commercial_qualification <> 'not_assessed';

    if recorded > 0 then
        raise exception
            'ABORT: % opportunity row(s) carry a review state, lifecycle or qualification. Rolling back would delete that work. Export it, or reset those columns deliberately, and run this again.',
            recorded;
    end if;
end
$$;

alter table opportunities
    drop constraint if exists opportunities_ended_project_is_not_active,
    drop constraint if exists opportunities_assessment_requires_review,
    drop constraint if exists opportunities_commercial_qualification_check,
    drop constraint if exists opportunities_project_lifecycle_check,
    drop constraint if exists opportunities_review_state_check;

-- Dropping a column drops its column grant, its comment and its constraints.
alter table opportunities
    drop column if exists commercial_qualification,
    drop column if exists project_lifecycle,
    drop column if exists review_state;

commit;
