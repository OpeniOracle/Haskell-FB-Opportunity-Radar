-- Reverses 0027.
--
-- Where a role has been recorded this refuses: the role is the only statement of
-- what that date meant, and there is no other copy of it.

begin;

do $$
declare
    recorded bigint;
begin
    select count(*) into recorded from signals where event_date_role is not null;

    if recorded > 0 then
        raise exception
            'ABORT: % signal(s) carry an event date role. Rolling back would delete what those dates mean. Export it, or reset the column deliberately, and run this again.',
            recorded;
    end if;
end
$$;

alter table signals
    drop constraint if exists signals_event_date_role_matches_date,
    drop constraint if exists signals_event_date_role_check;

alter table signals
    drop column if exists event_date_role;

commit;
