-- 0011  §7 step 10 — expected coverage, so health is not mistaken for coverage
--
-- C23. Every configured source can be green while an account is effectively
-- unmonitored, because the sources that would carry its signals were never
-- built. "All sources healthy" answers a question nobody asked.
--
-- This table gives coverage a DENOMINATOR: what we expected to see for this
-- account, from which source family, and whether silence there is a gap or the
-- correct answer.
--
-- 'not_applicable' is the value that earns the table its place. Two worked
-- examples from the pilot coverage matrix:
--   * Food-enforcement feeds for adjacent consumer-products accounts: those
--     sources were never going to fire, and the account must not be penalised.
--   * Periodic-filing feeds for privately held accounts: no filings exist, so
--     coverage has to come from newsrooms, incentives and permits instead.
--
-- D17 (health vs coverage separation) is OPEN and ADR 0010 is Proposed. This
-- migration therefore records the expectation and NOTHING ELSE: no threshold, no
-- score, no automated alarm. It is the input a coverage decision will need, not
-- the decision.

create table account_source_expectations (
    id                  uuid primary key default gen_random_uuid(),
    organization_id     uuid not null references organizations(id) on delete cascade,
    source_family       text not null,
    expectation         text not null,
    rationale           text not null,
    expected_cadence_hours integer,
    reviewed_at         timestamptz,
    reviewed_by         text,
    created_at          timestamptz not null default now(),
    unique (organization_id, source_family),

    constraint account_source_expectations_expectation_check
        check (expectation in (
            'required',        -- coverage gap if absent or unhealthy
            'expected',        -- counts toward completeness
            'optional',        -- neither counted nor penalised
            'not_applicable'   -- silence here is CORRECT; do not alarm
        )),
    -- An expectation with no rationale cannot be reviewed, and an unreviewable
    -- expectation becomes permanent by default.
    constraint account_source_expectations_rationale_present
        check (length(trim(rationale)) > 0),
    constraint account_source_expectations_cadence_positive
        check (expected_cadence_hours is null or expected_cadence_hours > 0)
);
comment on table account_source_expectations is
    'The denominator for coverage (C23). Seeded from the pilot source coverage matrix as a data operation, not by this migration.';

create index on account_source_expectations (source_family, expectation);
create index on account_source_expectations (organization_id);

-- E5  Sources evaluated and found permanently unavailable, recorded so a future
--     implementer does not rediscover the same dead end and spend the same week
--     on it.
create table unavailable_sources (
    id                      text primary key,
    name                    text not null,
    reason                  text not null,
    authority_citation      text,
    evaluated_at            date not null,
    substitute_source_id    text references sources(id),
    notes                   text,
    created_at              timestamptz not null default now(),
    constraint unavailable_sources_reason_check
        check (reason in ('statutorily_nonpublic', 'license_prohibits',
                          'tos_prohibits', 'no_machine_access',
                          'superseded_by_other_source')),
    -- A statutory exclusion has to cite the statute, or the next reviewer has to
    -- redo the legal research to find out whether it is still true.
    constraint unavailable_sources_statute_is_cited
        check (reason <> 'statutorily_nonpublic'
               or (authority_citation is not null
                   and length(trim(authority_citation)) > 0))
);
