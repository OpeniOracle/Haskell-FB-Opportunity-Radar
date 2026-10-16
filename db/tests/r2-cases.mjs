/**
 * Schema-contract cases for the R2 schema foundation (migrations 0025 - 0030).
 *
 * Same rules as db/test.mjs, which imports this list: every case runs in its own
 * transaction on the structural fixtures and is always rolled back, and a
 * negative case must be refused BY THE CONSTRAINT IT NAMES. A case that passes
 * because of an unrelated typo is not a test, so every statement below satisfies
 * every OTHER constraint on its table and fails on exactly one.
 *
 * Every value is synthetic. There are no real organizations, sources or
 * identifiers here.
 */

const ORG_A = "'00000000-0000-4000-8000-000000000010'"
const FAC = "'00000000-0000-4000-8000-000000000020'"
const EV = "'00000000-0000-4000-8000-000000000030'"
const RUN = "'00000000-0000-4000-8000-000000000001'"

/* ----------------------------------------------------------------- builders */

/** A minimal opportunity. `status` defaults to `new`; extras override or add. */
const opportunity = (cols = '', vals = '') => `
insert into opportunities (organization_id, title, stage, confidence, capability_alignment${cols})
values (${ORG_A}, 'Case', 'emerging', 'possible', '{}'${vals});`

const source = (id, cols = '', vals = '') => `
insert into sources (id, name, source_type, collection_method, base_url, allowed_domains,
                     schedule, freshness_sla_hours${cols})
values ('${id}', 'Case source', 'test', 'test', 'https://example.invalid/',
        array['example.invalid'], 'manual', 24${vals});`

const signal = (cols = '', vals = '') => `
insert into signals (organization_id, title, summary, signal_family, event_type,
                     first_observed_at, last_observed_at, confidence${cols})
values (${ORG_A}, 'Case', 'Case', 'facility_capacity', 'capacity_expansion',
        now(), now(), 'possible'${vals});`

const identifier = (system, value) => `
insert into facility_identifiers (facility_id, identifier_system, identifier_value)
values (${FAC}, '${system}', '${value}');`

const task = (cols = '', vals = '', key = 'doc-1') => `
insert into ingestion_tasks (source_run_id, task_key${cols})
values (${RUN}, '${key}'${vals});`

const fingerprint = (value, cols = '', vals = '') => `
insert into evidence_text_fingerprints (organization_id, source_id, fingerprint${cols})
values (${ORG_A}, 'test-source', '${value}'${vals});`

const HEX = 'ab'.repeat(32)

/** Runs `body` as the browser's role and requires a privilege failure. */
const asBrowser = (body) => `set local role authenticated;\n${body}`

/** A DO block that fails with `message` unless `condition` holds. */
const assertThat = (condition, message) => `
do $$
begin
    if not (${condition}) then
        raise exception '${message}';
    end if;
end
$$;`

/** @type {{group: string, name: string, expect: string, sql: string}[]} */
export const R2_CASES = []
const add = (group, name, expect, sql) => R2_CASES.push({ group, name, expect, sql })

/* ============================================================ 0025 opportunities */

const G1 = 'r2 opportunities'

add(G1, 'a new opportunity is unreviewed, of unknown lifecycle and not assessed, by default', 'ok', `
${opportunity()}
${assertThat(
  `(select review_state = 'unreviewed' and project_lifecycle = 'unknown'
          and commercial_qualification = 'not_assessed'
     from opportunities where title = 'Case')`,
  'the defaults assert something',
)}`)

add(G1, 'a pipeline-style derived insert, naming none of the new columns, stays unreviewed and not assessed', 'ok', `
${opportunity(', derived_by, derived_at, opportunity_key', ", 'connector:test', now(), 'k-1'")}
${assertThat(
  `(select review_state = 'unreviewed' and commercial_qualification = 'not_assessed'
     from opportunities where opportunity_key = 'k-1')`,
  'a derived row was created as something other than unreviewed and not assessed',
)}`)

add(G1, 'an unknown review state is refused', 'opportunities_review_state_check',
  opportunity(', review_state', ", 'approved'"))
add(G1, 'an unknown project lifecycle is refused', 'opportunities_project_lifecycle_check',
  opportunity(', project_lifecycle', ", 'building'"))
