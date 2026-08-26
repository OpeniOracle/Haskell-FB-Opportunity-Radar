#!/usr/bin/env node
/**
 * Schema-contract tests.
 *
 * Every case runs inside its own transaction, on top of the shared structural
 * fixtures, and the transaction is ALWAYS rolled back. The tests therefore leave
 * no rows behind and can run against any database the migrations have been
 * applied to, including a CI service container.
 *
 * Two kinds of case:
 *
 *   expect: 'ok'          the statement must succeed
 *   expect: '<name>'      the statement must FAIL and the failure must name this
 *                         constraint. Asserting on the constraint NAME rather
 *                         than on "it errored" is the point: a case that passes
 *                         because of an unrelated typo is not a test.
 *
 * A negative case that fails for the wrong reason is reported as a failure.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURES = readFileSync(join(HERE, 'tests', 'fixtures.sql'), 'utf8')

const ORG_A = "'00000000-0000-4000-8000-000000000010'"
const ORG_B = "'00000000-0000-4000-8000-000000000011'"
const ORG_C = "'00000000-0000-4000-8000-000000000012'"
const FAC = "'00000000-0000-4000-8000-000000000020'"
const EV = "'00000000-0000-4000-8000-000000000030'"
const BATCH = "'00000000-0000-4000-8000-000000000040'"
const RUN = "'00000000-0000-4000-8000-000000000001'"

const evidenceInsert = (cols, vals) => `
insert into evidence (source_id, source_run_id, original_url, resolved_url, title,
                      retrieved_at, content_hash, mime_type, extraction_status${cols})
values ('test-source', ${RUN}, 'https://example.invalid/b', 'https://example.invalid/b',
        'Case', now(), repeat('1', 64), 'text/html', 'success'${vals});`

const claimInsert = (extra) => `
insert into research_claims (
    research_claim_id, batch_id, source_file, source_record_locator, claim_type,
    subject_ref, predicate, object_value, observed_at${extra.cols})
values ('claim-1', ${BATCH}, 'f.jsonl', 'line 1', 'entity',
        'example-alpha', 'has_name', '"Example Alpha Foods"'::jsonb, current_date${extra.vals});`

/** @type {{group: string, name: string, expect: string, sql: string}[]} */
const CASES = [
  // ---- 1. A date without its precision. ---------------------------------
  {
    group: 'temporal',
    name: 'evidence date without precision is rejected',
    expect: 'evidence_temporal_requires_precision',
    sql: evidenceInsert(', temporal_start', ", '2027-01-01'"),
  },
  {
    group: 'temporal',
    name: 'evidence date WITH precision and basis is accepted',
    expect: 'ok',
    sql: evidenceInsert(
      ', temporal_start, temporal_end, temporal_precision, temporal_basis',
      ", '2027-01-01', '2027-12-31', 'year', 'stated'",
    ),
  },
  {
    group: 'temporal',
    name: 'signal event date without precision is rejected',
    expect: 'signals_event_date_requires_precision',
    sql: `
insert into signals (organization_id, title, summary, signal_family, event_type,
                     event_date, first_observed_at, last_observed_at, confidence)
values (${ORG_A}, 'Case', 'Case', 'facility_capacity', 'capacity_expansion',
        '2027-03-01', now(), now(), 'possible');`,
  },

  // ---- 2. An invalid temporal interval. ---------------------------------
  {
    group: 'temporal',
    name: 'evidence interval ending before it starts is rejected',
    expect: 'evidence_temporal_interval_valid',
    sql: evidenceInsert(
      ', temporal_start, temporal_end, temporal_precision, temporal_basis',
      ", '2027-06-01', '2027-01-01', 'month', 'stated'",
    ),
  },
  {
    group: 'temporal',
    name: 'research claim interval ending before it starts is rejected',
    expect: 'research_claims_interval_valid',
    sql: claimInsert({
      cols: ', valid_start, valid_end, valid_precision, valid_basis',
      vals: ", '2027-06-01', '2027-01-01', 'month', 'stated'",
    }),
  },

  // ---- 3. A rejected claim with no reason. ------------------------------
  {
    group: 'research',
    name: 'rejected research claim without a reason is rejected',
    expect: 'research_claims_rejection_requires_reason',
    sql: claimInsert({ cols: ', activation_status', vals: ", 'rejected'" }),
  },
  {
    group: 'research',
    name: 'rejected research claim with a whitespace-only reason is rejected',
    expect: 'research_claims_rejection_requires_reason',
    sql: claimInsert({
      cols: ', activation_status, rejection_reason',
      vals: ", 'rejected', '   '",
    }),
  },
  {
    group: 'research',
    name: 'rejected research claim WITH a reason is accepted',
    expect: 'ok',
    sql: claimInsert({
      cols: ', activation_status, rejection_reason',
      vals: ", 'rejected', 'Subject could not be resolved to a pilot account.'",
    }),
  },
  {
    group: 'candidates',
    name: 'rejected organization candidate without a reason is rejected',
    expect: 'organization_candidates_rejection_has_reason',
    sql: `
insert into organization_candidates (original_string, normalized_string,
                                     resolution_state, transformation_version)
values ('Example Alpha', 'example alpha', 'human_rejected', 'v1');`,
  },
  {
    group: 'candidates',
    name: 'rejected facility candidate without a reason is rejected',
    expect: 'facility_candidates_rejection_has_reason',
    sql: `
insert into facility_candidates (organization_id, address, source_kind, corroboration_status)
values (${ORG_A}, '{"city":"Example"}'::jsonb, 'news', 'rejected');`,
  },

  // ---- 4. An inference with no note. ------------------------------------
  {
    group: 'inference',
    name: 'inferred evidence date without a note is rejected',
    expect: 'evidence_inference_requires_note',
    sql: evidenceInsert(
      ', temporal_start, temporal_precision, temporal_basis',
      ", '2027-01-01', 'year', 'inferred'",
    ),
  },
  {
    group: 'inference',
    name: 'inferred evidence date WITH a note is accepted',
    expect: 'ok',
    sql: evidenceInsert(
      ', temporal_start, temporal_precision, temporal_basis, temporal_inference_note',
      ", '2027-01-01', 'year', 'inferred', 'Derived from a stated fiscal year.'",
    ),
  },
  {
    group: 'inference',
    name: 'inferred research claim without a note is rejected',
    expect: 'research_claims_inference_requires_note',
    sql: claimInsert({
      cols: ', valid_start, valid_precision, valid_basis',
      vals: ", '2027-01-01', 'year', 'inferred'",
    }),
  },
  {
    group: 'inference',
    name: 'inferred entity link without a note is rejected',
    expect: 'evidence_entity_links_inference_has_note',
    sql: `
insert into evidence_entity_links (evidence_id, organization_id, relationship,
                                   resolution_confidence, resolution_method, basis)
values (${EV}, ${ORG_A}, 'subject', 0.8, 'exact_identifier', 'inferred');`,
  },
  {
    group: 'inference',
    name: 'inferred ownership interval without a note is rejected',
    expect: 'organization_relationships_inference_has_note',
    sql: `
insert into organization_relationships (parent_organization_id, child_organization_id,
                                        relationship, from_date, from_precision, basis)
values (${ORG_B}, ${ORG_A}, 'parent_subsidiary', '2020-01-01', 'exact_day', 'inferred');`,
  },

  // ---- 5. Reference-only evidence carrying archived body content. --------
  {
    group: 'access',
    name: 'reference-only evidence carrying body text is rejected',
    expect: 'evidence_reference_only_has_no_body',
    sql: evidenceInsert(', access_mode, body_text', ", 'reference_only', 'Retained article text.'"),
  },
  {
    group: 'access',
    name: 'reference-only evidence carrying an archive URI is rejected',
    expect: 'evidence_reference_only_has_no_body',
    sql: evidenceInsert(', access_mode, archive_uri', ", 'reference_only', 's3://archive/a'"),
  },
  {
    group: 'access',
    name: 'metadata-only evidence carrying body text is rejected',
    expect: 'evidence_reference_only_has_no_body',
    sql: evidenceInsert(', access_mode, body_text', ", 'metadata_only', 'Retained article text.'"),
  },
  {
    group: 'access',
    name: 'metadata-only evidence carrying a locator is rejected',
    expect: 'evidence_metadata_only_has_no_locator',
    sql: evidenceInsert(', access_mode, locator', ", 'metadata_only', 'page 3, paragraph 2'"),
  },
  {
    group: 'access',
    name: 'reference-only evidence with a locator and no body is accepted',
    expect: 'ok',
    sql: evidenceInsert(', access_mode, locator', ", 'reference_only', 'page 3, paragraph 2'"),
  },
  {
    group: 'access',
    name: 'archived-full-text evidence carrying body text is accepted',
    expect: 'ok',
    sql: evidenceInsert(', access_mode, body_text', ", 'archived_full_text', 'Retained article text.'"),
  },

  // ---- 6. Ownership intervals where to_date <= from_date. ---------------
  {
    group: 'ownership',
    name: 'facility ownership interval ending before it starts is rejected',
    expect: 'facility_organizations_half_open',
    sql: `
insert into facility_organizations (facility_id, organization_id, relationship,
                                    from_date, to_date, from_precision, to_precision)
values (${FAC}, ${ORG_A}, 'operator', '2024-01-01', '2023-01-01', 'exact_day', 'exact_day');`,
  },
  {
    group: 'ownership',
    name: 'ZERO-LENGTH facility ownership interval is rejected (half-open, so > not >=)',
    expect: 'facility_organizations_half_open',
    sql: `
insert into facility_organizations (facility_id, organization_id, relationship,
                                    from_date, to_date, from_precision, to_precision)
values (${FAC}, ${ORG_A}, 'operator', '2024-01-01', '2024-01-01', 'exact_day', 'exact_day');`,
  },
  {
    group: 'ownership',
    name: 'zero-length organization relationship interval is rejected',
    expect: 'organization_relationships_half_open',
    sql: `
insert into organization_relationships (parent_organization_id, child_organization_id,
                                        relationship, from_date, to_date,
                                        from_precision, to_precision)
values (${ORG_B}, ${ORG_A}, 'parent_subsidiary', '2024-01-01', '2024-01-01',
        'exact_day', 'exact_day');`,
  },
  {
    group: 'ownership',
    name: 'a minority interest with no percentage is rejected',
    expect: 'organization_relationships_minority_has_percent',
    sql: `
insert into organization_relationships (parent_organization_id, child_organization_id,
                                        relationship, from_date, from_precision)
values (${ORG_B}, ${ORG_A}, 'minority_interest', '2025-12-06', 'exact_day');`,
  },
  {
    group: 'ownership',
    name: 'an organization cannot be its own parent',
    expect: 'organization_relationships_not_self',
    sql: `
insert into organization_relationships (parent_organization_id, child_organization_id,
                                        relationship)
values (${ORG_A}, ${ORG_A}, 'parent_subsidiary');`,
  },
  {
    // The half-open convention exists so that a succession has exactly one
    // holder on the changeover date and no gap. This asserts that directly.
    group: 'ownership',
    name: 'ADJACENT half-open intervals resolve to exactly one holder on the changeover date',
    expect: 'ok',
    sql: `
insert into facility_organizations (facility_id, organization_id, relationship,
                                    from_date, to_date, from_precision, to_precision)
values (${FAC}, ${ORG_B}, 'operator', '2020-01-01', '2025-12-06', 'exact_day', 'exact_day'),
       (${FAC}, ${ORG_C}, 'operator', '2025-12-06', null, 'exact_day', null);

do $$
declare
    holders_on_changeover int;
    holder_id uuid;
    holders_day_before int;
begin
    select count(*) into holders_on_changeover
    from facility_organizations
    where facility_id = ${FAC} and relationship = 'operator'
      and from_date <= date '2025-12-06'
      and (to_date is null or to_date > date '2025-12-06');
    if holders_on_changeover <> 1 then
        raise exception 'as-at 2025-12-06 resolved % holders, expected exactly 1',
            holders_on_changeover;
    end if;

    select organization_id into holder_id
    from facility_organizations
    where facility_id = ${FAC} and relationship = 'operator'
      and from_date <= date '2025-12-06'
      and (to_date is null or to_date > date '2025-12-06');
    if holder_id <> ${ORG_C}::uuid then
        raise exception 'the INCOMING organization must hold the changeover date';
    end if;

    select count(*) into holders_day_before
    from facility_organizations
    where facility_id = ${FAC} and relationship = 'operator'
      and from_date <= date '2025-12-05'
      and (to_date is null or to_date > date '2025-12-05');
    if holders_day_before <> 1 then
        raise exception 'as-at 2025-12-05 resolved % holders, expected exactly 1',
            holders_day_before;
    end if;
end
$$;`,
  },
  {
    group: 'ownership',
    name: 'a demerger records BOTH the ended parent edge and the retained stake',
    expect: 'ok',
    sql: `
insert into organization_relationships (parent_organization_id, child_organization_id,
                                        relationship, ownership_percent,
                                        ownership_percent_basis,
                                        from_date, to_date, from_precision, to_precision)
values (${ORG_B}, ${ORG_A}, 'parent_subsidiary', null, null,
        '2015-01-01', '2025-12-06', 'exact_day', 'exact_day'),
       (${ORG_B}, ${ORG_A}, 'minority_interest', 19.850, 'approximate',
        '2025-12-06', null, 'exact_day', null);`,
  },

  // ---- 7. Activation of an unvalidated research claim. -------------------
  {
    group: 'activation',
    name: 'validating a claim with no normalized target is rejected',
    expect: 'research_claims_activation_gate',
    sql: claimInsert({
      cols: ', activation_status, evidence_urls, scope_classification',
      vals: ", 'validated', array['https://example.invalid/x'], 'fnb_core'",
    }),
  },
  {
    // Regression: the gate originally read `array_length(evidence_urls, 1) >= 1`.
    // An EMPTY array yields NULL there, `null >= 1` is NULL, and a CHECK treats
    // NULL as satisfied — so a claim citing nothing activated cleanly.
    group: 'activation',
    name: 'validating a claim with a DEFAULT (empty) evidence array is rejected',
    expect: 'research_claims_activation_gate',
    sql: claimInsert({
      cols: ', activation_status, normalized_target_id, scope_classification',
      vals: `, 'validated', ${ORG_A}, 'fnb_core'`,
    }),
  },
  {
    group: 'activation',
    name: 'validating a claim with an explicitly empty evidence array is rejected',
    expect: 'research_claims_activation_gate',
    sql: claimInsert({
      cols: ', activation_status, normalized_target_id, scope_classification, evidence_urls',
      vals: `, 'validated', ${ORG_A}, 'fnb_core', '{}'`,
    }),
  },
  {
    group: 'activation',
    name: 'validating a claim whose scope is still unknown is rejected',
    expect: 'research_claims_activation_gate',
    sql: claimInsert({
      cols: ', activation_status, normalized_target_id, evidence_urls, scope_classification',
      vals: `, 'validated', ${ORG_A}, array['https://example.invalid/x'], 'unknown'`,
    }),
  },
  {
    group: 'activation',
    name: 'validating a claim whose asserted date has unknown precision is rejected',
    expect: 'research_claims_activation_gate',
    sql: claimInsert({
      cols: ', activation_status, normalized_target_id, evidence_urls, scope_classification, valid_start',
      vals: `, 'validated', ${ORG_A}, array['https://example.invalid/x'], 'fnb_core', '2027-01-01'`,
    }),
  },
  {
    group: 'activation',
    name: 'a fully substantiated claim CAN be validated',
    expect: 'ok',
    sql: claimInsert({
      cols: ', activation_status, normalized_target_id, evidence_urls, scope_classification, valid_start, valid_precision, valid_basis',
      vals: `, 'validated', ${ORG_A}, array['https://example.invalid/x'], 'fnb_core', '2027-01-01', 'year', 'stated'`,
    }),
  },
  {
    group: 'activation',
    name: 'a claim may rest in needs_evidence indefinitely without being an error',
    expect: 'ok',
    sql: claimInsert({ cols: ', activation_status', vals: ", 'needs_evidence'" }),
  },
  {
    group: 'activation',
    name: 'a facility candidate marked promoted without evidence is rejected',
    expect: 'facility_candidates_promotion_is_evidenced',
    sql: `
insert into facility_candidates (organization_id, address, source_kind,
                                 corroboration_status, promoted_facility_id)
values (${ORG_A}, '{"city":"Example"}'::jsonb, 'permit', 'promoted', ${FAC});`,
  },
  {
    group: 'activation',
    name: 'a facility candidate promoted WITH facility and evidence is accepted',
    expect: 'ok',
    sql: `
insert into facility_candidates (organization_id, address, source_kind,
                                 corroboration_status, promoted_facility_id,
                                 corroborating_evidence_id)
values (${ORG_A}, '{"city":"Example"}'::jsonb, 'permit', 'promoted', ${FAC}, ${EV});`,
  },

  // ---- 8. D14-L data through an unauthorized path. ----------------------
  // `licence_authorizations` ships empty, so every one of these fails on the
  // foreign key. The gate is the database, not a convention.
  {
    group: 'licence-gate',
    name: 'licence_authorizations ships EMPTY',
    expect: 'ok',
    sql: `
do $$
declare n int;
begin
    select count(*) into n from licence_authorizations;
    if n <> 0 then
        raise exception 'licence_authorizations must ship empty, found % row(s)', n;
    end if;
end
$$;`,
  },
  {
    group: 'licence-gate',
    name: 'an engagement observation cannot be inserted without an authorization',
    expect: 'engagement_observations_licence_authorization_id_fkey',
    sql: `
insert into engagement_observations (licence_authorization_id, organization_id,
                                     event_name, transformation_version)
values (gen_random_uuid(), ${ORG_A}, 'An industry trade show', 'v1');`,
  },
  {
    group: 'licence-gate',
    name: 'an engagement observation cannot skip the authorization column',
    expect: 'null value in column "licence_authorization_id"',
    sql: `
insert into engagement_observations (organization_id, event_name, transformation_version)
values (${ORG_A}, 'An industry trade show', 'v1');`,
  },
  {
    group: 'licence-gate',
    name: 'a segment tier cannot be inserted without an authorization',
    expect: 'organization_segment_tiers_licence_authorization_id_fkey',
    sql: `
insert into organization_segment_tiers (organization_id, sector,
                                        licence_authorization_id, target_tier)
values (${ORG_A}, 'beverage', gen_random_uuid(), 'tier_1');`,
  },
  {
    group: 'licence-gate',
    name: 'an attendance import batch cannot be inserted without an authorization',
    expect: 'import_batches_licence_authorization_id_fkey',
    sql: `
insert into import_batches (licence_authorization_id, source_filename, file_hash,
                            row_count, transformation_version, imported_by)
values (gen_random_uuid(), 'attendee-export.xlsx', repeat('2', 64), 1, 'v1', 'tester');`,
  },
  {
    group: 'licence-gate',
    name: 'an account-strategy score cannot be stored without an authorization',
    expect: 'opportunities_account_strategy_is_licensed',
    sql: `
insert into opportunities (organization_id, title, stage, confidence,
                           capability_alignment, why_it_matters,
                           haskell_fit, project_maturity, potential_scope,
                           timing_momentum, account_strategy,
                           raw_score, confidence_multiplier, final_score)
values (${ORG_A}, 'Case', 'emerging', 'possible', '{}', 'Case',
        10, 10, 10, 5, 8, 43, 0.80, 34);`,
  },
  {
    group: 'licence-gate',
    name: 'an opportunity WITHOUT an account-strategy score is accepted',
    expect: 'ok',
    sql: `
insert into opportunities (organization_id, title, stage, confidence,
                           capability_alignment, why_it_matters,
                           haskell_fit, project_maturity, potential_scope,
                           timing_momentum,
                           raw_score, confidence_multiplier, final_score)
values (${ORG_A}, 'Case', 'emerging', 'possible', '{}', 'Case',
        10, 10, 10, 5, 35, 0.80, 28);`,
  },
  {
    group: 'licence-gate',
    name: 'contact_records does NOT exist — personal-data functionality is dormant',
    expect: 'ok',
    sql: `
do $$
begin
    if to_regclass('public.contact_records') is not null then
        raise exception 'contact_records must not exist in Phase 1';
    end if;
end
$$;`,
  },

  // ---- Supporting structural rules. -------------------------------------
  {
    group: 'structure',
    name: 'a confirmed scope classification must name who confirmed it',
    expect: 'organizations_scope_class_confirmation_ck',
    sql: `
insert into organizations (canonical_name, organization_role, scope_class, scope_class_status)
values ('Example Delta Foods', 'manufacturer_brand', 'fnb_core', 'confirmed');`,
  },
  {
    group: 'structure',
    name: 'two distinct organizations MAY share a canonical name (C12)',
    expect: 'ok',
    sql: `
insert into organizations (canonical_name, organization_role, entity_key)
values ('Example Shared Name', 'manufacturer_brand', 'test:key-1'),
       ('Example Shared Name', 'distributor_logistics', 'test:key-2');`,
  },
  {
    group: 'structure',
    name: 'two organizations may NOT share an entity key',
    expect: 'organizations_entity_key_uidx',
    sql: `
insert into organizations (canonical_name, organization_role, entity_key)
values ('Example Epsilon', 'manufacturer_brand', 'test:same'),
       ('Example Zeta', 'manufacturer_brand', 'test:same');`,
  },
  {
    group: 'structure',
    name: 'a source run attempt that failed must name an error class',
    expect: 'source_run_attempts_failure_has_class',
    sql: `
insert into source_run_attempts (source_run_id, attempt_number, outcome)
values (${RUN}, 1, 'failure');`,
  },
  {
    group: 'structure',
    name: 'two logical runs cannot share a source and collection window',
    expect: 'source_runs_logical_key',
    sql: `
insert into source_runs (source_id, status, collection_window_start, collection_window_end)
values ('test-source', 'success', '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z'),
       ('test-source', 'success', '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z');`,
  },
  {
    group: 'structure',
    name: 'an alert dedupe key is recipient- and channel-aware (C7)',
    expect: 'alerts_dedupe_uidx',
    sql: `
with s as (
  insert into signals (organization_id, title, summary, signal_family, event_type,
                       first_observed_at, last_observed_at, confidence)
  values (${ORG_A}, 'Case', 'Case', 'facility_capacity', 'capacity_expansion',
          now(), now(), 'possible')
  returning id
)
insert into alerts (recipient_ref, material_change_key, title, body,
                    delivery_channel, status, signal_id)
select 'user:1', 'change-1', 'A', 'B', 'in_app', 'queued', s.id from s;

-- Same recipient, same channel, same change: the second must collide. Under the
-- v0.1 key it would not have, because subscription_id is null on both.
insert into alerts (recipient_ref, material_change_key, title, body,
                    delivery_channel, status, signal_id)
select 'user:1', 'change-1', 'A', 'B', 'in_app', 'queued', id from signals limit 1;`,
  },
  {
    group: 'structure',
    name: 'an alert with no recipient is rejected',
    expect: 'alerts_recipient_present',
    sql: `
with s as (
  insert into signals (organization_id, title, summary, signal_family, event_type,
                       first_observed_at, last_observed_at, confidence)
  values (${ORG_A}, 'Case', 'Case', 'facility_capacity', 'capacity_expansion',
          now(), now(), 'possible')
  returning id
)
insert into alerts (material_change_key, title, body, delivery_channel, status, signal_id)
select 'change-2', 'A', 'B', 'in_app', 'queued', s.id from s;`,
  },
  {
    group: 'structure',
    name: 'a signal family outside the reference vocabulary is rejected',
    expect: 'signals_signal_family_fk',
    sql: `
insert into signals (organization_id, title, summary, signal_family, event_type,
                     first_observed_at, last_observed_at, confidence)
values (${ORG_A}, 'Case', 'Case', 'not_a_real_family', 'capacity_expansion',
        now(), now(), 'possible');`,
  },
  {
    group: 'structure',
    name: 'a new signal family is an INSERT, not a migration (ADR 0008)',
    expect: 'ok',
    sql: `
insert into signal_families (code, label) values ('new_family_added_by_insert', 'New family');
insert into signal_event_types (code, label, signal_family_id)
values ('new_event_type', 'New event type',
        (select id from signal_families where code = 'new_family_added_by_insert'));
insert into signals (organization_id, title, summary, signal_family, event_type,
                     first_observed_at, last_observed_at, confidence)
values (${ORG_A}, 'Case', 'Case', 'new_family_added_by_insert', 'new_event_type',
        now(), now(), 'possible');`,
  },
  {
    group: 'structure',
    name: 'an opportunity may score above the v0.1 dimension caps under a new config',
    expect: 'ok',
    sql: `
insert into scoring_configs (version, config) values ('test-v2', '{"haskell_fit": 40}'::jsonb);
insert into opportunities (organization_id, title, stage, confidence,
                           capability_alignment, why_it_matters,
                           haskell_fit, project_maturity, potential_scope, timing_momentum,
                           raw_score, confidence_multiplier, final_score,
                           scoring_config_version)
values (${ORG_A}, 'Case', 'emerging', 'possible', '{}', 'Case',
        40, 10, 10, 5, 65, 0.80, 52, 'test-v2');`,
  },
  {
    group: 'structure',
    name: 'a coverage expectation with no rationale is rejected',
    expect: 'account_source_expectations_rationale_present',
    sql: `
insert into account_source_expectations (organization_id, source_family, expectation, rationale)
values (${ORG_A}, 'company_newsroom', 'required', '   ');`,
  },
  {
    group: 'structure',
    name: 'silence from a not_applicable source is recordable as CORRECT',
    expect: 'ok',
    sql: `
insert into account_source_expectations (organization_id, source_family, expectation, rationale)
values (${ORG_A}, 'food_enforcement', 'not_applicable',
        'Adjacent consumer-products account; this source was never going to fire.');`,
  },
  {
    group: 'structure',
    name: 'a statutorily non-public source must cite its statute',
    expect: 'unavailable_sources_statute_is_cited',
    sql: `
insert into unavailable_sources (id, name, reason, evaluated_at)
values ('test-dead-end', 'Structural test', 'statutorily_nonpublic', current_date);`,
  },
  {
    group: 'structure',
    name: 'a ranking hypothesis cannot be enabled without a measured corpus',
    expect: 'ranking_hypotheses_enable_requires_corpus',
    sql: `
insert into ranking_hypotheses (name, description, proposed_by, evidence_basis, enabled)
values ('test-hypothesis', 'Case', 'tester', 'Case', true);`,
  },
  {
    group: 'structure',
    name: 'an evidence record cannot supersede itself',
    expect: 'evidence_not_superseded_by_itself',
    sql: `update evidence set superseded_by_evidence_id = id where id = ${EV};`,
  },
  {
    group: 'structure',
    name: 'a correction is a relationship, and the superseded record survives it',
    expect: 'ok',
    sql: `
${evidenceInsert('', '')}

insert into evidence_relationships (from_evidence_id, to_evidence_id, relationship, note)
select id, ${EV}::uuid, 'corrects', 'Case'
from evidence where content_hash = repeat('1', 64);

do $$
declare n int;
begin
    select count(*) into n from evidence where id = ${EV};
    if n <> 1 then
        raise exception 'the superseded record must remain readable';
    end if;
end
$$;`,
  },
  {
    group: 'structure',
    name: 'a dismissal without a reason code is rejected',
    expect: 'opportunity_status_history_negative_needs_reason',
    sql: `
with o as (
  insert into opportunities (organization_id, title, stage, confidence,
                             capability_alignment, why_it_matters,
                             haskell_fit, project_maturity, potential_scope,
                             timing_momentum, raw_score, confidence_multiplier, final_score)
  values (${ORG_A}, 'Case', 'emerging', 'possible', '{}', 'Case',
          10, 10, 10, 5, 35, 0.80, 28)
  returning id
)
insert into opportunity_status_history (opportunity_id, to_status, actor_type, actor_id)
select o.id, 'dismissed', 'user', 'tester' from o;`,
  },
  {
    group: 'structure',
    name: 'a change event with an empty dedupe key is rejected',
    expect: 'change_events_dedupe_key_present',
    sql: `
insert into change_events (object_type, object_id, change_type, materiality, dedupe_key)
values ('organization', ${ORG_A}, 'renamed', 'material', '');`,
  },
]

