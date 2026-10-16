-- Reverses 0026.
--
-- THE CLASSIFICATION IS LOST, THE ACCESS POSTURE IS NOT.
--
-- Dropping `rights_class` removes the label and the rule that coupled it to
-- `access_mode` and `license_mode`. It changes no access mode, so nothing that
-- was reference-only becomes archivable by rolling this back; the pipeline
-- reads `access_mode`, which this migration never touched.
--
-- It does discard any class an operator set. Where one has been set, this
-- refuses, so the classification is exported deliberately and not by accident.

begin;

do $$
declare
    classified bigint;
begin
    select count(*) into classified from sources where rights_class <> 'unclassified';

    if classified > 0 then
        raise exception
            'ABORT: % source(s) carry a rights class. Rolling back would delete that classification. Export it, or reset it to unclassified deliberately, and run this again.',
            classified;
    end if;
end
$$;

alter table sources
    drop constraint if exists sources_archive_requires_established_rights,
    drop constraint if exists sources_rights_class_check;

alter table sources
    drop column if exists rights_class;

commit;