// Accepted, so the OTHER rule (an assessment needs an accepted review) is met and
// only the vocabulary can refuse it. PostgreSQL does not promise which failing
// constraint it reports first.
add(G1, 'an unknown commercial qualification is refused', 'opportunities_commercial_qualification_check',
  opportunity(', review_state, commercial_qualification', ", 'accepted', 'hot'"))

for (const review of ['accepted', 'rejected', 'unreviewed']) {
  add(G1, `review state ${review} is accepted`, 'ok', opportunity(', review_state', `, '${review}'`))
}
for (const lifecycle of ['announced', 'approved', 'under_construction', 'unknown']) {
  add(G1, `lifecycle ${lifecycle} is accepted on an active opportunity`, 'ok',
    opportunity(', project_lifecycle', `, '${lifecycle}'`))
}

// An assessment needs an accepted review. Each non-default qualification is
// refused on an unreviewed row AND on a rejected one.
for (const qualification of ['no_open_work', 'open_work_unverified', 'qualified']) {
  add(G1, `${qualification} is refused on an unreviewed opportunity`,
    'opportunities_assessment_requires_review',
    opportunity(', commercial_qualification', `, '${qualification}'`))
  add(G1, `${qualification} is refused on a rejected opportunity`,
    'opportunities_assessment_requires_review',
    opportunity(', review_state, commercial_qualification', `, 'rejected', '${qualification}'`))
  add(G1, `${qualification} is accepted on an accepted opportunity`, 'ok',
    opportunity(', review_state, commercial_qualification', `, 'accepted', '${qualification}'`))
}

// An ended project is never an active opportunity.
const ACTIVE = ['new', 'watching', 'pursue', 'assigned', 'on_hold']
const TERMINAL = ['dismissed', 'closed_won', 'closed_lost', 'cancelled', 'expired']
for (const lifecycle of ['completed', 'cancelled', 'withdrawn', 'historical']) {
  for (const status of ACTIVE) {
    add(G1, `a ${lifecycle} project cannot be ${status}`, 'opportunities_ended_project_is_not_active',
      opportunity(', project_lifecycle, status', `, '${lifecycle}', '${status}'`))
  }
}
for (const status of TERMINAL) {
  add(G1, `a completed project may be ${status}, and stays searchable`, 'ok',
    opportunity(', project_lifecycle, status', `, 'completed', '${status}'`))
}
add(G1, 'an ended project cannot carry open work, even once accepted',
  'opportunities_ended_project_is_not_active',
  opportunity(', project_lifecycle, status, review_state, commercial_qualification',
    ", 'completed', 'expired', 'accepted', 'qualified'"))
add(G1, 'an ended project cannot be open_work_unverified either',
  'opportunities_ended_project_is_not_active',
  opportunity(', project_lifecycle, status, review_state, commercial_qualification',
    ", 'cancelled', 'cancelled', 'accepted', 'open_work_unverified'"))
add(G1, 'an ended project MAY be recorded as having no open work, once accepted', 'ok',
  opportunity(', project_lifecycle, status, review_state, commercial_qualification',
    ", 'completed', 'expired', 'accepted', 'no_open_work'"))
add(G1, 'a project under construction may be qualified, once accepted', 'ok',
  opportunity(', project_lifecycle, review_state, commercial_qualification',
    ", 'under_construction', 'accepted', 'qualified'"))

// The existing vocabularies are untouched.
for (const status of [...ACTIVE, ...TERMINAL]) {
  add(G1, `the existing status ${status} is still accepted`, 'ok', opportunity(', status', `, '${status}'`))
}
for (const stage of ['emerging', 'developing', 'confirmed']) {
  add(G1, `the existing stage ${stage} is still accepted`, 'ok', `
insert into opportunities (organization_id, title, stage, confidence, capability_alignment)
values (${ORG_A}, 'Case', '${stage}', 'possible', '{}');`)
}

add(G1, 'an update that changes an ended lifecycle back to an active status is refused too', 'opportunities_ended_project_is_not_active', `
${opportunity(', project_lifecycle, status', ", 'completed', 'expired'")}
update opportunities set status = 'new' where title = 'Case';`)

