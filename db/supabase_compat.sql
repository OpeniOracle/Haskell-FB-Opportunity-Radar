-- Supabase compatibility shim for a PLAIN PostgreSQL test target.
--
-- Supabase provisions three roles and an `auth` schema before any migration
-- runs. A bare postgres:16 or postgres:17 container does not, so 0015 — which
-- grants to those roles and writes a policy against `auth.uid()` — would fail in
-- CI for a reason that has nothing to do with the migration being wrong.
--
-- This file creates the minimum that makes the real migration runnable
-- unmodified. It is applied ONLY to test databases. It is never applied to a
-- Supabase project, where all of this already exists and is managed by the
-- platform.
--
-- `auth.uid()` returns null here. That is deliberate and it is the interesting
-- case: a null uid is what an unauthenticated request looks like, so the
-- per-user policies are exercised in their deny direction by default.

do $$
begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then
        create role anon nologin noinherit;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then
        create role authenticated nologin noinherit;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then
        create role service_role nologin noinherit bypassrls;
    end if;
end
$$;

grant usage on schema public to anon, authenticated, service_role;

-- Supabase's default posture, reproduced so that the migration's REVOKE has
-- something real to revoke. Testing a revoke against a role that was never
-- granted anything proves nothing.
grant all on all tables in schema public to anon, authenticated;
grant all on all sequences in schema public to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;

create schema if not exists auth;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

create or replace function auth.role()
returns text
language sql
stable
as $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;

grant usage on schema auth to anon, authenticated, service_role;

-- `auth.users` exists on every Supabase project. Migration 0016 puts a trigger
-- on it, so the test target needs a table of the same name with the columns that
-- trigger reads. Only `id` and `email` matter here; reproducing GoTrue's full
-- schema would be pretending to test something this shim cannot test.
create table if not exists auth.users (
    id                  uuid primary key default gen_random_uuid(),
    email               text,
    created_at          timestamptz not null default now()
);

-- `auth.sessions` exists on every Supabase project: GoTrue writes one row per
-- signed-in session and DELETES it on sign-out. Migration 0018 reads it to give
-- the evidence proxy immediate revocation, so the test target needs a table of
-- the same name with the two columns that function reads.
--
-- Only `id` and `user_id` matter here. GoTrue's real table also carries device
-- metadata, AAL and refresh timings; reproducing those would be pretending to
-- test something this shim cannot test. The cascade matches GoTrue's, so
-- deleting a user in a test removes their sessions the way it does in reality.
create table if not exists auth.sessions (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid not null references auth.users (id) on delete cascade,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now(),
    not_after   timestamptz
);
