-- 0004  §7 step 3 — evidence: temporal model, access modes, confidence axes,
--                    families and correction relationships
--
-- This is the migration the plan calls out as non-retrofittable: "with the full
-- temporal model and access modes from the first migration… Retrofitting means
-- reprocessing the corpus." Everything below therefore lands now, even though
-- nothing writes some of it until Phase 2.
--
-- ADR 0004 (D15, Accepted). A date is an interval with a PRECISION and a BASIS.
-- "in 2027" is not 2027-01-01. The constraints here make the fabricated day
-- impossible to store rather than merely discouraged.
--
-- ADR 0012 (D24, Accepted). A correction is a RELATIONSHIP between immutable
-- records. Nothing is overwritten, so `evidence_relationships` carries the
-- supersession and the superseded row stays readable.
--
-- ADR 0006 (Proposed) and ADR 0009 (Proposed) contribute columns and structural
-- consistency only. NO promotion rule, NO threshold, NO automated confidence
-- decision is encoded — D19 and D16 are open.

alter table evidence
    -- Temporal model: when the SUBJECT of the evidence happens.
    add column if not exists temporal_raw_expression text,
    add column if not exists temporal_start date,
    add column if not exists temporal_end date,
    add column if not exists temporal_precision text,
    add column if not exists temporal_basis text,
    add column if not exists temporal_inference_note text,
    -- Provenance: publication and retrieval are separate facts.
    add column if not exists published_precision text,
    add column if not exists published_basis text,
    -- Access mode and retained content.
    add column if not exists access_mode text not null default 'reference_only',
    add column if not exists body_text text,
    add column if not exists archive_uri text,
    -- `content_hash` already exists in the v0.1.0 baseline and is not redeclared.
    add column if not exists locator text,
    add column if not exists data_sensitivity_class text not null default 'public',
    add column if not exists retention_expires_at timestamptz,
    -- Three confidence axes (ADR 0009). Recorded, never computed here.
    add column if not exists evidence_strength text,
    add column if not exists assessment_type text,
    add column if not exists confidence_level text,
    -- Supersession pointer. The relationship table is authoritative; this is the
    -- denormalised current-view shortcut.
    add column if not exists superseded_by_evidence_id uuid references evidence(id),
    add column if not exists transformation_version text;

alter table evidence
    -- ---- Temporal precision vocabulary. Fixed by an ACCEPTED ADR, so a CHECK
    -- ---- is right: this is a stable structural invariant, not evolving
    -- ---- business vocabulary.
    add constraint evidence_temporal_precision_check
        check (temporal_precision is null or temporal_precision in
               ('exact_day', 'month', 'quarter', 'season', 'half_year',
                'year', 'range', 'relative', 'unknown')),
    add constraint evidence_temporal_basis_check
        check (temporal_basis is null or temporal_basis in ('stated', 'inferred', 'unknown')),

    -- ---- REJECTS: a date without its precision. -------------------------
    -- A stored interval with no precision is a date the interface cannot render
    -- honestly, because it cannot know how much of it the source actually said.
    add constraint evidence_temporal_requires_precision
        check ((temporal_start is null and temporal_end is null)
               or (temporal_precision is not null and temporal_basis is not null)),

    -- ---- REJECTS: an invalid temporal interval. -------------------------
    add constraint evidence_temporal_interval_valid
        check (temporal_start is null or temporal_end is null or temporal_end >= temporal_start),

    -- ---- REJECTS: an inference with no note. ----------------------------
    -- If the platform worked the date out rather than reading it, it has to say
    -- how. An unexplained inference is indistinguishable from a source fact.
    add constraint evidence_inference_requires_note
        check (temporal_basis is distinct from 'inferred'
               or (temporal_inference_note is not null and length(trim(temporal_inference_note)) > 0)),

    add constraint evidence_published_precision_check
        check (published_precision is null or published_precision in
               ('exact_day', 'month', 'quarter', 'season', 'half_year',
                'year', 'range', 'relative', 'unknown')),
    add constraint evidence_published_basis_check
        check (published_basis is null or published_basis in ('stated', 'inferred', 'unknown')),

    -- ---- Access modes (ADR 0006). Recorded, with no promotion rule. -----
    add constraint evidence_access_mode_check
        check (access_mode in ('structured_primary', 'archived_full_text',
                               'licensed_full_text', 'reference_only', 'metadata_only')),

    -- ---- REJECTS: reference-only evidence carrying archived body content.
    -- The mode is a statement about what we are permitted to retain. A body
    -- stored against it contradicts the permission it was collected under.
    add constraint evidence_reference_only_has_no_body
        check (access_mode not in ('reference_only', 'metadata_only')
               or (body_text is null and archive_uri is null)),

    -- Metadata-only keeps neither body nor locator.
    add constraint evidence_metadata_only_has_no_locator
        check (access_mode <> 'metadata_only' or locator is null),

    -- ---- Confidence axes. Vocabulary only; no threshold, no derivation. --
    add constraint evidence_strength_check
        check (evidence_strength is null or evidence_strength in
               ('authoritative', 'corroborated', 'single_source', 'weak')),
    add constraint evidence_assessment_type_check
        check (assessment_type is null or assessment_type in
               ('observed_fact', 'system_inference', 'projection')),
    add constraint evidence_confidence_level_check
        check (confidence_level is null or confidence_level in ('high', 'moderate', 'low')),

    add constraint evidence_sensitivity_check
        check (data_sensitivity_class in ('public', 'licensed',
                                          'confidential_internal', 'restricted_personal')),
    add constraint evidence_not_superseded_by_itself
        check (superseded_by_evidence_id is null or superseded_by_evidence_id <> id);

-- An evidence family groups records that describe the same underlying event, so
-- a re-collection or a correction does not read as new activity (C16).
create table evidence_families (
    id                  uuid primary key default gen_random_uuid(),
    family_key          text not null unique,
    label               text,
    first_seen_at       timestamptz not null default now(),
    created_at          timestamptz not null default now()
);

alter table evidence
    add column if not exists evidence_family_id uuid references evidence_families(id);

-- ADR 0012: corrections supersede, they do not overwrite. Seven typed
-- relationships, all of them between two immutable records.
create table evidence_relationships (
    id                  uuid primary key default gen_random_uuid(),
    from_evidence_id    uuid not null references evidence(id) on delete cascade,
    to_evidence_id      uuid not null references evidence(id) on delete cascade,
    relationship        text not null,
    note                text,
    occurred_at         timestamptz,
    created_at          timestamptz not null default now(),
    unique (from_evidence_id, to_evidence_id, relationship),
    check (from_evidence_id <> to_evidence_id),
    check (relationship in ('corrects', 'retracts', 'withdraws', 'contradicts',
                            'supersedes', 'delays', 'cancels'))
);
comment on table evidence_relationships is
    'ADR 0012. Nothing is deleted; the current view is computed from these.';

create index on evidence (evidence_family_id);
create index on evidence (superseded_by_evidence_id);
create index on evidence (access_mode);
create index on evidence_relationships (to_evidence_id);