add(G1, 'the project_maturity SCORE is a different column, untouched', 'ok', `
${opportunity(', project_maturity', ', 12')}
${assertThat(`(select project_maturity = 12 from opportunities where title = 'Case')`, 'the score changed')}`)

/* ============================================================ 0026 sources */

const G2 = 'r2 source rights'

add(G2, 'a new source is unclassified and reference-only by default', 'ok', `
${source('r2-default')}
${assertThat(
  `(select rights_class = 'unclassified' and access_mode = 'reference_only'
     from sources where id = 'r2-default')`,
  'the defaults are not the conservative ones',
)}`)

add(G2, 'an unknown rights class is refused', 'sources_rights_class_check',
  source('r2-bad', ', rights_class', ", 'public_domain'"))

for (const cls of [
  'federal_public_record', 'state_local_public_record', 'economic_development_body',
  'corporate_first_party', 'discovery_or_republication', 'unclassified',
]) {
  add(G2, `${cls} is a recognised rights class`, 'ok', source(`r2-${cls.slice(0, 12)}`, ', rights_class', `, '${cls}'`))
}

const ARCHIVING = ['structured_primary', 'archived_full_text', 'licensed_full_text']
const NON_FEDERAL = [
  'state_local_public_record', 'economic_development_body', 'corporate_first_party',
  'discovery_or_republication', 'unclassified',
]

// D-R2: reference-only until reuse rights are established. Nothing but a federal
// record, or a source that has DECLARED an open or licensed posture, may be
// archived, parsed as an official record or held as licensed full text.
for (const cls of NON_FEDERAL) {
  for (const mode of ARCHIVING) {
    add(G2, `a ${cls} source cannot be ${mode} while its licence is unknown`,
      'sources_archive_requires_established_rights',
      source('r2-x', ', rights_class, access_mode, license_mode', `, '${cls}', '${mode}', 'unknown'`))
  }
  add(G2, `a ${cls} source cannot be archived under a restricted licence`,
    'sources_archive_requires_established_rights',
    source('r2-x', ', rights_class, access_mode, license_mode', `, '${cls}', 'archived_full_text', 'restricted'`))
  for (const mode of ['reference_only', 'metadata_only']) {
    add(G2, `a ${cls} source may be ${mode} whatever its licence`, 'ok',
      source('r2-x', ', rights_class, access_mode, license_mode', `, '${cls}', '${mode}', 'unknown'`))
  }
}
for (const licence of ['open', 'licensed']) {
  add(G2, `a state or local source MAY be archived once it declares an ${licence} posture`, 'ok',
    source('r2-x', ', rights_class, access_mode, license_mode',
      `, 'state_local_public_record', 'archived_full_text', '${licence}'`))
}
add(G2, 'a federal public record may be archived under ADR 0014 without a separate licence declaration', 'ok',
  source('r2-x', ', rights_class, access_mode, license_mode',
    ", 'federal_public_record', 'archived_full_text', 'unknown'"))
add(G2, 'a source is not made federal by being called public: an unclassified one stays reference-only', 'ok', `
${source('r2-pub', ', data_sensitivity_class', ", 'public'")}
${assertThat(`(select rights_class = 'unclassified' from sources where id = 'r2-pub')`, 'public implied federal')}`)

add(G2, 'an update that tries to archive an unclassified source is refused too',
  'sources_archive_requires_established_rights', `
${source('r2-upd')}
update sources set access_mode = 'archived_full_text' where id = 'r2-upd';`)

add(G2, 'the existing access-mode and licence vocabularies are untouched', 'ok', `
${source('r2-am', ', access_mode, license_mode', ", 'archived_full_text', 'open'")}
${source('r2-am2', ', access_mode, license_mode', ", 'licensed_full_text', 'licensed'")}`)

/* ============================================================ 0027 signals */

const G3 = 'r2 signal dates'

add(G3, 'a signal has no event date role by default: NULL means not recorded', 'ok', `
${signal()}
${assertThat(`(select event_date_role is null from signals where title = 'Case')`, 'a role was invented')}`)

add(G3, 'an existing-style dated signal with no role is still accepted', 'ok',
  signal(', event_date, event_date_precision', ", '2027-03-01', 'exact_day'"))

