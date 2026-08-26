-- Structural fixtures for the schema-contract tests.
--
-- Every value here is synthetic and structurally minimal. There are no real
-- organizations, no real sources, no real URLs and no evidence content: these
-- rows exist to give a foreign key something to point at.
--
-- The runner wraps this and each test case in a transaction that is ALWAYS
-- rolled back, so nothing survives the test run.

insert into signal_families (code, label) values ('facility_capacity', 'Facility capacity');
insert into signal_event_types (code, label, signal_family_id)
    values ('capacity_expansion', 'Capacity expansion',
            (select id from signal_families where code = 'facility_capacity'));

insert into sources (
    id, name, source_type, collection_method, base_url, allowed_domains,
    schedule, freshness_sla_hours
) values (
    'test-source', 'Structural test source', 'test', 'test',
    'https://example.invalid/', array['example.invalid'], 'manual', 24
);

insert into source_runs (id, source_id, status)
    values ('00000000-0000-4000-8000-000000000001', 'test-source', 'success');

insert into organizations (id, canonical_name, organization_role)
    values ('00000000-0000-4000-8000-000000000010', 'Example Alpha Foods', 'manufacturer_brand'),
           ('00000000-0000-4000-8000-000000000011', 'Example Beta Holdings', 'parent_company'),
           ('00000000-0000-4000-8000-000000000012', 'Example Gamma Group', 'parent_company');

insert into facilities (id, organization_id, canonical_name)
    values ('00000000-0000-4000-8000-000000000020',
            '00000000-0000-4000-8000-000000000010', 'Example Alpha Plant 1');

-- A minimal valid evidence row, used as a link target by later cases.
insert into evidence (
    id, source_id, source_run_id, original_url, resolved_url, title,
    retrieved_at, content_hash, mime_type, extraction_status, access_mode
) values (
    '00000000-0000-4000-8000-000000000030', 'test-source',
    '00000000-0000-4000-8000-000000000001',
    'https://example.invalid/a', 'https://example.invalid/a', 'Structural fixture',
    now(), repeat('0', 64), 'text/html', 'success', 'reference_only'
);

insert into research_batches (id, source_file, tool_or_author, record_count)
    values ('00000000-0000-4000-8000-000000000040', 'structural-test.jsonl', 'test', 0);
