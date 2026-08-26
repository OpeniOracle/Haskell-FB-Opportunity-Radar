-- 0009  §7 step 8 — research-claim staging and the activation gate
--
-- ADR 0011. External research NEVER lands in a canonical table. It lands here,
-- and it stays here until every activation precondition is satisfiable in a
-- single row-level check.
--
-- THE GATE FAILS CLOSED. `activation_status = 'validated'` is not a flag an
-- importer can set; it is a claim the row has to be able to substantiate. If the
-- claim cannot name a normalized target, cite at least one evidence URL, state a
-- scope, carry a precision for any date it asserts, and explain any inference,
-- the transition is rejected by the database rather than by a convention.
--
-- 'unresolved' is a valid outcome that blocks activation without being an error
-- (ADR 0005). A claim may sit in 'staged' or 'needs_evidence' indefinitely.

create table research_batches (
    id                  uuid primary key default gen_random_uuid(),
    source_file         text not null,
    file_hash           char(64),
    tool_or_author      text not null,
    received_at         timestamptz not null default now(),
    record_count        integer not null default 0,
    notes               text,
    check (record_count >= 0)
);

create table research_claims (
    research_claim_id       text primary key,
    batch_id                uuid not null references research_batches(id) on delete cascade,
    source_file             text not null,
    source_record_locator   text not null,     -- JSONL line, table row, or heading
    claim_type              text not null,
    subject_ref             text not null,
    predicate               text not null,
    object_value            jsonb not null,

    -- Valid time, on the same six-field temporal contract as canonical rows.
    valid_raw_expression    text,
    valid_start             date,
    valid_end               date,
    valid_precision         text not null default 'unknown',
    valid_basis             text not null default 'unknown',
    valid_inference_note    text,

    observed_at             date not null,
    evidence_urls           text[] not null default '{}',
    verification_status     text not null default 'unverified',
    source_authority        text not null default 'unknown',
    scope_classification    text not null default 'unknown',
    activation_status       text not null default 'staged',
    rejection_reason        text,
    pilot_account_ref       text,
    normalized_target_id    uuid,
    activated_by            text,
    activated_at            timestamptz,
    created_at              timestamptz not null default now(),

    constraint research_claims_claim_type_check
        check (claim_type in ('entity', 'alias', 'facility', 'relationship',
                              'project', 'source', 'hypothesis',
                              -- Both reviewed graph files carry records asserting a
                              -- COUNT rather than an instance ("24 plants in 18
                              -- states"). True, useful, and not facility records:
                              -- forcing them into 'facility' would invent sites the
                              -- source explicitly declined to enumerate.
                              'network_assertion')),
    constraint research_claims_verification_check
        check (verification_status in ('unverified', 'corroborated', 'verified')),
    constraint research_claims_authority_check
        check (source_authority in ('primary', 'official_secondary',
                                    'secondary', 'unknown')),
    constraint research_claims_scope_check
        check (scope_classification in ('fnb_core', 'fnb_adjacent',
                                        'non_fnb', 'unknown')),
    constraint research_claims_activation_status_check
        check (activation_status in ('staged', 'validated', 'rejected',
                                     'superseded', 'needs_evidence')),
    constraint research_claims_precision_check
        check (valid_precision in ('exact_day', 'month', 'quarter', 'season',
                                   'half_year', 'year', 'range', 'relative', 'unknown')),
    constraint research_claims_basis_check
        check (valid_basis in ('stated', 'inferred', 'unknown')),

    -- ---- REJECTS: an invalid temporal interval. -------------------------
    constraint research_claims_interval_valid
        check (valid_end is null or valid_start is null or valid_end >= valid_start),

    -- ---- REJECTS: an inference with no note. ----------------------------
    constraint research_claims_inference_requires_note
        check (valid_basis <> 'inferred'
               or (valid_inference_note is not null
                   and length(trim(valid_inference_note)) > 0)),

    -- ---- REJECTS: a rejected claim with no reason. ----------------------
    -- An unexplained rejection is rediscovered, re-triaged and re-rejected on
    -- every re-import.
    constraint research_claims_rejection_requires_reason
        check (activation_status <> 'rejected'
               or (rejection_reason is not null
                   and length(trim(rejection_reason)) > 0)),

    -- ---- REJECTS: activation of an unvalidated claim. -------------------
    -- Every precondition in one check, so there is no order of operations in
    -- which a row is briefly activated while still incomplete.
    constraint research_claims_activation_gate
        check (activation_status <> 'validated'
               or (normalized_target_id is not null
                   -- coalesce, NOT a bare array_length: an EMPTY array yields
                   -- NULL, and `null >= 1` is NULL, which a CHECK treats as
                   -- satisfied. Without this a claim with zero evidence URLs
                   -- activates cleanly. Caught by a schema-contract test.
                   and coalesce(array_length(evidence_urls, 1), 0) >= 1
                   and scope_classification <> 'unknown'
                   and (valid_start is null or valid_precision <> 'unknown')
                   and (valid_basis <> 'inferred' or valid_inference_note is not null)))
);
comment on constraint research_claims_activation_gate on research_claims is
    'ADR 0011 activation gate. Fails closed: validation is substantiated by the row, not asserted by the importer.';
comment on column research_claims.pilot_account_ref is
    'Required for any claim about a Highest Value account or its subsidiaries, so acquired and adjacent entities cannot silently become new pilot accounts. Enforced in application logic because it depends on subject resolution.';

create index on research_claims (activation_status, claim_type);
create index on research_claims (subject_ref);
create index on research_claims (batch_id);
create index on research_claims (pilot_account_ref) where pilot_account_ref is not null;
