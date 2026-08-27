-- Revert 0015. Drops the policies and the grants, and disables RLS.
--
-- This restores the pre-RLS posture, which is DENY for the browser only because
-- Supabase's default grants are also removed here. Re-running the up migration
-- is the intended way back.

drop policy if exists alerts_own_rows on public.alerts;
drop policy if exists user_read_state_own_rows on public.user_read_state;

do $$
declare
    p record;
begin
    for p in
        select schemaname, tablename, policyname
        from pg_policies
        where schemaname = 'public' and policyname like '%\_read\_authenticated'
    loop
        execute format('drop policy if exists %I on %I.%I',
                       p.policyname, p.schemaname, p.tablename);
    end loop;
end
$$;

revoke all on all tables in schema public from anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;

do $$
declare
    t record;
begin
    for t in
        select tablename from pg_tables where schemaname = 'public'
    loop
        execute format('alter table public.%I disable row level security', t.tablename);
    end loop;
end
$$;
