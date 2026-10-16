-- 0030 — Remembering what a filer has already said.
--
-- THE DEFECT (docs/design/18 section 8.5, doc 19 R3, pinned by the R1.5 harness).
--
-- A filer's boilerplate recurs. The same sentence about a capital project sits
-- in a 10-K, again in the next 10-Q, and again in the next 10-K, and each
-- appearance can read as a fresh announcement. Six of the production
-- opportunities and the "Our History" page came from exactly that. The remedy is
-- recurring-disclosure suppression: a normalised sentence the same filer has
-- already published is a RECURRENCE, which refreshes `last_observed_at` and
-- creates nothing.
--
-- It needs a memory that outlives any one document. Recomputing it from stored
-- text would mean re-reading every earlier filing on every run, and for
-- reference-only sources the text was never stored at all (ADR 0014). A hash of
-- a normalised sentence is something that rule allows keeping, and it is all the
-- check needs.
--
--   (organization, source, fingerprint)  is the identity, so the same sentence
--   from the same filer through the same source is one row however many times
--   it recurs. `first_evidence_id` names the document it first appeared in and
--   `first_seen_at` when. The first sighting is the only fact recorded; later
--   ones are the CALLER's business (the signal's last_observed_at).
--
-- WHAT IS NOT HERE: how a sentence is normalised or fingerprinted (that is R3,
-- and the choice is made once, in code, with a test), and any use of the table.
-- This migration creates storage and its contract; it writes no row.
--
-- THE FINGERPRINT is a SHA-256 in lower-case hex, like `evidence.content_hash`,
-- and the constraint says so: a fingerprint that is not 64 hex digits is a bug
-- in the normaliser, and storing it would make every later comparison against it
-- silently fail to match.
--
-- DELETION. If the evidence a fingerprint first appeared in is deleted (for
-- example under a retention rule), the fingerprint STAYS and `first_evidence_id`
-- becomes NULL. Suppression keeps working and nothing is held that could not be
-- held. Dropping the fingerprint with the evidence instead would make a later
-- recurrence look new: the failure this table exists to prevent. If the
-- organisation or the source is deleted, its fingerprints go with it.
--
-- SERVER-SIDE ONLY, like the work queue (0029): RLS enabled and forced, all
-- privileges revoked from anon and authenticated, no policy.

begin;

create table evidence_text_fingerprints (
    organization_id    uuid not null references organizations (id) on delete cascade,
    source_id          text not null references sources (id) on delete cascade,
    fingerprint        char(64) not null,
    first_evidence_id  uuid references evidence (id) on delete set null,
    first_seen_at      timestamptz not null default now(),

    constraint evidence_text_fingerprints_pkey
        primary key (organization_id, source_id, fingerprint),
    constraint evidence_text_fingerprints_is_sha256_hex
        check (fingerprint ~ '^[0-9a-f]{64}$')
);

comment on table evidence_text_fingerprints is
    'Roadmap R3 prerequisite. SHA-256 of a normalised sentence a filer has already published, per (organization, source), for recurring-disclosure suppression. Hashes only; never text. Server-side only.';

-- The foreign key's ON DELETE SET NULL has to find the rows to null. Without
-- this, deleting an evidence row scans the whole table.
create index evidence_text_fingerprints_first_evidence_idx
    on evidence_text_fingerprints (first_evidence_id)
    where first_evidence_id is not null;

alter table evidence_text_fingerprints enable row level security;
alter table evidence_text_fingerprints force row level security;

revoke all on evidence_text_fingerprints from anon, authenticated;

commit;
