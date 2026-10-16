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
-- public record OR it has explicitly declared `license_mode` open or licensed.
-- `unknown`, the default, is neither. So a state or local source, a
-- municipality, an economic-development body, a newswire or a company cannot be
-- switched to full-text archiving by accident, by a typo in a seed, or by being
-- called "public" in a hurry. Establishing the rights is an explicit, recorded
-- act (`license_mode`, with `terms_reviewed_at` and `license_notes`), and until
-- it happens `reference_only` is the posture, which is also the column default.
-- A source is never silently reclassified as federal.
--
-- EXISTING ROWS. The two federal sources the pilot seeds declare `open`; the
-- corporate one is `reference_only`. All satisfy the rule as they stand, and
-- all start as `unclassified` until the reviewed seed in db/seed/0009 sets
-- their class. Classifying them changes no access mode.
--
-- THE BROWSER. `sources` is granted column by column (0015), withholding
-- `connector_config` and the other operational configuration. `rights_class` is
-- a policy label, not a secret, so it is granted here, in the same transaction.

begin;

alter table sources
    add column rights_class text not null default 'unclassified';

alter table sources
    add constraint sources_rights_class_check
        check (rights_class in ('federal_public_record', 'state_local_public_record',
                                'economic_development_body', 'corporate_first_party',
                                'discovery_or_republication', 'unclassified')),
    add constraint sources_archive_requires_established_rights
        check (rights_class = 'federal_public_record'
               or access_mode in ('reference_only', 'metadata_only')
               or license_mode in ('open', 'licensed'));

comment on column sources.rights_class is
    'D-R2 / ADR 0017 (Proposed). What kind of publisher this is. unclassified asserts nothing. Anything but a federal public record may be archived only after it declares license_mode open or licensed; until then reference_only is the posture.';

grant select (rights_class) on sources to authenticated;

commit;
