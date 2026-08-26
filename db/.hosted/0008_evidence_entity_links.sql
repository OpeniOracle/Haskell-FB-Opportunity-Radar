-- 0008  §7 step 7 — evidence entity links
--
-- Placed here because it needs both sides: evidence (0004) and the resolved
-- organization/facility identity model (0005–0007).
--
-- The v0.1 baseline table records a resolution confidence but not what produced
-- it, and allows the same evidence to be linked to the same entity in the same
-- role an unlimited number of times. Both are fixed here.
--
-- `resolution_method` already exists and stays free text: the set of resolvers
-- will change, and pinning it in a CHECK would make adding one a migration
-- (ADR 0008).

alter table evidence_entity_links
    add column if not exists facility_candidate_id uuid references facility_candidates(id) on delete cascade,
    add column if not exists as_of_date date,
    add column if not exists basis text not null default 'stated',
    add column if not exists inference_note text,
    add column if not exists resolved_by text,
    add column if not exists resolved_at timestamptz,
    add column if not exists transformation_version text;

alter table evidence_entity_links
    add constraint evidence_entity_links_basis_check
        check (basis in ('stated', 'inferred', 'unknown')),
    -- Same rule as evidence itself: a link the platform WORKED OUT has to say
    -- how. An unexplained inference is indistinguishable from a source fact.
    add constraint evidence_entity_links_inference_has_note
        check (basis <> 'inferred'
               or (inference_note is not null and length(trim(inference_note)) > 0));

-- A link to a candidate is a link to something not yet confirmed to exist, so it
-- satisfies the "at least one side" rule on its own. The baseline check was
-- anonymous, so it is located by definition rather than by a guessed name.
do $$
declare
    conname_found text;
begin
    select c.conname into conname_found
    from pg_constraint c
    where c.conrelid = 'evidence_entity_links'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) like '%organization_id IS NOT NULL%'
      and pg_get_constraintdef(c.oid) like '%facility_id IS NOT NULL%'
    limit 1;

    if conname_found is not null then
        execute format('alter table evidence_entity_links drop constraint %I', conname_found);
    end if;
end
$$;

alter table evidence_entity_links
    add constraint evidence_entity_links_has_a_subject
        check (organization_id is not null
               or facility_id is not null
               or facility_candidate_id is not null);

create unique index if not exists evidence_entity_links_unique_org
    on evidence_entity_links (evidence_id, organization_id, relationship)
    where organization_id is not null;
create unique index if not exists evidence_entity_links_unique_facility
    on evidence_entity_links (evidence_id, facility_id, relationship)
    where facility_id is not null;
create index if not exists evidence_entity_links_candidate_idx
    on evidence_entity_links (facility_candidate_id)
    where facility_candidate_id is not null;
