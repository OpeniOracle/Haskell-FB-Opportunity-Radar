-- Seed: shared service mailboxes that must never hold an application account.
--
-- The SEC contact mailbox is confirmed as actively monitored and is declared to
-- a federal regulator for automated-source identification and operational
-- notices. That is the whole of its job. It is not a bootstrap administrator and
-- not an ordinary user, and migration 0017 makes that impossible rather than
-- merely documented.

insert into reserved_service_addresses (email_normalized, purpose, reserved_by, notes) values
    ('oracles@openi-analytics.com',
     'SEC EDGAR automated-source identification and operational notices',
     'Openi Analytics',
     'Shared role mailbox. Confirmed monitored 2026-08-26. Never an application account: its readers change without revocation, and every action it took would be attributed to a mailbox rather than a person.')
on conflict (email_normalized) do update set
    purpose = excluded.purpose,
    reserved_by = excluded.reserved_by,
    notes = excluded.notes;