function runSql(sql) {
  execFileSync('psql', ['-v', 'ON_ERROR_STOP=1', '--no-psqlrc', '-q', '-f', '-'], {
    input: sql,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: process.env,
  })
}

const only = process.argv[2] ?? null
const selected = only ? CASES.filter((c) => c.group === only) : CASES

let passed = 0
const failures = []
let lastGroup = null

for (const c of selected) {
  if (c.group !== lastGroup) {
    console.log(`\n  ${c.group}`)
    lastGroup = c.group
  }
  // begin … rollback, so no case can see or leave another case's rows.
  const script = `begin;\n${FIXTURES}\n${c.sql}\nrollback;`
  let error = null
  try {
    runSql(script)
  } catch (err) {
    error = (err.stderr?.toString?.() ?? err.message ?? '').trim()
  }

  if (c.expect === 'ok') {
    if (error) {
      failures.push({ ...c, detail: `expected success, got:\n${indent(error)}` })
      console.log(`    FAIL  ${c.name}`)
    } else {
      passed += 1
      console.log(`    ok    ${c.name}`)
    }
    continue
  }

  if (!error) {
    failures.push({ ...c, detail: `expected rejection by ${c.expect}, but the statement SUCCEEDED` })
    console.log(`    FAIL  ${c.name}`)
  } else if (!error.includes(c.expect)) {
    failures.push({ ...c, detail: `rejected, but not by ${c.expect}:\n${indent(error)}` })
    console.log(`    FAIL  ${c.name}  (wrong reason)`)
  } else {
    passed += 1
    console.log(`    ok    ${c.name}`)
  }
}

function indent(text) {
  return text.split('\n').map((l) => `        ${l}`).join('\n')
}

console.log(`\n${passed}/${selected.length} schema-contract tests passed`)
if (failures.length) {
  console.error('\nFAILURES\n')
  for (const f of failures) {
    console.error(`  [${f.group}] ${f.name}`)
    console.error(`${indent(f.detail)}\n`)
  }
  process.exit(1)
}
