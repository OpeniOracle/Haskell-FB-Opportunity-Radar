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

/**
 * One signed-in, allowlisted user, for the 0018 guard cases.
 *
 * Fixed ids so a case can name the session it is about to delete. The `auth`
 * tables are the compatibility shim's on a test target and GoTrue's on Supabase;
 * only `id`, `email` and `user_id` are touched, which both have.
 */
const guardFixture = () => `
insert into auth_invite_allowlist (email_normalized, email_as_entered, invited_by)
values ('live@example.invalid', 'live@example.invalid', 'tester');

insert into auth.users (id, email)
values ('00000000-0000-4000-8000-0000000000a0', 'live@example.invalid');

insert into auth.sessions (id, user_id)
values ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000a0');`

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
  // ---- Invite-only authentication (0016). --------------------------------
  // Supabase's signup toggles are platform configuration with no table behind
  // them, so they cannot be tested. This half can be, and it is the half that
  // catches the day someone turns the toggles back on.
  {
    group: 'invite-only',
    name: 'the invite allowlist ships EMPTY',
    expect: 'ok',
    sql: `
do $$
declare n int;
begin
    select count(*) into n from auth_invite_allowlist;
    if n <> 0 then
        raise exception 'auth_invite_allowlist must ship empty, found % row(s)', n;
    end if;
end
$$;`,
  },
  {
    group: 'invite-only',
    name: 'an uninvited address cannot create an account',
    expect: 'Self-registration is disabled',
    sql: `insert into auth.users (email) values ('stranger@example.invalid');`,
  },
  {
    // Anonymous sign-in creates a user with no email, so refusing a null email
    // refuses anonymous authentication at the database layer too.
    group: 'invite-only',
    name: 'an anonymous (email-less) account cannot be created',
    expect: 'Anonymous and email-less accounts are not permitted',
    sql: `insert into auth.users (email) values (null);`,
  },
  {
    group: 'invite-only',
    name: 'a blank email cannot create an account',
    expect: 'Anonymous and email-less accounts are not permitted',
    sql: `insert into auth.users (email) values ('   ');`,
  },
  {
    group: 'invite-only',
    name: 'an INVITED address can create an account, case-insensitively',
    expect: 'ok',
    sql: `
insert into auth_invite_allowlist (email_normalized, email_as_entered, invited_by)
values ('invited@example.invalid', 'Invited@Example.invalid', 'tester');

insert into auth.users (email) values ('INVITED@EXAMPLE.INVALID');

do $$
declare n int;
begin
    select count(*) into n from auth.users where lower(email) = 'invited@example.invalid';
    if n <> 1 then
        raise exception 'expected exactly one invited account, found %', n;
    end if;
end
$$;`,
  },
  {
    group: 'invite-only',
    name: 'the allowlist rejects a non-normalized entry',
    expect: 'auth_invite_allowlist_is_normalized',
    sql: `
insert into auth_invite_allowlist (email_normalized, email_as_entered, invited_by)
values ('Mixed@Case.invalid', 'Mixed@Case.invalid', 'tester');`,
  },
  {
    group: 'invite-only',
    name: 'the allowlist rejects an entry with no inviter',
    expect: 'auth_invite_allowlist_inviter_present',
    sql: `
insert into auth_invite_allowlist (email_normalized, email_as_entered, invited_by)
values ('someone@example.invalid', 'someone@example.invalid', '  ');`,
  },
  {
    group: 'invite-only',
    name: 'authenticated cannot read the invite allowlist',
    expect: 'permission denied',
    sql: `
set local role authenticated;
select count(*) from auth_invite_allowlist;`,
  },

  // ---- Reserved service addresses (0017). --------------------------------
  {
    group: 'reserved-addresses',
    name: 'the reserved-address table ships EMPTY',
    expect: 'ok',
    sql: `
do $$
declare n int;
begin
    select count(*) into n from reserved_service_addresses;
    if n <> 0 then
        raise exception 'reserved_service_addresses must ship empty, found %', n;
    end if;
end
$$;`,
  },
  {
    // A shared role mailbox has readers who change without anyone revoking
    // anything, and every action it takes is attributed to a mailbox rather
    // than a person.
    group: 'reserved-addresses',
    name: 'a reserved service mailbox cannot be allowlisted',
    expect: 'reserved service address',
    sql: `
insert into reserved_service_addresses (email_normalized, purpose, reserved_by)
values ('ops@example.invalid', 'automated source identification', 'tester');

insert into auth_invite_allowlist (email_normalized, email_as_entered, invited_by)
values ('ops@example.invalid', 'ops@example.invalid', 'tester');`,
  },
  {
    group: 'reserved-addresses',
    name: 'a reserved mailbox cannot be allowlisted under different casing',
    expect: 'reserved service address',
    sql: `
insert into reserved_service_addresses (email_normalized, purpose, reserved_by)
values ('ops@example.invalid', 'automated source identification', 'tester');

insert into auth_invite_allowlist (email_normalized, email_as_entered, invited_by)
values (lower('OPS@Example.invalid'), 'OPS@Example.invalid', 'tester');`,
  },
  {
    group: 'reserved-addresses',
    name: 'an existing allowlist row cannot be UPDATED onto a reserved address',
    expect: 'reserved service address',
    sql: `
insert into reserved_service_addresses (email_normalized, purpose, reserved_by)
values ('ops@example.invalid', 'automated source identification', 'tester');

insert into auth_invite_allowlist (email_normalized, email_as_entered, invited_by)
values ('person@example.invalid', 'person@example.invalid', 'tester');

update auth_invite_allowlist
   set email_normalized = 'ops@example.invalid',
       email_as_entered = 'ops@example.invalid'
 where email_normalized = 'person@example.invalid';`,
  },
  {
    group: 'reserved-addresses',
    name: 'a reserved mailbox therefore cannot become an account at all',
    expect: 'Self-registration is disabled',
    sql: `
insert into reserved_service_addresses (email_normalized, purpose, reserved_by)
values ('ops@example.invalid', 'automated source identification', 'tester');

insert into auth.users (email) values ('ops@example.invalid');`,
  },
  {
    group: 'reserved-addresses',
    name: 'an ordinary address is still allowlistable',
    expect: 'ok',
    sql: `
insert into reserved_service_addresses (email_normalized, purpose, reserved_by)
values ('ops@example.invalid', 'automated source identification', 'tester');

insert into auth_invite_allowlist (email_normalized, email_as_entered, invited_by)
values ('person@example.invalid', 'person@example.invalid', 'tester');

insert into auth.users (email) values ('person@example.invalid');`,
  },
  {
    group: 'reserved-addresses',
    name: 'authenticated cannot read the reserved-address table',
    expect: 'permission denied',
    sql: `
set local role authenticated;
select count(*) from reserved_service_addresses;`,
  },

  // ---- Evidence session guard (0018). ------------------------------------
  // The evidence proxy's immediate revocation depends entirely on this
  // function. `app/src/test/sessionRevocation.test.ts` models it in memory and
  // proves the TypeScript side; these cases hold the SQL to the same statements
  // against real PostgreSQL.
  //
  // A helper sets up one signed-in, allowlisted user per case. Cases then remove
  // exactly one of the four preconditions and assert the answer flips.
  // ---- Administrator pre-provisioning -----------------------------------
  //
  // The second approved onboarding method: an account created by an
  // administrator through the Auth Admin API, with no password, receiving no
  // email. Its owner activates it later through "Set or reset your password".
  //
  // The point of these cases is that pre-provisioning is NOT a privileged
  // shortcut. Migration 0016's trigger fires `before insert on auth.users`, so
  // it applies to an Admin API creation exactly as it applies to an invitation,
  // and every authorization control downstream treats the two identically.
  {
    group: 'preprovisioning',
    name: 'an administrator cannot create an account for a non-allowlisted address',
    expect: 'Self-registration is disabled',
    sql: `
insert into auth.users (id, email)
values ('00000000-0000-4000-8000-0000000000b0', 'never.invited@example.invalid');`,
  },
  {
    group: 'preprovisioning',
    name: 'allowlisting first is what makes the creation possible',
    expect: 'ok',
    sql: `
insert into auth_invite_allowlist (email_normalized, email_as_entered, invited_by)
values ('preprovisioned@example.invalid', 'Preprovisioned@Example.invalid', 'administrator');

insert into auth.users (id, email)
values ('00000000-0000-4000-8000-0000000000b1', 'preprovisioned@example.invalid');`,
  },
  {
    group: 'preprovisioning',
    name: 'the allowlist comparison is case-insensitive on the normalized column',
    expect: 'ok',
    sql: `
insert into auth_invite_allowlist (email_normalized, email_as_entered, invited_by)
values ('mixed.case@example.invalid', 'Mixed.Case@Example.Invalid', 'administrator');

-- GoTrue lowercases the address it stores; the trigger lowercases what it
-- compares. A row entered in mixed case must still match.
insert into auth.users (id, email)
values ('00000000-0000-4000-8000-0000000000b2', 'mixed.case@example.invalid');`,
  },
  {
    group: 'preprovisioning',
    name: 'a pre-provisioned account with no password is still refused evidence once de-listed',
    expect: 'ok',
    sql: `
insert into auth_invite_allowlist (email_normalized, email_as_entered, invited_by)
values ('silent@example.invalid', 'silent@example.invalid', 'administrator');

-- Created as the Admin API creates one: confirmed, and with NO password.
insert into auth.users (id, email, encrypted_password)
values ('00000000-0000-4000-8000-0000000000b3', 'silent@example.invalid', null);

insert into auth.sessions (id, user_id)
values ('00000000-0000-4000-8000-0000000000b4', '00000000-0000-4000-8000-0000000000b3');

do $$
declare v boolean;
begin
    -- While allowlisted, the same rule as any other account.
    select public.authorize_evidence_access(
        '00000000-0000-4000-8000-0000000000b3',
        '00000000-0000-4000-8000-0000000000b4') into v;
    if v is not true then
        raise exception 'a pre-provisioned, allowlisted session should be authorised';
    end if;

    -- Removing the allowlist row must take effect on the next request, with no
    -- token expiry involved and no special case for how the account was made.
    delete from public.auth_invite_allowlist where email_normalized = 'silent@example.invalid';

    select public.authorize_evidence_access(
        '00000000-0000-4000-8000-0000000000b3',
        '00000000-0000-4000-8000-0000000000b4') into v;
    if v is not false then
        raise exception 'evidence access survived removal from the allowlist';
    end if;
end $$;`,
  },
  {
    group: 'preprovisioning',
    name: 'an email-less account is refused, however it is created',
    expect: 'Anonymous and email-less accounts are not permitted',
    sql: `
insert into auth.users (id, email)
values ('00000000-0000-4000-8000-0000000000b5', null);`,
  },
  {
    group: 'session-guard',
    name: 'a live, allowlisted session is authorised',
    expect: 'ok',
    sql: `
${guardFixture()}
do $$
declare v boolean;
begin
    select public.authorize_evidence_access(
        (select id from auth.users where email = 'live@example.invalid'),
        (select s.id from auth.sessions s
          join auth.users u on u.id = s.user_id
         where u.email = 'live@example.invalid')) into v;
    if v is not true then
        raise exception 'a live allowlisted session must be authorised, got %', v;
    end if;
end
$$;`,
  },
  {
    // This is the whole point of the migration: the access token is unchanged
    // and unexpired, and the answer still flips to false the moment GoTrue
    // deletes the session row.
    group: 'session-guard',
    name: 'deleting the session revokes access immediately',
    expect: 'ok',
    sql: `
${guardFixture()}
delete from auth.sessions
 where user_id = (select id from auth.users where email = 'live@example.invalid');

do $$
declare v boolean;
begin
    select public.authorize_evidence_access(
        (select id from auth.users where email = 'live@example.invalid'),
        '00000000-0000-4000-8000-0000000000aa') into v;
    if v is not false then
        raise exception 'a deleted session must not be authorised, got %', v;
    end if;
end
$$;`,
  },
  {
    group: 'session-guard',
    name: 'a session belonging to a DIFFERENT user is refused',
    expect: 'ok',
    sql: `
${guardFixture()}
insert into auth_invite_allowlist (email_normalized, email_as_entered, invited_by)
values ('other@example.invalid', 'other@example.invalid', 'tester');
insert into auth.users (id, email)
values ('00000000-0000-4000-8000-0000000000bb', 'other@example.invalid');

do $$
declare v boolean;
begin
    -- Other user's id paired with the first user's session id. Both halves
    -- exist; the pairing does not.
    select public.authorize_evidence_access(
        '00000000-0000-4000-8000-0000000000bb',
        '00000000-0000-4000-8000-0000000000aa') into v;
    if v is not false then
        raise exception 'a mismatched session/user pair must be refused, got %', v;
    end if;
end
$$;`,
  },
  {
    group: 'session-guard',
    name: 'removing the allowlist entry revokes access immediately',
    expect: 'ok',
    sql: `
${guardFixture()}
delete from auth_invite_allowlist where email_normalized = 'live@example.invalid';

do $$
declare v boolean;
begin
    select public.authorize_evidence_access(
        (select id from auth.users where email = 'live@example.invalid'),
        '00000000-0000-4000-8000-0000000000aa') into v;
    if v is not false then
        raise exception 'a de-listed user must not be authorised, got %', v;
    end if;
end
$$;`,
  },
  {
    group: 'session-guard',
    name: 'a deleted user is refused',
    expect: 'ok',
    sql: `
${guardFixture()}
delete from auth.users where email = 'live@example.invalid';

do $$
declare v boolean;
begin
    select public.authorize_evidence_access(
        '00000000-0000-4000-8000-0000000000a0',
        '00000000-0000-4000-8000-0000000000aa') into v;
    if v is not false then
        raise exception 'a deleted user must not be authorised, got %', v;
    end if;
end
$$;`,
  },
  {
    group: 'session-guard',
    name: 'null arguments are refused rather than treated as a wildcard',
    expect: 'ok',
    sql: `
do $$
declare v boolean;
begin
    if public.authorize_evidence_access(null, null) is not false
       or public.authorize_evidence_access('00000000-0000-4000-8000-0000000000a0', null) is not false
       or public.authorize_evidence_access(null, '00000000-0000-4000-8000-0000000000aa') is not false
    then
        raise exception 'null arguments must be refused';
    end if;
end
$$;`,
  },
  {
    // A browser session must not be able to call this even to probe. Learning
    // that a given session id exists is itself information about another user.
    group: 'session-guard',
    name: 'authenticated cannot execute the guard function',
    expect: 'permission denied',
    sql: `
set local role authenticated;
select public.authorize_evidence_access(
    '00000000-0000-4000-8000-0000000000a0',
    '00000000-0000-4000-8000-0000000000aa');`,
  },
  {
    group: 'session-guard',
    name: 'anon cannot execute the guard function',
    expect: 'permission denied',
    sql: `
set local role anon;
select public.authorize_evidence_access(
    '00000000-0000-4000-8000-0000000000a0',
    '00000000-0000-4000-8000-0000000000aa');`,
  },
  {
    group: 'session-guard',
    name: 'the guard returns a boolean and nothing else',
    expect: 'ok',
    sql: `
do $$
declare
    rettype text;
    definer boolean;
    cfg     text[];
begin
    select pg_catalog.format_type(p.prorettype, null), p.prosecdef, p.proconfig
      into rettype, definer, cfg
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'authorize_evidence_access';

    if rettype is null then
        raise exception 'authorize_evidence_access is not installed';
    end if;
    -- A set-returning or composite result would hand back session rows.
    if rettype <> 'boolean' then
        raise exception 'guard must return boolean, returns %', rettype;
    end if;
    if not definer then
        raise exception 'guard must be security definer, or the caller needs auth rights';
    end if;
    -- Without a pinned search_path a caller could shadow auth.sessions.
    if cfg is null or not (cfg::text like '%search_path%') then
        raise exception 'guard must pin search_path';
    end if;
end
$$;`,
  },
  {
    group: 'session-guard',
    name: 'execute is granted to service_role only',
    expect: 'ok',
    sql: `
do $$
declare
    granted text;
begin
    select string_agg(g, ', ' order by g) into granted
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace,
           lateral unnest(array['anon', 'authenticated', 'public']) as g
     where n.nspname = 'public'
       and p.proname = 'authorize_evidence_access'
       and has_function_privilege(g, p.oid, 'execute');

    if granted is not null then
        raise exception 'guard is executable by: %', granted;
    end if;

    if not exists (
        select 1 from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'authorize_evidence_access'
          and has_function_privilege('service_role', p.oid, 'execute')
    ) then
        raise exception 'service_role cannot execute the guard; the proxy would fail closed forever';
    end if;
end
$$;`,
  },

  // ---- Row-level security (0015). ---------------------------------------
  // These run as the `authenticated` role rather than inspecting catalogues,
  // because what matters is what a browser session can actually read.
  {
    group: 'rls',
    name: 'EVERY table in public has row-level security enabled',
    expect: 'ok',
    sql: `
do $$
declare
    unprotected text;
begin
    select string_agg(c.relname, ', ' order by c.relname) into unprotected
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;

    if unprotected is not null then
        raise exception 'RLS is not enabled on: %', unprotected;
    end if;
end
$$;`,
  },
  {
    group: 'rls',
    name: 'anon can read nothing at all',
    expect: 'ok',
    sql: `
do $$
declare
    leaked text;
begin
    select string_agg(distinct table_name, ', ') into leaked
    from information_schema.role_table_grants
    where table_schema = 'public' and grantee = 'anon';

    if leaked is not null then
        raise exception 'anon holds table privileges on: %', leaked;
    end if;
end
$$;`,
  },
  {
    group: 'rls',
    name: 'authenticated holds no write privilege anywhere',
    expect: 'ok',
    sql: `
do $$
declare
    writable text;
begin
    select string_agg(distinct table_name || ':' || privilege_type, ', ')
      into writable
    from information_schema.role_table_grants
    where table_schema = 'public'
      and grantee = 'authenticated'
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE');

    if writable is not null then
        raise exception 'authenticated can write: %', writable;
    end if;
end
$$;`,
  },
  {
    group: 'rls',
    name: 'an authenticated session CAN read the dashboard tables',
    expect: 'ok',
    sql: `
set local role authenticated;
select count(*) from opportunities;
select count(*) from signals;
select count(*) from evidence;
select count(*) from sources;
select count(*) from source_runs;
select count(*) from organizations;
select count(*) from facilities;
select count(*) from account_source_expectations;`,
  },
  {
    group: 'rls',
    name: 'an authenticated session CANNOT read the licence gate',
    expect: 'permission denied',
    sql: `
set local role authenticated;
select count(*) from licence_authorizations;`,
  },
  {
    group: 'rls',
    name: 'an authenticated session CANNOT read engagement observations',
    expect: 'permission denied',
    sql: `
set local role authenticated;
select count(*) from engagement_observations;`,
  },
  {
    group: 'rls',
    name: 'an authenticated session CANNOT read the audit trail',
    expect: 'permission denied',
    sql: `
set local role authenticated;
select count(*) from audit_events;`,
  },
  {
    group: 'rls',
    name: 'an authenticated session CANNOT read research staging',
    expect: 'permission denied',
    sql: `
set local role authenticated;
select count(*) from research_claims;`,
  },
  {
    group: 'rls',
    name: 'an authenticated session CANNOT read the model replay cache',
    expect: 'permission denied',
    sql: `
set local role authenticated;
select count(*) from model_replay_cache;`,
  },
  {
    // Preserved content lives in a private bucket. Handing the browser the path
    // and relying on it not to ask is not a control.
    group: 'rls',
    name: 'an authenticated session CANNOT read preserved evidence body text',
    expect: 'permission denied',
    sql: `
set local role authenticated;
select body_text from evidence limit 1;`,
  },
  {
    group: 'rls',
    name: 'an authenticated session CANNOT read the evidence storage path',
    expect: 'permission denied',
    sql: `
set local role authenticated;
select raw_storage_uri from evidence limit 1;`,
  },
  {
    group: 'rls',
    name: 'an authenticated session CANNOT read the D14-L account-strategy score',
    expect: 'permission denied',
    sql: `
set local role authenticated;
select account_strategy from opportunities limit 1;`,
  },
  {
    group: 'rls',
    name: 'an authenticated session CANNOT read the D14-L segment tier',
    expect: 'permission denied',
    sql: `
set local role authenticated;
select target_tier from organizations limit 1;`,
  },
  {
    group: 'rls',
    name: 'an authenticated session CAN read cohort membership',
    expect: 'ok',
    sql: `
set local role authenticated;
select highest_value, canonical_name, scope_class from organizations limit 1;`,
  },
  {
    group: 'rls',
    name: 'an authenticated session CANNOT write, even to a table it can read',
    expect: 'permission denied',
    sql: `
set local role authenticated;
insert into organizations (canonical_name, organization_role)
values ('Example Injected', 'manufacturer_brand');`,
  },
  {
    // auth.uid() is null in the test shim, which is what an unauthenticated
    // request looks like. The per-user policies must match nothing.
    group: 'rls',
    name: 'per-user rows are invisible when there is no authenticated subject',
    expect: 'ok',
    sql: `
insert into user_read_state (user_id, surface, last_seen_at)
values ('someone-else', 'pulse', now());

set local role authenticated;
do $$
declare n int;
begin
    select count(*) into n from user_read_state;
    if n <> 0 then
        raise exception 'a null subject matched % per-user row(s)', n;
    end if;
end
$$;`,
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
