-- Reverses 0028.
--
-- Loses nothing: the constraints hold no data, and every row that satisfied them
-- satisfies the free-text column they were added to. The comment goes with its
-- constraint so the baseline dump is reproduced exactly.

begin;

alter table facility_identifiers
    drop constraint if exists facility_identifiers_value_is_clean,
    drop constraint if exists facility_identifiers_system_check;

comment on column facility_identifiers.identifier_system is null;

commit;
