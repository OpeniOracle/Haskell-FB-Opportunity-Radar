-- Roll back 0020.
--
-- Removes the Microsoft identity guard and restores migration 0016's
-- invite-only trigger to its original body — WITHOUT the one-account-per-address
-- rule, because that rule arrived here and rolling back means going back.
--
-- The function is restored by being rewritten rather than dropped: 0016 created
-- it, so dropping it would leave the invite-only trigger pointing at nothing and
-- take self-registration protection down with it. A rollback of THIS migration
-- must not weaken the previous one.

drop trigger if exists guard_microsoft_identity on auth.identities;
drop function if exists auth_guard_microsoft_identity();

create or replace function auth_enforce_invite_only()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
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
