-- Reverses 0029.
--
-- THE QUEUE IS TRANSIENT BY DESIGN, so there is little to lose, but "little" is
-- not "nothing": unfinished tasks are the only record of which documents a run
-- did not reach. This refuses while any task is pending or running, so work in
-- flight is not discarded by a rollback. Finished tasks are history and go with
-- the table.

begin;

do $$
declare
    in_flight bigint;
begin
    select count(*) into in_flight from ingestion_tasks
     where status in ('pending', 'running');

    if in_flight > 0 then
        raise exception
            'ABORT: % ingestion task(s) are pending or running. Rolling back would discard work that has not been done. Let them finish, or fail or skip them deliberately, and run this again.',
            in_flight;
    end if;
end
$$;

drop table if exists ingestion_tasks;

commit;
