-- Reverses 0030.
--
-- The table is a cache of hashes derived from documents that are still
-- recoverable from their evidence rows, so dropping it loses the SUPPRESSION
-- MEMORY and not any fact: the next run simply rebuilds it, and until then a
-- recurring sentence may read as new once. That is a degradation, not data
-- loss, so there is no refusal here.

begin;

drop table if exists evidence_text_fingerprints;

commit;
