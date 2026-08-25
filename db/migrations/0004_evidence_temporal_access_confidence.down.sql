drop table if exists evidence_relationships cascade;

alter table evidence drop column if exists evidence_family_id;
drop table if exists evidence_families cascade;

alter table evidence
    drop constraint if exists evidence_temporal_precision_check,
    drop constraint if exists evidence_temporal_basis_check,
    drop constraint if exists evidence_temporal_requires_precision,
    drop constraint if exists evidence_temporal_interval_valid,
    drop constraint if exists evidence_inference_requires_note,
    drop constraint if exists evidence_published_precision_check,
    drop constraint if exists evidence_published_basis_check,
    drop constraint if exists evidence_access_mode_check,
    drop constraint if exists evidence_reference_only_has_no_body,
    drop constraint if exists evidence_metadata_only_has_no_locator,
    drop constraint if exists evidence_strength_check,
    drop constraint if exists evidence_assessment_type_check,
    drop constraint if exists evidence_confidence_level_check,
    drop constraint if exists evidence_sensitivity_check,
    drop constraint if exists evidence_not_superseded_by_itself;

alter table evidence
    drop column if exists temporal_raw_expression,
    drop column if exists temporal_start,
    drop column if exists temporal_end,
    drop column if exists temporal_precision,
    drop column if exists temporal_basis,
    drop column if exists temporal_inference_note,
    drop column if exists published_precision,
    drop column if exists published_basis,
    drop column if exists access_mode,
    drop column if exists body_text,
    drop column if exists archive_uri,
    drop column if exists locator,
    drop column if exists data_sensitivity_class,
    drop column if exists retention_expires_at,
    drop column if exists evidence_strength,
    drop column if exists assessment_type,
    drop column if exists confidence_level,
    drop column if exists superseded_by_evidence_id,
    drop column if exists transformation_version;
