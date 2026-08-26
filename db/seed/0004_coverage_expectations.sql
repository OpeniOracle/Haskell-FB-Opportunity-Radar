-- Seed: expected coverage per account (C23).
--
-- This is the DENOMINATOR. Without it, "all sources healthy" answers a question
-- nobody asked: every configured source can be green while an account is
-- effectively unmonitored, because the sources that would carry its signals were
-- never built.
--
-- `not_applicable` is the value that earns this table its place. Two cases from
-- the coverage matrix, seeded literally:
--
--   * Food-inspection coverage for the two adjacent consumer-products accounts
--     and the coatings account. Those sources were never going to fire, and the
--     accounts must not be scored as under-covered for silence that is correct.
--
--   * Periodic-filing coverage for the two private accounts, and for the one
--     account whose verified CIK is historical with no current periodic filings.
--     Coverage there has to come from newsrooms, incentives and permits.
--
-- No threshold and no alarm is encoded. D17 is Open and ADR 0010 is Proposed, so
-- this records the expectation and nothing else.

-- SEC EDGAR: required where the registrant files operational periodic reports.
insert into account_source_expectations (organization_id, source_family, expectation, rationale)
select o.id, 'sec_edgar', 'required',
       'Operational periodic filer. Capex discussion, segment capacity commentary and restructuring appear here first.'
from organizations o
where o.entity_key in (
    'sec:0000077476', 'sec:0000021344', 'sec:0000056873', 'sec:0000100493',
    'sec:0000047111', 'sec:0000055785', 'sec:0000217410', 'sec:0000080424',
    'sec:0000089800', 'sec:0000031462', 'sec:0001418135'
)
on conflict (organization_id, source_family) do update set
    expectation = excluded.expectation, rationale = excluded.rationale;

-- Ownership-only: the identity is verified but there is no operational periodic
-- coverage, so a filing is a bonus rather than an expectation.
insert into account_source_expectations (organization_id, source_family, expectation, rationale)
select o.id, 'sec_edgar', 'optional',
       'Ownership-only SEC coverage: identity is verified but no operational periodic filings exist. Plant activity comes from subsidiary newsrooms.'
from organizations o
where o.entity_key = 'sec:0000792990'
on conflict (organization_id, source_family) do update set
    expectation = excluded.expectation, rationale = excluded.rationale;

insert into account_source_expectations (organization_id, source_family, expectation, rationale)
select o.id, 'sec_edgar', 'not_applicable',
       'No current periodic filings. The verified CIK is historical, so silence here is correct and must not be counted as a coverage gap.'
from organizations o
where o.entity_key = 'sec:0001048515'
on conflict (organization_id, source_family) do update set
    expectation = excluded.expectation, rationale = excluded.rationale;

insert into account_source_expectations (organization_id, source_family, expectation, rationale)
select o.id, 'sec_edgar', 'not_applicable',
       'Private company with no SEC registration. Coverage must come from state incentives, local permits and newsroom instead.'
from organizations o
where o.entity_key in ('radar:mars-incorporated', 'radar:niagara-bottling')
on conflict (organization_id, source_family) do update set
    expectation = excluded.expectation, rationale = excluded.rationale;

-- The company newsroom is expected for every account. It is the only source
-- every one of the fifteen has, private and public alike.
insert into account_source_expectations (organization_id, source_family, expectation, rationale)
select o.id, 'company_newsroom', 'required',
       'The only source common to every pilot account. Plant projects usually surface here or in regional press before they reach a filing.'
from organizations o
where o.highest_value
on conflict (organization_id, source_family) do update set
    expectation = excluded.expectation, rationale = excluded.rationale;

-- FSIS meat and poultry inspection: meaningful only for the protein account.
insert into account_source_expectations (organization_id, source_family, expectation, rationale)
select o.id, 'fsis_mpi', 'required',
       'Federally inspected meat and poultry establishments. Establishment-level presence and change is directly observable here.'
from organizations o
where o.entity_key = 'sec:0000100493'
on conflict (organization_id, source_family) do update set
    expectation = excluded.expectation, rationale = excluded.rationale;

insert into account_source_expectations (organization_id, source_family, expectation, rationale)
select o.id, 'fsis_mpi', 'not_applicable',
       'Not a federally inspected meat or poultry operator. Silence from this source is correct, and the account must not be penalised for a source that was never going to fire.'
from organizations o
where o.highest_value
  and o.entity_key <> 'sec:0000100493'
on conflict (organization_id, source_family) do update set
    expectation = excluded.expectation, rationale = excluded.rationale;

-- Food-safety enforcement: not applicable to the non-food accounts.
insert into account_source_expectations (organization_id, source_family, expectation, rationale)
select o.id, 'food_enforcement', 'not_applicable',
       'Adjacent or non-F&B account. A food-enforcement source was never going to fire for it, so its silence is correct rather than a gap.'
from organizations o
where o.scope_class in ('fnb_adjacent', 'non_fnb')
on conflict (organization_id, source_family) do update set
    expectation = excluded.expectation, rationale = excluded.rationale;

insert into account_source_expectations (organization_id, source_family, expectation, rationale)
select o.id, 'food_enforcement', 'expected',
       'F&B manufacturer. Recall and enforcement activity is a genuine negative-signal source for this account.'
from organizations o
where o.scope_class = 'fnb_core' and o.highest_value
on conflict (organization_id, source_family) do update set
    expectation = excluded.expectation, rationale = excluded.rationale;
