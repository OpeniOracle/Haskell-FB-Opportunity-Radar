-- 0026 — Source rights class.
--
-- Decision D-R2 (docs/design/20), drafted for ratification in ADR 0017.
--
-- ADR 0014 decides two kinds of source: U.S. government material is archived,
-- corporate material is held by reference. It is silent about state and local
-- government, economic-development bodies, municipal publications, advocacy
-- sites and wire services, which is most of what the research package found.
-- This records WHAT KIND of publisher a source is, so the access policy for it
-- is a stated rule and not an inference from a hostname.
--
-- THE VOCABULARY
--
--   federal_public_record        U.S. federal government work (SEC, FSIS, EPA).
--                                The only class ADR 0014 lets be archived.
--   state_local_public_record    A state or local public body or authority.
--   economic_development_body    An economic-development organisation.
--   corporate_first_party        A company's own newsroom or IR pages.
--   discovery_or_republication   Press, wire services, indexes, aggregators and
--                                advocacy sites; a copy is not an origin.
--   unclassified                 Nothing is asserted. THE DEFAULT.
--
-- WHY A NEW COLUMN AND NOT `license_mode` OR `access_mode`.
--
--   access_mode   what we are PERMITTED to store and fetch (ADR 0006).
--   license_mode  the licensing posture the source has DECLARED: open |
--                 licensed | restricted | unknown.
--   rights_class  WHAT KIND OF PUBLISHER it is.
--
-- They are different questions with a rule between them, and the rule is the
-- point of this migration. Nothing here duplicates either existing column and no
-- value of either is reinterpreted.
--
-- THE RULE, AS A CONSTRAINT.
--
-- A source may be archived, parsed as an official record or licensed in full
-- (anything but reference_only or metadata_only) only if EITHER it is a federal
-- public record OR it has DOCUMENTED a rights determination, which means all of:
--
--   license_mode      open or licensed         (`unknown`, the default, and
--                                               `restricted` are neither)
--   terms_reviewed_at not null                 (when the terms were reviewed)
--   license_notes     contains a non-blank     (what was decided, and by whom)
--                     character
--
-- So a state or local source, a municipality, an economic-development body, a
-- newswire, a company or a source nobody has classified cannot be switched to
-- full-text archiving by accident, by a typo in a seed, by being called "public"
-- in a hurry, or by setting one flag. Establishing the rights is an explicit,
-- recorded act, and until it happens `reference_only` is the posture, which is
-- also the column default. A source is never silently reclassified as federal.
--
-- WHAT THE CONSTRAINT CAN AND CANNOT PROVE. It proves the determination was
-- RECORDED: a review date exists and a note exists. It cannot prove the note is
-- true, that the reviewer was competent, or that the date is the real one; no
-- constraint can, and a minimum note length would be a number picked from the
-- air. The ADR asks the note to say what was decided and who decided it, and
-- review is where that is read.
--
-- NULL IS THE TRAP, so no operand of the documented branch can be NULL: the
-- columns it reads are tested with `is not null` and the note is coalesced
-- before it is matched. A bare `license_notes ~ '\S'` yields NULL for a NULL
-- note, `true and null` is NULL, and a CHECK treats NULL as satisfied; an
-- undocumented source would have passed.
--
-- EXISTING ROWS. When this runs every source is `unclassified`, because the
-- reviewed seed db/seed/0009 classifies them AFTERWARDS (the column does not
-- exist until now). So for this one moment the two federal pilot sources are
-- judged like any other: they archive under ADR 0014, declare `open`, and must
-- therefore have documented it. Seed 0002 records the determination (ADR 0014,
-- accepted 2026-08-26) and a database seeded before that was added may hold a
-- NULL review date. THAT IS REFUSED, atomically, with the sources named and
-- what is missing from each, and nothing is changed: re-running the reviewed
-- seeds fills a blank review date and never overwrites a recorded one, or the
-- operator records the determination, and this is run again. The corporate
-- pilot source is `reference_only` and is unaffected. Classifying the three as
-- federal / corporate (seed 0009) changes no access mode.
--
-- THE BROWSER. `sources` is granted column by column (0015), withholding
-- `connector_config` and the other operational configuration. `rights_class` is
-- a policy label, not a secret, so it is granted here, in the same transaction.

begin;

alter table sources
    add column rights_class text not null default 'unclassified';

-- A REFUSAL THAT SAYS WHAT IS WRONG. Adding the constraint below would refuse a
-- violating row anyway and roll everything back, but with a constraint name and
-- no row. This finds the rows first, so the person who reads the failure learns
-- which sources and what each is missing. It changes nothing: the whole
-- migration is one transaction, and raising here discards it.
--
-- The predicate is the constraint's, word for word, and every operand of it is
-- non-null (see the note on NULL above), so `not (...)` selects exactly the rows
-- the constraint would refuse.
do $$
declare
    offenders bigint;
    listing   text;
begin
    select count(*),
           string_agg(id || ' (' || concat_ws('; ',
               case when license_mode not in ('open', 'licensed')
                    then 'license_mode is ' || license_mode end,
               case when terms_reviewed_at is null
                    then 'terms_reviewed_at is empty' end,
               case when coalesce(license_notes, '') !~ '\S'
                    then 'license_notes is empty' end) || ')',
               ', ' order by id)
      into offenders, listing
      from sources
     where not (rights_class = 'federal_public_record'
                or access_mode in ('reference_only', 'metadata_only')
                or (license_mode in ('open', 'licensed')
                    and terms_reviewed_at is not null
                    and coalesce(license_notes, '') ~ '\S'));

    if offenders > 0 then
        raise exception
            'ABORT: % source(s) break sources_archive_requires_established_rights: %. A source that is not a federal public record may be archived, parsed as an official record or held as licensed full text only when it declares license_mode open or licensed AND records terms_reviewed_at and license_notes (ADR 0017). Record the determination, or set access_mode to reference_only, deliberately, and run this again. Nothing was changed.',
            offenders, listing;
    end if;
end
$$;

alter table sources
    add constraint sources_rights_class_check
        check (rights_class in ('federal_public_record', 'state_local_public_record',
                                'economic_development_body', 'corporate_first_party',
                                'discovery_or_republication', 'unclassified')),
    add constraint sources_archive_requires_established_rights
        check (rights_class = 'federal_public_record'
               or access_mode in ('reference_only', 'metadata_only')
               or (license_mode in ('open', 'licensed')
                   and terms_reviewed_at is not null
                   and coalesce(license_notes, '') ~ '\S'));

comment on column sources.rights_class is
    'D-R2 / ADR 0017 (Proposed). What kind of publisher this is. unclassified asserts nothing. Anything but a federal public record may be archived only after it documents a rights determination: license_mode open or licensed, terms_reviewed_at and license_notes recorded; until then reference_only is the posture.';

grant select (rights_class) on sources to authenticated;

commit;