add(G3, 'an unknown role is refused', 'signals_event_date_role_check',
  signal(', event_date, event_date_precision, event_date_role', ", '2027-03-01', 'exact_day', 'rumour'"))

for (const role of ['announcement', 'milestone', 'decision', 'effective']) {
  add(G3, `${role} is accepted with a date`, 'ok',
    signal(', event_date, event_date_precision, event_date_role', `, '2027-03-01', 'exact_day', '${role}'`))
  add(G3, `${role} is refused with no date: a role describes a date`, 'signals_event_date_role_matches_date',
    signal(', event_date_role', `, '${role}'`))
}
add(G3, 'a forecast is accepted with NO event date: its interval lives in the evidence', 'ok',
  signal(', event_date_role', ", 'forecast'"))
add(G3, 'a forecast is refused WITH an event date (ADR 0004: a prediction is not a fact)',
  'signals_event_date_role_matches_date',
  signal(', event_date, event_date_precision, event_date_role', ", '2027-12-31', 'quarter', 'forecast'"))
add(G3, 'the existing precision and basis rules still apply beside a role', 'signals_event_date_requires_precision',
  signal(', event_date, event_date_role', ", '2027-03-01', 'announcement'"))
add(G3, 'a signal row is readable by a signed-in session, new column included', 'ok', `
${signal()}
${asBrowser('select id, event_date, event_date_role from signals;')}`)

/* ========================================================== 0028 identifiers */

const G4 = 'r2 facility identifiers'

for (const system of ['fsis_establishment_number', 'fsis_establishment_id', 'frs_registry_id', 'npdes_permit_id']) {
  add(G4, `${system} is a recognised identifier system`, 'ok', identifier(system, 'TEST-0001'))
}
for (const bad of ['FSIS', 'fsis', 'fsis_est', 'FRS_REGISTRY_ID', 'npdes', 'rcra_id', '']) {
  add(G4, `the identifier system ${JSON.stringify(bad)} is refused`, 'facility_identifiers_system_check',
    identifier(bad, 'TEST-0001'))
}
add(G4, 'an empty identifier value is refused', 'facility_identifiers_value_is_clean',
  identifier('frs_registry_id', ''))
add(G4, 'a value with trailing whitespace is refused: it would fork the unique key', 'facility_identifiers_value_is_clean',
  identifier('frs_registry_id', '110000123456 '))
add(G4, 'a value with leading whitespace is refused', 'facility_identifiers_value_is_clean',
  identifier('frs_registry_id', ' 110000123456'))
add(G4, 'the same (system, value) is still unique', 'facility_identifiers_identifier_system_identifier_value_key', `
${identifier('frs_registry_id', 'TEST-0002')}
${identifier('frs_registry_id', 'TEST-0002')}`)
add(G4, 'the same value under two systems is two identifiers', 'ok', `
${identifier('frs_registry_id', 'TEST-0003')}
${identifier('npdes_permit_id', 'TEST-0003')}`)

/* ============================================================ 0029 task queue */

const G5 = 'r2 task queue'

add(G5, 'a new task is pending, unclaimed, with no attempts', 'ok', `
${task()}
${assertThat(
  `(select status = 'pending' and attempt = 0 and claimed_by is null and claimed_at is null
          and last_heartbeat_at is null and completed_at is null
     from ingestion_tasks where task_key = 'doc-1')`,
  'a new task is not pending and unclaimed',
)}`)

add(G5, 'an unknown status is refused', 'ingestion_tasks_status_check', task(', status', ", 'abandoned'"))
add(G5, 'the run-level statuses partial_success and unchanged are not task statuses', 'ingestion_tasks_status_check',
  task(', status, completed_at', ", 'partial_success', now()"))
add(G5, 'a blank task key is refused', 'ingestion_tasks_key_present', task('', '', '   '))
add(G5, 'a negative attempt count is refused', 'ingestion_tasks_attempt_non_negative', task(', attempt', ', -1'))
add(G5, 'a running task must name who holds it and when it last heartbeat', 'ingestion_tasks_running_is_claimed',
  task(', status', ", 'running'"))
