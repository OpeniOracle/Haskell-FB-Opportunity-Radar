-- 0017  Shared service mailboxes are not application accounts
--
-- The SEC contact address exists so that a federal regulator can reach an
-- operator about automated collection. It is a shared, role-based mailbox.
--
-- A shared mailbox is the wrong thing to hold an account:
--
--   * Its readers change without anyone revoking anything, so "who has access"
--     stops having an answer.
--   * Every action it takes is attributed to a mailbox rather than a person,
--     which makes `audit_events` unusable for the one question audit exists to
--     answer.
--   * A password reset sent to it is visible to everyone who reads it.
--
-- Migration 0016 made an account impossible unless the address is on
-- `auth_invite_allowlist`. This makes it impossible to put a reserved service
-- address ON that list in the first place — so the rule holds even if someone
-- later invites the mailbox in good faith, having no idea it was reserved.
--
-- The table ships EMPTY. Addresses are reserved as a deliberate data operation
-- (see db/seed/0005_reserved_service_addresses.sql), the same way the licence
-- gate works.

create table if not exists reserved_service_addresses (
    email_normalized    text primary key,
    purpose             text not null,
    reserved_by         text not null,
    reserved_at         timestamptz not null default now(),
    notes               text,
    constraint reserved_service_addresses_is_normalized
        check (email_normalized = lower(trim(email_normalized))),
    constraint reserved_service_addresses_email_shape
        check (position('@' in email_normalized) > 1),
    constraint reserved_service_addresses_purpose_present
        check (length(trim(purpose)) > 0)
);

comment on table reserved_service_addresses is
    'Shared, role-based mailboxes that must never hold an application account. Enforced against auth_invite_allowlist by trigger.';

alter table reserved_service_addresses enable row level security;
revoke all on reserved_service_addresses from anon, authenticated;

create or replace function auth_reject_reserved_address()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    reserved_purpose text;
begin
    select purpose into reserved_purpose
    from public.reserved_service_addresses
    where email_normalized = lower(trim(new.email_normalized));

    if reserved_purpose is not null then
        raise exception
            '% is a reserved service address (%) and must not hold an application account.',
            new.email_as_entered, reserved_purpose
            using errcode = 'insufficient_privilege';
    end if;

    return new;
end
$$;

drop trigger if exists reject_reserved_address on auth_invite_allowlist;
create trigger reject_reserved_address
    before insert or update on auth_invite_allowlist
    for each row execute function auth_reject_reserved_address();
