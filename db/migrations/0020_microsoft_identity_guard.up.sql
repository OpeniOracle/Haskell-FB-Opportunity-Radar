-- 0020  Microsoft identity linking, guarded in the database
--
-- Signing in with Microsoft proves who somebody is to MICROSOFT. It does not
-- decide who may use the Radar, and it must not be allowed to become a second
-- door into an account that was created for someone else.
--
-- Three things can go wrong once an external identity provider is attached to
-- an existing set of accounts, and none of them are hypothetical:
--
--   * A second account is created for an address that already has one. The
--     four pre-provisioned Haskell reviewers already exist. If a Microsoft
--     sign-in created a NEW row for the same address, the reviewer would land
--     in an empty duplicate, their allowlist row would still point at the
--     original, and "who is this person" would stop having one answer.
--
--   * A Microsoft identity for one address attaches itself to an account held
--     by another. That is account takeover, and it needs no password.
--
--   * A Microsoft identity attaches on the strength of an email address that
--     Microsoft never verified. An unverified address in a token is a claim,
--     not a fact: in a tenant that permits it, a directory administrator can
--     set a user's mail attribute to anything.
--
-- Supabase's own rules already cover most of this: GoTrue links an OAuth
-- identity to an existing user only when the provider says the email is
-- verified. That rule lives in the platform, is configured by dashboard
-- toggles, and cannot be tested from CI — which is the same argument migration
-- 0016 made about the signup toggles. This migration is the half that CAN be
-- tested and that no checkbox can turn off.
--
-- WHAT THIS DOES NOT DO. It does not authorize anybody. Authorization is the
-- allowlist, re-read on every request by `/api/session`. A Microsoft identity
-- that passes every check here still reaches an application that refuses it
-- unless `auth_invite_allowlist` holds its exact address.

-- ---------------------------------------------------------------------------
-- 1. One account per address.
-- ---------------------------------------------------------------------------
--
-- Folded into the existing invite-only trigger rather than added as a second
-- one, so the order of two `before insert` triggers on the same table can never
-- become the thing this depends on.
--
-- NOTE ON LINKING, because it is the whole reason this is safe: attaching a
-- Microsoft identity to an EXISTING user does not insert into `auth.users`. It
-- inserts into `auth.identities`. So this trigger is not consulted at all when
-- a pre-provisioned reviewer signs in with Microsoft for the first time, and
-- cannot refuse them. It fires only when a genuinely new account is being
-- created — which, for an uninvited stranger, is exactly what must not happen.

create or replace function auth_enforce_invite_only()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
    existing_id uuid;
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

    -- A second account for an address that already has one. The address is
    -- deliberately absent from the message: this fires on an OAuth sign-in, so
    -- the message reaches the project's authentication log, and a log is not a
    -- place to accumulate the addresses of the people who use the product.
    select u.id into existing_id
    from auth.users u
    where lower(trim(u.email)) = lower(trim(new.email))
      and u.id is distinct from new.id
    limit 1;

    if existing_id is not null then
        raise exception
            'An account already exists for this address. Sign in to it, or link the new identity to it; a second account must not be created.'
            using errcode = 'unique_violation';
    end if;

    return new;
end
$$;

-- ---------------------------------------------------------------------------
-- 2. A Microsoft identity may only attach to its own, verified address.
-- ---------------------------------------------------------------------------
--
-- Scoped to `azure`/`microsoft` on purpose. Every other provider — including
-- the `email` identity that every existing account already has — passes
-- straight through, so this cannot disturb password sign-in, invitations or
-- the recovery-code flow.

create or replace function auth_guard_microsoft_identity()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
    claimed_email text;
    account_email text;
    verified      text;
begin
    if lower(coalesce(new.provider, '')) not in ('azure', 'microsoft', 'azure-ad', 'entra') then
        return new;
    end if;

    claimed_email := lower(trim(coalesce(new.identity_data ->> 'email', '')));

    if claimed_email = '' then
        raise exception
            'A Microsoft identity that carries no email address cannot be attached to an account. Grant the application the email scope.'
            using errcode = 'insufficient_privilege';
    end if;

    /*
       IS THE ADDRESS VERIFIED, ACCORDING TO MICROSOFT?

       Entra emits `xms_edov` ("email domain owner verified") only when the
       optional claim has been configured on the application registration.
       Supabase reads it and records `email_verified`. Which of the two lands in
       `identity_data` depends on versions on both sides, so both are accepted.

       BOTH ABSENT MEANS REFUSED, and that is deliberate. "We were not told" is
       not "it is verified" — and the difference is the entire security value of
       the claim. A deployment whose app registration lacks `xms_edov` will find
       Microsoft sign-in refused here, with this sentence in the project's
       authentication log saying exactly which setting is missing. That is a
       configuration error surfacing loudly, which is the outcome to want.
    */
    verified := lower(trim(coalesce(
        new.identity_data ->> 'email_verified',
        new.identity_data ->> 'xms_edov',
        ''
    )));

    if verified not in ('true', 't', '1') then
        raise exception
            'Microsoft did not assert this address as verified. Configure the xms_edov optional claim on the application registration; an unverified address will not be accepted.'
            using errcode = 'insufficient_privilege';
    end if;

    select lower(trim(u.email)) into account_email
    from auth.users u
    where u.id = new.user_id;

    if account_email is null or account_email = '' then
        raise exception
            'A Microsoft identity cannot be attached to an account that has no email address of its own.'
            using errcode = 'insufficient_privilege';
    end if;

    -- The takeover case. Neither address appears in the message.
    if account_email <> claimed_email then
        raise exception
            'A Microsoft identity may only be attached to the account holding the same address.'
            using errcode = 'insufficient_privilege';
    end if;

    return new;
end
$$;

drop trigger if exists guard_microsoft_identity on auth.identities;
create trigger guard_microsoft_identity
    before insert or update on auth.identities
    for each row execute function auth_guard_microsoft_identity();