add(G5, 'a running task with an owner but no heartbeat is refused', 'ingestion_tasks_running_is_claimed',
  task(', status, claimed_by, claimed_at', ", 'running', 'worker-1', now()"))
add(G5, 'a pending task cannot still carry an owner: a half-released claim', 'ingestion_tasks_pending_is_unclaimed',
  task(', claimed_by', ", 'worker-1'"))
add(G5, 'a heartbeat cannot predate the claim', 'ingestion_tasks_heartbeat_follows_claim', task(
  ', status, claimed_by, claimed_at, last_heartbeat_at',
  ", 'running', 'worker-1', now(), now() - interval '1 hour'"))
for (const status of ['success', 'skipped']) {
  add(G5, `a ${status} task must say when it finished`, 'ingestion_tasks_terminal_is_completed',
    task(', status', `, '${status}'`))
}
add(G5, 'a failed task must say when it finished', 'ingestion_tasks_terminal_is_completed',
  task(', status, error_class', ", 'failure', 'timeout'"))
add(G5, 'an unfinished task cannot carry a completion time', 'ingestion_tasks_terminal_is_completed',
  task(', completed_at', ', now()'))
add(G5, 'a failure must name an error class, as a failed attempt must', 'ingestion_tasks_failure_has_class',
  task(', status, completed_at', ", 'failure', now()"))
add(G5, 'enqueueing the same unit twice in one run is one row', 'ingestion_tasks_run_key_unique', `
${task()}
${task()}`)
add(G5, 'the same key in two runs is two tasks', 'ok', `
insert into source_runs (id, source_id, status)
    values ('00000000-0000-4000-8000-000000000002', 'test-source', 'success');
${task()}
insert into ingestion_tasks (source_run_id, task_key)
values ('00000000-0000-4000-8000-000000000002', 'doc-1');`)

add(G5, 'the whole life of a task is expressible: claim, heartbeat, retry, claim, finish', 'ok', `
${task()}
update ingestion_tasks set status = 'running', claimed_by = 'worker-1', claimed_at = now(),
       last_heartbeat_at = now(), attempt = attempt + 1 where task_key = 'doc-1';
update ingestion_tasks set last_heartbeat_at = now() where task_key = 'doc-1';
update ingestion_tasks set status = 'pending', claimed_by = null, claimed_at = null,
       last_heartbeat_at = null, retry_after = now() + interval '5 minutes' where task_key = 'doc-1';
update ingestion_tasks set status = 'running', claimed_by = 'worker-2', claimed_at = now(),
       last_heartbeat_at = now(), attempt = attempt + 1 where task_key = 'doc-1';
update ingestion_tasks set status = 'success', completed_at = now() where task_key = 'doc-1';
${assertThat(
  `(select status = 'success' and attempt = 2 and claimed_by = 'worker-2' from ingestion_tasks where task_key = 'doc-1')`,
  'the lifecycle did not end where it should',
)}`)

add(G5, 'of two workers racing for one task, exactly one claim succeeds', 'ok', `
${task()}
do $$
declare
    first_claim integer;
    second_claim integer;
begin
    update ingestion_tasks
       set status = 'running', claimed_by = 'worker-1', claimed_at = now(),
           last_heartbeat_at = now(), attempt = attempt + 1
     where task_key = 'doc-1' and status = 'pending'
       and (retry_after is null or retry_after <= now());
    get diagnostics first_claim = row_count;

    update ingestion_tasks
       set status = 'running', claimed_by = 'worker-2', claimed_at = now(),
           last_heartbeat_at = now(), attempt = attempt + 1
     where task_key = 'doc-1' and status = 'pending'
       and (retry_after is null or retry_after <= now());
    get diagnostics second_claim = row_count;

    if first_claim <> 1 or second_claim <> 0 then
        raise exception 'claims were % and %, expected 1 and 0', first_claim, second_claim;
    end if;
end
$$;`)

add(G5, 'a task whose retry time has not arrived cannot be claimed', 'ok', `
${task(', retry_after', ", now() + interval '1 hour'")}
do $$
declare
    claimed integer;
begin
    update ingestion_tasks set status = 'running', claimed_by = 'w', claimed_at = now(),
           last_heartbeat_at = now()
     where task_key = 'doc-1' and status = 'pending'
       and (retry_after is null or retry_after <= now());
    get diagnostics claimed = row_count;
    if claimed <> 0 then
        raise exception 'a task still backing off was claimed';
    end if;
end
$$;`)

