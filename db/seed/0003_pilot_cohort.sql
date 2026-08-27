-- Seed: the 15 Highest Value pilot accounts.
--
-- SOURCE OF THESE IDENTITIES. `docs/design/05_IMPLEMENTATION_ROADMAP.md`, each
-- one independently verified in `docs/design/12_PILOT_SOURCE_COVERAGE_MATRIX.md`
-- against an SEC-controlled URL or accession number where one exists. They come
-- from the approved public-research package and require neither attendance
-- workbook.
--
-- WHAT IS DELIBERATELY ABSENT. No `target_tier`, no engagement, no
-- account-strategy score. Those are D14-L blocked, the schema will not accept
-- them without a licence authorization, and none exists. `highest_value` marks
-- cohort membership and comes from the public-research package, not the workbook.
--
-- `scope_class_status` is 'provisional' for all fifteen. D11 is approved
-- PROVISIONALLY: every classification made before F&B market-leader confirmation
-- is provisional, and pilot relevance metrics must be able to exclude them
-- because their classification changes the relevance denominator.
--
-- `entity_key` is identifier-derived — `sec:<CIK>` where the registrant is
-- verified, `radar:<slug>` for the two private companies with no CIK. That is
-- the C12 correction working as intended: identity comes from an identifier, not
-- from a name string.
--
-- Idempotent. Re-running updates the row rather than failing or duplicating it,
-- so this is safe to apply to a database that already has it.

insert into organizations (
    canonical_name, legal_name, organization_role, entity_key,
    scope_class, scope_class_status, supplier_routing, highest_value,
    sectors, official_website
) values
    ('PepsiCo, Inc.', 'PepsiCo, Inc.', 'manufacturer_brand', 'sec:0000077476',
     'fnb_core', 'provisional', false, true,
     array['beverage', 'snacks'], 'https://www.pepsico.com'),

    ('The Coca-Cola Company', 'The Coca-Cola Company', 'manufacturer_brand', 'sec:0000021344',
     'fnb_core', 'provisional', false, true,
     array['beverage'], 'https://www.coca-colacompany.com'),

    -- Ownership-only SEC coverage: verified identity, no operational periodic
    -- filings. Plant activity has to come from US subsidiary newsrooms.
    ('Nestle S.A.', 'Nestle S.A.', 'parent_company', 'sec:0000792990',
     'fnb_core', 'provisional', false, true,
     array['food', 'beverage', 'dairy'], 'https://www.nestle.com'),

    ('The Kroger Co.', 'The Kroger Co.', 'retailer', 'sec:0000056873',
     'fnb_core', 'provisional', false, true,
     array['retail', 'food'], 'https://www.thekrogerco.com'),

    ('Tyson Foods, Inc.', 'Tyson Foods, Inc.', 'manufacturer_brand', 'sec:0000100493',
     'fnb_core', 'provisional', false, true,
     array['protein', 'food'], 'https://www.tysonfoods.com'),

    -- Private. No CIK for the operating company, so coverage comes from the
    -- newsroom and from the acquired footprint's public trail.
    ('Mars, Incorporated', 'Mars, Incorporated', 'manufacturer_brand', 'radar:mars-incorporated',
     'fnb_core', 'provisional', false, true,
     array['confectionery', 'food', 'pet_care'], 'https://www.mars.com'),

    ('The Hershey Company', 'The Hershey Company', 'manufacturer_brand', 'sec:0000047111',
     'fnb_core', 'provisional', false, true,
     array['confectionery'], 'https://www.thehersheycompany.com'),

    -- Adjacent consumer products, not food. Silence from a food-enforcement
    -- source is CORRECT here and must not be scored as a coverage gap.
    ('Kimberly-Clark Corporation', 'Kimberly-Clark Corporation', 'manufacturer_brand', 'sec:0000055785',
     'fnb_adjacent', 'provisional', false, true,
     array['consumer_products'], 'https://www.kimberly-clark.com'),

    ('Unilever PLC', 'Unilever PLC', 'parent_company', 'sec:0000217410',
     'fnb_core', 'provisional', false, true,
     array['food', 'beverage', 'consumer_products'], 'https://www.unilever.com'),

    ('The Procter & Gamble Company', 'The Procter & Gamble Company', 'manufacturer_brand', 'sec:0000080424',
     'fnb_adjacent', 'provisional', false, true,
     array['consumer_products'], 'https://us.pg.com'),

    -- Classified non_fnb and provisional, exactly as the coverage matrix records
    -- it. On the list for sound commercial reasons that are not F&B.
    ('The Sherwin-Williams Company', 'The Sherwin-Williams Company', 'manufacturer_brand', 'sec:0000089800',
     'non_fnb', 'provisional', false, true,
     array['coatings'], 'https://www.sherwin-williams.com'),

    -- Supplier semantics: a signal about Ecolab's OWN plant is eligible, one
    -- about a customer's plant is account intelligence. That distinction is a
    -- property of which facility a signal concerns, which is why it is a column
    -- and not a class.
    ('Ecolab Inc.', 'Ecolab Inc.', 'ingredient_supplier', 'sec:0000031462',
     'fnb_adjacent', 'provisional', true, true,
     array['sanitation', 'water_treatment'], 'https://www.ecolab.com'),

    -- The verified CIK is HISTORICAL. There is no current periodic coverage, so
    -- this account depends on the North American newsroom and state records.
    ('Danone S.A.', 'Danone S.A.', 'parent_company', 'sec:0001048515',
     'fnb_core', 'provisional', false, true,
     array['dairy', 'beverage'], 'https://www.danone.com'),

    -- Mid-reorganization. Expected to become two accounts during the pilot.
    ('Keurig Dr Pepper Inc.', 'Keurig Dr Pepper Inc.', 'manufacturer_brand', 'sec:0001418135',
     'fnb_core', 'provisional', false, true,
     array['beverage'], 'https://www.keurigdrpepper.com'),

    -- Private, no SEC coverage found. Coverage is state incentives, local
    -- permits and water filings.
    ('Niagara Bottling, LLC', 'Niagara Bottling, LLC', 'manufacturer_brand', 'radar:niagara-bottling',
     'fnb_core', 'provisional', false, true,
     array['beverage', 'bottled_water'], 'https://www.niagarawater.com')

on conflict (entity_key) where entity_key is not null do update set
    canonical_name     = excluded.canonical_name,
    legal_name         = excluded.legal_name,
    organization_role  = excluded.organization_role,
    scope_class        = excluded.scope_class,
    supplier_routing   = excluded.supplier_routing,
    highest_value      = excluded.highest_value,
    sectors            = excluded.sectors,
    official_website   = excluded.official_website,
    updated_at         = now();

-- Record the SEC identifier separately as well, so entity resolution can find an
-- account by CIK without parsing `entity_key`.
insert into organization_identifiers (organization_id, identifier_system, identifier_value, source_url)
select o.id, 'sec_cik', substring(o.entity_key from 5),
       'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=' || substring(o.entity_key from 5)
from organizations o
where o.entity_key like 'sec:%'
on conflict (identifier_system, identifier_value) do nothing;

-- NOT seeded here: the corporate-structure edges the coverage matrix flags as
-- live resolution hazards (the ice-cream demerger, the water-brands succession,
-- the confectionery acquisition). Each needs its counterparty organization to
-- exist first, and those counterparties are not pilot accounts. They belong with
-- entity resolution in the First Live Data PR, where the organizations they
-- point at are actually created. Writing a relationship whose other end does not
-- exist would silently insert nothing and look like it had worked.
