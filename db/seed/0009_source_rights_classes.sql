-- 0009 — The rights class of the three pilot sources.
--
-- D-R2 / ADR 0017 (Proposed). Migration 0026 added `sources.rights_class` with a
-- default of `unclassified`, which asserts nothing. This records what the pilot
-- already decided in ADR 0014, in the new column, and nothing more:
--
--   sec-edgar       U.S. federal government work         federal_public_record
--   fsis-mpi        U.S. federal government work         federal_public_record
--   mars-newsroom   a company's own newsroom             corporate_first_party
--
-- IT CHANGES NO ACCESS MODE AND NO LICENCE. The pilot's posture is already in
-- `access_mode` and `license_mode` (0002, 0006); this labels the kind of
-- publisher so the rule that couples the two (sources_archive_requires_established_rights)
-- is stated and not inferred.
--
-- IT NEVER OVERRIDES A DECISION. Each statement applies only to a source that is
-- still `unclassified`. A class an operator has set, for any reason, is left
-- exactly as it is, which is what makes re-running this safe: seeds are how a
-- correction is applied, and a correction must not undo a reviewed change.
--
-- A source that does not exist is simply not updated; this file creates none.

update sources
   set rights_class = 'federal_public_record',
       updated_at   = now()
 where id in ('sec-edgar', 'fsis-mpi')
   and rights_class = 'unclassified';

update sources
   set rights_class = 'corporate_first_party',
       updated_at   = now()
 where id = 'mars-newsroom'
   and rights_class = 'unclassified';
