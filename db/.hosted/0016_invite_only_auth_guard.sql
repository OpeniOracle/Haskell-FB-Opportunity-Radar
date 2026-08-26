-- 0016  Invite-only authentication, enforced in the database
--
-- Supabase's GoTrue settings — "allow email signups", "allow anonymous sign-ins"
-- — are PLATFORM configuration, not database state. They live in the project
-- dashboard and there is no table to set them from. That makes them a control
-- nobody can test from CI and anybody with dashboard access can flip back,
-- silently, at any time.
--
-- This migration adds the half that CAN be tested and cannot be flipped by a
-- checkbox: a trigger on `auth.users` that refuses to create an account unless
-- the address was invited first.
--
-- It is DEFENCE IN DEPTH, not a replacement. The dashboard toggles remain the
-- primary control and are documented in docs/ENVIRONMENT.md. This is what
-- catches the day someone turns them back on.
--
-- Two consequences, both intended:
--
--   * A null email is rejected. Anonymous sign-in creates a user with no
--     email, so anonymous authentication is refused here as well as in the
--     dashboard.
--
--   * Inviting someone is now two steps: add the address to the allowlist,
--     then send the invite. That is what "invite-only" means — the list of who
--     may hold an account is a deliberate, auditable record rather than a
--     property of who happened to find the sign-up form.

create table if not exists auth_invite_allowlist (
    email_normalized    text primary key,
    email_as_entered    text not null,
    invited_by          text not null,
    invited_at          timestamptz not null default now(),
    note                text,
    constraint auth_invite_allowlist_email_shape
        check (position('@' in email_normalized) > 1),
    constraint auth_invite_allowlist_is_normalized
        check (email_normalized = lower(trim(email_normalized))),
    constraint auth_invite_allowlist_inviter_present
        check (length(trim(invited_by)) > 0)
);

comment on table auth_invite_allowlist is
    'Who may hold an account. Ships EMPTY: until a row exists here, no account can be created by any path, including the dashboard invite flow.';

alter table auth_invite_allowlist enable row level security;
revoke all on auth_invite_allowlist from anon, authenticated;

create or replace function auth_enforce_invite_only()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
    -- Anonymous sign-in produces a user with no email address.
    if new.email is null or trim(new.email) = '' then
        raise exception
            'Anonymous and email-less accounts are not permitted on this project.'
            using errcode = 'insufficient_privilege';
    end if;

    if not exists (
        select 1 from public.auth_invite_allowlist
        where email_normalized = lower(trim(new.email))
    ) then
        raise exception
            'Self-registration is disabled. % was not invited; add it to auth_invite_allowlist first.',
            new.email
            using errcode = 'insufficient_privilege';
    end if;

    return new;
end
$$;

drop trigger if exists enforce_invite_only on auth.users;
create trigger enforce_invite_only
    before insert on auth.users
    for each row execute function auth_enforce_invite_only();