add(G5, 'a running task whose heartbeat has gone stale is found by the lease query', 'ok', `
${task(
  ', status, claimed_by, claimed_at, last_heartbeat_at',
  ", 'running', 'worker-1', now() - interval '2 hours', now() - interval '1 hour'",
)}
${assertThat(
  `(select count(*) = 1 from ingestion_tasks
     where status = 'running' and last_heartbeat_at < now() - interval '15 minutes')`,
  'a stale lease was not found',
)}`)

add(G5, 'deleting a run takes its tasks with it', 'ok', `
insert into source_runs (id, source_id, status)
    values ('00000000-0000-4000-8000-000000000003', 'test-source', 'success');
insert into ingestion_tasks (source_run_id, task_key)
values ('00000000-0000-4000-8000-000000000003', 'doc-1');
delete from source_runs where id = '00000000-0000-4000-8000-000000000003';
${assertThat(
  `(select count(*) = 0 from ingestion_tasks where source_run_id = '00000000-0000-4000-8000-000000000003')`,
  'a task outlived its run',
)}`)

add(G5, 'the claim and stale-lease indexes are partial, so they stay the size of the backlog', 'ok', `
${assertThat(
  `(select count(*) = 2 from pg_indexes
     where tablename = 'ingestion_tasks'
       and ((indexname = 'ingestion_tasks_claimable_idx' and indexdef like '%WHERE (status = ''pending''::text)%')
         or (indexname = 'ingestion_tasks_stale_idx' and indexdef like '%WHERE (status = ''running''::text)%')))`,
  'the partial indexes are missing or no longer partial',
)}`)

add(G5, 'a signed-in session cannot read the queue', 'permission denied',
  asBrowser('select count(*) from ingestion_tasks;'))
add(G5, 'a signed-in session cannot write to the queue', 'permission denied',
  asBrowser("insert into ingestion_tasks (source_run_id, task_key) values (gen_random_uuid(), 'x');"))
add(G5, 'an anonymous session cannot read the queue', 'permission denied',
  'set local role anon;\nselect count(*) from ingestion_tasks;')
add(G5, 'row-level security is enabled AND forced on the queue, with no policy', 'ok', assertThat(
  `(select relrowsecurity and relforcerowsecurity from pg_class where relname = 'ingestion_tasks')
   and not exists (select 1 from pg_policies where tablename = 'ingestion_tasks')`,
  'the queue is not locked down',
))

/* ================================================== 0030 text fingerprints */

const G6 = 'r2 fingerprints'

add(G6, 'a SHA-256 hex fingerprint is accepted, naming the evidence it first appeared in', 'ok',
  fingerprint(HEX, ', first_evidence_id', `, ${EV}`))
add(G6, 'the first sighting need not name evidence', 'ok', fingerprint(HEX))
for (const [label, value] of [
  ['upper-case hex', 'AB'.repeat(32)],
  ['too short', 'ab'.repeat(31)],
  ['not hex', 'zz'.repeat(32)],
]) {
  add(G6, `a fingerprint that is ${label} is refused`, 'evidence_text_fingerprints_is_sha256_hex', fingerprint(value))
}
// char(64) refuses an over-long value itself, before any check runs.
add(G6, 'a fingerprint that is too long is refused by the column type', 'value too long for type character(64)',
  fingerprint('ab'.repeat(33)))
