-- Reverses 0030.
--
-- THE FINGERPRINTS CANNOT ALWAYS BE REBUILT, SO THIS REFUSES TO DISCARD THEM.
--
-- The table holds SHA-256 hashes of sentences a filer has already published. It
-- is tempting to call it a cache: drop it and let the next run recompute it from
-- the stored documents. That holds only where the document was kept. For
-- reference-only evidence (ADR 0014, ADR 0017) the body was NEVER stored, and
-- `first_evidence_id` goes NULL when the evidence row is deleted, so for those
-- sources the hash is the only trace that the sentence was ever seen. Once
-- dropped it cannot be reconstructed, and a boilerplate sentence the filer has
-- repeated for years would read as a fresh announcement again: the failure this
-- table exists to prevent.
--
-- So this refuses whenever the table holds a row, names the count, and changes
-- nothing. It never deletes a fingerprint and never resets the table. An empty
-- table holds nothing to lose and is dropped without ceremony.
--
-- To roll back past this migration on purpose: export the table (it is
-- `(organization_id, source_id, fingerprint, first_evidence_id, first_seen_at)`,
-- and the hashes are not secret), then remove the rows deliberately, and run this
-- again. That is a decision for a person, not for a rollback script.

begin;

do $$
declare
    remembered bigint;
begin
    select count(*) into remembered from evidence_text_fingerprints;

    if remembered > 0 then
        raise exception
            'ABORT: evidence_text_fingerprints holds % fingerprint(s). They are SHA-256 hashes of text that reference-only evidence does not retain, so once dropped they cannot be rebuilt from stored documents, and a recurring disclosure would read as new again. Export them, then remove them deliberately, and run this again. Nothing was deleted.',
            remembered;
    end if;
end
$$;

drop table if exists evidence_text_fingerprints;

commit;
