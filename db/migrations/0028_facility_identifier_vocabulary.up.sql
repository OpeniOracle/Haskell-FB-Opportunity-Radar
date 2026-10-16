-- 0028 — A validated vocabulary for facility identifiers.
--
-- `facility_identifiers.identifier_system` has been free text since the
-- baseline. That is exactly wrong for the column the facility-resolution ladder
-- is built on (ADR 0005, doc 18 section 8): a deterministic match is "same
-- system, same value", and `FSIS`, `fsis` and `fsis_est` are three systems that
-- will never match each other. Uniqueness is on (system, value), so a misspelt
-- system does not collide, it quietly forks the key space and a duplicate
-- facility is born.
--
-- THE VOCABULARY is the identifiers the roadmap's connectors will produce and
-- nothing else (doc 18 sections 8.2 and 11):
--
--   fsis_establishment_number   FSIS establishment number (the plant's number)
--   fsis_establishment_id       FSIS establishment id (the directory's key)
--   frs_registry_id             EPA Facility Registry Service registry id
--   npdes_permit_id             NPDES permit identifier
--
-- Two FSIS systems are listed because they are two key spaces, and keeping them
-- apart is what stops one being matched against the other. Which one a
-- connector writes is for that connector (roadmap R6) to confirm against the
-- live directory; the first live sample is the place to settle it. Adding a
-- system is one reviewed migration that replaces this constraint, which is the
-- right price for widening the vocabulary of a matching key.
--
-- SPECULATIVE SYSTEMS ARE NOT LISTED. RCRA, air-permit, parcel, building-permit,
-- utility and corporate identifiers appear in the research notes, but no
-- connector on the roadmap produces them yet.
--
-- THE VALUE. A value must be non-empty and must not carry leading or trailing
-- whitespace, because `'123 '` and `'123'` are different keys to the unique
-- index and the same facility to everyone else. NO PER-SYSTEM FORMAT IS
-- ENFORCED: this environment cannot reach the registries, and a pattern
-- written from memory that rejects a real identifier would break ingestion the
-- first time it met one. A format check is added only with a live sample.
--
-- EXISTING ROWS. Nothing in the application writes this table today, so it is
-- expected to be empty; if it is not, a row outside the vocabulary fails this
-- migration atomically and changes nothing. The operator procedure
-- (docs/design/23) runs the read-only query that finds such rows first.
--
-- The browser holds a table-level read on this table (0015); no grant changes.

begin;

alter table facility_identifiers
    add constraint facility_identifiers_system_check
        check (identifier_system in ('fsis_establishment_number', 'fsis_establishment_id',
                                     'frs_registry_id', 'npdes_permit_id')),
    add constraint facility_identifiers_value_is_clean
        check (identifier_value <> '' and identifier_value = btrim(identifier_value));

comment on column facility_identifiers.identifier_system is
    'Controlled vocabulary (0028): fsis_establishment_number | fsis_establishment_id | frs_registry_id | npdes_permit_id. Uniqueness is on (system, value), so a misspelt system would fork the key space.';

commit;