add(G6, 'the same sentence from the same filer through the same source is one row',
  'evidence_text_fingerprints_pkey', `
${fingerprint(HEX)}
${fingerprint(HEX)}`)
add(G6, 'the same sentence from another source is another row', 'ok', `
${source('r2-other')}
${fingerprint(HEX)}
insert into evidence_text_fingerprints (organization_id, source_id, fingerprint)
values (${ORG_A}, 'r2-other', '${HEX}');`)
add(G6, 'deleting the evidence keeps the fingerprint and clears the pointer', 'ok', `
${fingerprint(HEX, ', first_evidence_id', `, ${EV}`)}
delete from evidence where id = ${EV};
${assertThat(
  `(select count(*) = 1 and bool_and(first_evidence_id is null) from evidence_text_fingerprints)`,
  'the fingerprint did not survive its evidence, or still points at it',
)}`)
add(G6, 'deleting the organization removes its fingerprints', 'ok', `
insert into organizations (id, canonical_name, organization_role)
    values ('00000000-0000-4000-8000-0000000000f1', 'Example Delta Foods', 'manufacturer_brand');
insert into evidence_text_fingerprints (organization_id, source_id, fingerprint)
values ('00000000-0000-4000-8000-0000000000f1', 'test-source', '${HEX}');
delete from organizations where id = '00000000-0000-4000-8000-0000000000f1';
${assertThat(
  `(select count(*) = 0 from evidence_text_fingerprints where organization_id = '00000000-0000-4000-8000-0000000000f1')`,
  'a fingerprint outlived its organization',
)}`)
add(G6, 'a signed-in session cannot read the fingerprints', 'permission denied',
  asBrowser('select count(*) from evidence_text_fingerprints;'))
add(G6, 'a signed-in session cannot write a fingerprint', 'permission denied',
  asBrowser(`insert into evidence_text_fingerprints (organization_id, source_id, fingerprint) values (gen_random_uuid(), 'test-source', '${HEX}');`))
add(G6, 'row-level security is enabled AND forced on the fingerprints, with no policy', 'ok', assertThat(
  `(select relrowsecurity and relforcerowsecurity from pg_class where relname = 'evidence_text_fingerprints')
   and not exists (select 1 from pg_policies where tablename = 'evidence_text_fingerprints')`,
  'the fingerprints are not locked down',
))

/* ===================================== the browser, column by column (0025, 0026) */

const G7 = 'r2 browser grants'

add(G7, 'a signed-in session can read the three new opportunity columns', 'ok', `
${opportunity()}
${asBrowser('select id, review_state, project_lifecycle, commercial_qualification from opportunities;')}`)
add(G7, 'a signed-in session can read sources.rights_class', 'ok', `
${source('r2-g')}
${asBrowser('select id, rights_class from sources;')}`)
for (const column of ['derived_by', 'derived_at', 'opportunity_key', 'account_strategy']) {
  add(G7, `opportunities.${column} is STILL withheld from the browser`, 'permission denied',
    asBrowser(`select ${column} from opportunities;`))
}
for (const column of ['connector_config', 'connector_id', 'query_scope', 'extraction_config', 'retry_policy']) {
  add(G7, `sources.${column} is STILL withheld from the browser`, 'permission denied',
    asBrowser(`select ${column} from sources;`))
}
for (const column of ['body_text', 'archive_uri', 'raw_storage_uri', 'extracted_text_uri']) {
  add(G7, `evidence.${column} is STILL withheld from the browser`, 'permission denied',
    asBrowser(`select ${column} from evidence;`))
}
add(G7, 'the browser holds no write privilege on any table this foundation touched or created', 'ok', assertThat(
  `not exists (
     select 1 from information_schema.role_table_grants
      where grantee in ('anon', 'authenticated')
        and table_name in ('opportunities', 'sources', 'signals', 'facility_identifiers',
                           'ingestion_tasks', 'evidence_text_fingerprints')
        and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'))
   and not exists (
     select 1 from information_schema.column_privileges
      where grantee in ('anon', 'authenticated')
        and table_name in ('opportunities', 'sources')
        and privilege_type in ('INSERT', 'UPDATE'))`,
  'a browser role can write',
))
add(G7, 'the new columns are granted to the browser and to nobody else', 'ok', assertThat(
  `(select count(*) = 4 from information_schema.column_privileges
     where grantee = 'authenticated' and privilege_type = 'SELECT'
       and ((table_name = 'opportunities'
             and column_name in ('review_state', 'project_lifecycle', 'commercial_qualification'))
         or (table_name = 'sources' and column_name = 'rights_class')))
   and not exists (select 1 from information_schema.column_privileges
     where grantee = 'anon'
       and column_name in ('review_state', 'project_lifecycle', 'commercial_qualification', 'rights_class'))`,
  'the grants are not exactly the four columns for authenticated alone',
))
